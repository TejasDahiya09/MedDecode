import type { VerifiedIdentity } from "../services/auth.service.js";

declare global {
  namespace Express {
    interface Request {
      auth?: Readonly<VerifiedIdentity>;
    }
  }
}

export {};
