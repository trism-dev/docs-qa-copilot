import type { AnswerBlock } from "./answer.ts";

// The answer is plain text with **bold** and "- " lists. This turns it into data the page renders
// as elements, so no HTML string is ever built and no markdown library is needed.
export type Inline = { kind: "text" | "bold"; text: string } | { kind: "cite"; n: number };
export type Node = { type: "p"; inline: Inline[] } | { type: "ul" | "ol"; items: Inline[][] };

// Private-use characters stand in for citation markers while parsing.
const OPEN = String.fromCharCode(0xe000);
const CLOSE = String.fromCharCode(0xe001);
const MARK = new RegExp(OPEN + "([0-9]+)" + CLOSE);
const STRAY = new RegExp("[" + OPEN + CLOSE + "]", "g");

// One string, markers in place, so a **bold** span or list that crosses a block boundary still parses.
function joinBlocks(blocks: AnswerBlock[]): string {
  return blocks
    .map((b) => {
      const text = b.text.replace(STRAY, "");
      const marks = b.citations.map((n) => OPEN + n + CLOSE).join("");
      const body = text.trimEnd();
      // Markers go before trailing whitespace so they stay on the line they belong to.
      return body + marks + text.slice(body.length);
    })
    .join("");
}

function inline(s: string): Inline[] {
  const parts = s.split("**");
  // An unmatched ** stays literal text.
  if (parts.length % 2 === 0) {
    const last = parts.pop()!;
    parts[parts.length - 1] += "**" + last;
  }
  const out: Inline[] = [];
  parts.forEach((part, i) => {
    part.split(MARK).forEach((seg, j) => {
      if (j % 2 === 1) out.push({ kind: "cite", n: Number(seg) });
      else if (seg) out.push({ kind: i % 2 === 1 ? "bold" : "text", text: seg });
    });
  });
  return out;
}

export function parseAnswer(blocks: AnswerBlock[]): Node[] {
  const nodes: Node[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (para.length) nodes.push({ type: "p", inline: inline(para.join(" ")) });
    if (list) nodes.push({ type: list.type, items: list.items.map(inline) });
    para = [];
    list = null;
  };
  for (const raw of joinBlocks(blocks).split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const m = /^(?:([-*•])|\d+[.)])\s+(.*)$/.exec(line);
    if (!m) {
      if (list) flush();
      para.push(line);
      continue;
    }
    const type = m[1] ? "ul" : "ol";
    if (para.length || (list && list.type !== type)) flush();
    list ??= { type, items: [] };
    list.items.push(m[2]);
  }
  flush();
  return nodes;
}
