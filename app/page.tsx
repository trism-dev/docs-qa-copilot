"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerBlock, Citation } from "../lib/answer.ts";
import { parseAnswer, type Inline } from "../lib/markup.ts";
import { readNdjson, StreamFormatError } from "../lib/ndjson.ts";
import { Documents, type Doc } from "./documents.tsx";

type Done = { blocks: AnswerBlock[]; citations: Citation[]; stopReason: string | null; notFound: boolean };
type Phase = "idle" | "streaming" | "done" | "error";

const EXAMPLES = [
  "What is the catastrophic protection out-of-pocket maximum under Standard Option?",
  "How much will my out-of-pocket drug costs be capped at in 2027?",
  "What is the standard Part B premium amount?",
];

export default function Home() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [streamed, setStreamed] = useState("");
  const [result, setResult] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [scopeOpen, setScopeOpen] = useState(true);
  const abort = useRef<AbortController | null>(null);

  const loadDocs = useCallback(async (select?: string) => {
    setLoadError(null);
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) throw new Error();
      const list: Doc[] = await res.json();
      setDocs(list);
      // The first load selects everything; after an upload only the new document is added.
      setSelected((prev) => (select ? new Set(prev).add(select) : prev.size === 0 ? new Set(list.map((d) => d.id)) : prev));
    } catch {
      setLoadError("Could not load the document list.");
    }
  }, []);

  useEffect(() => {
    void loadDocs();
    return () => abort.current?.abort();
  }, [loadDocs]);

  const busy = phase === "streaming";

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy || selected.size === 0) return;
    setQuestion(q);
    setAsked(q);
    setScopeOpen(false); // get the list out of the way of the answer
    setPhase("streaming");
    setStreamed("");
    setResult(null);
    setError(null);
    setActive(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const everything = docs !== null && docs.every((d) => selected.has(d.id));
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, documentIds: everything ? undefined : [...selected] }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? `The request failed (${res.status}).`);
      }
      let finished = false;
      for await (const ev of readNdjson(res.body) as AsyncGenerator<{ type: string; text?: string; message?: string } & Partial<Done>>) {
        if (ev.type === "text") setStreamed((s) => s + ev.text);
        else if (ev.type === "reset") setStreamed("");
        else if (ev.type === "done") {
          finished = true;
          setResult({ blocks: ev.blocks!, citations: ev.citations!, stopReason: ev.stopReason ?? null, notFound: !!ev.notFound });
          setPhase("done");
        } else if (ev.type === "error") {
          throw new Error(ev.message);
        }
      }
      if (!finished) throw new Error("The answer ended early. Try again.");
    } catch (e) {
      if (controller.signal.aborted) return;
      // Only messages we wrote ourselves or the server sent as plain errors: never a raw parser message.
      setError(
        e instanceof TypeError ? "Could not reach the server. Try again." : e instanceof SyntaxError ? new StreamFormatError().message : e instanceof Error ? e.message : "Something went wrong.",
      );
      setPhase("error");
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function jumpTo(n: number) {
    setActive(n);
    const el = document.getElementById(`source-${n}`);
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
  }

  const citations = result?.citations ?? [];
  const hint = selected.size === 0 && docs?.length ? "Select at least one document to search." : "Enter to ask, Shift+Enter for a new line.";

  return (
    <div className="wrap layout">
      <main id="main" className="main" tabIndex={-1}>
        <h1>Ask your documents</h1>
        <p className="lede">Answers come only from the documents you choose, and each claim points to the page and passage it came from.</p>

        <form
          className="ask"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <label htmlFor="question">Your question</label>
          <textarea
            id="question"
            rows={3}
            maxLength={1000}
            value={question}
            aria-describedby="question-hint"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(question);
              }
            }}
          />
          <Documents
            docs={docs}
            loadError={loadError}
            selected={selected}
            disabled={busy}
            open={scopeOpen}
            onOpenChange={setScopeOpen}
            onToggle={toggle}
            onReload={() => void loadDocs()}
            onUploaded={(id) => loadDocs(id)}
          />
          <div className="actions">
            <button type="submit" className="primary" disabled={busy || !question.trim() || selected.size === 0}>
              {busy ? "Answering…" : "Ask"}
            </button>
            <span id="question-hint" className="muted small">
              {hint}
            </span>
          </div>
        </form>

        <section className="answer" aria-label="Answer" aria-live="polite" aria-busy={busy}>
          {phase === "idle" && (
            <div className="empty">
              <h2>Try a question from these documents</h2>
              <ul>
                {EXAMPLES.map((q) => (
                  <li key={q}>
                    <button type="button" className="example" disabled={selected.size === 0} onClick={() => void ask(q)}>
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {phase !== "idle" && (
            <p className="asked">
              <span className="label">Question</span>
              {asked}
            </p>
          )}

          {phase === "streaming" &&
            (streamed ? (
              <p className="prose stream">{streamed}</p>
            ) : (
              <p className="status">Searching the documents…</p>
            ))}

          {phase === "error" && (
            <div className="problem" role="alert">
              <p>{error}</p>
              <button type="button" className="secondary" onClick={() => void ask(asked)}>
                Try again
              </button>
            </div>
          )}

          {phase === "done" && result && (
            <AnswerBody result={result} citations={citations} onCite={jumpTo} />
          )}
        </section>
      </main>

      <aside className="sources" aria-labelledby="sources-heading">
        <h2 id="sources-heading">Sources</h2>
        {phase === "done" && citations.length > 0 ? (
          <ol>
            {citations.map((c) => (
              <SourceItem key={c.n} c={c} doc={docs?.find((d) => d.id === c.documentId)} active={active === c.n} />
            ))}
          </ol>
        ) : (
          <p className="muted">
            {phase === "streaming"
              ? "Sources appear when the answer is complete."
              : phase === "done"
                ? "No sources: nothing in the selected documents answers this."
                : "Each claim in an answer links to the exact passage and page it came from."}
          </p>
        )}
      </aside>
    </div>
  );
}

function AnswerBody(props: { result: Done; citations: Citation[]; onCite: (n: number) => void }) {
  const { result, citations, onCite } = props;
  if (result.notFound) {
    return (
      <div className="notfound">
        <p className="label">Nothing found</p>
        <p className="prose">Not found in these documents. Nothing in the documents you selected answers this question, so there is no answer and no source to show.</p>
        <p className="muted small">Try rephrasing the question, or include more documents.</p>
      </div>
    );
  }
  const pageOf = (n: number) => citations.find((c) => c.n === n)?.page;
  const inline = (parts: Inline[]) =>
    parts.map((p, i) =>
      p.kind === "cite" ? (
        <button key={i} type="button" className="cite" aria-controls={`source-${p.n}`} aria-label={`Source ${p.n}, page ${pageOf(p.n)}`} onClick={() => onCite(p.n)}>
          {p.n}
        </button>
      ) : p.kind === "bold" ? (
        <strong key={i}>{p.text}</strong>
      ) : (
        p.text
      ),
    );
  return (
    <div className={result.stopReason === "refusal" ? "notfound" : undefined}>
      {result.stopReason === "refusal" && <p className="label">Declined</p>}
      <div className="prose">
        {parseAnswer(result.blocks).map((node, i) =>
          node.type === "p" ? (
            <p key={i}>{inline(node.inline)}</p>
          ) : node.type === "ul" ? (
            <ul key={i}>
              {node.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ul>
          ) : (
            <ol key={i}>
              {node.items.map((it, j) => (
                <li key={j}>{inline(it)}</li>
              ))}
            </ol>
          ),
        )}
      </div>
      {result.stopReason === "max_tokens" && <p className="muted small">This answer was cut off because it hit the length limit. Ask a narrower question to see the rest.</p>}
    </div>
  );
}

function SourceItem({ c, doc, active }: { c: Citation; doc: Doc | undefined; active: boolean }) {
  return (
    <li id={`source-${c.n}`} tabIndex={-1} className={active ? "source active" : "source"}>
      <p className="source-head">
        <span className="num">{c.n}</span>
        <span>
          <span className="source-doc">{c.documentName}</span>
          <span className="source-page">page {c.page}</span>
        </span>
      </p>
      <blockquote>{c.quote}</blockquote>
      <p className="source-open small">
        {doc?.source_url ? (
          <a href={`${doc.source_url}#page=${c.page}`} target="_blank" rel="noopener">
            Open page {c.page}
            <span className="visually-hidden"> of {c.documentName}, opens in a new tab</span>
          </a>
        ) : (
          <span className="muted">From your upload. The file is not stored, so open your own copy at page {c.page}.</span>
        )}
      </p>
    </li>
  );
}
