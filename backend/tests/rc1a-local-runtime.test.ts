import assert from "node:assert/strict";
import test from "node:test";

import { assertRc1aLocalRuntime, createRc1aDisabledWorker } from "../scripts/rc1a-local-runtime.js";

const root = "C:\\Users\\dahiy\\MedDecode\\tmp\\rc1a";
const base = {
  databaseUrl: "postgresql://meddecode_scoped_login@127.0.0.1:55440/meddecode_phase1f_20261115",
  intelligenceUrl: "http://127.0.0.1:18000",
  storageRoot: `${root}\\documents`,
  temporaryRoot: `${root}\\worker-tmp`,
  repositoryRoot: root,
  workerInstanceId: "rc1a-local-worker-001",
  internalToken: "r".repeat(48),
  catalogueEnvironment: {
    MEDDECODE_CATALOGUE_ENV: "local",
    MEDDECODE_CATALOGUE_HOST: "127.0.0.1",
    MEDDECODE_CATALOGUE_PORT: "55440",
    MEDDECODE_CATALOGUE_DATABASE: "meddecode_phase1f_20261115",
    MEDDECODE_CATALOGUE_USER: "meddecode_catalogue_rc1a_reader",
    MEDDECODE_CATALOGUE_SSLMODE: "disable",
  },
} as const;

test("RC-1A configuration accepts only the task-owned loopback graph", () => {
  assert.doesNotThrow(() => assertRc1aLocalRuntime(base));
  for (const configuration of [
    { ...base, databaseUrl: "postgresql://meddecode_scoped_login@db.example.invalid:5432/meddecode_phase1f_20261115" },
    { ...base, intelligenceUrl: "https://intelligence.example.invalid" },
    { ...base, storageRoot: "C:\\Users\\dahiy\\MedDecode\\outside" },
    { ...base, catalogueEnvironment: { ...base.catalogueEnvironment, MEDDECODE_CATALOGUE_ENV: "hosted" } },
    { ...base, catalogueEnvironment: { ...base.catalogueEnvironment, MEDDECODE_CATALOGUE_PASSWORD: "must-not-be-accepted" } },
  ]) assert.throws(() => assertRc1aLocalRuntime(configuration));
});

test("RC-1A constructs one disabled real FastAPI worker without claiming a job", () => {
  let calls = 0;
  const caller = { rpc: async () => { calls += 1; return { data: [], error: null }; } };
  const composition = createRc1aDisabledWorker({
    configuration: base,
    rpcCaller: caller,
    storageClient: { send: async () => { throw new Error("not started"); } },
    reviewStore: {
      initializeFromOcr: async () => { throw new Error("not started"); },
      completeInitialReview: async () => { throw new Error("not started"); },
      loadConfirmed: async () => { throw new Error("not started"); },
      finalizeConfirmed: async () => { throw new Error("not started"); },
      failConfirmed: async () => { throw new Error("not started"); },
    },
    confirmedIntelligence: { analyzeConfirmed: async () => { throw new Error("not started"); } },
  });
  assert.equal(calls, 0);
  assert.ok(composition.runtime);
});
