import { test, after } from "node:test";
import assert from "node:assert/strict";
import { answerQuestion, mapCitations, MODEL, NOT_IN_DOCUMENTS_SENTENCE, splitSentences, type AnswerEvent, type ContentBlockLike } from "./answer.ts";
import { getPool } from "./db.ts";
import type { RetrievedChunk } from "./retrieve.ts";

const chunk = (chunkId: number, page: number, text: string): RetrievedChunk => ({
  chunkId,
  documentId: `doc-${page}`,
  documentName: `Doc ${page}`,
  page,
  text,
  score: 0.5,
});

const chunks = [
  chunk(10, 5, "Page five says the premium is $100."),
  chunk(11, 28, "Standard Option deductible: $350 per person, $700 per family."),
  chunk(12, 40, "Dental cleanings are covered twice a year."),
];

const cite = (document_index: number, cited_text: string) => ({ type: "content_block_location", document_index, cited_text });

test("maps a citation to the page of the chunk its document_index names", () => {
  const { blocks, citations } = mapCitations(
    [{ type: "text", text: "The deductible is $350.", citations: [cite(1, "Standard Option deductible: $350 per person")] }],
    chunks,
  );
  assert.deepEqual(citations, [
    { n: 1, documentId: "doc-28", documentName: "Doc 28", page: 28, quote: "Standard Option deductible: $350 per person", chunkId: 11 },
  ]);
  assert.deepEqual(blocks, [{ text: "The deductible is $350.", citations: [1] }]);
});

test("dedupes the same chunk and quote, but keeps a different quote from the same chunk", () => {
  const content: ContentBlockLike[] = [
    { type: "text", text: "A ", citations: [cite(1, "$350 per person")] },
    { type: "text", text: "B ", citations: [cite(1, "$350 per person"), cite(1, "$700 per family")] },
  ];
  const { blocks, citations } = mapCitations(content, chunks);
  assert.deepEqual(citations.map((c) => [c.n, c.chunkId, c.quote]), [[1, 11, "$350 per person"], [2, 11, "$700 per family"]]);
  assert.deepEqual(blocks.map((b) => b.citations), [[1], [1, 2]]);
});

test("a block with several citations lists each marker once, in order", () => {
  const { blocks, citations } = mapCitations(
    [{ type: "text", text: "Both.", citations: [cite(2, "twice a year"), cite(0, "premium is $100"), cite(2, "twice a year")] }],
    chunks,
  );
  assert.deepEqual(blocks[0].citations, [1, 2]);
  assert.deepEqual(citations.map((c) => c.page), [40, 5]);
});

test("ignores out-of-range indexes, other citation types and non-text blocks without throwing", () => {
  const content: ContentBlockLike[] = [
    { type: "thinking" },
    { type: "text", text: "x", citations: [cite(99, "nope"), cite(-1, "nope"), { type: "page_location", document_index: 0, cited_text: "nope" }, { type: "content_block_location" }] },
    { type: "text", text: "y", citations: null },
    { type: "text", text: "z" },
  ];
  const { blocks, citations } = mapCitations(content, chunks);
  assert.deepEqual(citations, []);
  assert.deepEqual(blocks, [{ text: "x", citations: [] }, { text: "y", citations: [] }, { text: "z", citations: [] }]);
});

test("drops the declined model's partial output before a fallback marker", () => {
  const { blocks, citations } = mapCitations(
    [
      { type: "text", text: "partial from the model that declined", citations: [cite(0, "premium is $100")] },
      { type: "fallback" },
      { type: "text", text: "The real answer.", citations: [cite(2, "twice a year")] },
    ],
    chunks,
  );
  assert.deepEqual(blocks, [{ text: "The real answer.", citations: [1] }]);
  assert.deepEqual(citations.map((c) => c.chunkId), [12]);
});

test("splitSentences splits at sentence ends and bullets and loses no characters", () => {
  const text = "Under Standard Option, the deductible is $350. You pay 15% after that.\nNote: see below\n• First item\n• Second item. Done";
  const parts = splitSentences(text);
  assert.ok(parts.length >= 5);
  assert.equal(parts.join(""), text);
  assert.deepEqual(splitSentences("no punctuation here"), ["no punctuation here"]);
});

// The one test that spends money: it needs the key and the local database with the public corpus.
const skip = process.env.ANTHROPIC_API_KEY && process.env.DATABASE_URL ? false : "ANTHROPIC_API_KEY or DATABASE_URL not set";

after(async () => {
  if (process.env.DATABASE_URL) await getPool().end();
});

test("real answer: every citation quote occurs in its chunk and the page matches", { skip, timeout: 120_000 }, async (t) => {
  const { rows } = await getPool().query("SELECT count(*)::int AS n FROM documents WHERE owner IS NULL");
  if (rows[0].n === 0) return t.skip("no public corpus in the database");

  let streamed = "";
  let done: Extract<AnswerEvent, { type: "done" }> | undefined;
  for await (const e of answerQuestion("What is the catastrophic protection out-of-pocket maximum under Standard Option?", { owner: null })) {
    assert.notEqual(e.type, "error", e.type === "error" ? e.message : "");
    if (e.type === "text") streamed += e.text;
    if (e.type === "done") done = e;
  }
  assert.ok(done, "stream ended without a done event");
  assert.equal(done.notFound, false);
  assert.notEqual(done.stopReason, "refusal");
  assert.ok(done.retrievedChunks.length > 0 && done.usage.output_tokens > 0);
  assert.ok(done.citations.length > 0, "an answer from the documents should cite them");
  for (const c of done.citations) {
    const source: RetrievedChunk | undefined = done.retrievedChunks.find((r) => r.chunkId === c.chunkId);
    assert.ok(source, `citation ${c.n} names a chunk that was not retrieved`);
    assert.ok(source.text.includes(c.quote), `citation ${c.n} quote is not in its chunk`);
    assert.equal(c.page, source.page);
    assert.equal(c.documentName, source.documentName);
  }
  // Marker numbers on blocks all point at real citations, and the blocks are the streamed text.
  const known = new Set(done.citations.map((c) => c.n));
  assert.ok(done.blocks.every((b) => b.citations.every((n) => known.has(n))));
  assert.equal(done.blocks.map((b) => b.text).join(""), streamed);
  console.log(`# model ${done.model} (requested ${MODEL}), ${done.citations.length} citations`);
});

test("no retrieved chunks returns the not-found sentence without calling the API", { skip: process.env.DATABASE_URL ? false : "DATABASE_URL not set", timeout: 120_000 }, async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-used";
  try {
    // A scope with no documents retrieves nothing.
    const events = [];
    for await (const e of answerQuestion("anything", { owner: null, documentIds: ["00000000-0000-4000-8000-000000000000"] })) events.push(e);
    assert.deepEqual(events.map((e) => e.type), ["text", "done"]);
    const done = events[1];
    assert.ok(done.type === "done" && done.notFound && done.citations.length === 0 && done.model === null);
    assert.equal(done.blocks[0].text, NOT_IN_DOCUMENTS_SENTENCE);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});
