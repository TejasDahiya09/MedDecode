const nodeEnv = process.env.NODE_ENV ?? "development";

const parsedPort = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
  throw new Error("PORT must be a valid integer between 1 and 65535.");
}

export const env = {
  nodeEnv,
  port: parsedPort,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173"
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
