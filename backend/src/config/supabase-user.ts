import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv } from "./env.js";

/**
 * Creates a request-scoped client for an already verified user. Supabase sends
 * the bearer token to PostgREST, allowing auth.uid()-based RLS policies to
 * enforce that user's database access. This client never receives the secret
 * or service-role key and creating it does not make a network request.
 */
export function createUserSupabaseClient(accessToken: string) {
  if (!accessToken.trim()) {
    throw new Error("A verified access token is required.");
  }

  const { supabaseUrl, supabasePublishableKey } = getSupabasePublicEnv();

  return createClient(supabaseUrl, supabasePublishableKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}
