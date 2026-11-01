import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DOCUMENT_IDS, MAX_QUESTION, parseAskBody } from "./ask-request.ts";

const ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const bad = (body: unknown) => assert.ok("error" in parseAskBody(body), JSON.stringify(body));

test("accepts a question with and without documentIds, trimming the question", () => {
  assert.deepEqual(parseAskBody({ question: "  What is the deductible?  " }), { question: "What is the deductible?" });
  assert.deepEqual(parseAskBody({ question: "q", documentIds: [ID] }), { question: "q", documentIds: [ID] });
  assert.deepEqual(parseAskBody({ question: "q".repeat(MAX_QUESTION) }), { question: "q".repeat(MAX_QUESTION) });
  assert.ok(!("error" in parseAskBody({ question: "q", documentIds: Array(MAX_DOCUMENT_IDS).fill(ID) })));
});

test("rejects a missing, empty, non-string or too long question", () => {
  for (const b of [null, [], "q", {}, { question: "" }, { question: "   " }, { question: 5 }, { question: "q".repeat(MAX_QUESTION + 1) }]) bad(b);
});

test("rejects malformed documentIds", () => {
  for (const ids of ["abc", {}, [1], ["not-a-uuid"], [ID, "x"], Array(MAX_DOCUMENT_IDS + 1).fill(ID), [null]]) {
    bad({ question: "q", documentIds: ids });
  }
});

test("an owner in the body is ignored, never returned", () => {
  assert.deepEqual(parseAskBody({ question: "q", owner: "someone-else" }), { question: "q" });
});
