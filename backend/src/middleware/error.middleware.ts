import type { ErrorRequestHandler, RequestHandler, Response } from "express";

interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

function sendError(
  response: Response,
  statusCode: number,
  code: string,
  message: string
) {
  const body: ErrorBody = { error: { code, message } };
  response.status(statusCode).json(body);
}

function isMalformedJson(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const parseError = error as SyntaxError & {
    status?: number;
    type?: string;
  };

  return parseError.status === 400 && parseError.type === "entity.parse.failed";
}

function isPayloadTooLarge(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const parseError = error as Error & { type?: string };
  return parseError.type === "entity.too.large";
}

export const notFoundHandler: RequestHandler = (_request, response) => {
  sendError(response, 404, "NOT_FOUND", "Route not found.");
};

export const errorHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  next
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (isMalformedJson(error)) {
    sendError(response, 400, "INVALID_JSON", "Request body contains invalid JSON.");
    return;
  }

  if (isPayloadTooLarge(error)) {
    sendError(
      response,
      413,
      "PAYLOAD_TOO_LARGE",
      "Request body exceeds the allowed size."
    );
    return;
  }

  if (error instanceof AppError) {
    sendError(response, error.statusCode, error.code, error.message);
    return;
  }

  sendError(
    response,
    500,
    "INTERNAL_SERVER_ERROR",
    "An unexpected error occurred."
  );
};
