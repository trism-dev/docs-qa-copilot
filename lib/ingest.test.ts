import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getPool } from "./db.ts";
import { ingestDocument } from "./ingest.ts";
import { PdfError } from "./pdf.ts";
import { makePdf } from "./test-pdf.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

after(async () => {
  if (!skip) await getPool().end();
});

test("ingests a PDF with page numbers and 384-dim embeddings", { skip, timeout: 300_000 }, async () => {
  const pdf = await makePdf([
    ["The annual deductible for in-network care is 500 dollars per person."],
    ["Dental cleanings are covered twice per year at no cost to the member."],
  ]);
  const pool = getPool();
  const result = await ingestDocument({ name: "ingest-test.pdf", owner: "ingest-test", expiresAt: null, buffer: pdf });
  try {
    assert.equal(result.pages, 2);
    assert.equal(result.chunks, 2);
    const { rows } = await pool.query(
      "SELECT page, ord, text, vector_dims(embedding) AS dims FROM chunks WHERE document_id = $1 ORDER BY ord",
      [result.id],
    );
    assert.deepEqual(rows.map((r) => [r.page, r.ord, r.dims]), [[1, 0, 384], [2, 1, 384]]);
    assert.match(rows[1].text, /Dental/);
    const doc = await pool.query("SELECT owner, pages FROM documents WHERE id = $1", [result.id]);
    assert.deepEqual(doc.rows[0], { owner: "ingest-test", pages: 2 });
  } finally {
    await pool.query("DELETE FROM documents WHERE id = $1", [result.id]);
  }
});

test("a PDF whose chunks are all too small is rejected, not stored", async () => {
  const pdf = await makePdf([["Hi"], ["ok"]]);
  await assert.rejects(
    ingestDocument({ name: "tiny.pdf", owner: "ingest-test", expiresAt: null, buffer: pdf }),
    (err: unknown) => err instanceof PdfError && err.code === "no_text",
  );
});
