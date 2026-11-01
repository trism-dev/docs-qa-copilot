import { cookies } from "next/headers";

const NAME = "owner";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only a UUID counts as an owner: anything else is treated as no cookie.
export async function getOwner(): Promise<string | null> {
  const value = (await cookies()).get(NAME)?.value;
  return value && UUID.test(value) ? value : null;
}

export async function getOrCreateOwner(): Promise<string> {
  const existing = await getOwner();
  if (existing) return existing;
  const id = crypto.randomUUID();
  (await cookies()).set(NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
}
