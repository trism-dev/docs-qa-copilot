import { answerQuestion, type AnswerEvent } from "../../../lib/answer.ts";
import { parseAskBody } from "../../../lib/ask-request.ts";
import { getOwner } from "../../../lib/owner.ts";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BODY = 32 * 1024;

function fail(status: number, error: string) {
  return Response.json({ error }, { status });
}

// retrievedChunks stays on the server: the client only gets the page and quote of each citation.
function toClient(e: AnswerEvent) {
  if (e.type !== "done") return e;
  const { retrievedChunks: _omit, ...rest } = e;
  return rest;
}

export async function POST(req: Request) {
  // Same reasoning as /api/documents: a chunked body has no length to check up front.
  const length = req.headers.get("content-length");
  if (length === null || !/^\d+$/.test(length)) return fail(411, "Content-Length required");
  if (Number(length) > MAX_BODY) return fail(413, "Request too large");

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail(400, "Body must be JSON");
  }
  const parsed = parseAskBody(json);
  if ("error" in parsed) return fail(400, parsed.error);

  // Aborted when the client goes away (the request signal) or stops reading (cancel below).
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const events = answerQuestion(parsed.question, { owner: await getOwner(), documentIds: parsed.documentIds, signal: abort.signal });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const r = await events.next();
      if (r.done) controller.close();
      else controller.enqueue(encoder.encode(JSON.stringify(toClient(r.value)) + "\n"));
    },
    async cancel() {
      abort.abort();
      await events.return(undefined);
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
