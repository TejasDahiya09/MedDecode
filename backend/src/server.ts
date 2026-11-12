import "dotenv/config";

import { app } from "./app.js";
import { env } from "./config/env.js";

export function startServer() {
  const server = app.listen(env.port, () => {
    console.log(`MedDecode backend running on port ${env.port}`);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error(`MedDecode backend failed to start (${error.code ?? "UNKNOWN"}).`);
    process.exitCode = 1;
  });

  return server;
}

startServer();
