import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs as nodeParseArgs } from "node:util";
import { answerQuestion, MODEL } from "../lib/answer.ts";
import { getPool } from "../lib/db.ts";
import { aggregateAll, costOf, INPUT_PRICE, OUTPUT_PRICE, type Aggregate, type QuestionResult, type Report } from "../lib/eval-report.ts";
import { K, retrieve, type RetrievedChunk } from "../lib/retrieve.ts";
import { missedFactsIn, scoreResult, type Question } from "../lib/score.ts";

const CONCURRENCY = 3;
const ATTEMPTS = 3;

export type Args = { split: "dev" | "heldout" | "all"; retrievalOnly: boolean; final: boolean; label: string; out: string };

export function parseArgs(argv: string[]): Args {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      split: { type: "string", default: "dev" },
      "retrieval-only": { type: "boolean", default: false },
      final: { type: "boolean", default: false },
      label: { type: "string", default: "run" },
      out: { type: "string" },
    },
  });
  const split = values.split;
  if (split !== "dev" && split !== "heldout" && split !== "all") throw new Error(`--split must be dev, heldout or all, got "${split}"`);
  // The held-out questions are for one final run, after tuning is frozen. Refuse everything else, retrieval-only included.
  if (split !== "dev" && !values.final) throw new Error(`--split ${split} is refused without --final: the held-out questions are for one final run, after tuning is frozen`);
  const label = values.label!;
  return { split, retrievalOnly: values["retrieval-only"]!, final: values.final!, label, out: values.out ?? path.join("eval", "results", `${label}.json`) };
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function corpusInfo(): Promise<Report["meta"]["corpus"]> {
  const { rows } = await getPool().query(
    `SELECT d.name, d.pages, (SELECT count(*)::int FROM chunks c WHERE c.document_id = d.id) AS chunks
     FROM documents d WHERE d.owner IS NULL AND (d.expires_at IS NULL OR d.expires_at > now()) ORDER BY d.name`,
  );
  return {
    documents: rows.map((r) => r.name as string),
    pages: rows.reduce((s, r) => s + Number(r.pages), 0),
    chunks: rows.reduce((s, r) => s + Number(r.chunks), 0),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function base(q: Question, chunks: RetrievedChunk[]): QuestionResult {
  const goldIdx = q.unanswerable ? -1 : chunks.findIndex((c) => c.documentName === q.document && q.gold_pages.includes(c.page));
  return {
    id: q.id,
    question: q.question,
    split: q.split,
    category: q.category,
    document: q.document,
    goldPages: q.gold_pages,
    reference: q.reference,
    retrieved: chunks.map((c) => ({ documentName: c.documentName, page: c.page, chunkId: c.chunkId, score: c.score })),
    factsInContext: q.unanswerable ? null : missedFactsIn(q, chunks.map((c) => c.text).join(" ")).length === 0,
    firstGoldRank: goldIdx >= 0 ? goldIdx + 1 : null,
    answer: null,
    citations: [],
    score: null,
    error: null,
    attempts: 0,
    firstTextMs: null,
    totalMs: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    servedModel: null,
    stopReason: null,
  };
}

async function runRetrievalOnly(q: Question): Promise<QuestionResult> {
  const t0 = performance.now();
  const r = base(q, await retrieve(q.question, { owner: null }));
  r.totalMs = performance.now() - t0;
  r.attempts = 1;
  return r;
}

// The same call the app makes, as a public user. A persistent failure is recorded as incorrect, never dropped.
async function runFull(q: Question): Promise<QuestionResult> {
  let error = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const t0 = performance.now();
    let firstTextMs: number | null = null;
    error = "no result";
    for await (const ev of answerQuestion(q.question, { apiKey: process.env.ANTHROPIC_API_KEY ?? "", owner: null })) {
      if (ev.type === "text") firstTextMs ??= performance.now() - t0;
      else if (ev.type === "error") error = `${ev.code}: ${ev.message}`;
      else if (ev.type === "done") {
        const answer = ev.blocks.map((b) => b.text).join("");
        const r = base(q, ev.retrievedChunks);
        r.answer = answer;
        r.citations = ev.citations.map((c) => ({ n: c.n, documentName: c.documentName, page: c.page, quote: c.quote }));
        r.score = scoreResult(q, { answer, citations: r.citations });
        r.attempts = attempt;
        r.firstTextMs = firstTextMs;
        r.totalMs = performance.now() - t0;
        r.inputTokens = ev.usage.input_tokens;
        r.outputTokens = ev.usage.output_tokens;
        r.costUsd = costOf(ev.usage.input_tokens, ev.usage.output_tokens);
        r.servedModel = ev.model;
        r.stopReason = ev.stopReason;
        return r;
      }
    }
    if (attempt < ATTEMPTS) await sleep(2000 * attempt ** 2);
  }
  const r = base(q, []);
  r.answer = "";
  r.score = scoreResult(q, { answer: "", citations: [] });
  r.error = error;
  r.attempts = ATTEMPTS;
  return r;
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const pct = (x: number | null) => (x === null ? "  -  " : `${(x * 100).toFixed(1)}%`.padStart(5));
const secs = (x: number | null) => (x === null ? "-" : `${(x / 1000).toFixed(1)}s`);

function summary(name: string, a: Aggregate, retrievalOnly: boolean): string {
  const lines = [`${name} (n=${a.n}, ${a.answerable} answerable, ${a.unanswerable} unanswerable${a.errors ? `, ${a.errors} errors` : ""})`];
  lines.push(`  recall@k ${pct(a.recallAtK)}  recall@8 ${pct(a.recallAt8)}  facts-in-context ${pct(a.contextFactRecall)}  MRR ${a.mrr === null ? "-" : a.mrr.toFixed(3)}`);
  if (!retrievalOnly) {
    lines.push(`  answer ${pct(a.answerAccuracy)}  citation ${pct(a.citationAccuracy)}  abstention ${pct(a.abstentionAccuracy)}`);
    lines.push(`  by category: ${Object.entries(a.byCategory).map(([c, v]) => `${c} ${v.correct}/${v.n}`).join("  ")}`);
    lines.push(`  latency p50 ${secs(a.p50Ms)} p95 ${secs(a.p95Ms)}  cost/question $${a.costPerQuestion?.toFixed(4)}  total $${a.totalCost.toFixed(2)}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all: Question[] = JSON.parse(await readFile(new URL("../eval/questions.json", import.meta.url), "utf8"));
  const questions = args.split === "all" ? all : all.filter((q) => q.split === args.split);
  if (!args.retrievalOnly && !process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  const corpus = await corpusInfo();
  console.error(`corpus: ${corpus.documents.length} documents, ${corpus.pages} pages, ${corpus.chunks} chunks; k=${K}; ${questions.length} questions (${args.split})`);
  const results = await pool(questions, CONCURRENCY, async (q) => {
    const r = args.retrievalOnly ? await runRetrievalOnly(q) : await runFull(q);
    console.error(`${q.id} ${args.retrievalOnly ? `gold rank ${r.firstGoldRank ?? "none"}` : r.score!.correct ? "ok" : `FAIL${r.error ? ` (${r.error})` : ""}`} ${secs(r.totalMs)}`);
    return r;
  });

  const dirty = git(["status", "--porcelain", "--", ".", ":!eval/results"]) !== "";
  const report: Report = {
    meta: {
      date: new Date().toISOString(),
      sha: git(["rev-parse", "--short", "HEAD"]),
      dirty,
      label: args.label,
      split: args.split,
      retrievalOnly: args.retrievalOnly,
      final: args.final,
      model: args.retrievalOnly ? null : MODEL,
      k: K,
      corpus,
      pricing: { inputPerMillion: INPUT_PRICE, outputPerMillion: OUTPUT_PRICE },
    },
    aggregates: aggregateAll(results, args.retrievalOnly),
    results,
  };
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(report, null, 2) + "\n");
  console.log(`${report.meta.label} @ ${report.meta.sha}${dirty ? "+dirty" : ""}  ${report.meta.date}  -> ${args.out}`);
  for (const [name, a] of Object.entries(report.aggregates)) console.log(summary(name, a, args.retrievalOnly));
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    try {
      await getPool().end();
    } catch {} // no pool when DATABASE_URL was never needed
  }
}
