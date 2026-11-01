import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, costOf, percentile, type QuestionResult } from "./eval-report.ts";
import type { Score } from "./score.ts";

const score = (correct: boolean, citationHit = correct): Score => ({ factsMet: correct, missedFacts: [], citationHit, abstained: false, correct });
function r(over: Partial<QuestionResult>): QuestionResult {
  return {
    id: "q",
    question: "",
    split: "dev",
    category: "fact",
    document: "D",
    goldPages: [1],
    retrieved: [],
    firstGoldRank: null,
    answer: "",
    citations: [],
    score: score(false),
    error: null,
    attempts: 1,
    firstTextMs: 100,
    totalMs: 1000,
    inputTokens: 1000,
    outputTokens: 100,
    costUsd: costOf(1000, 100),
    servedModel: "m",
    stopReason: "end_turn",
    ...over,
  };
}

test("percentile uses nearest rank", () => {
  const v = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(percentile(v, 50), 10);
  assert.equal(percentile(v, 95), 19);
  assert.equal(percentile([], 50), null);
});

test("cost is $4 per million input and $20 per million output", () => {
  assert.equal(costOf(1_000_000, 0), 4);
  assert.equal(costOf(0, 1_000_000), 20);
});

test("aggregates count answerable and unanswerable separately", () => {
  const a = aggregate(
    [
      r({ id: "a", firstGoldRank: 1, score: score(true) }),
      r({ id: "b", firstGoldRank: 4, score: score(false, true) }),
      r({ id: "c", firstGoldRank: null, score: score(false) }),
      r({ id: "d", firstGoldRank: 12, score: score(true) }),
      r({ id: "u1", category: "unanswerable", document: null, goldPages: [], score: score(true) }),
      r({ id: "u2", category: "unanswerable", document: null, goldPages: [], score: score(false), error: "api: x" }),
    ],
    false,
  );
  assert.equal(a.n, 6);
  assert.equal(a.answerable, 4);
  assert.equal(a.errors, 1);
  assert.equal(a.answerAccuracy, 3 / 6);
  assert.equal(a.citationAccuracy, 3 / 4); // a, b, d have a gold citation (score(true) sets citationHit)
  assert.equal(a.abstentionAccuracy, 1 / 2);
  assert.equal(a.recallAtK, 3 / 4);
  assert.equal(a.recallAt8, 2 / 4);
  assert.equal(a.mrr, (1 + 1 / 4 + 0 + 1 / 12) / 4);
  assert.deepEqual(a.byCategory.fact, { n: 4, correct: 2, accuracy: 0.5 });
  assert.deepEqual(a.byCategory.unanswerable, { n: 2, correct: 1, accuracy: 0.5 });
  assert.ok(Math.abs(a.totalCost - 6 * costOf(1000, 100)) < 1e-12);
});

test("retrieval-only has retrieval metrics and no answer metrics", () => {
  const a = aggregate([r({ firstGoldRank: 2, score: null, answer: null, totalMs: 5, firstTextMs: null })], true);
  assert.equal(a.recallAtK, 1);
  assert.equal(a.mrr, 0.5);
  assert.equal(a.answerAccuracy, null);
  assert.equal(a.costPerQuestion, null);
  assert.equal(a.byCategory.fact.accuracy, null);
});
