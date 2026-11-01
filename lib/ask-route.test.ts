import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The route cannot be imported under node (lib/owner.ts imports next/headers), so the key check is the pure
// readApiKey (tested in api-key.test.ts) and these two tests guard how the route uses it. The behavior itself
// (401 with a server key set and no header) is checked over HTTP against `next start`.
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

test("the route checks the key before the body, the rate limit, retrieval and the model", () => {
  const src = readFileSync(join(root, "app/api/ask/route.ts"), "utf8");
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    assert.ok(i >= 0, `${needle} not found in the route`);
    return i;
  };
  const order = ["readApiKey(req.headers)", "parseAskBody(", "limitRequest(", "answerQuestion("].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(src, /if \("error" in key\) return fail\(401,/);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path] : [];
  });
}

test("neither app/ nor lib/ reads the server's Anthropic credentials from the environment", () => {
  const offenders = [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "lib"))].filter((f) => /ANTHROPIC_(API_KEY|AUTH_TOKEN)/.test(readFileSync(f, "utf8").replace(/\/\/.*/g, "")));
  assert.deepEqual(offenders, []);
});
