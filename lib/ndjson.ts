// Yields each JSON line of a response body. A read can end in the middle of a line (or of a
// multi-byte character), so keep the unfinished tail until the rest arrives.
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  let finished = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      tail += decoder.decode(value, { stream: !done });
      const lines = tail.split("\n");
      tail = lines.pop()!;
      for (const line of lines) if (line.trim()) yield JSON.parse(line);
      if (done) break;
    }
    if (tail.trim()) yield JSON.parse(tail);
    finished = true;
  } finally {
    // Stopped early (bad line, or the caller quit): let go of the connection.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
