import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./eval.ts";

test("dev is the default and needs no --final", () => {
  const a = parseArgs([]);
  assert.equal(a.split, "dev");
  assert.equal(a.final, false);
  assert.equal(parseArgs(["--split", "dev", "--retrieval-only", "--label", "x"]).out.replaceAll("\\", "/"), "eval/results/x.json");
});

test("heldout and all are refused without --final, retrieval-only included", () => {
  for (const split of ["heldout", "all"]) {
    assert.throws(() => parseArgs(["--split", split]), /refused without --final/);
    assert.throws(() => parseArgs(["--split", split, "--retrieval-only"]), /refused without --final/);
  }
});

test("heldout and all are allowed with --final", () => {
  assert.equal(parseArgs(["--split", "heldout", "--final"]).split, "heldout");
  assert.equal(parseArgs(["--split", "all", "--final", "--out", "a.json"]).out, "a.json");
});

test("an unknown split is rejected", () => {
  assert.throws(() => parseArgs(["--split", "test"]), /--split must be/);
});
