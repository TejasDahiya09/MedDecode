import { describe, expect, it } from 'vitest';

import {
  hostedTestsApproved,
  loadHostedTestConfiguration,
} from '../e2e/support/hosted-test-credentials';

const approved = {
  MEDDECODE_HOSTED_E2E_APPROVED: 'true',
  MEDDECODE_E2E_TARGET_ORIGIN: 'https://meddecode.example.test',
  MEDDECODE_E2E_PROJECT_ID: 'wyripeqruhvbksjfsvlr',
  MEDDECODE_E2E_EMAIL: ['injected-at-runtime', 'example.test'].join('@'),
  MEDDECODE_E2E_PASSWORD: ['injected', 'at', 'runtime'].join('-'),
};

describe('hosted browser test configuration', () => {
  it('fails closed until separately approved', () => {
    expect(hostedTestsApproved({})).toBe(false);
    expect(() => loadHostedTestConfiguration({})).toThrow('HOSTED_E2E_APPROVAL_REQUIRED');
  });

  it('requires every runtime-only credential input', () => {
    const missingPassword = { ...approved, MEDDECODE_E2E_PASSWORD: undefined };
    expect(() => loadHostedTestConfiguration(missingPassword)).toThrow(
      'HOSTED_E2E_CREDENTIALS_REQUIRED',
    );
  });

  it('rejects a different project and credentials embedded in the target URL', () => {
    expect(() => loadHostedTestConfiguration({
      ...approved,
      MEDDECODE_E2E_PROJECT_ID: 'unapproved-project',
    })).toThrow('HOSTED_E2E_PROJECT_REJECTED');
    expect(() => loadHostedTestConfiguration({
      ...approved,
      MEDDECODE_E2E_TARGET_ORIGIN: `https://${['name', 'runtime-value'].join(':')}@meddecode.example.test`,
    })).toThrow('HOSTED_E2E_TARGET_REJECTED');
  });

  it('returns configuration without transforming or exposing credentials', () => {
    const result = loadHostedTestConfiguration(approved);
    expect(result.origin).toBe('https://meddecode.example.test');
    expect(result.projectId).toBe('wyripeqruhvbksjfsvlr');
    expect(Object.isFrozen(result)).toBe(true);
  });
});
