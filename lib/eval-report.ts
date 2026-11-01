import type { Category, Score } from "./score.ts";

// $ per million tokens
export const INPUT_PRICE = 4;
export const OUTPUT_PRICE = 20;

export type QuestionResult = {
  id: string;
  question: string;
  split: "dev" | "heldout";
  category: Category;
  document: string | null;
  goldPages: number[];
  reference: string; // the set's short reference answer, shown on the page next to the system's answer
  retrieved: { documentName: string; page: number; chunkId: number; score: number }[];
  factsInContext: boolean | null; // answerable only: every required fact appears in the text of the retrieved chunks
  firstGoldRank: number | null; // 1-based rank of the first retrieved chunk on a gold page; null if none (or unanswerable)
  answer: string | null; // null in retrieval-only runs
  citations: { n: number; documentName: string; page: number; quote: string }[];
  score: Score | null; // null in retrieval-only runs
  error: string | null; // set when every attempt failed; the question then counts as incorrect
  attempts: number;
  firstTextMs: number | null;
  totalMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  servedModel: string | null;
  stopReason: string | null;
};

export type Aggregate = {
  n: number;
  answerable: number;
  unanswerable: number;
  errors: number;
  answerAccuracy: number | null; // correct / all questions
  citationAccuracy: number | null; // answerable questions with a citation on a gold page
  abstentionAccuracy: number | null; // unanswerable questions answered correctly (abstained, no citations)
  recallAtK: number | null; // answerable questions with a gold page among the retrieved chunks
  recallAt8: number | null; // the same, using only the first 8 chunks
  contextFactRecall: number | null; // answerable questions whose required facts all appear in the retrieved text (stricter than a gold page)
  mrr: number | null; // mean reciprocal rank of the first gold-page chunk (0 when none), answerable only
  byCategory: Record<string, { n: number; correct: number | null; accuracy: number | null }>;
  p50Ms: number | null;
  p95Ms: number | null;
  p50FirstTextMs: number | null;
  costPerQuestion: number | null;
  totalCost: number;
};

export type Report = {
  meta: {
    date: string;
    sha: string;
    dirty: boolean;
    label: string;
    split: string;
    retrievalOnly: boolean;
    final: boolean;
    model: string | null;
    k: number;
    corpus: { documents: string[]; pages: number; chunks: number };
    pricing: { inputPerMillion: number; outputPerMillion: number };
  };
  aggregates: Record<string, Aggregate>; // "overall", plus "dev" and "heldout" for the splits present
  results: QuestionResult[];
};

export const costOf = (inputTokens: number, outputTokens: number) => (inputTokens * INPUT_PRICE + outputTokens * OUTPUT_PRICE) / 1e6;

const ratio = (num: number, den: number) => (den === 0 ? null : num / den);

// Nearest-rank percentile.
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)];
}

export function aggregate(rs: QuestionResult[], retrievalOnly: boolean): Aggregate {
  const answerable = rs.filter((r) => r.category !== "unanswerable");
  const unanswerable = rs.filter((r) => r.category === "unanswerable");
  // A request that failed has no retrieval record, so it is left out of the retrieval measures (it still counts as incorrect).
  const retrieved = answerable.filter((r) => !r.error);
  const correct = (list: QuestionResult[]) => list.filter((r) => r.score?.correct).length;
  const ranked = (list: QuestionResult[], max: number) => list.filter((r) => r.firstGoldRank !== null && r.firstGoldRank <= max).length;
  const times = rs.flatMap((r) => (r.totalMs === null ? [] : [r.totalMs]));
  const firsts = rs.flatMap((r) => (r.firstTextMs === null ? [] : [r.firstTextMs]));
  const totalCost = rs.reduce((s, r) => s + r.costUsd, 0);
  const cats: Aggregate["byCategory"] = {};
  for (const c of new Set(rs.map((r) => r.category))) {
    const list = rs.filter((r) => r.category === c);
    cats[c] = retrievalOnly
      ? { n: list.length, correct: null, accuracy: null }
      : { n: list.length, correct: correct(list), accuracy: ratio(correct(list), list.length) };
  }
  return {
    n: rs.length,
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    errors: rs.filter((r) => r.error).length,
    answerAccuracy: retrievalOnly ? null : ratio(correct(rs), rs.length),
    citationAccuracy: retrievalOnly ? null : ratio(answerable.filter((r) => r.score?.citationHit).length, answerable.length),
    abstentionAccuracy: retrievalOnly ? null : ratio(correct(unanswerable), unanswerable.length),
    recallAtK: ratio(ranked(retrieved, Infinity), retrieved.length),
    recallAt8: ratio(ranked(retrieved, 8), retrieved.length),
    contextFactRecall: ratio(retrieved.filter((r) => r.factsInContext).length, retrieved.length),
    mrr: ratio(retrieved.reduce((s, r) => s + (r.firstGoldRank ? 1 / r.firstGoldRank : 0), 0), retrieved.length),
    byCategory: cats,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p50FirstTextMs: percentile(firsts, 50),
    costPerQuestion: retrievalOnly ? null : ratio(totalCost, rs.length),
    totalCost,
  };
}

export function aggregateAll(rs: QuestionResult[], retrievalOnly: boolean): Report["aggregates"] {
  const out: Report["aggregates"] = { overall: aggregate(rs, retrievalOnly) };
  for (const split of ["dev", "heldout"] as const) {
    const list = rs.filter((r) => r.split === split);
    if (list.length > 0) out[split] = aggregate(list, retrievalOnly);
  }
  return out;
}
