import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { toSql } from "pgvector";
import { getPool } from "./db.ts";
import { purgeExpired } from "./purge.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

after(async () => {
  if (!skip) await getPool().end();
});

// purgeExpired deletes every expired row, not just this test's. Running it in a transaction that is always
// rolled back means the test never changes rows another process (or a shared dev database) owns.
test("deletes expired uploads and old rate limits, keeps public, unexpired and recent rows", { skip }, async () => {
  const client = await getPool().connect();
  const tag = randomUUID();
  const vec = toSql(Array.from({ length: 384 }, (_, i) => i / 384));
  try {
    await client.query("BEGIN");
    const add = async (name: string, owner: string | null, expires: string) =>
      (await client.query(`INSERT INTO documents (name, owner, pages, expires_at) VALUES ($1, $2, 1, ${expires}) RETURNING id`, [`purge-${tag}-${name}`, owner])).rows[0].id as string;
    const expired = await add("expired", tag, "now() - interval '1 hour'");
    const live = await add("live", tag, "now() + interval '1 hour'");
    const publicDoc = await add("public", null, "NULL");
    for (const id of [expired, live, publicDoc]) {
      await client.query("INSERT INTO chunks (document_id, page, ord, text, embedding) VALUES ($1, 1, 0, 'purge test', $2)", [id, vec]);
    }
    await client.query("INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now() - interval '3 days', 1), ($2, now(), 1)", [`purge-${tag}:old`, `purge-${tag}:new`]);

    const result = await purgeExpired(client);
    assert.ok(result.documents >= 1 && result.rateLimits >= 1);

    const docs = await client.query("SELECT id FROM documents WHERE id = ANY($1::uuid[])", [[expired, live, publicDoc]]);
    assert.deepEqual(docs.rows.map((r) => r.id).sort(), [live, publicDoc].sort());
    const chunks = await client.query("SELECT document_id FROM chunks WHERE document_id = ANY($1::uuid[])", [[expired, live, publicDoc]]);
    assert.deepEqual(chunks.rows.map((r) => r.document_id).sort(), [live, publicDoc].sort());
    const limits = await client.query("SELECT key FROM rate_limits WHERE key LIKE $1", [`purge-${tag}:%`]);
    assert.deepEqual(limits.rows.map((r) => r.key), [`purge-${tag}:new`]);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
});
