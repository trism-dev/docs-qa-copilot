"use client";

import { useRef, useState } from "react";

export type Doc = { id: string; name: string; pages: number; source_url: string | null; public: boolean };

// Which documents a question searches, plus uploading a private one.
export function Documents(props: {
  docs: Doc[] | null;
  loadError: string | null;
  selected: Set<string>;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (id: string) => void;
  onReload: () => void;
  onUploaded: (id: string) => Promise<void>;
}) {
  const { docs, loadError, selected, disabled, open, onOpenChange, onToggle, onReload, onUploaded } = props;
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(file.name);
    setUploadError(null);
    setAdded(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Upload failed (${res.status})`);
      setAdded(`${json.name} is ready: ${json.pages} ${json.pages === 1 ? "page" : "pages"}.`);
      await onUploaded(json.id);
    } catch (e) {
      setUploadError(e instanceof TypeError ? "Could not reach the server. Try again." : e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <details className="docs" open={open} onToggle={(e) => onOpenChange(e.currentTarget.open)}>
      <summary>
        Search in
        <span className="muted">{docs ? ` ${selected.size} of ${docs.length} ${docs.length === 1 ? "document" : "documents"}` : ""}</span>
      </summary>
      <fieldset>
        <legend className="visually-hidden">Documents to search</legend>
      {loadError ? (
        <p className="problem" role="alert">
          {loadError}{" "}
          <button type="button" className="link" onClick={onReload}>
            Try again
          </button>
        </p>
      ) : docs === null ? (
        <p className="muted">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="muted">No documents yet. Upload a PDF below.</p>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <label className="doc">
                <input type="checkbox" checked={selected.has(d.id)} disabled={disabled} onChange={() => onToggle(d.id)} />
                <span className="doc-name">{d.name}</span>
                <span className="doc-meta">
                  {d.public ? "" : "Your upload · "}
                  {d.pages} {d.pages === 1 ? "page" : "pages"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="upload">
        <label htmlFor="upload">Add your own PDF</label>
        <input
          id="upload"
          ref={input}
          type="file"
          accept="application/pdf"
          disabled={uploading !== null}
          aria-describedby="upload-hint"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <p id="upload-hint" className="muted small">
          Up to 4 MB and 300 pages, with selectable text (scans are not supported). Uploads are private to you and deleted after 24 hours.
        </p>
        <div role="status">
          {uploading && <p className="working">Reading and indexing {uploading}. This can take a minute…</p>}
          {added && !uploading && <p className="small">{added}</p>}
        </div>
        {uploadError && (
          <p className="problem" role="alert">
            {uploadError}
          </p>
        )}
      </div>
      </fieldset>
    </details>
  );
}
