# Evaluation set (frozen)

50 questions over two PDFs: the 2026 FEHB Blue Cross Blue Shield Service Benefit Plan Brochure (RI 71-005, 168 pages) and Medicare & You 2027 (128 pages). The file is `questions.json`.

## How it was made

Written by hand from the extracted text (`corpus/*.txt`) and, where tables were garbled, from page images of the PDFs. The app's retrieval and models were not run on any question, so the set is not shaped by what the system finds. Ground truth is human-style (read from the documents by the author), not model output from the system under test.

Mix: 42 answerable (21 per document) and 8 unanswerable. Answerable categories: 16 `fact`, 12 `table`, 8 `procedure`, 6 `multi_page`. Four unanswerable questions are close to real content (2027 amounts that the books say were not yet available, a state-specific limit, a named drug); the rest ask for another insurer's rate, a specific doctor's network status, a specific plan's premium, or a named plan's benefits.

## Fields

- `id`, `question`: plain-language question. Brochure questions name Standard or Basic Option where it matters.
- `split`: `dev` or `heldout` (see below).
- `category`: `fact`, `table`, `procedure`, `multi_page`, or `unanswerable`.
- `document`: exact document name, or `null` for unanswerable questions.
- `gold_pages`: PDF page indices (the `=== page N ===` numbers) of every page that states the fact. Empty for unanswerable.
- `must_include`: list of required facts. Each fact is a list of case-insensitive regex alternatives; the fact is met if any alternative matches. All facts must be met. Empty for unanswerable.
- `reference`: short answer with where it was found.
- `unanswerable`: `true` when the documents do not answer the question.

Page numbers: brochure PDF page = printed page + 2 (cover is PDF page 1; "Summary of Benefits: Page 162" is PDF page 164). Medicare & You PDF page = printed page (offset 0). Always compare against the PDF index.

## Split

Mechanical, not by judgment. Within each category (fact, table, procedure, multi_page, unanswerable, in that order), ids are sorted, shuffled with a Fisher-Yates shuffle driven by mulberry32 with **seed 20261101** (one PRNG stream, run once across the categories in that order), and the first N of each go to `dev`. N is the 40% share by largest remainder, ties broken in category order: fact 7, table 5, procedure 3, multi_page 2, unanswerable 3. Result: 20 dev, 30 heldout.

## Scoring rule

An answer to an answerable question is correct if every fact in `must_include` matches the answer text and at least one citation lands on a page in `gold_pages` (of the right document). For an unanswerable question, the answer is correct only if the system abstains and gives no citations.

## Freeze rule

- `dev` may be used for tuning (prompts, chunking, retrieval settings).
- `heldout` must not be used for tuning, and its results must not drive changes. Report it only for final comparisons.
- The file is frozen. Any later correction to a question, regex, gold page, or split is listed below with a reason. Do not edit silently, and do not re-draw the split.

## Corrections after freeze

Made before any system run, after an audit of the first commit (questions, gold pages and split unchanged):

- Regex guards across the set: every dollar amount now has a trailing guard so it cannot match inside a longer number (`$35` no longer matches `$350` or `$3,500`; amounts with cents are guarded too), and numbers, percentages and "N months/days/weeks/years" have a leading guard (`7-month` no longer matches `27 months`). Reason: false passes on look-alike numbers.
- q27: added a required process fact (CVS Caremark, order form, enclose or send the prescription, or the physician calling it in) beside the "two weeks" fact. Reason: the timing alone passed an answer with no process.
- q05: added a required fact that someone must phone, call or notify the Plan, beside the "two business days" fact. Reason: the timing alone passed an answer that never says to call.
- q39, q42, q46, q48: tightened broad synonym lists. q39 dropped the bare `no` (it passed "No problem, you can enroll"). q42 now needs C and F as Medigap plans, so "Part C" no longer counts. q46 needs both "no need or no penalty" and a reason (creditable, or keep FEHB coverage), and no longer accepts "creditable" alone. q48 dropped the bare `exception` and now needs a statement that the plan does not pay or cover, or that you must use Preferred providers.

## Known limits

- Answers use 2026 amounts printed in the books. Several Medicare figures (for example the Part A deductible) may be answerable from a model's memory, so the citation requirement is what ties a pass to the retrieved text.
- Regexes check required facts, not wrongness: an answer that contains the fact and also states something wrong still passes. Yes/no regexes (`q39`, `q46`, `q48`) are synonym lists and can still be fooled by a contrived answer.
- q05: the Plan accepts a call from any of four parties (you, your representative, the physician, the hospital), so the regex only requires that a call or notification is stated. It cannot check who is named.
- The extracted text interleaves table columns on many pages. Facts checked against the page image: q12 (PDF p.81), q21, q30, q35, q42 (p.80), q43 (p.168), q44 (p.96). Facts in other garbled tables (q03 p.41, q20 p.77, q22 p.105-106, q29 p.88) were confirmed from the clean summary pages (p.164-167) and the 2026 changes list (p.17-19), not from images.
