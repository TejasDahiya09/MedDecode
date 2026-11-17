import "dotenv/config";

import { app } from "./app.js";
import { env } from "./config/env.js";
import { createHttpShutdown } from "./services/http-shutdown.js";

export function startServer() {
  const onListening = () => {
    console.log(`MedDecode backend running on port ${env.port}`);
  };
  const server = env.nodeEnv === "development"
    ? app.listen(env.port, "127.0.0.1", onListening)
    : app.listen(env.port, onListening);

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`MedDecode backend failed to start (${error.code ?? "UNKNOWN"}).`);
    process.exitCode = 1;
  });

  const shutdown = createHttpShutdown(server);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.once("close", () => {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  });

  return server;
}

startServer();
