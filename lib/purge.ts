import { getPool } from "./db.ts";

// Deletes expired uploads (their chunks cascade) and old rate-limit windows. A NULL expires_at never compares
// as expired, so public documents are never touched. `db` is a parameter only so a test can run inside a rolled-back transaction.
export async function purgeExpired(db: { query: (sql: string) => Promise<{ rowCount: number | null }> } = getPool()) {
  const documents = await db.query("DELETE FROM documents WHERE expires_at <= now()");
  const limits = await db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'");
  return { documents: documents.rowCount ?? 0, rateLimits: limits.rowCount ?? 0 };
}
