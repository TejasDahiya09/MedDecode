import { Router } from "express";
import { readFileSync } from "node:fs";
import { Client } from "pg";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "meddecode-backend",
    version: "1.0.0"
  });
});

async function pythonReady(): Promise<boolean> {
  try {
    const endpoint = new URL(process.env.PYTHON_INTELLIGENCE_URL ?? "");
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !((endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) || endpoint.protocol === "https:")) return false;
    endpoint.pathname = "/ready";
    const response = await fetch(endpoint, { redirect: "error", signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch { return false; }
}

/** Optional dedicated, read-only DB identity. No fallback to a privileged client. */
async function databaseReady(): Promise<boolean> {
  let client: Client | undefined;
  try {
    const connectionString = process.env.BACKEND_READINESS_DATABASE_URL;
    if (!connectionString) return false;
    const url = new URL(connectionString);
    const user = decodeURIComponent(url.username).split(".")[0]?.toLowerCase();
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !user || url.search || url.hash ||
        ["postgres", "service_role", "authenticated", "anon", "meddecode_worker"].includes(user)) return false;
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    const noTls = process.env.BACKEND_READINESS_LOCAL_NO_TLS === "true" && local && process.env.NODE_ENV !== "production";
    const caPath = process.env.BACKEND_READINESS_DATABASE_CA_FILE;
    if (!noTls && !caPath) return false;
    client = new Client({ connectionString, connectionTimeoutMillis: 2000, statement_timeout: 2000,
      ssl: noTls ? false : { ca: readFileSync(caPath!, "utf8"), rejectUnauthorized: true } });
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT 1");
    await client.query("ROLLBACK");
    return true;
  } catch { return false; }
  finally { await client?.end().catch(() => undefined); }
}

let pending: Promise<{ python: boolean; database: boolean }> | undefined;
healthRouter.get("/ready", async (_req, res) => {
  // Share overlapping checks so unauthenticated probes cannot open an unbounded number of connections.
  pending ??= Promise.all([pythonReady(), databaseReady()]).then(([python, database]) => ({ python, database })).finally(() => { pending = undefined; });
  const state = await pending;
  res.status(state.python && state.database ? 200 : 503).json({ status: state.python && state.database ? "ready" : "not_ready",
    dependencies: { intelligence: state.python ? "ready" : "unavailable", database: state.database ? "ready" : "unavailable" } });
});
