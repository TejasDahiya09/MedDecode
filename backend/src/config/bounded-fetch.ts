/** Bound external Supabase requests without logging URLs, tokens or provider errors. */
export function createBoundedFetch(implementation: typeof fetch, timeoutMs = 15_000): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const upstream = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const cancel = () => controller.abort();
    if (upstream?.aborted) cancel();
    else upstream?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, timeoutMs);
    timer.unref();
    try { return await implementation(input, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); upstream?.removeEventListener("abort", cancel); }
  };
}
