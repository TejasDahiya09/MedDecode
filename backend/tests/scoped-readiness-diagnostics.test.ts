import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createHash, createHmac } from "node:crypto";
import { join } from "node:path";

const localRequire = createRequire(join(process.cwd(), "package.json"));
const { verifyStsResponse, safeErrorCode, Sha256 } = localRequire("./scripts/verify-scoped-hosted-readiness.cjs") as {
  verifyStsResponse(ok: boolean, body: string): void;
  safeErrorCode(error: unknown, stage: string): string;
  Sha256: new (secret?: string | Uint8Array) => unknown;
};

test("readiness configuration failures identify their category without leaking environment secrets", () => {
  const sentinel = "SYNTHETIC_SECRET_NEVER_PRINT";
  const run = spawnSync(process.execPath, ["scripts/verify-scoped-hosted-readiness.cjs"], {
    env: { ...process.env, WORKER_RPC_MODE: "invalid", MEDDECODE_CATALOGUE_PASSWORD: sentinel },
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /SCOPED_READINESS_FAILED:CONFIGURATION:CHECK_FAILED/);
  assert.doesNotMatch(run.stderr + run.stdout, new RegExp(sentinel));
});

test("STS diagnostics classify failures without exposing returned identities or error messages", () => {
  assert.doesNotThrow(() => verifyStsResponse(true, '<Arn>arn:aws:iam::226945380522:user/meddecode-worker-dev</Arn>'));
  for (const code of ["InvalidClientTokenId", "SignatureDoesNotMatch", "ExpiredToken", "AccessDenied", "InvalidToken"]) {
    assert.throws(() => verifyStsResponse(false, `<Error><Code>${code}</Code><Message>SENSITIVE</Message></Error>`),
      (error: unknown) => safeErrorCode(error, "AWS_IDENTITY") === code && !String(error).includes("SENSITIVE"));
  }
  assert.throws(() => verifyStsResponse(true, '<Arn>arn:aws:iam::000000000000:user/other</Arn>'),
    (error: unknown) => safeErrorCode(error, 'AWS_IDENTITY') === 'WRONG_AWS_IDENTITY');
  assert.equal(safeErrorCode({ $metadata: { httpStatusCode: 403 }, message: 'SECRET' }, 'S3_METADATA'), 'S3_ACCESS_DENIED');
  assert.equal(safeErrorCode({ $metadata: { httpStatusCode: 404 }, message: 'SECRET' }, 'S3_METADATA'), 'S3_NOT_FOUND');
});

test("readiness verifier separates database, catalogue, AWS and object stages", () => {
  const source = readFileSync("scripts/verify-scoped-hosted-readiness.cjs", "utf8");
  for (const name of ["SCOPED_DATABASE", "CATALOGUE_READER", "AWS_IDENTITY", "S3_METADATA"]) {
    assert.match(source, new RegExp(`stage = '${name}'`));
  }
  for (const marker of ["SCOPED_DATABASE_IDENTITY_OK", "CATALOGUE_READER_QUERY_OK", "WORKER_IDENTITY_AND_S3_OBJECT_METADATA_OK"]) {
    assert.ok(source.includes(marker));
  }
});

test("readiness tags are transaction-local and retained pooler sessions are never exempted", () => {
  const readiness = readFileSync("scripts/verify-scoped-hosted-readiness.cjs", "utf8");
  const barrier = readFileSync("scripts/wait-scoped-worker-barrier.ps1", "utf8");
  assert.match(readiness, /set_config\('application_name', \$1, true\)/);
  assert.match(readiness, /finally \{ c\.release\(true\); \}/);
  assert.match(readiness, /finally \{ await worker\.end\(\); \}/);
  assert.match(barrier, /if \(\$sessions -eq 0 -and \$locks -eq 0\)/);
  assert.match(barrier, /SELECT count\(\*\) FROM pg_stat_activity WHERE usename IN/);
  assert.doesNotMatch(barrier, /pg_terminate_backend|pg_cancel_backend|Start-Process/i);
  assert.doesNotMatch(barrier, /application_name\s*(?:=|<>|!=)/i);
});

test("STS request signature matches an independent SigV4 calculation", async () => {
  const { SignatureV4 } = localRequire("@smithy/signature-v4");
  const secret = "synthetic-secret";
  const signer = new SignatureV4({ credentials: { accessKeyId: "synthetic-key", secretAccessKey: secret },
    region: "ap-south-1", service: "sts", sha256: Sha256 });
  const request = await signer.sign({ protocol: "https:", hostname: "sts.ap-south-1.amazonaws.com", method: "GET", path: "/",
    headers: { host: "sts.ap-south-1.amazonaws.com" }, query: { Action: "GetCallerIdentity", Version: "2011-06-15" } },
    { signingDate: new Date("2026-11-14T00:00:00Z") });
  const authorization = request.headers.authorization as string;
  const fields = /SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(authorization);
  assert.ok(fields);
  const signedHeaders = fields[1]; const signature = fields[2];
  assert.ok(signedHeaders && signature);
  const names = signedHeaders.split(";");
  const headers = names.map((name: string) => `${name}:${String(request.headers[name]).trim()}\n`).join("");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const canonical = `GET\n/\nAction=GetCallerIdentity&Version=2011-06-15\n${headers}\n${signedHeaders}\n${hash("")}`;
  const toSign = `AWS4-HMAC-SHA256\n20261114T000000Z\n20261114/ap-south-1/sts/aws4_request\n${hash(canonical)}`;
  const hmac = (key: string | Buffer, message: string) => createHmac("sha256", key).update(message).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, "20261114"), "ap-south-1"), "sts"), "aws4_request");
  assert.equal(signature, createHmac("sha256", signingKey).update(toSign).digest("hex"));
});
