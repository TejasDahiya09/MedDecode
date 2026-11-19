const APPROVED_PROJECT = 'wyripeqruhvbksjfsvlr';

export type HostedTestConfiguration = Readonly<{
  origin: string;
  projectId: string;
  email: string;
  password: string;
}>;

export function hostedTestsApproved(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.MEDDECODE_HOSTED_E2E_APPROVED === 'true';
}

export function loadHostedTestConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): HostedTestConfiguration {
  if (!hostedTestsApproved(environment)) {
    throw new Error('HOSTED_E2E_APPROVAL_REQUIRED');
  }
  const origin = environment.MEDDECODE_E2E_TARGET_ORIGIN;
  const projectId = environment.MEDDECODE_E2E_PROJECT_ID;
  const email = environment.MEDDECODE_E2E_EMAIL;
  const password = environment.MEDDECODE_E2E_PASSWORD;
  if (!origin || !projectId || !email || !password) {
    throw new Error('HOSTED_E2E_CREDENTIALS_REQUIRED');
  }
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('HOSTED_E2E_TARGET_REJECTED');
  }
  if (projectId !== APPROVED_PROJECT) {
    throw new Error('HOSTED_E2E_PROJECT_REJECTED');
  }
  return Object.freeze({ origin: url.origin, projectId, email, password });
}
