import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv } from "../config/env.js";

export interface VerifiedIdentity {
  readonly userId: string;
  readonly email?: string;
}

export interface AuthVerifier {
  verifyAccessToken(accessToken: string): Promise<VerifiedIdentity>;
}

export class AuthenticationFailure extends Error {
  constructor() {
    super("Authentication failed.");
    this.name = "AuthenticationFailure";
  }
}

let authClient: SupabaseClient | undefined;

function getAuthClient(): SupabaseClient {
  if (!authClient) {
    const { supabaseUrl, supabasePublishableKey } = getSupabasePublicEnv();
    authClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }

  return authClient;
}

export const supabaseAuthVerifier: AuthVerifier = {
  async verifyAccessToken(accessToken) {
    try {
      const { data, error } = await getAuthClient().auth.getUser(accessToken);

      if (error || !data.user?.id) {
        throw new AuthenticationFailure();
      }

      const identity: VerifiedIdentity = data.user.email
        ? { userId: data.user.id, email: data.user.email }
        : { userId: data.user.id };

      return Object.freeze(identity);
    } catch {
      throw new AuthenticationFailure();
    }
  }
};
