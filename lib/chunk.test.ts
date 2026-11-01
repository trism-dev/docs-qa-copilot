import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkPages } from "./chunk.ts";

const sentence = "The deductible applies to every covered claim in the plan year. ";

test("chunks stay on their page and ord is global", () => {
  const pages = [
    { page: 1, text: sentence.repeat(40) },
    { page: 2, text: "Page two has its own distinct content about dental benefits." },
    { page: 3, text: sentence.repeat(25) },
  ];
  const chunks = chunkPages(pages);
  assert.deepEqual(chunks.map((c) => c.ord), chunks.map((_, i) => i));
  for (const c of chunks) {
    assert.ok(c.text.length <= 1000);
    assert.ok(pages.find((p) => p.page === c.page)!.text.includes(c.text), "chunk text comes from its own page");
  }
  assert.deepEqual([...new Set(chunks.map((c) => c.page))], [1, 2, 3]);
  assert.equal(chunks.filter((c) => c.page === 2).length, 1);
});

test("consecutive chunks overlap and break at a sentence", () => {
  const [a, b] = chunkPages([{ page: 1, text: sentence.repeat(40) }]);
  assert.ok(a.text.endsWith("."));
  const tail = a.text.slice(-100);
  assert.ok(b.text.includes(tail), "next chunk repeats the end of the previous one");
});

test("prefers a line break", () => {
  const line = "Office visit copay is 30 dollars per visit".padEnd(99, "x");
  const [a] = chunkPages([{ page: 1, text: Array(20).fill(line).join("\n") }]);
  assert.ok(a.text.endsWith("x"));
  assert.equal(a.text.split("\n").length, 10);
});

test("tiny pages are dropped, ord has no gaps", () => {
  const chunks = chunkPages([
    { page: 1, text: "12" },
    { page: 2, text: "   \n  " },
    { page: 3, text: "A real sentence with enough characters in it." },
  ]);
  assert.deepEqual(chunks, [{ page: 3, ord: 0, text: "A real sentence with enough characters in it." }]);
});
