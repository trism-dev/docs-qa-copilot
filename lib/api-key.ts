// A visitor's own Anthropic key travels in this header, only to /api/ask. Never in a URL, a body or a cookie.
export const API_KEY_HEADER = "x-anthropic-api-key";

// Shape only, not proof the key works: sk-ant- prefix, 20 to 300 characters, no whitespace.
export function isApiKeyShape(value: string): boolean {
  return value.length >= 20 && value.length <= 300 && value.startsWith("sk-ant-") && !/\s/.test(value);
}

// The one place the route gets its key from: the request header. It never reads the server's environment.
export function readApiKey(headers: Headers): { apiKey: string } | { error: string } {
  const value = headers.get(API_KEY_HEADER);
  if (value === null || value === "") return { error: "Add your Anthropic API key to ask a question." };
  if (!isApiKeyShape(value)) return { error: "That does not look like an Anthropic API key. It should start with sk-ant-." };
  return { apiKey: value };
}
