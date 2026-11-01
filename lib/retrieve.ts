import { toSql } from "pgvector";
import { getPool } from "./db.ts";
import { embedQuery } from "./embed.ts";

export type RetrievedChunk = {
  chunkId: number;
  documentId: string;
  documentName: string;
  page: number;
  text: string;
  score: number; // cosine similarity, 1 = identical
};

export async function retrieve(
  query: string,
  opts: { owner?: string | null; documentIds?: string[]; k?: number },
): Promise<RetrievedChunk[]> {
  const k = opts.k ?? 8;
  // Embed before taking a connection: embedding is the slow step.
  const vector = toSql(await embedQuery(query));

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Without this, an HNSW scan stops at ef_search rows and the WHERE filter can leave fewer than k.
    await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
    // relaxed_order may return rows slightly out of order, so sort the final k.
    const { rows } = await client.query(
      `SELECT * FROM (
         SELECT c.id, c.document_id, d.name, c.page, c.text, c.embedding <=> $1::vector AS distance
         FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE (d.owner IS NULL OR d.owner = $2::text)
           AND (d.expires_at IS NULL OR d.expires_at > now())
           AND ($3::uuid[] IS NULL OR c.document_id = ANY($3::uuid[]))
         ORDER BY c.embedding <=> $1::vector
         LIMIT $4
       ) t ORDER BY distance`,
      [vector, opts.owner ?? null, opts.documentIds ?? null, k],
    );
    await client.query("COMMIT");
    return rows.map((r) => ({
      chunkId: Number(r.id),
      documentId: r.document_id,
      documentName: r.name,
      page: r.page,
      text: r.text,
      score: 1 - r.distance,
    }));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
