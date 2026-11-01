import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnswer } from "./markup.ts";

const b = (text: string, ...citations: number[]) => ({ text, citations });

test("renders bold and puts a citation marker after the block it supports", () => {
  assert.deepEqual(parseAnswer([b("The limit is **$6,000** per year.", 1), b(" Other text.")]), [
    {
      type: "p",
      inline: [
        { kind: "text", text: "The limit is " },
        { kind: "bold", text: "$6,000" },
        { kind: "text", text: " per year." },
        { kind: "cite", n: 1 },
        { kind: "text", text: " Other text." },
      ],
    },
  ]);
});

test("bold that spans two blocks still parses as one span", () => {
  const [p] = parseAnswer([b("This is **very ", 1), b("important** news.")]);
  assert.deepEqual(p, {
    type: "p",
    inline: [
      { kind: "text", text: "This is " },
      { kind: "bold", text: "very" },
      { kind: "cite", n: 1 },
      { kind: "bold", text: " important" },
      { kind: "text", text: " news." },
    ],
  });
});

test("an unmatched ** stays as literal text", () => {
  assert.deepEqual(parseAnswer([b("a **b")]), [{ type: "p", inline: [{ kind: "text", text: "a **b" }] }]);
});

test("parses lists and paragraphs, with a marker staying on its own list line", () => {
  const nodes = parseAnswer([b("Intro:\n\n- one", 1), b("\n- two\n"), b("3. last\n\nAfter.")]);
  assert.deepEqual(nodes, [
    { type: "p", inline: [{ kind: "text", text: "Intro:" }] },
    { type: "ul", items: [[{ kind: "text", text: "one" }, { kind: "cite", n: 1 }], [{ kind: "text", text: "two" }]] },
    { type: "ol", items: [[{ kind: "text", text: "last" }]] },
    { type: "p", inline: [{ kind: "text", text: "After." }] },
  ]);
});

test("model text can never forge a marker, and html stays text", () => {
  const [p] = parseAnswer([b("x" + String.fromCharCode(0xe000) + "7" + String.fromCharCode(0xe001) + " <script>alert(1)</script>")]);
  assert.deepEqual(p, { type: "p", inline: [{ kind: "text", text: "x7 <script>alert(1)</script>" }] });
});
