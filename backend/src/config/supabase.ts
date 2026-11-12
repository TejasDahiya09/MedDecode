import { createClient } from "@supabase/supabase-js";

import { getSupabaseEnv } from "./env.js";

const { supabaseUrl, supabaseSecretKey } = getSupabaseEnv();

/**
 * Privileged server-only client. Do not use this client in ordinary user routes:
 * its secret key can bypass RLS. User-facing data access must use a user-scoped
 * client carrying the verified caller's access token.
 */
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseSecretKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);
