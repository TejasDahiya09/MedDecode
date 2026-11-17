import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createHttpShutdown } from "../src/services/http-shutdown.js";

test("graceful shutdown is idempotent and stops the HTTP listener", async () => {
  const server = createServer((_request, response) => response.end("ok"));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const closed = new Promise<void>(resolve => server.once("close", resolve));
  const stop = createHttpShutdown(server, 500);
  stop(); stop();
  await closed;
  assert.equal(server.listening, false);
});
