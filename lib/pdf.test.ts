import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPages, MAX_PAGES, PdfError } from "./pdf.ts";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { makePdf } from "./test-pdf.ts";

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof PdfError, String(err));
    return err.code;
  }
  assert.fail("expected PdfError");
}

test("page numbers and line reconstruction", async () => {
  const pdf = await makePdf([["Alpha first page"], ["Beta second page", "Copay 30 dollars"], ["Gamma third page"]]);
  const pages = await extractPages(pdf);
  assert.deepEqual(pages, [
    { page: 1, text: "Alpha first page" },
    { page: 2, text: "Beta second page\nCopay 30 dollars" },
    { page: 3, text: "Gamma third page" },
  ]);
});

test("non-PDF rejected", async () => {
  assert.equal(await codeOf(extractPages(Buffer.from("hello, definitely not a pdf"))), "not_pdf");
});

test("corrupt PDF gives a clean error", async () => {
  assert.equal(await codeOf(extractPages(Buffer.from("%PDF-1.7\nthis is garbage"))), "bad_pdf");
});

test("PDF without text rejected", async () => {
  assert.equal(await codeOf(extractPages(await makePdf([[], []]))), "no_text");
});

test("too many pages rejected", async () => {
  const pdf = await makePdf(Array.from({ length: MAX_PAGES + 1 }, () => ["x"]));
  assert.equal(await codeOf(extractPages(pdf)), "too_many_pages");
});

test("NUL characters are stripped from extracted text", async () => {
  // A ToUnicode map sends char code 0 to U+0000, so pdf.js really emits a NUL.
  const stream = "BT /F1 12 Tf 50 700 Td (Hello\\000World with some more words) Tj ET";
  const cmap =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <00> <0000> endbfchar endcmap end end";
  const obj = (n: number, body: string) => `${n} 0 obj${body} endobj\n`;
  const pdf = Buffer.from(
    "%PDF-1.4\n" +
      obj(1, "<</Type/Catalog/Pages 2 0 R>>") +
      obj(2, "<</Type/Pages/Kids[3 0 R]/Count 1>>") +
      obj(3, "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>") +
      obj(4, `<</Length ${stream.length}>>stream\n${stream}\nendstream`) +
      obj(5, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica/ToUnicode 6 0 R>>") +
      obj(6, `<</Length ${cmap.length}>>stream\n${cmap}\nendstream`) +
      "trailer<</Root 1 0 R>>\n%%EOF",
  );
  const [page] = await extractPages(pdf);
  assert.ok(page.text.includes("Hello") && page.text.includes("World"));
  assert.ok(!page.text.includes(String.fromCharCode(0)));
});


test("items of one word are joined, items a space apart are separated, wide gaps get a marker", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage();
  const size = 12;
  // Draw each piece as its own text item, the way kerned PDFs do. offset = gap after the previous piece.
  let x = 50;
  for (const [text, gap] of [["Pr", 0], ["eferred", -0.5], ["provider", 3], ["Cell", 30]] as const) {
    x += gap;
    page.drawText(text, { x, y: 700, size, font });
    x += font.widthOfTextAtSize(text, size);
  }
  const [{ text }] = await extractPages(Buffer.from(await doc.save()));
  assert.equal(text, "Preferred provider | Cell");
});
