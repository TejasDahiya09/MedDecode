import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env.js";

const app = express();

app.use(helmet());
app.use(cors({
  origin: env.corsOrigin
}));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "meddecode-backend",
    version: "1.0.0"
  });
});

app.listen(env.port, () => {
  console.log(`MedDecode backend running on port ${env.port}`);
});
