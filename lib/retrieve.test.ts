import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { getPool } from "./db.ts";
import { ingestDocument } from "./ingest.ts";
import { retrieve } from "./retrieve.ts";
import { makePdf } from "./test-pdf.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const A = "retrieve-test-a";
const B = "retrieve-test-b";
const DAY = 86_400_000;

const ids: Record<string, string> = {};

async function add(key: string, name: string, owner: string | null, text: string, expiresAt: Date | null = null) {
  const buffer = await makePdf([["Cover page of the booklet with nothing special in it at all."], [text]]);
  ids[key] = (await ingestDocument({ name, owner, expiresAt, buffer })).id;
}

before(async () => {
  if (skip) return;
  await add("a", "retrieve-a.pdf", A, "The annual deductible for in-network care is 500 dollars per person.");
  await add("pub", "retrieve-public.pdf", null, "The annual deductible for hospital care is 750 dollars per family.");
  // B's text is the best match for the query below.
  await add("b", "retrieve-b.pdf", B, "What is the annual deductible for in-network care? The annual deductible for in-network care is 500 dollars.");
  await add("expired", "retrieve-expired.pdf", null, "The annual deductible for in-network care is 500 dollars per person.", new Date(Date.now() - DAY));
});

after(async () => {
  if (skip) return;
  await getPool().query("DELETE FROM documents WHERE id = ANY($1::uuid[])", [Object.values(ids)]);
  await getPool().end();
});

const Q = "What is the annual deductible for in-network care?";

test("owner A sees own and public chunks, never owner B's", { skip, timeout: 300_000 }, async () => {
  // Presence is scoped so it does not depend on what else is in the db; absence stays unscoped.
  const own = new Set((await retrieve(Q, { owner: A, documentIds: [ids.a, ids.pub, ids.b], k: 50 })).map((r) => r.documentId));
  assert.ok(own.has(ids.a) && own.has(ids.pub));
  assert.ok(!own.has(ids.b));
  const all = (await retrieve(Q, { owner: A, k: 50 })).map((r) => r.documentId);
  assert.ok(!all.includes(ids.b));
});

test("no owner sees only public chunks", { skip, timeout: 300_000 }, async () => {
  const scoped = new Set((await retrieve(Q, { documentIds: [ids.a, ids.pub, ids.b], k: 50 })).map((r) => r.documentId));
  assert.ok(scoped.has(ids.pub));
  assert.ok(!scoped.has(ids.a) && !scoped.has(ids.b));
  const all = (await retrieve(Q, { k: 50 })).map((r) => r.documentId);
  assert.ok(!all.includes(ids.a) && !all.includes(ids.b));
});

test("expired documents never come back", { skip, timeout: 300_000 }, async () => {
  const scoped = new Set((await retrieve(Q, { owner: A, documentIds: [ids.pub, ids.expired], k: 50 })).map((r) => r.documentId));
  assert.ok(scoped.has(ids.pub) && !scoped.has(ids.expired));
  const all = (await retrieve(Q, { owner: A, k: 50 })).map((r) => r.documentId);
  assert.ok(!all.includes(ids.expired));
});

test("documentIds restricts results", { skip, timeout: 300_000 }, async () => {
  const res = await retrieve(Q, { owner: A, documentIds: [ids.pub], k: 50 });
  assert.ok(res.length > 0);
  assert.ok(res.every((r) => r.documentId === ids.pub));
});

test("results carry page and document name, best first", { skip, timeout: 300_000 }, async () => {
  const res = await retrieve(Q, { owner: A, documentIds: [ids.a], k: 5 });
  assert.ok(res.length > 0 && res.every((r) => r.documentId === ids.a && (r.page === 1 || r.page === 2)));
  assert.equal(res[0].documentName, "retrieve-a.pdf");
  assert.equal(res[0].page, 2);
  assert.match(res[0].text, /500 dollars/);
  assert.ok(res.every((r, i) => i === 0 || res[i - 1].score >= r.score) && res[0].score <= 1);
});
