"use client";

import { useEffect, useState, type Ref } from "react";
import { isApiKeyShape } from "../lib/api-key.ts";

const STORAGE_KEY = "anthropic-api-key";

// The key lives in memory, and in sessionStorage (this tab only) when the browser allows it.
// Never localStorage, never a cookie. Every storage access is guarded: it throws when storage is blocked.
export function useApiKey() {
  const [key, setKeyState] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY) ?? "";
      if (isApiKeyShape(stored)) setKeyState(stored);
    } catch {
      // Storage blocked: the key then lasts until the page is closed or reloaded.
    }
    setLoaded(true);
  }, []);

  function setKey(next: string) {
    setKeyState(next);
    try {
      if (next) sessionStorage.setItem(STORAGE_KEY, next);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Same: keep working from memory.
    }
  }

  return { key, loaded, setKey };
}

// Asks for the visitor's own Anthropic key, and once set shrinks to one line that never shows more than its last four characters.
export function KeyPanel(props: { apiKey: string; message: string | null; inputRef: Ref<HTMLInputElement>; onSave: (key: string) => void; onRemove: () => void }) {
  const { apiKey, message, inputRef, onSave, onRemove } = props;
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  if (apiKey) {
    return (
      <p className="keybox keyset">
        Using your key ending in <strong>{apiKey.slice(-4)}</strong>{" "}
        <button type="button" className="link" onClick={onRemove}>
          Remove key
        </button>
      </p>
    );
  }

  const shown = localError ?? message;
  return (
    <form
      className="keybox"
      onSubmit={(e) => {
        e.preventDefault();
        const value = draft.trim();
        if (!isApiKeyShape(value)) {
          setLocalError("That does not look like an Anthropic API key. It should start with sk-ant-.");
          return;
        }
        setLocalError(null);
        setDraft("");
        onSave(value);
      }}
    >
      <label htmlFor="api-key">Your Anthropic API key</label>
      <div className="keyrow">
        <input
          id="api-key"
          ref={inputRef}
          type="password"
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          value={draft}
          aria-describedby={shown ? "key-help key-message" : "key-help"}
          aria-invalid={shown ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setLocalError(null);
          }}
        />
        <button type="submit" className="secondary" disabled={!draft.trim()}>
          Use this key
        </button>
      </div>
      {shown && (
        <p id="key-message" className="problem" role="alert">
          {shown}
        </p>
      )}
      <p id="key-help" className="muted small">
        Questions are billed to your own Anthropic account, at about $0.03 each. The key is kept only in this browser tab and sent with each question over HTTPS. The server uses it for that question and never stores it. A key with a spend limit is a good idea.{" "}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">
          Get a key from the Anthropic Console
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      </p>
    </form>
  );
}
