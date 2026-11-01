import { PDFDocument, StandardFonts } from "pdf-lib";

// Test helper: one PDF page per entry; each entry is a list of lines ([] = blank page).
export async function makePdf(pages: string[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage();
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 700 - i * 20, size: 12, font }));
  }
  return Buffer.from(await doc.save());
}
