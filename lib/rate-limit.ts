import { createHash } from "node:crypto";
import { getPool } from "./db.ts";

export type Rule = { limit: number; windowMs: number };
export type Limits = { name: string; noun: string; ip: Rule; global: Rule };

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// Fixed window aligned to the epoch (so daily windows reset at 00:00 UTC). One atomic upsert, so parallel
// requests never over-allow. `now` is a parameter only so tests can move the clock.
export async function consume(key: string, limit: number, windowMs: number, now = Date.now()): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const start = Math.floor(now / windowMs) * windowMs;
  const { rows } = await getPool().query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, new Date(start)],
  );
  return { allowed: rows[0].count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((start + windowMs - now) / 1000)) };
}

// On Vercel this header is overwritten, not forwarded from outside, so its first entry is the real client (https://vercel.com/docs/headers/request-headers); on any other host it is spoofable.
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

function inWords(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function tooMany(message: string, retryAfterSeconds: number) {
  return Response.json(
    { error: `${message} Try again in ${inWords(retryAfterSeconds)}.`, code: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

// Returns a 429 response when the request is over a limit, otherwise null. The per-IP counter is checked first so a
// rejected request never spends the shared daily budget. Keys hold a hash of the IP, never the address.
export async function limitRequest(req: Request, l: Limits): Promise<Response | null> {
  const ip = createHash("sha256").update(clientIp(req)).digest("hex");
  const mine = await consume(`${l.name}:ip:${ip}`, l.ip.limit, l.ip.windowMs);
  if (!mine.allowed) return tooMany(`You have used your allowance of ${l.ip.limit} ${l.noun}.`, mine.retryAfterSeconds);
  const all = await consume(`${l.name}:global`, l.global.limit, l.global.windowMs);
  if (!all.allowed) return tooMany(`The demo has reached its limit of ${l.global.limit} ${l.noun} for all visitors.`, all.retryAfterSeconds);
  return null;
}
