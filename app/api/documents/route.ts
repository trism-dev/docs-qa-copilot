import { getPool } from "../../../lib/db.ts";
import { ingestDocument } from "../../../lib/ingest.ts";
import { getOrCreateOwner, getOwner } from "../../../lib/owner.ts";
import { MAX_BYTES, PdfError, type PdfErrorCode } from "../../../lib/pdf.ts";
import { purgeExpired } from "../../../lib/purge.ts";
import { DAY_MS, limitRequest, type Limits } from "../../../lib/rate-limit.ts";

export const runtime = "nodejs";
export const maxDuration = 300;

const LIMITS: Limits = { name: "documents", noun: "uploads", ip: { limit: 5, windowMs: DAY_MS }, global: { limit: 50, windowMs: DAY_MS } };
// Multipart framing adds a little on top of the file itself.
const MAX_BODY = MAX_BYTES + 64 * 1024;

const STATUS: Record<PdfErrorCode, number> = {
  too_large: 413,
  not_pdf: 415,
  too_many_pages: 422,
  no_text: 422,
  bad_pdf: 422,
};

function fail(status: number, error: string, code?: string) {
  return Response.json({ error, code }, { status });
}

function cleanName(raw: string): string {
  // Basename only, no control characters.
  const base = raw.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return base.slice(0, 200) || "document.pdf";
}

export async function POST(req: Request) {
  // Chunked bodies have no length to check up front and formData() would buffer them unbounded.
  const length = req.headers.get("content-length");
  if (length === null || !/^\d+$/.test(length)) return fail(411, "Content-Length required", "length_required");
  if (Number(length) > MAX_BODY) return fail(413, "File too large", "too_large");

  // Before the body is read and before any embedding.
  const limited = await limitRequest(req, LIMITS);
  if (limited) return limited;
  // Expired uploads are hidden at once; this deletes them. A failure must not fail the upload.
  await purgeExpired().catch((err) => console.error("purge failed", err));

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "Expected multipart/form-data with a file field");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "Missing file field");
  if (file.size > MAX_BYTES) return fail(413, "File too large", "too_large");

  try {
    // Uploads are always private to the caller and expire; a public request can never create a public document.
    const owner = await getOrCreateOwner();
    const result = await ingestDocument({
      name: cleanName(file.name),
      owner,
      expiresAt: new Date(Date.now() + DAY_MS),
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PdfError) return fail(STATUS[err.code], err.message, err.code);
    console.error("ingest failed", err);
    return fail(500, "Ingest failed");
  }
}

export async function GET() {
  const owner = await getOwner();
  const { rows } = await getPool().query(
    `SELECT id, name, pages, source_url, created_at, expires_at, owner IS NULL AS public
       FROM documents
      WHERE (owner IS NULL OR owner = $1) AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC`,
    [owner],
  );
  return Response.json(rows);
}
