import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import { createAuthRouter } from "./routes/auth.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { createProfileRouter } from "./routes/profile.routes.js";
import { createMedicineCabinetRouter } from "./routes/medicine-cabinet.routes.js";
import { createFamilyMemberRouter } from "./routes/family-member.routes.js";
import { createPrescriptionHistoryRouter } from "./routes/prescription-history.routes.js";
import {
  supabaseMedicineCabinetRepository,
  type MedicineCabinetRepository
} from "./repositories/medicine-cabinet.repository.js";
import {
  supabaseFamilyMemberRepository,
  type FamilyMemberRepository
} from "./repositories/family-member.repository.js";
import {
  createPrescriptionUploadRouter,
  createDefaultPrescriptionUploadDependencies,
  type PrescriptionUploadDependenciesFactory
} from "./routes/prescription-upload.routes.js";
import {
  createUserSupabaseClient,
  type UserSupabaseClientFactory
} from "./config/supabase-user.js";
import {
  supabaseProfileRepository,
  type ProfileRepository
} from "./repositories/profile.repository.js";
import {
  supabasePrescriptionHistoryRepository,
  type PrescriptionHistoryRepository
} from "./repositories/prescription-history.repository.js";
import {
  supabaseAuthVerifier,
  type AuthVerifier
} from "./services/auth.service.js";

export type RouteRegistrar = (app: Express) => void;

export function createApp(
  registerRoutes?: RouteRegistrar,
  authVerifier: AuthVerifier = supabaseAuthVerifier,
  userClientFactory: UserSupabaseClientFactory = createUserSupabaseClient,
  profileRepository: ProfileRepository = supabaseProfileRepository,
  uploadDependenciesFactory: PrescriptionUploadDependenciesFactory =
    createDefaultPrescriptionUploadDependencies,
  prescriptionHistoryRepository: PrescriptionHistoryRepository =
    supabasePrescriptionHistoryRepository,
  medicineCabinetRepository: MedicineCabinetRepository =
    supabaseMedicineCabinetRepository,
  familyMemberRepository: FamilyMemberRepository =
    supabaseFamilyMemberRepository
): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({
    origin: env.corsOrigin
  }));
  app.use(express.json({ limit: "1mb" }));

  app.use(healthRouter);
  app.use(createAuthRouter(authVerifier));
  app.use(createProfileRouter(
    authVerifier,
    userClientFactory,
    profileRepository
  ));
  app.use(createPrescriptionUploadRouter(
    authVerifier,
    userClientFactory,
    uploadDependenciesFactory
  ));
  app.use(createPrescriptionHistoryRouter(
    authVerifier,
    userClientFactory,
    prescriptionHistoryRepository
  ));
  app.use(createMedicineCabinetRouter(
    authVerifier,
    userClientFactory,
    medicineCabinetRepository
  ));
  app.use(createFamilyMemberRouter(
    authVerifier,
    userClientFactory,
    familyMemberRepository
  ));
  registerRoutes?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
