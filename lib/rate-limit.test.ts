import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPool } from "./db.ts";
import { clientIp, consume, limitRequest } from "./rate-limit.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
// Unique per run so parallel runs and the app's own rows never collide; everything under it is deleted after.
const PREFIX = `test-${randomUUID()}`;
const WINDOW = 60_000;

after(async () => {
  if (skip) return;
  await getPool().query("DELETE FROM rate_limits WHERE key LIKE $1", [`${PREFIX}%`]);
  await getPool().end();
});

test("clientIp takes the first x-forwarded-for entry and falls back to a shared bucket", () => {
  assert.equal(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } })), "1.2.3.4");
  assert.equal(clientIp(new Request("http://x")), "unknown");
});

test("allows up to the limit, then denies with a retry time", { skip }, async () => {
  const key = `${PREFIX}:limit`;
  const start = Math.floor(Date.now() / WINDOW) * WINDOW;
  const now = start + 10_000;
  for (let i = 0; i < 3; i++) assert.equal((await consume(key, 3, WINDOW, now)).allowed, true);
  const denied = await consume(key, 3, WINDOW, now);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 50);
});

test("a new window starts a fresh count", { skip }, async () => {
  const key = `${PREFIX}:rollover`;
  const start = Math.floor(Date.now() / WINDOW) * WINDOW;
  assert.equal((await consume(key, 1, WINDOW, start)).allowed, true);
  assert.equal((await consume(key, 1, WINDOW, start + 1)).allowed, false);
  assert.equal((await consume(key, 1, WINDOW, start + WINDOW)).allowed, true);
});

test("parallel calls never allow more than the limit", { skip }, async () => {
  const key = `${PREFIX}:parallel`;
  const now = Math.floor(Date.now() / WINDOW) * WINDOW + 10_000;
  const results = await Promise.all(Array.from({ length: 20 }, () => consume(key, 5, WINDOW, now)));
  assert.equal(results.filter((r) => r.allowed).length, 5);
});

test("a request over its own limit does not spend the global budget, and the key holds no raw IP", { skip }, async () => {
  const name = `${PREFIX}:both`;
  const limits = { name, noun: "things", ip: { limit: 1, windowMs: WINDOW }, global: { limit: 100, windowMs: WINDOW } };
  const req = new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.7" } });
  assert.equal(await limitRequest(req, limits), null);
  const res = await limitRequest(req, limits);
  assert.equal(res?.status, 429);
  assert.match(res!.headers.get("Retry-After")!, /^[0-9]+$/);
  assert.match((await res!.json()).error, /Try again in/);
  const { rows } = await getPool().query("SELECT key, count FROM rate_limits WHERE key LIKE $1 ORDER BY key", [`${name}:%`]);
  assert.equal(rows.find((r) => r.key === `${name}:global`).count, 1);
  assert.ok(rows.every((r) => !r.key.includes("203.0.113.7")));
});
