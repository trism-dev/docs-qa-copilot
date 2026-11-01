const SIZE = 1000;
const OVERLAP = 150;
const MIN_CHARS = 30;

// Prefer ending a chunk at a line or sentence boundary in the back half of the window.
function breakAt(text: string, start: number): number {
  const end = start + SIZE;
  if (end >= text.length) return text.length;
  const window = text.slice(start + SIZE / 2, end);
  const nl = window.lastIndexOf("\n");
  if (nl >= 0) return start + SIZE / 2 + nl + 1;
  const m = [...window.matchAll(/[.!?]\s/g)].at(-1);
  return m ? start + SIZE / 2 + m.index + 2 : end;
}

export function chunkPages(pages: { page: number; text: string }[]): { page: number; ord: number; text: string }[] {
  const out: { page: number; ord: number; text: string }[] = [];
  for (const { page, text } of pages) {
    let start = 0;
    while (start < text.length) {
      const end = breakAt(text, start);
      const piece = text.slice(start, end).trim();
      if (piece.replace(/\s/g, "").length >= MIN_CHARS) out.push({ page, ord: out.length, text: piece });
      if (end >= text.length) break;
      start = Math.max(end - OVERLAP, start + 1); // always advance
    }
  }
  return out;
}
