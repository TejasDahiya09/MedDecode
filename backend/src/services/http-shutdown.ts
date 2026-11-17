import type { Server } from "node:http";

/** Stop accepting requests, then force-close lingering connections at the deadline. */
export function createHttpShutdown(server: Server, timeoutMs = 15_000): () => void {
  let closing = false;
  return () => {
    if (closing) return;
    closing = true;
    const timer = setTimeout(() => server.closeAllConnections(), timeoutMs);
    timer.unref();
    server.close(() => clearTimeout(timer));
    server.closeIdleConnections();
  };
}
