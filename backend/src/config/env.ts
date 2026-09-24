const nodeEnv = process.env.NODE_ENV ?? "development";

const parsedPort = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
  throw new Error("PORT must be a valid integer between 1 and 65535.");
}

export const env = {
  nodeEnv,
  port: parsedPort,
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173"
} as const;
