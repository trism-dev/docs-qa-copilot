# Docs Q&A Copilot

Ask questions about policy and benefits PDFs and get answers with page-level citations. An evaluation page scores the answers and shows every failure.

**Live demo:** [docs-qa-copilot.vercel.app](https://docs-qa-copilot.vercel.app). Asking a question needs your own [Anthropic API key](https://console.anthropic.com/settings/keys), billed to your account at about $0.03 a question. The site holds no key of its own. Browsing the documents and the [evaluation page](https://docs-qa-copilot.vercel.app/eval) needs no key.

![Asking a question on the live site, following a citation to its source, then opening the evaluation page](docs/demo.gif)

## Results

Measured over 296 pages (1,182 chunks) of two public documents: the 2026 FEHB Blue Cross Blue Shield brochure (168 pages) and Medicare & You 2027 (128 pages).

| | Questions | Answer accuracy | Citation accuracy | Recall@8 | MRR |
|---|---|---|---|---|---|
| All | 50 | 92.0% (46/50) | 95.2% | 97.6% | 0.777 |
| Held out, never used for tuning | 30 | 93.3% (28/30) | 92.0% | 96.0% | 0.658 |
| Dev, used for tuning | 20 | 90.0% (18/20) | 100% | 100% | 0.951 |

Latency was 4.5 s at p50 and 7.8 s at p95. Each question cost about $0.03.

An answer counts as correct only if it contains every required fact and at least one citation lands on a page that states it. Unanswerable questions (8 of the 50) must get an explicit "not found" with no citations; all 8 did.

**How far to trust this:**
- It's a small set, and one question moves a split by 3 to 5 points. The same code scored 100%, 95% and 90% on dev across three runs.
- Held-out MRR is well below dev, so the right chunk often ranks lower on unseen questions.
- The questions were written from the documents and audited by sampling, not by a benefits expert.
- The scorer uses regular expressions, so an unusual correct wording can fail and a wrong answer containing a matching term could pass.

Per-question results are in [`eval/results/latest.json`](eval/results/latest.json), and every experiment is in [`eval/tuning.md`](eval/tuning.md).

## Design choices

- **Citations come from the API.** Claude's native citations return exact quotes. Each retrieved chunk is its own document, and chunks never cross a page, so a citation maps to exactly one page.
- **Plain vector search, because the evidence said so.** Hybrid full-text search looked like an obvious fit for documents full of exact terms, but it did worse on the dev set (MRR 0.920 at best, against 0.951), so it was removed. Larger k, other chunk sizes and chunk prefixes didn't help either.
- **The biggest gain was a bug fix.** PDF extraction split words apart (`Pr eferr ed Pr ovider`). Fixing that took dev accuracy from 80% to between 90% and 100%.
- **Local embeddings.** `bge-small-en-v1.5` runs in the Node process through ONNX, with no API key or per-call cost. The tradeoff is about 57 MB of function bundle and a model download on cold start.
- **Postgres does everything.** pgvector for search, plus rate limits and expiry in ordinary tables, with raw SQL and no ORM.
- **The eval uses the app's code path.** The harness calls the same `answerQuestion` function as the API, and the scorer is deterministic, so runs are cheap and reproducible apart from the model's own variation.
- **Built for a public demo.** Uploads are private to an anonymous cookie, hidden after 24 hours and deleted within a day after that. Each visitor asks with their own Anthropic API key, kept in their browser tab and sent with each question, so the deployed app has no model bill; a per-IP limit protects the database. Document text is treated as untrusted data.

**Known weakness:** multi-column tables lose their columns on extraction. This caused two of the four failures. Scanned PDFs are rejected, since there's no OCR.

## Stack

TypeScript, Next.js and React, Node API routes, PostgreSQL with pgvector, `bge-small-en-v1.5` embeddings, Claude Opus 5.5, Vercel.

## Run it locally

Needs Node 24, Docker and an Anthropic API key. You paste the key into the page; `ANTHROPIC_API_KEY` in `.env.local` is only read by `npm run eval` and the real-answer test, never by the app.

```bash
npm ci
docker compose up -d db
```

Create `.env.local`:

```
DATABASE_URL=postgres://rag:rag@localhost:5433/rag
ANTHROPIC_API_KEY=your-key
```

```bash
npm run migrate
npm run ingest:corpus
npm run dev
```

## Checks

```bash
npm run typecheck
npm test
npm run eval -- --split dev
```

`npm run eval` costs about $0.03 per question. Held-out questions only run with `--final`, which is meant to be used once, after tuning is frozen.

## Deploy

1. Set `DATABASE_URL` and `CRON_SECRET` on the Vercel project, for production only. Do not set `ANTHROPIC_API_KEY`: the app never reads it.
2. Run `npm run migrate` and `npm run ingest:corpus` against the production database, which needs pgvector 0.8 or later.
3. Deploy. `vercel.json` sets the framework and the daily purge.
