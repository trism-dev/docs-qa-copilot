import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_PAGES = 300;

export type PdfErrorCode = "not_pdf" | "too_large" | "too_many_pages" | "no_text" | "bad_pdf";

export class PdfError extends Error {
  code: PdfErrorCode;
  constructor(code: PdfErrorCode, message: string) {
    super(message);
    this.name = "PdfError";
    this.code = code;
  }
}

// Postgres text cannot hold NUL, so strip it here, the only place text enters.
const clean = (s: string) => s.replaceAll(String.fromCharCode(0), "").trim();

// Items closer than this in y (PDF points) share a line.
const LINE_TOLERANCE = 3;

export async function extractPages(buffer: Buffer | Uint8Array): Promise<{ page: number; text: string }[]> {
  if (buffer.length > MAX_BYTES) throw new PdfError("too_large", `PDF is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  if (Buffer.from(buffer.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new PdfError("not_pdf", "File is not a PDF");

  // Copy the bytes: pdf.js detaches the array it is given.
  const task = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    // PasswordException, InvalidPDFException and friends all land here.
    throw new PdfError("bad_pdf", `PDF is encrypted or corrupt (${err instanceof Error ? err.name : "unknown"})`);
  }

  try {
    if (doc.numPages > MAX_PAGES) throw new PdfError("too_many_pages", `PDF has ${doc.numPages} pages, the limit is ${MAX_PAGES}`);
    const pages: { page: number; text: string }[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const items = content.items.flatMap((it) =>
        "str" in it && clean(it.str) ? [{ s: clean(it.str), x: it.transform[4], y: it.transform[5] }] : [],
      );
      // Top of page first (PDF y grows upward), then group into lines.
      items.sort((a, b) => b.y - a.y);
      const lines: (typeof items)[] = [];
      for (const it of items) {
        const line = lines.at(-1);
        if (line && Math.abs(line[0].y - it.y) <= LINE_TOLERANCE) line.push(it);
        else lines.push([it]);
      }
      const text = lines.map((l) => l.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ")).join("\n");
      pages.push({ page: n, text });
    }
    if (!pages.some((p) => p.text.length > 0)) {
      throw new PdfError("no_text", "PDF has no extractable text. It is probably scanned; OCR is not supported.");
    }
    return pages;
  } catch (err) {
    if (err instanceof PdfError) throw err;
    throw new PdfError("bad_pdf", "PDF is corrupt");
  } finally {
    await task.destroy();
  }
}
