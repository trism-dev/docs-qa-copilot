import { test } from "node:test";
import assert from "node:assert/strict";
import { API_KEY_HEADER, isApiKeyShape, readApiKey } from "./api-key.ts";

const KEY = "sk-ant-fake0000000000000000000";

test("accepts a key that starts with sk-ant- and is 20 to 300 characters", () => {
  assert.ok(isApiKeyShape(KEY));
  assert.ok(isApiKeyShape("sk-ant-" + "a".repeat(13)));
  assert.ok(isApiKeyShape("sk-ant-" + "a".repeat(293)));
});

test("rejects a wrong prefix, a wrong length and any whitespace", () => {
  for (const v of ["", "sk-ant-", "sk-ant-" + "a".repeat(12), "sk-ant-" + "a".repeat(294), "sk-xxx-" + "a".repeat(20), " " + KEY, KEY + " ", KEY + "\n", "sk-ant-aaaa aaaaaaaaaaaaaaaa", "SK-ANT-" + "a".repeat(20)]) {
    assert.equal(isApiKeyShape(v), false, JSON.stringify(v));
  }
});

test("readApiKey reads only the header and says why a key was refused", () => {
  assert.deepEqual(readApiKey(new Headers({ [API_KEY_HEADER]: KEY })), { apiKey: KEY });
  assert.match((readApiKey(new Headers()) as { error: string }).error, /Add your Anthropic API key/);
  assert.match((readApiKey(new Headers({ [API_KEY_HEADER]: "nope" })) as { error: string }).error, /does not look like/);
  // Other headers do not count.
  assert.ok("error" in readApiKey(new Headers({ authorization: `Bearer ${KEY}`, "x-api-key": KEY })));
});
