const nodeEnv = process.env.NODE_ENV ?? "development";

const parsedPort = Number(process.env.PORT ?? 3000);

export function parseCorsOrigin(value: string | undefined, environment: string): string {
  if (!value?.trim()) {
    if (environment === "production") throw new Error("CORS_ORIGIN is required in production.");
    return "http://127.0.0.1:5174";
  }
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.origin !== value) throw new Error();
    return url.origin;
  } catch { throw new Error("CORS_ORIGIN must be an explicit HTTP origin."); }
}

export function validateSupabaseUrl(value: string, environment: string): string {
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && (environment === "production" || url.protocol !== "http:")) ||
        url.username || url.password || url.search || url.hash) throw new Error();
    return value;
  } catch { throw new Error("SUPABASE_URL must be a valid secure URL."); }
}

export function parseProcessingJobStoreEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error("PROCESSING_JOB_STORE_ENABLED must be either true or false.");
}

export type MedicineCatalogueDefaultSource = "legacy" | "official_catalogue";

export function parseMedicineCatalogueDefaultSource(
  value: string | undefined
): MedicineCatalogueDefaultSource {
  if (value === undefined || value === "" || value === "legacy") return "legacy";
  if (value === "official_catalogue") return "official_catalogue";
  throw new Error(
    "MEDICINE_CATALOGUE_DEFAULT_SOURCE must be either legacy or official_catalogue."
  );
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
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN, nodeEnv),
  processingJobStoreEnabled: parseProcessingJobStoreEnabled(
    process.env.PROCESSING_JOB_STORE_ENABLED
  ),
  prescriptionAutoSubmitEnabled: parseProcessingJobStoreEnabled(
    process.env.PRESCRIPTION_AUTO_SUBMIT_ENABLED
  ),
  prescriptionReviewV3Enabled: parseProcessingJobStoreEnabled(
    process.env.MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED
  ),
  medicineCatalogueDefaultSource: parseMedicineCatalogueDefaultSource(
    process.env.MEDICINE_CATALOGUE_DEFAULT_SOURCE
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

  return { supabaseUrl: validateSupabaseUrl(supabaseUrl, nodeEnv), supabaseSecretKey } as const;
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

  return { supabaseUrl: validateSupabaseUrl(supabaseUrl, nodeEnv), supabasePublishableKey } as const;
}

const DEFAULT_PRESCRIPTION_MAX_BYTES = 10 * 1024 * 1024;
// Keep upload acceptance aligned with the current worker/Python input boundary.
const MAXIMUM_CONFIGURABLE_PRESCRIPTION_BYTES = 10 * 1024 * 1024;
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
      "PRESCRIPTION_MAX_FILE_SIZE_BYTES must be a positive integer no greater than 10 MiB."
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
