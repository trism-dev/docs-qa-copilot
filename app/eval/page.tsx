import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Aggregate, QuestionResult, Report } from "../../lib/eval-report.ts";

export const metadata = {
  title: "Evaluation - Docs Q&A Copilot",
  description: "How often the app answers correctly on a fixed set of 50 questions, with every failure shown.",
};

const CATEGORIES: [string, string][] = [
  ["fact", "Fact"],
  ["table", "Table"],
  ["procedure", "Procedure"],
  ["multi_page", "Multi-page"],
  ["unanswerable", "Unanswerable"],
];
const SPLITS: [string, string][] = [
  ["overall", "Overall"],
  ["dev", "Dev"],
  ["heldout", "Held-out"],
];

async function load(): Promise<Report | null> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "eval", "results", "latest.json"), "utf8"));
  } catch (err) {
    // Only a missing file means "no run yet"; a damaged file should fail the build, not hide.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const secs = (x: number | null | undefined) => (x == null ? "n/a" : `${(x / 1000).toFixed(1)} s`);
const usd = (x: number | null | undefined, digits: number) => (x == null ? "n/a" : `$${x.toFixed(digits)}`);
const plain = (s: string) => s.replaceAll("**", "");
const inSplit = (rs: QuestionResult[], split: string) => (split === "overall" ? rs : rs.filter((r) => r.split === split));
const countCorrect = (rs: QuestionResult[]) => rs.filter((r) => r.score?.correct).length;

// Why a question failed, in words. Empty for a pass.
function reasons(r: QuestionResult): string[] {
  const s = r.score;
  if (r.error) return [`The request failed after ${r.attempts} attempts (${r.error}), so it counts as incorrect.`];
  if (!s || s.correct) return [];
  if (r.category === "unanswerable") {
    return [
      s.abstained
        ? "It said \"Not found\" but still returned citations, so it did not fully abstain."
        : "It gave an answer to a question the documents do not answer.",
    ];
  }
  const out: string[] = [];
  if (s.abstained) out.push("It said \"Not found in these documents\" to a question the documents answer.");
  else if (!s.factsMet) out.push("The answer is missing a required fact.");
  if (!s.citationHit) out.push("No citation lands on a gold page of the right document.");
  return out;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="ev-metric">
      <dt>{label}</dt>
      <dd>
        {value}
        {note && <span className="ev-note"> {note}</span>}
      </dd>
    </div>
  );
}

function Question({ r }: { r: QuestionResult }) {
  const pass = !!r.score?.correct;
  const missed = r.score?.missedFacts ?? [];
  const retrieved = new Map<string, number[]>();
  for (const c of r.retrieved) retrieved.set(c.documentName, [...(retrieved.get(c.documentName) ?? []), c.page]);
  const why = reasons(r);
  return (
    <details className={`ev-q ${pass ? "ev-pass" : "ev-fail"}`} open={!pass}>
      <summary>
        <span className="ev-badge">{pass ? "Pass" : "Fail"}</span>
        <span className="ev-qtext">{r.question}</span>
        <span className="ev-qmeta">
          {r.id} · {CATEGORIES.find(([k]) => k === r.category)?.[1]} · {r.split === "dev" ? "dev" : "held-out"}
        </span>
      </summary>
      <dl className="ev-detail">
        {why.length > 0 && (
          <>
            <dt>Why it failed</dt>
            <dd>{why.join(" ")}</dd>
          </>
        )}
        <dt>Answer</dt>
        <dd className="ev-answer">{r.answer ? plain(r.answer) : "No answer was produced."}</dd>
        {r.reference && (
          <>
            <dt>Reference</dt>
            <dd>{r.reference}</dd>
          </>
        )}
        <dt>Citations</dt>
        <dd>
          {r.citations.length === 0 ? (
            "None."
          ) : (
            <ul className="ev-list">
              {r.citations.map((c) => {
                const gold = c.documentName === r.document && r.goldPages.includes(c.page);
                return (
                  <li key={c.n}>
                    <strong>Page {c.page}</strong>, {c.documentName} ({gold ? "a gold page" : "not a gold page"})
                    <blockquote>{c.quote.trim()}</blockquote>
                  </li>
                );
              })}
            </ul>
          )}
        </dd>
        <dt>Gold pages</dt>
        <dd>
          {r.category === "unanswerable"
            ? "None. The documents do not answer this, so the right result is \"Not found in these documents.\" with no citations."
            : `${r.goldPages.join(", ")} (${r.document})`}
        </dd>
        {r.category !== "unanswerable" && (
          <>
            <dt>Facts missed</dt>
            <dd>
              {missed.length === 0 ? (
                "None."
              ) : (
                <ul className="ev-list">
                  {missed.map((alts, i) => (
                    <li key={i}>
                      {alts.map((a, j) => (
                        <span key={j}>
                          {j > 0 && " or "}
                          <code>{a}</code>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </>
        )}
        <dt>Retrieved pages</dt>
        <dd>
          {r.retrieved.length === 0 ? (
            r.error ? "Not recorded: the request failed." : "Nothing was retrieved."
          ) : (
            <>
              {[...retrieved].map(([doc, pages]) => (
                <span key={doc} className="ev-doc">
                  {doc}: {pages.join(", ")}
                </span>
              ))}
              <span className="ev-doc">
                {r.firstGoldRank ? `First chunk on a gold page: rank ${r.firstGoldRank} of ${r.retrieved.length}.` : r.category === "unanswerable" ? "" : "No retrieved chunk is on a gold page."}
              </span>
            </>
          )}
        </dd>
      </dl>
    </details>
  );
}

export default async function EvalPage() {
  const report = await load();
  if (!report) {
    return (
      <main id="main" className="wrap ev" tabIndex={-1}>
        <h1>Evaluation</h1>
        <p className="lede">No run yet. The evaluation has not been run on this build, so there are no numbers to show.</p>
      </main>
    );
  }
  const { meta, aggregates, results } = report;
  const all = aggregates.overall;
  const held = aggregates.heldout;
  const correct = (split: string) => countCorrect(inSplit(results, split));
  const size = (split: string) => inSplit(results, split).length;
  const failed = results.filter((r) => !r.score?.correct);
  const passed = results.filter((r) => r.score?.correct);
  const rows: [string, (a: Aggregate) => string][] = [
    ["Answer accuracy", (a) => pct(a.answerAccuracy)],
    ["Citation accuracy", (a) => pct(a.citationAccuracy)],
    [`Recall@${meta.k}`, (a) => pct(a.recallAtK)],
    ["MRR", (a) => (a.mrr == null ? "n/a" : a.mrr.toFixed(3))],
    ["Abstention accuracy", (a) => pct(a.abstentionAccuracy)],
    ["Failed requests", (a) => String(a.errors)],
    ["Latency p50 / p95", (a) => `${secs(a.p50Ms)} / ${secs(a.p95Ms)}`],
    ["Cost per question", (a) => usd(a.costPerQuestion, 4)],
  ];
  const splits = SPLITS.filter(([k]) => aggregates[k]);
  const date = meta.date.slice(0, 10);

  return (
    <main id="main" className="wrap ev" tabIndex={-1}>
      <h1>Evaluation</h1>
      <p className="lede">
        Fifty fixed questions over the two documents, scored by rule, with every answer and every failure shown below.
      </p>

      {meta.retrievalOnly && <p className="ev-warn">This run measured retrieval only. No answers were generated, so answer accuracy is not available.</p>}

      <section aria-labelledby="ev-head" className="ev-head">
        <h2 id="ev-head">Answer accuracy</h2>
        <dl className="ev-big">
          {held && (
            <div>
              <dt>Held-out questions</dt>
              <dd>{pct(held.answerAccuracy)}</dd>
              <dd className="ev-count">
                {correct("heldout")} of {size("heldout")} correct
              </dd>
            </div>
          )}
          <div>
            <dt>{meta.split === "all" ? "All questions" : "Dev questions"}</dt>
            <dd>{pct(all.answerAccuracy)}</dd>
            <dd className="ev-count">
              {correct("overall")} of {size("overall")} correct
            </dd>
          </div>
        </dl>
        <p className="muted small">
          {held
            ? "The held-out questions were not run or looked at while the system was tuned, so that figure is the fair one. The dev questions were used for tuning."
            : "This run did not include the held-out questions."}
        </p>
      </section>

      <section aria-labelledby="ev-metrics">
        <h2 id="ev-metrics">All measures</h2>
        <div className="ev-scroll" role="region" aria-label="Measures by split" tabIndex={0}>
          <table className="ev-table">
            <caption className="visually-hidden">Measures by question split</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                {splits.map(([k, label]) => (
                  <th key={k} scope="col">
                    {label} <span className="ev-note">({size(k)})</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, f]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {splits.map(([k]) => (
                    <td key={k}>{f(aggregates[k])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="ev-cats">
        <h2 id="ev-cats">Accuracy by category</h2>
        <div className="ev-scroll" role="region" aria-label="Accuracy by category" tabIndex={0}>
          <table className="ev-table">
            <caption className="visually-hidden">Answer accuracy by question category and split</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                {splits.map(([k, label]) => (
                  <th key={k} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map(([cat, label]) => (
                <tr key={cat}>
                  <th scope="row">{label}</th>
                  {splits.map(([k]) => {
                    const c = aggregates[k].byCategory[cat];
                    return <td key={k}>{c ? `${c.correct ?? "n/a"} of ${c.n} (${pct(c.accuracy)})` : "none"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="ev-run">
        <h2 id="ev-run">This run</h2>
        <dl className="ev-facts">
          <Metric label="Date" value={date} />
          <Metric label="Code version" value={meta.sha} note={meta.dirty ? "(with uncommitted changes)" : undefined} />
          <Metric label="Model" value={meta.model ?? "none (retrieval only)"} />
          <Metric label="Chunks retrieved per question" value={String(meta.k)} />
          <Metric label="Corpus" value={`${meta.corpus.pages} pages, ${meta.corpus.chunks} chunks`} note={`in ${meta.corpus.documents.length} documents`} />
          <Metric label="Total cost of the run" value={usd(all.totalCost, 2)} />
        </dl>
      </section>

      <section aria-labelledby="ev-how">
        <h2 id="ev-how">How scoring works, and its limits</h2>
        <div className="ev-prose">
          <p>
            Each question has the facts a good answer must contain and the pages that state them. An answer to a question the documents cover counts as correct only if it contains every
            required fact and cites at least one gold page of the right document. A question the documents do not cover (a 2027 amount that is not printed, another insurer&apos;s premium) is
            correct only if the app says &ldquo;Not found in these documents.&rdquo; and cites nothing. If the model request fails, the question counts as incorrect and is not dropped.
          </p>
          <p>
            Facts are checked with case-insensitive patterns written before the first run, so the check is mechanical: it does not read the answer. An answer that contains the right number
            and also says something wrong can pass, and a correct answer worded in an unexpected way can fail. A citation on a gold page shows the app pointed at the right page, not that
            the quoted sentence supports the claim. Recall@{meta.k} is the share of answerable questions with a gold page among the {meta.k} retrieved chunks; MRR rewards ranking the first such
            chunk higher.
          </p>
          <p>
            The 50 questions were written by hand before the system was run and are frozen. 20 are the dev split, used to tune extraction and retrieval; 30 are held out and were run once,
            after tuning stopped. Fifty questions is a small sample: one question is 2 points overall, and a model&apos;s answers also vary a little from run to run. The questions cover two
            documents, so the numbers say little about other kinds of PDF.
          </p>
        </div>
      </section>

      {!meta.retrievalOnly && (
        <>
      <section aria-labelledby="ev-fail">
        <h2 id="ev-fail">Failed questions ({failed.length})</h2>
        {failed.length === 0 ? <p>No question failed in this run.</p> : failed.map((r) => <Question key={r.id} r={r} />)}
      </section>

      <section aria-labelledby="ev-pass">
        <h2 id="ev-pass">Passed questions ({passed.length})</h2>
        {passed.map((r) => (
          <Question key={r.id} r={r} />
        ))}
      </section>
        </>
      )}
    </main>
  );
}
