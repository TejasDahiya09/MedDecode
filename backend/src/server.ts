import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "meddecode-backend",
    version: "1.0.0"
  });
});

app.listen(PORT, () => {
  console.log(`MedDecode backend running on port ${PORT}`);
});
