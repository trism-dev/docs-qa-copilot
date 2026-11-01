import { cookies } from "next/headers";

const NAME = "owner";

export async function getOwner(): Promise<string | null> {
  return (await cookies()).get(NAME)?.value || null;
}

export async function getOrCreateOwner(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(NAME)?.value;
  if (existing) return existing;
  const id = crypto.randomUUID();
  jar.set(NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
}
