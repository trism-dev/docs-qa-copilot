import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NOT_IN_DOCUMENTS_SENTENCE } from "./answer.ts";
import { scoreResult, type Question } from "./score.ts";

const DOC = "Doc A";
const answerable: Question = {
  id: "t1",
  question: "What is the deductible?",
  split: "dev",
  category: "fact",
  document: DOC,
  gold_pages: [30, 164],
  must_include: [["\\$350(?!,?\\d|\\.\\d)"], ["per person", "individual"]],
  reference: "",
  unanswerable: false,
};
const unanswerable: Question = { ...answerable, id: "t2", category: "unanswerable", document: null, gold_pages: [], must_include: [], unanswerable: true };
const cite = (page: number, documentName = DOC) => ({ documentName, page });

test("right facts and a gold-page citation is correct", () => {
  const s = scoreResult(answerable, { answer: "It is **$350** per person.", citations: [cite(164)] });
  assert.deepEqual(s, { factsMet: true, missedFacts: [], citationHit: true, abstained: false, correct: true });
});

test("right facts with no citation is wrong", () => {
  const s = scoreResult(answerable, { answer: "It is $350 per person.", citations: [] });
  assert.equal(s.factsMet, true);
  assert.equal(s.citationHit, false);
  assert.equal(s.correct, false);
});

test("right citation with the wrong number is wrong", () => {
  const s = scoreResult(answerable, { answer: "It is $300 per person.", citations: [cite(30)] });
  assert.equal(s.citationHit, true);
  assert.equal(s.factsMet, false);
  assert.equal(s.correct, false);
  assert.deepEqual(s.missedFacts, [["\\$350(?!,?\\d|\\.\\d)"]]);
});

test("a number that only contains the right one does not match", () => {
  const s = scoreResult(answerable, { answer: "It is $3,500 per person.", citations: [cite(30)] });
  assert.equal(s.factsMet, false);
});

test("every fact is required, any alternative satisfies one fact", () => {
  assert.equal(scoreResult(answerable, { answer: "$350 for an individual", citations: [cite(30)] }).correct, true);
  const s = scoreResult(answerable, { answer: "$350", citations: [cite(30)] });
  assert.equal(s.correct, false);
  assert.deepEqual(s.missedFacts, [["per person", "individual"]]);
});

test("matching ignores case, bold markers and line breaks", () => {
  const s = scoreResult(answerable, { answer: "$350 PER\nPERSON", citations: [cite(30)] });
  assert.equal(s.factsMet, true);
  assert.equal(scoreResult(answerable, { answer: "$**350** per person", citations: [cite(30)] }).factsMet, true);
});

test("a citation on a non-gold page is wrong", () => {
  const s = scoreResult(answerable, { answer: "$350 per person", citations: [cite(31)] });
  assert.equal(s.citationHit, false);
  assert.equal(s.correct, false);
});

test("a gold page number in the wrong document is wrong", () => {
  const s = scoreResult(answerable, { answer: "$350 per person", citations: [cite(30, "Doc B")] });
  assert.equal(s.citationHit, false);
  assert.equal(s.correct, false);
});

test("one gold citation among others is enough", () => {
  const s = scoreResult(answerable, { answer: "$350 per person", citations: [cite(5), cite(164), cite(99, "Doc B")] });
  assert.equal(s.correct, true);
});

test("abstaining on an answerable question is wrong", () => {
  const s = scoreResult(answerable, { answer: NOT_IN_DOCUMENTS_SENTENCE, citations: [] });
  assert.equal(s.abstained, true);
  assert.equal(s.correct, false);
});

test("abstaining wins over matching text and citations", () => {
  const s = scoreResult(answerable, { answer: `${NOT_IN_DOCUMENTS_SENTENCE} $350 per person`, citations: [cite(30)] });
  assert.equal(s.abstained, true);
  assert.equal(s.correct, false);
});

test("unanswerable: abstaining with no citations is correct", () => {
  const s = scoreResult(unanswerable, { answer: NOT_IN_DOCUMENTS_SENTENCE, citations: [] });
  assert.deepEqual(s, { factsMet: false, missedFacts: [], citationHit: false, abstained: true, correct: true });
  assert.equal(scoreResult(unanswerable, { answer: `  ${NOT_IN_DOCUMENTS_SENTENCE}\n`, citations: [] }).correct, true);
});

test("unanswerable: answering is wrong", () => {
  const s = scoreResult(unanswerable, { answer: "The deductible will be $400 in 2027.", citations: [cite(30)] });
  assert.equal(s.abstained, false);
  assert.equal(s.correct, false);
  assert.equal(scoreResult(unanswerable, { answer: "The deductible will be $400.", citations: [] }).correct, false);
});

test("unanswerable: abstaining while still citing is wrong", () => {
  assert.equal(scoreResult(unanswerable, { answer: NOT_IN_DOCUMENTS_SENTENCE, citations: [cite(30)] }).correct, false);
});

test("unanswerable: the sentence must be at the start", () => {
  assert.equal(scoreResult(unanswerable, { answer: `I think so. ${NOT_IN_DOCUMENTS_SENTENCE}`, citations: [] }).correct, false);
  assert.equal(scoreResult(unanswerable, { answer: "", citations: [] }).correct, false);
});

test("the frozen set is well formed and every regex compiles", () => {
  const set: Question[] = JSON.parse(readFileSync(new URL("../eval/questions.json", import.meta.url), "utf8"));
  assert.equal(set.length, 50);
  assert.equal(new Set(set.map((q) => q.id)).size, 50);
  assert.equal(set.filter((q) => q.split === "dev").length, 20);
  for (const q of set) {
    assert.equal(q.unanswerable, q.category === "unanswerable", q.id);
    assert.equal(q.document === null, q.unanswerable, q.id);
    assert.equal(q.gold_pages.length === 0, q.unanswerable, q.id);
    assert.equal(q.must_include.length === 0, q.unanswerable, q.id);
    for (const alts of q.must_include) for (const a of alts) assert.doesNotThrow(() => new RegExp(a, "i"), `${q.id} ${a}`);
  }
});
