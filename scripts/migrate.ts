import { readFile } from "node:fs/promises";
import pg from "pg";

// Own short-lived Client rather than the shared pool, which is for the app.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  console.log("schema applied");
} finally {
  await client.end();
}
