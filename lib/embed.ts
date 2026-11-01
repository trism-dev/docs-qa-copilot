import os from "node:os";
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";

// Serverless filesystems are read-only except for the temp dir.
env.cacheDir = path.join(os.tmpdir(), "hf-cache");

const BATCH = 16;
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

let extractor: ReturnType<typeof load> | undefined;

function load() {
  return pipeline("feature-extraction", "Xenova/bge-small-en-v1.5", { dtype: "q8" });
}

async function embed(texts: string[]): Promise<number[][]> {
  const run = await (extractor ??= load().catch((err) => {
    extractor = undefined; // do not cache a failed load
    throw err;
  }));
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const t = await run(texts.slice(i, i + BATCH), { pooling: "mean", normalize: true });
    out.push(...(t.tolist() as number[][]));
  }
  return out;
}

export const embedPassages = embed;

export async function embedQuery(q: string): Promise<number[]> {
  return (await embed([QUERY_PREFIX + q]))[0];
}
