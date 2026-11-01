import { test } from "node:test";
import assert from "node:assert/strict";
import { readNdjson } from "./ndjson.ts";

function bodyOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });
}

async function all(body: ReadableStream<Uint8Array>) {
  const out: unknown[] = [];
  for await (const v of readNdjson(body)) out.push(v);
  return out;
}

test("joins a JSON line split across reads", async () => {
  const bytes = new TextEncoder().encode('{"type":"text","text":"abc"}\n{"type":"done"}\n');
  // Every possible split point, including mid-line.
  for (let i = 1; i < bytes.length; i++) {
    const got = await all(bodyOf([bytes.slice(0, i), bytes.slice(i)]));
    assert.deepEqual(got, [{ type: "text", text: "abc" }, { type: "done" }], `split at ${i}`);
  }
});

test("keeps a multi-byte character split across reads intact", async () => {
  const bytes = new TextEncoder().encode('{"text":"price €5 — ok"}\n');
  for (let i = 1; i < bytes.length; i++) {
    assert.deepEqual(await all(bodyOf([bytes.slice(0, i), bytes.slice(i)])), [{ text: "price €5 — ok" }]);
  }
});

test("reads a final line with no trailing newline and skips blank lines", async () => {
  const got = await all(bodyOf([new TextEncoder().encode('{"a":1}\n\n{"b":2}')]));
  assert.deepEqual(got, [{ a: 1 }, { b: 2 }]);
});
