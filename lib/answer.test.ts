import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import util from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { answerQuestion, createClient, describeError, mapCitations, MODEL, NOT_IN_DOCUMENTS_SENTENCE, splitSentences, textEvents, type AnswerEvent, type StreamEventLike, type ContentBlockLike } from "./answer.ts";
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

async function* events(list: StreamEventLike[]) {
  for (const e of list) yield e;
}

test("textEvents turns a stream into text, and a fallback block start into a reset", async () => {
  const delta = (text: string) => ({ type: "content_block_delta", delta: { type: "text_delta", text } });
  const out = [];
  for await (const e of textEvents(
    events([
      { type: "message_start" },
      { type: "content_block_start", content_block: { type: "text" } },
      delta("partial from the model that declined"),
      { type: "content_block_delta", delta: { type: "citations_delta" } },
      { type: "content_block_delta", delta: { type: "thinking_delta" } },
      { type: "content_block_start", content_block: { type: "fallback" } },
      { type: "content_block_start", content_block: { type: "text" } },
      delta("The real "),
      delta("answer."),
      { type: "message_stop" },
    ]),
  )) out.push(e);
  assert.deepEqual(out, [
    { type: "text", text: "partial from the model that declined" },
    { type: "reset" },
    { type: "text", text: "The real " },
    { type: "text", text: "answer." },
  ]);
  // What a client that clears on reset ends up showing.
  let shown = "";
  for (const e of out) shown = e.type === "reset" ? "" : shown + e.text;
  assert.equal(shown, "The real answer.");
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
  for await (const e of answerQuestion("What is the catastrophic protection out-of-pocket maximum under Standard Option?", { apiKey: process.env.ANTHROPIC_API_KEY!, owner: null })) {
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
  // A scope with no documents retrieves nothing.
  const events = [];
  for await (const e of answerQuestion("anything", { apiKey: "sk-ant-test-not-used", owner: null, documentIds: ["00000000-0000-4000-8000-000000000000"] })) events.push(e);
  assert.deepEqual(events.map((e) => e.type), ["text", "done"]);
  const done = events[1];
  assert.ok(done.type === "done" && done.notFound && done.citations.length === 0 && done.model === null);
  assert.equal(done.blocks[0].text, NOT_IN_DOCUMENTS_SENTENCE);
});

const KEY = "sk-ant-fake0000000000000000000";

test("the client uses the caller's key, never the environment's, and an empty key is refused", () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  process.env.ANTHROPIC_API_KEY = "sk-ant-server-key-must-not-be-used";
  process.env.ANTHROPIC_AUTH_TOKEN = "server-token-must-not-be-used";
  try {
    const client = createClient(KEY);
    assert.equal(client.apiKey, KEY);
    assert.equal(client.authToken, null);
    assert.equal(client.baseURL, "https://api.anthropic.com");
    assert.throws(() => createClient(""), /API key is required/);
    assert.throws(() => createClient(undefined as unknown as string), /API key is required/);
  } finally {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  }
});

test("answerQuestion with an empty key fails before retrieval, whatever the environment holds", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-server-key-must-not-be-used";
  try {
    await assert.rejects(answerQuestion("anything", { apiKey: "", owner: null }).next(), /API key is required/);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

// Errors that carry the key in their text, headers or body: the client event and the log must stay free of it.
const apiError = (status: number, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type: "x_error", message: `${message} (x-api-key ${KEY})` } }, `${status} ${message} ${KEY}`, new Headers({ "x-api-key": KEY }));

test("API errors map to fixed messages, and neither the event nor the log contains the key", () => {
  const logged: string[] = [];
  const spy = mock.method(console, "error", (...args: unknown[]) => void logged.push(args.map((a) => (typeof a === "string" ? a : util.inspect(a, { depth: 5 }))).join(" ")));
  try {
    const cases: [unknown, string, string][] = [
      [apiError(401, "invalid x-api-key"), "invalid_key", "Anthropic rejected this API key."],
      [apiError(400, "Your credit balance is too low to access the Anthropic API."), "no_credit", "This API key's account has no credit."],
      [apiError(400, "messages: something else is wrong"), "api", "The model service returned an error. Try again."],
      [apiError(429, "rate limited"), "rate_limit", "This API key is rate limited by Anthropic. Try again shortly."],
      [apiError(403, "forbidden"), "api", "The model service returned an error. Try again."],
      [apiError(500, "overloaded"), "api", "The model service returned an error. Try again."],
      [new Anthropic.APIConnectionError({ message: `connect failed ${KEY}`, cause: new Error(KEY) }), "connection", "Could not reach the model service. Try again."],
      [new Error(`something broke with ${KEY}`), "internal", "Something went wrong while answering. Try again."],
      [`thrown string ${KEY}`, "internal", "Something went wrong while answering. Try again."],
    ];
    for (const [err, code, message] of cases) {
      const event = describeError(err);
      assert.deepEqual([event.code, event.message], [code, message]);
      assert.ok(!JSON.stringify(event).includes(KEY));
    }
    assert.ok(logged.length > 0, "the api and internal paths log something");
    assert.ok(!logged.join("\n").includes(KEY), "the key reached the log");
  } finally {
    spy.mock.restore();
  }
});
