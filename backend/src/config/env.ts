const nodeEnv = process.env.NODE_ENV ?? "development";

const parsedPort = Number(process.env.PORT ?? 3000);

export function parseProcessingJobStoreEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error("PROCESSING_JOB_STORE_ENABLED must be either true or false.");
}

export interface DevelopmentFixtureIntelligenceConfig {
  readonly pythonExecutable: string;
  readonly intelligenceDirectory: string;
  readonly fixturePdfPath: string;
}

/**
 * This integration is deliberately unavailable unless a local development
 * process opts in with all three server-side paths. It is never configurable
 * by an HTTP request and is not available outside NODE_ENV=development.
 */
export function getDevelopmentFixtureIntelligenceConfig(
  source: Readonly<Record<string, string | undefined>> = process.env
): DevelopmentFixtureIntelligenceConfig | null {
  if (nodeEnv !== "development" || source.DEVELOPMENT_FIXTURE_INTELLIGENCE_ENABLED !== "true") {
    return null;
  }
  const pythonExecutable = source.DEVELOPMENT_FIXTURE_PYTHON_EXECUTABLE?.trim();
  const intelligenceDirectory = source.DEVELOPMENT_FIXTURE_INTELLIGENCE_DIRECTORY?.trim();
  const fixturePdfPath = source.DEVELOPMENT_FIXTURE_PDF_PATH?.trim();
  if (!pythonExecutable || !intelligenceDirectory || !fixturePdfPath) {
    throw new Error("Development fixture intelligence requires explicit local paths.");
  }
  return { pythonExecutable, intelligenceDirectory, fixturePdfPath };
}

if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
  throw new Error("PORT must be a valid integer between 1 and 65535.");
}

export const env = {
  nodeEnv,
  port: parsedPort,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  processingJobStoreEnabled: parseProcessingJobStoreEnabled(
    process.env.PROCESSING_JOB_STORE_ENABLED
  )
} as const;

export function getSupabaseEnv() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required.");
  }

  if (!supabaseSecretKey) {
    throw new Error("SUPABASE_SECRET_KEY is required.");
  }

  return { supabaseUrl, supabaseSecretKey } as const;
}

export function getSupabasePublicEnv() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required.");
  }

  if (!supabasePublishableKey) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY is required.");
  }

  return { supabaseUrl, supabasePublishableKey } as const;
}

const DEFAULT_PRESCRIPTION_MAX_BYTES = 10 * 1024 * 1024;
const MAXIMUM_CONFIGURABLE_PRESCRIPTION_BYTES = 50 * 1024 * 1024;
const DEFAULT_PRESCRIPTION_UPLOAD_TIMEOUT_MS = 30_000;
const MAXIMUM_PRESCRIPTION_UPLOAD_TIMEOUT_MS = 5 * 60_000;

export function getPrescriptionUploadEnv() {
  const awsRegion = process.env.AWS_REGION;
  const awsS3Bucket = process.env.AWS_S3_BUCKET;
  const configuredMaximum = process.env.PRESCRIPTION_MAX_FILE_SIZE_BYTES;
  const configuredTimeout = process.env.PRESCRIPTION_UPLOAD_TIMEOUT_MS;
  const maximumFileSizeBytes = configuredMaximum === undefined
    ? DEFAULT_PRESCRIPTION_MAX_BYTES
    : Number(configuredMaximum);
  const uploadTimeoutMs = configuredTimeout === undefined
    ? DEFAULT_PRESCRIPTION_UPLOAD_TIMEOUT_MS
    : Number(configuredTimeout);

  if (!awsRegion?.trim()) {
    throw new Error("AWS_REGION is required for prescription storage.");
  }

  if (!awsS3Bucket?.trim()) {
    throw new Error("AWS_S3_BUCKET is required for prescription storage.");
  }

  if (
    !Number.isSafeInteger(maximumFileSizeBytes) ||
    maximumFileSizeBytes <= 0 ||
    maximumFileSizeBytes > MAXIMUM_CONFIGURABLE_PRESCRIPTION_BYTES
  ) {
    throw new Error(
      "PRESCRIPTION_MAX_FILE_SIZE_BYTES must be a positive integer no greater than 50 MiB."
    );
  }

  if (
    !Number.isSafeInteger(uploadTimeoutMs) ||
    uploadTimeoutMs <= 0 ||
    uploadTimeoutMs > MAXIMUM_PRESCRIPTION_UPLOAD_TIMEOUT_MS
  ) {
    throw new Error(
      "PRESCRIPTION_UPLOAD_TIMEOUT_MS must be a positive integer no greater than 300000."
    );
  }

  return {
    awsRegion: awsRegion.trim(),
    awsS3Bucket: awsS3Bucket.trim(),
    maximumFileSizeBytes,
    uploadTimeoutMs
  } as const;
}
