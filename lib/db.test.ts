import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toSql } from "pgvector";
import { getPool } from "./db.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

after(async () => {
  if (!skip) await getPool().end();
});

test("schema applies twice and a vector row round-trips", { skip }, async () => {
  const pool = getPool();
  const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  await pool.query(schema);
  await pool.query(schema);

  const vec = Array.from({ length: 384 }, (_, i) => i / 384);
  const doc = await pool.query("INSERT INTO documents (name, pages) VALUES ('test', 1) RETURNING id");
  const id = doc.rows[0].id;
  try {
    await pool.query("INSERT INTO chunks (document_id, page, ord, text, embedding) VALUES ($1, 1, 0, 'hello world', $2)", [
      id,
      toSql(vec),
    ]);
    const { rows } = await pool.query("SELECT vector_dims(embedding) AS dims, embedding::text AS txt FROM chunks WHERE document_id = $1 AND tsv @@ to_tsquery('english', 'hello')", [id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dims, 384);
    assert.ok(Math.abs(Number(rows[0].txt.slice(1, -1).split(",")[1]) - 1 / 384) < 1e-6);
  } finally {
    await pool.query("DELETE FROM documents WHERE id = $1", [id]);
  }
});
