import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const postgresBin = "C:\\Program Files\\PostgreSQL\\17\\bin";
const taskPrefix = "meddecode-batch1-pg17-";
const utilityTimeoutMs = 60_000;

async function runWithoutInheritedPipes(executable: string, arguments_: readonly string[]): Promise<void> {
  const child = spawn(executable, arguments_, { stdio: "ignore", windowsHide: true });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("PostgreSQL utility timed out."));
    }, utilityTimeoutMs);
    timeout.unref();
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolveExit(code ?? -1);
    });
  });
  if (exitCode !== 0) throw new Error(`PostgreSQL utility exited with code ${exitCode}.`);
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

export interface PrivatePostgres17 {
  readonly config: {
    readonly host: "127.0.0.1";
    readonly port: number;
    readonly user: "postgres";
    readonly database: "postgres";
  };
  stop(): Promise<void>;
}

export async function startPrivatePostgres17(): Promise<PrivatePostgres17> {
  const root = await mkdtemp(join(tmpdir(), taskPrefix));
  const data = join(root, "data");
  const log = join(root, "postgres.log");
  const port = await availablePort();
  let started = false;

  try {
    await execute(join(postgresBin, "initdb.exe"), [
      "-D", data,
      "-U", "postgres",
      "--auth-local=trust",
      "--auth-host=trust",
      "--encoding=UTF8",
      "--no-locale",
      "--no-sync",
    ], { windowsHide: true, timeout: utilityTimeoutMs });
    await runWithoutInheritedPipes(join(postgresBin, "pg_ctl.exe"), [
      "-D", data,
      "-l", log,
      "-o", `-h 127.0.0.1 -p ${port}`,
      "-t", "30",
      "-w",
      "start",
    ]);
    started = true;

    let stopped = false;
    return {
      config: { host: "127.0.0.1", port, user: "postgres", database: "postgres" },
      async stop() {
        if (stopped) return;
        stopped = true;
        if (started) {
          await runWithoutInheritedPipes(join(postgresBin, "pg_ctl.exe"), ["-D", data, "-m", "fast", "-t", "30", "-w", "stop"]);
          started = false;
        }
        const resolvedRoot = resolve(root);
        const resolvedTemp = resolve(tmpdir());
        assert.ok(resolvedRoot.startsWith(resolvedTemp + "\\"));
        assert.ok(basename(resolvedRoot).startsWith(taskPrefix));
        await rm(resolvedRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (started) {
      await runWithoutInheritedPipes(join(postgresBin, "pg_ctl.exe"), ["-D", data, "-m", "immediate", "-t", "30", "-w", "stop"]).catch(() => undefined);
    }
    const resolvedRoot = resolve(root);
    if (resolvedRoot.startsWith(resolve(tmpdir()) + "\\") && basename(resolvedRoot).startsWith(taskPrefix)) {
      await rm(resolvedRoot, { recursive: true, force: true });
    }
    throw error;
  }
}
