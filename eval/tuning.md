# Tuning log

Everything here was measured on the 20 `dev` questions (17 answerable, 3 unanswerable). The 30 `heldout` questions were not run, scored or used for any decision until the code was frozen. Two held-out entries (q02 and q07) were printed once as format samples at the start, before any system run, and no decision used them.

Dev is small. One question is 5 points of answer accuracy, and one answerable question is 5.9 points of recall. The model's answers also vary from run to run: the same frozen code scored 100% and then 95% on dev (q42 flipped). Treat differences of one or two questions as noise.

Each run's per-question file is in `eval/results/` (the label column below is the file name). Runs marked "dirty" were made with the experiment uncommitted, which is the point: the experiment code is not kept (see "Removed").

## Vector search against hybrid search

Same corpus, same extraction (the word-splitting fix), k = 8, dev only, retrieval-only (free). "Hybrid" is Postgres full-text search fused with the vector results by reciprocal rank fusion (constant 60, 40 candidates per arm), owner and expiry filters on both arms.

| Retrieval | recall@8 | MRR | facts in retrieved text | Kept |
| --- | --- | --- | --- | --- |
| Vector only | 100.0% | 0.951 | 94.1% | yes |
| Hybrid, full-text arm matches any question word (OR) | 94.1% | 0.714 | 88.2% | no |
| Hybrid, full-text arm needs every question word (AND) | 100.0% | 0.920 | 94.1% | no |

Hybrid did not help on dev. The OR arm ranks by word counts without any weighting for rare words, so common words ("plan", "option") pull in the wrong chunks. The AND arm adds little, since most chunks lack every word of a long question. Dev recall is already 100% for vector search, so there was no headroom to gain and some rank to lose. This says nothing about harder questions than the 17 here. It was not tried on held-out, by design.

## Experiments

Dev, k = 8, chunk size 1000 unless noted. Answer accuracy is from a full run (about $0.58 each) and is blank where the experiment was judged on retrieval alone. "facts in text" is the share of answerable questions whose required facts all appear in the retrieved text, a stricter test than a gold page; it was added after the baseline and the first rows, so those rows show a dash.

| Step | What was tried | recall@8 | MRR | facts in text | Answer accuracy | Run | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a | Baseline: code as committed before this work | 88.2% | 0.794 | - | 80.0% (16/20); citation 88.2% | `dev-baseline-retrieval`, `dev-baseline` | starting point |
| b | Extraction fix: add a space only when the gap between pdf.js items exceeds 0.15 of the font height; keep ` \| ` for gaps over 12 points | 100.0% | 0.951 | 94.1% | 100.0% (20/20), then 95.0% (19/20) on a second run of the same code | `dev-b-wordsplit-retrieval`, `dev-b-wordsplit`, `dev-g-frozen-config` | kept |
| c | Column-aware extraction for the benefit tables | not run | | | | | not implemented, see below |
| d | Hybrid search, OR full-text arm | 94.1% (100.0% in an earlier run of the same code) | 0.714 (0.731) | 88.2% | not measured | `dev-d-hybrid-retrieval`, `dev-d-hybrid-or-retrieval-v2` | removed |
| d | Hybrid search, AND full-text arm | 100.0% | 0.920 | 94.1% | not measured | `dev-d-hybrid-and-retrieval`, `dev-d-hybrid-and-retrieval-v2` | removed |
| e | Embed each chunk as "document name > nearest heading + text" (headings found as lines at 1.3 times the page's median font height) | 94.1% | 0.788 | - | not measured | `dev-e-heading-retrieval` | removed |
| e | Embed each chunk as "document name + text" | 100.0% | 0.850 | - | not measured | `dev-e-docname-retrieval` | removed |
| f | k = 12 | 100.0% | 0.951 | - | 90.0% (18/20); $0.0375 per question | `dev-f-k12` | not kept |
| f | k = 16 | 100.0% | 0.951 | - | 90.0% (18/20); $0.0458 per question | `dev-f-k16` | not kept |
| f | k = 8 (current) | 100.0% | 0.951 | 94.1% | 100.0%, 95.0%; $0.029 per question | as b | kept |
| f | Chunk size 500, overlap 75 | 100.0% | 0.873 | 94.1% | not measured | `dev-f-size500` | not kept |
| f | Chunk size 700, overlap 100 | 100.0% | 0.777 | 94.1% | not measured | `dev-f-size700` | not kept |
| f | Chunk size 1500, overlap 200 | 94.1% | 0.822 | 88.2% | not measured | `dev-f-size1500` | not kept |
| g | Prompt changes | not run | | | | | not needed, see below |

Notes on the rows:

- b. This is the one change that mattered. The old code put a space between every pair of pdf.js items, but many PDF fonts store the letters of one word as separate items that touch or overlap, so the text read "Pr eferr ed Pr ovider" and "Y ou must use". In the brochure, "Pr eferr", "Y ou", "W e ", "T o ", "of fice", "emer gency" and "r eceive" went from 39, 552, 203, 47, 69, 75 and 21 lines to 0. The corpus went from 1,193 to 1,182 chunks. No new run-together words appeared (checked by listing every token of 17 or more letters before and after; all new ones are real words). The spacing threshold of 0.15 comes from the measured gaps: items with a real space between them sit 0.20 to 0.30 of the font height apart, and items of one word are at or below 0.
- c. Not implemented. On dev the table questions that matter already score 100% in retrieval and in the answer after step b, so there was nothing a column fix could be measured against except q42, and q42 is the Medicare Medigap chart, not a brochure table: its empty cells are centered, so the text reads "Medicare Part B deductible 100% | 100% | 100%** 100%**" with no way to tell which plans the four values belong to. A correct fix needs the header row's x positions and per-table logic (centered cells, empty cells, footnote marks). That is not simple, and tuning it on the one dev question it would affect would fit the extraction to that question. q42 stays a known weak spot: it passed in 1 of 4 runs after step b (and failed in the baseline).
- c, further. A fresh-eyes review of the extraction code also found that two-column body text (not only tables) is joined line by line across the gutter with a ` | ` marker, so some sentences interleave (for example Medicare & You lines 508-515 of `corpus/10050-medicare-and-you.txt`). That is the same missing piece as c and was left alone for the same reason; it is a known limit of the extraction, not fixed.
- d. See the table above. The experiment code is not in the repository; the numbers and the description are.
- e. The heading prefix made things worse, not better. The nearest large line is often a running header ("Standard and Basic Option") or a table heading, which adds the same words to many chunks and makes them look alike.
- f. Larger k costs more ($0.029 to $0.037 to $0.046 per question) and did not raise dev recall, which is already 100% at 8. The two 90% runs lost q25 and q42; q42 is the unstable question above, and q25 is a retrieval miss at chunk level (below). With more chunks in front of it the model did not do better. Smaller and larger chunks both lowered MRR, so 1000 stays.
- g. The dev failures were retrieval and extraction problems, not prompt problems (table below), so the prompt is unchanged.

## Dev failures, classified

Classes: retrieval miss, answer error, scorer false negative, question error. "Run" is the run where it failed.

| Question | Run | Class | What happened |
| --- | --- | --- | --- |
| q01 deductible, Standard Option | baseline | retrieval miss | None of the 8 chunks came from a gold page; the model said "Not found in these documents." After step b a gold page ranks 6th, so this question is close to the edge at k = 8. |
| q25 Blue Health Assessment | baseline, k = 12, k = 16 | retrieval miss (chunk level) | The page was retrieved (so page recall counts it) but the chunk with "$50 health account" is the first chunk on page 127 and ranks 29th for this question, behind every k tried. Without it the model says the excerpts do not state the amount. In the one run where it passed, the model worked $50 out from $170 minus three $40 goals and said it was inferred. |
| q42 Part B deductible and Medigap | baseline, frozen-config run, k = 12, k = 16 | extraction (table) problem, shows as an answer error | The right page is retrieved first, but the Medigap chart's columns are lost in extraction, so the model correctly says it cannot match the values to plans. It passed once by naming Plans C and F from the "can't buy Plans C or F" footnote. |
| q48 Basic Option, non-Preferred doctor | baseline | scorer false negative (gold pages incomplete) | The facts matched, but the cited pages were 39 and 16, which state the same rule ("you must use Preferred providers") and are not in `gold_pages` (32, 41, 166). The question and the gold pages were not edited: the gold list says it names every page that states the fact, and it does not, but the fix would raise the score of a question I had already seen fail, and after step b the question passes on gold pages anyway. |

No question was corrected. No scorer change was made after the first run.

## What was removed

Hybrid search (both arms), the heading and document-name prefixes, and the chunk-size and k experiments were reverted. `lib/retrieve.ts`, `lib/chunk.ts`, `lib/ingest.ts` and the prompt in `lib/answer.ts` are as they were before this work. The only product change from tuning is the spacing fix in `lib/pdf.ts`.

## Spend

Dev runs: baseline $0.56, step b $0.58, k = 12 $0.75, k = 16 $0.92, frozen-config rerun $0.58. Total $3.39 before the final run.
