import { createHash, timingSafeEqual } from "node:crypto";
import { purgeExpired } from "../../../../lib/purge.ts";

export const runtime = "nodejs";

// Hash both sides so the compare is constant-time whatever the lengths.
function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. With no secret set, nothing is allowed in.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameSecret(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await purgeExpired());
}
