import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getPool } from "../lib/db.ts";
import { ingestDocument } from "../lib/ingest.ts";
import { extractPages } from "../lib/pdf.ts";

type Entry = { url: string; file: string; name: string };

const OPM = "https://www.opm.gov/healthcare-insurance/healthcare/plan-information/plans/pdf/2026/brochures";
const CORE: Entry[] = [
  { url: `${OPM}/71-005.pdf`, file: "71-005.pdf", name: "2026 FEHB Blue Cross Blue Shield Service Benefit Plan Brochure (RI 71-005)" },
  { url: "https://www.medicare.gov/publications/10050-medicare-and-you.pdf", file: "10050-medicare-and-you.pdf", name: "Medicare & You 2027" },
];
const EXTRA: Entry = { url: `${OPM}/71-017.pdf`, file: "71-017.pdf", name: "2026 FEHB FEP Blue Focus Brochure (RI 71-017)" };
const MIN_TOTAL_PAGES = 200;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const dir = new URL("../corpus/", import.meta.url);

async function load(e: Entry): Promise<Buffer> {
  const file = new URL(e.file, dir);
  if (!existsSync(file)) {
    const res = await fetch(e.url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`download ${e.url}: ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFile(file);
}

async function ingest(e: Entry): Promise<number> {
  const buffer = await load(e);
  const pages = await extractPages(buffer);
  const dump = pages.map((p) => `=== page ${p.page} ===\n${p.text}`).join("\n\n");
  await writeFile(new URL(`${e.file.replace(/\.pdf$/, "")}.txt`, dir), dump + "\n");

  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT d.id, (SELECT count(*)::int FROM chunks WHERE document_id = d.id) AS chunks FROM documents d WHERE d.name = $1 AND d.owner IS NULL",
    [e.name],
  );
  if (rows.length > 0) {
    console.log(`${e.name}: already ingested, ${pages.length} pages, ${rows[0].chunks} chunks`);
  } else {
    const r = await ingestDocument({ name: e.name, owner: null, expiresAt: null, buffer });
    console.log(`${e.name}: ${r.pages} pages, ${r.chunks} chunks`);
  }
  return pages.length;
}

const start = Date.now();
await mkdir(dir, { recursive: true });
try {
  let total = 0;
  for (const e of CORE) total += await ingest(e);
  if (total < MIN_TOTAL_PAGES) total += await ingest(EXTRA);
  console.log(`total ${total} pages in ${((Date.now() - start) / 1000).toFixed(1)}s`);
} finally {
  await getPool().end();
}
