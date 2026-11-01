import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The route cannot be imported under node (lib/owner.ts imports next/headers), so the key check is the pure
// readApiKey (tested in api-key.test.ts) and these tests guard how the code uses it. The behavior itself
// (401 with a server key set and no header) is checked over HTTP against `next start`.
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// Whole-line // comments and block comments only. A // after code is kept: it may be inside a URL string,
// and stripping it would let a line like `const u = "https://x"; process.env.ANTHROPIC_API_KEY` hide a read.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

// Any read of a process.env name starting with ANTHROPIC: dot access, bracket access, or destructuring.
const ENV_READ = [
  /process\.env\s*\??\.\s*ANTHROPIC/,
  /process\.env\s*(\?\.)?\s*\[\s*["'`]\s*ANTHROPIC/,
  /\{[^{}]*\bANTHROPIC\w*[^{}]*\}\s*=\s*process\.env\b/,
];
const readsAnthropicEnv = (src: string) => ENV_READ.some((re) => re.test(stripComments(src)));

// new Anthropic(...) with no options object naming apiKey makes the SDK read ANTHROPIC_API_KEY itself.
function unsafeClients(src: string): string[] {
  const code = stripComments(src);
  const bad: string[] = [];
  for (const m of code.matchAll(/new\s+Anthropic\w*\s*\(/g)) {
    const args = code.slice(m.index + m[0].length);
    if (!/^\s*\{[^}]*\bapiKey\b/.test(args)) bad.push(code.slice(m.index, m.index + 60).split("\n")[0]);
  }
  return bad;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path] : [];
  });
}
const served = () => [...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "lib"))];

test("the detectors catch what they are for", () => {
  assert.ok(readsAnthropicEnv('const u = "https://example.com"; const k = process.env.ANTHROPIC_API_KEY;'));
  assert.ok(readsAnthropicEnv('const k = process.env["ANTHROPIC_AUTH_TOKEN"];'));
  assert.ok(readsAnthropicEnv("const k = process.env[`ANTHROPIC_BASE_URL`];"));
  assert.ok(readsAnthropicEnv("const { ANTHROPIC_API_KEY: k } = process.env;"));
  assert.ok(!readsAnthropicEnv("// process.env.ANTHROPIC_API_KEY\n/* process.env.ANTHROPIC_API_KEY */\nconst a = process.env.DATABASE_URL;"));
  assert.equal(unsafeClients("const c = new Anthropic();").length, 1);
  assert.equal(unsafeClients("const c = new Anthropic({ timeout: 5 });").length, 1);
  assert.equal(unsafeClients("const c = new Anthropic({ apiKey, timeout: 5 });").length, 0);
});

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

test("the route uses the key only to hand it to answerQuestion", () => {
  const code = stripComments(readFileSync(join(root, "app/api/ask/route.ts"), "utf8"));
  assert.equal(code.match(/\bkey\.apiKey\b/g)?.length, 1, "key.apiKey must appear exactly once");
  assert.match(code, /answerQuestion\(\s*parsed\.question,\s*\{\s*apiKey:\s*key\.apiKey\b/);
  // The only other things done with `key` are the error check and reading its message.
  const uses = [...code.matchAll(/(?<![\w.\-/])key\b(?!\s*[:=])\S*/g)].map((m) => m[0]).filter((u) => !/^key\.(apiKey|error)\b/.test(u) && u !== "key)");
  assert.deepEqual(uses, [], "key is used somewhere other than the error check and answerQuestion");
  assert.ok(!/console\./.test(code), "the route must not log");
});

test("neither app/ nor lib/ reads an ANTHROPIC_* variable from process.env", () => {
  assert.deepEqual(served().filter((f) => readsAnthropicEnv(readFileSync(f, "utf8"))), []);
});

test("every Anthropic client is built with an explicit apiKey", () => {
  const offenders = served().flatMap((f) => unsafeClients(readFileSync(f, "utf8")).map((l) => `${f}: ${l}`));
  assert.deepEqual(offenders, []);
  // And there is at least one, so the scan is not passing by finding nothing.
  assert.ok(served().some((f) => /new\s+Anthropic\s*\(/.test(readFileSync(f, "utf8"))));
});
