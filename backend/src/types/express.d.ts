import type { VerifiedIdentity } from "../services/auth.service.js";
import type { UserSupabaseClient } from "../config/supabase-user.js";

declare global {
  namespace Express {
    interface Request {
      auth?: Readonly<VerifiedIdentity>;
      userSupabase?: UserSupabaseClient;
    }
  }
}

export {};
