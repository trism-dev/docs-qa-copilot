import { toSql } from "pgvector";
import { chunkPages } from "./chunk.ts";
import { getPool } from "./db.ts";
import { embedPassages } from "./embed.ts";
import { extractPages, PdfError } from "./pdf.ts";

const INSERT_BATCH = 200;

export async function ingestDocument(args: {
  name: string;
  owner: string | null;
  expiresAt: Date | null;
  buffer: Buffer | Uint8Array;
}): Promise<{ id: string; name: string; pages: number; chunks: number }> {
  const pages = await extractPages(args.buffer);
  const chunks = chunkPages(pages);
  if (chunks.length === 0) throw new PdfError("no_text", "PDF has too little extractable text. Scanned PDFs are not supported (no OCR).");
  // Embed before taking a connection: embedding is the slow step.
  const vectors = await embedPassages(chunks.map((c) => c.text));

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "INSERT INTO documents (name, owner, pages, expires_at) VALUES ($1, $2, $3, $4) RETURNING id",
      [args.name, args.owner, pages.length, args.expiresAt],
    );
    const id: string = rows[0].id;
    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const batch = chunks.slice(i, i + INSERT_BATCH);
      const params: unknown[] = [id];
      const values = batch.map((c, j) => {
        params.push(c.page, c.ord, c.text, toSql(vectors[i + j]));
        const p = 2 + j * 4;
        return `($1, $${p}, $${p + 1}, $${p + 2}, $${p + 3})`;
      });
      await client.query(`INSERT INTO chunks (document_id, page, ord, text, embedding) VALUES ${values.join(", ")}`, params);
    }
    await client.query("COMMIT");
    return { id, name: args.name, pages: pages.length, chunks: chunks.length };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
