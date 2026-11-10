import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import {
  supabaseAuthVerifier,
  type AuthVerifier
} from "./services/auth.service.js";

export type RouteRegistrar = (app: Express) => void;

export function createApp(
  registerRoutes?: RouteRegistrar,
  authVerifier: AuthVerifier = supabaseAuthVerifier
): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({
    origin: env.corsOrigin
  }));
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);
  app.use(createAuthRouter(authVerifier));
  registerRoutes?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
