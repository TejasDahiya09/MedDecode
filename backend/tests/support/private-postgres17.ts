import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, open, rm } from "node:fs/promises";
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

async function startWindowsServerDirectly(data: string, log: string, port: number): Promise<ChildProcess> {
  const logHandle = await open(log, "a");
  const child = spawn(join(postgresBin, "postgres.exe"), [
    "-D", data,
    "-h", "127.0.0.1",
    "-p", String(port),
  ], { stdio: ["ignore", logHandle.fd, logHandle.fd], windowsHide: true });
  await logHandle.close();
  const error = new Promise<never>((_, reject) => child.once("error", reject));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`PostgreSQL server exited during startup with code ${child.exitCode}.`);
    try {
      await execute(join(postgresBin, "pg_isready.exe"), ["-h", "127.0.0.1", "-p", String(port)], {
        windowsHide: true,
        timeout: 2000,
      });
      return child;
    } catch {
      await Promise.race([new Promise(resolveDelay => setTimeout(resolveDelay, 100)), error]);
    }
  }
  child.kill();
  throw new Error("PostgreSQL direct server startup timed out.");
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
  let directServer: ChildProcess | undefined;

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
    if (process.platform === "win32") {
      // pg_ctl.exe invokes CreateRestrictedToken on Windows. That operation
      // fails with error 87 inside the restricted Codex token even though the
      // task-owned data directory is writable. Launching postgres.exe directly
      // preserves the same loopback/data boundaries without elevating rights.
      directServer = await startWindowsServerDirectly(data, log, port);
    } else {
      await runWithoutInheritedPipes(join(postgresBin, "pg_ctl.exe"), [
        "-D", data,
        "-l", log,
        "-o", `-h 127.0.0.1 -p ${port}`,
        "-t", "30",
        "-w",
        "start",
      ]);
    }
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
          if (directServer?.exitCode === null) {
            await new Promise<void>(resolveExit => directServer!.once("exit", () => resolveExit()));
          }
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
      if (directServer?.exitCode === null) directServer.kill();
    }
    const resolvedRoot = resolve(root);
    if (resolvedRoot.startsWith(resolve(tmpdir()) + "\\") && basename(resolvedRoot).startsWith(taskPrefix)) {
      await rm(resolvedRoot, { recursive: true, force: true });
    }
    throw error;
  }
}
