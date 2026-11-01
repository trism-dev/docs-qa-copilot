import { NOT_IN_DOCUMENTS_SENTENCE } from "./answer.ts";

export type Category = "fact" | "table" | "procedure" | "multi_page" | "unanswerable";

export type Question = {
  id: string;
  question: string;
  split: "dev" | "heldout";
  category: Category;
  document: string | null;
  gold_pages: number[];
  must_include: string[][]; // every fact must match; each fact is a list of regex alternatives
  reference: string;
  unanswerable: boolean;
};

export type ScoreInput = { answer: string; citations: { documentName: string; page: number }[] };

export type Score = {
  factsMet: boolean; // answerable only: every must_include fact matched. False for unanswerable.
  missedFacts: string[][]; // the alternatives of each fact that did not match
  citationHit: boolean; // answerable only: some citation is on a gold page of the right document. False for unanswerable.
  abstained: boolean; // the answer starts with the not-found sentence
  correct: boolean;
};

// Bold markers and line breaks are formatting, not content: "**$350**" and "two\nweeks" should match.
const normalize = (s: string) => s.replaceAll("**", "").replace(/\s+/g, " ").trim();

export function scoreResult(q: Question, r: ScoreInput): Score {
  const answer = normalize(r.answer);
  const abstained = answer.startsWith(NOT_IN_DOCUMENTS_SENTENCE);
  if (q.unanswerable) {
    return { factsMet: false, missedFacts: [], citationHit: false, abstained, correct: abstained && r.citations.length === 0 };
  }
  const missedFacts = q.must_include.filter((alts) => !alts.some((a) => new RegExp(a, "i").test(answer)));
  const factsMet = missedFacts.length === 0;
  const citationHit = r.citations.some((c) => c.documentName === q.document && q.gold_pages.includes(c.page));
  return { factsMet, missedFacts, citationHit, abstained, correct: factsMet && citationHit && !abstained };
}
