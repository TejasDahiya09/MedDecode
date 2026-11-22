import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env, getDevelopmentFixtureIntelligenceConfig, getPrescriptionUploadEnv } from "./config/env.js";
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
  supabasePrescriptionResultsRepository,
  type PrescriptionResultsRepository
} from "./repositories/prescription-results.repository.js";
import {
  supabaseAuthVerifier,
  type AuthVerifier
} from "./services/auth.service.js";
import { createPrescriptionProcessingRouter } from "./routes/prescription-processing.routes.js";
import {
  createConfiguredAutomaticProcessingJobStore,
  createConfiguredProcessingJobStore,
  type ProcessingJobStoreFactory
} from "./repositories/processing-job.store.js";
import { createDevelopmentFixtureIntelligenceRouter } from "./routes/development-fixture-intelligence.routes.js";
import { LocalPythonIntelligenceClient } from "./services/local-python-intelligence.client.js";
import { createPrescriptionResultsRouter } from "./routes/prescription-results.routes.js";
import {
  createMedicineCatalogueRouter,
  userMedicineCatalogueRepository,
  type MedicineCatalogueRepository,
} from "./routes/medicine-catalogue.routes.js";
import type { MedicineCatalogueDefaultSource } from "./config/env.js";
import { createPrescriptionReviewRouter } from "./routes/prescription-review.routes.js";
import {
  type PrescriptionReviewRepositoryFactory,
} from "./repositories/prescription-review.repository.js";
import { createPostgresPrescriptionReviewRepository } from "./repositories/postgres-prescription-review.repository.js";
import { createPrescriptionDocumentPreviewRouter } from "./routes/prescription-document-preview.routes.js";
import { createS3PrescriptionDocumentPreviewService } from "./services/prescription-document-preview.service.js";
import type { PrescriptionDocumentPreviewService } from "./services/prescription-document-preview.service.js";
import { createRemindersRouter } from "./routes/reminders.routes.js";
import {
  defaultRemindersRepository,
  type RemindersRepository,
} from "./repositories/reminders.repository.js";

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
    supabaseFamilyMemberRepository,
  processingJobStoreFactory: ProcessingJobStoreFactory =
    createConfiguredProcessingJobStore,
  prescriptionResultsRepository: PrescriptionResultsRepository =
    supabasePrescriptionResultsRepository,
  prescriptionReviewOptions: {
    readonly enabled: boolean;
    readonly repositoryFactory: PrescriptionReviewRepositoryFactory;
    readonly documentPreviewService?: PrescriptionDocumentPreviewService;
    readonly autoDispatchConfirmed?: boolean;
  } = {
    enabled: env.prescriptionReviewV3Enabled,
    repositoryFactory: createPostgresPrescriptionReviewRepository,
    autoDispatchConfirmed: env.prescriptionReviewV3Enabled,
  },
  remindersRepository: RemindersRepository = defaultRemindersRepository,
  automaticProcessingJobStoreFactory: ProcessingJobStoreFactory =
    createConfiguredAutomaticProcessingJobStore,
  medicineCatalogueOptions: {
    readonly repository?: MedicineCatalogueRepository;
    readonly enabled?: boolean;
    readonly defaultSource?: MedicineCatalogueDefaultSource;
  } = {}
): Express {
  if (env.prescriptionAutoSubmitEnabled && !env.processingJobStoreEnabled) {
    throw new Error("Automatic prescription submission requires the durable job store.");
  }
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
    uploadDependenciesFactory,
    { enabled: env.prescriptionAutoSubmitEnabled, storeFactory: automaticProcessingJobStoreFactory }
  ));
  app.use(createPrescriptionHistoryRouter(
    authVerifier,
    userClientFactory,
    prescriptionHistoryRepository
  ));
  app.use(createPrescriptionResultsRouter(
    authVerifier,
    userClientFactory,
    prescriptionResultsRepository
  ));
  if (prescriptionReviewOptions.enabled) {
    app.use(createPrescriptionReviewRouter(
      authVerifier,
      userClientFactory,
      prescriptionReviewOptions.repositoryFactory,
      prescriptionReviewOptions.autoDispatchConfirmed === true,
    ));
    const preview=prescriptionReviewOptions.documentPreviewService ??
      (process.env.AWS_REGION?.trim() && process.env.AWS_S3_BUCKET?.trim() ? (()=>{
        const storage=getPrescriptionUploadEnv();
        return createS3PrescriptionDocumentPreviewService({region:storage.awsRegion,bucket:storage.awsS3Bucket,
          maximumBytes:storage.maximumFileSizeBytes,timeoutMs:storage.uploadTimeoutMs});
      })() : undefined);
    if(preview) app.use(createPrescriptionDocumentPreviewRouter(authVerifier,userClientFactory,preview));
  }
  app.use(createMedicineCabinetRouter(
    authVerifier,
    userClientFactory,
    medicineCabinetRepository
  ));
  app.use(createRemindersRouter(
    authVerifier,
    userClientFactory,
    remindersRepository
  ));
  // Keep the catalogue disabled until hosted RPC access has passed deployment
  // verification. Source selection remains explicit and legacy-defaulted.
  app.use(createMedicineCatalogueRouter(
    authVerifier,
    userClientFactory,
    medicineCatalogueOptions.repository ?? userMedicineCatalogueRepository,
    medicineCatalogueOptions.enabled ?? process.env.MEDICINE_CATALOGUE_READ_ENABLED === "true",
    medicineCatalogueOptions.defaultSource ?? env.medicineCatalogueDefaultSource,
  ));
  app.use(createFamilyMemberRouter(
    authVerifier,
    userClientFactory,
    familyMemberRepository
  ));
  app.use(createPrescriptionProcessingRouter(
    authVerifier,
    userClientFactory,
    processingJobStoreFactory
  ));
  const developmentFixture = getDevelopmentFixtureIntelligenceConfig();
  if (developmentFixture) {
    app.use(createDevelopmentFixtureIntelligenceRouter(
      authVerifier,
      () => new LocalPythonIntelligenceClient({
        pythonExecutable: developmentFixture.pythonExecutable,
        intelligenceDirectory: developmentFixture.intelligenceDirectory,
        worker: "development-local-pdf-fixture",
        developmentFixture: {
          mode: "fictional-pdf-injected-ocr",
          pdfPath: developmentFixture.fixturePdfPath,
        },
      }),
      userClientFactory,
    ));
  }
  registerRoutes?.(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
