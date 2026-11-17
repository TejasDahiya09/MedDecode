import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedFetch } from "../src/config/bounded-fetch.js";

const pendingFetch: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
  const signal = init?.signal;
  if (signal?.aborted) return reject(new Error("aborted"));
  signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
});

test("aborts a stalled provider request within the configured deadline", async () => {
  const keepAlive = setTimeout(() => undefined, 500);
  try { await assert.rejects(createBoundedFetch(pendingFetch, 10)("https://example.invalid"), /aborted/); }
  finally { clearTimeout(keepAlive); }
});

test("preserves caller cancellation", async () => {
  const controller = new AbortController();
  const pending = createBoundedFetch(pendingFetch)("https://example.invalid", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /aborted/);
});
