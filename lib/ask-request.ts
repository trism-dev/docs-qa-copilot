const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_QUESTION = 1000;
export const MAX_DOCUMENT_IDS = 20;

// Validates the untrusted request body. The owner is never read from here; it comes from the cookie.
export function parseAskBody(body: unknown): { question: string; documentIds?: string[] } | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { error: "Body must be a JSON object" };
  const { question, documentIds } = body as Record<string, unknown>;
  if (typeof question !== "string" || question.trim() === "") return { error: "question must be a non-empty string" };
  if (question.trim().length > MAX_QUESTION) return { error: `question must be at most ${MAX_QUESTION} characters` };
  if (documentIds === undefined) return { question: question.trim() };
  if (!Array.isArray(documentIds) || documentIds.length > MAX_DOCUMENT_IDS) {
    return { error: `documentIds must be an array of at most ${MAX_DOCUMENT_IDS} ids` };
  }
  if (!documentIds.every((id) => typeof id === "string" && UUID.test(id))) return { error: "documentIds must be UUIDs" };
  return { question: question.trim(), documentIds: documentIds as string[] };
}
