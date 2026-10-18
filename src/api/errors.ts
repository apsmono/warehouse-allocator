import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { StrategyNotAvailableError } from "../engine/index.js";

export type ApiErrorCode =
  | "MALFORMED_JSON"
  | "PAYLOAD_TOO_LARGE"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "STRATEGY_NOT_AVAILABLE"
  | "RATE_LIMITED"
  | "INTERNAL";

export type ErrorDetail = {
  path: string;
  message: string;
};

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
};

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorCode;
  public readonly details?: ErrorDetail[];

  constructor(status: number, code: ApiErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends ApiError {
  constructor(details: ErrorDetail[], message = "Order is invalid") {
    super(422, "VALIDATION_FAILED", message, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super(404, "NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class RateLimitedError extends ApiError {
  constructor(message = "Too many allocation requests, please try again later") {
    super(429, "RATE_LIMITED", message);
    this.name = "RateLimitedError";
  }
}

function isBodyParserError(err: unknown): err is { type?: string } {
  return typeof err === "object" && err !== null && "type" in err;
}

export function extractErrorCode(err: unknown): string {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof err.code === "string" &&
    err.code.length > 0
  ) {
    return err.code;
  }
  return err instanceof Error ? err.name : "UnknownError";
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError("Route not found"));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response<ApiErrorBody>,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    const details: ErrorDetail[] = err.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    res.status(422).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "Order is invalid",
        details,
      },
    });
    return;
  }

  if (err instanceof StrategyNotAvailableError) {
    res.status(422).json({
      error: {
        code: "STRATEGY_NOT_AVAILABLE",
        message: err.message,
        details: [
          {
            path: "options.strategy",
            message: err.message,
          },
        ],
      },
    });
    return;
  }

  if (isBodyParserError(err)) {
    if (err.type === "entity.parse.failed") {
      res.status(400).json({
        error: {
          code: "MALFORMED_JSON",
          message: "Request body is not valid JSON",
        },
      });
      return;
    }
    if (err.type === "entity.too.large") {
      res.status(413).json({
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "Request body exceeds 10 KB limit",
        },
      });
      return;
    }
  }

  const reason = extractErrorCode(err);
  console.error(`Unhandled internal error (${reason}).`);
  res.status(500).json({
    error: {
      code: "INTERNAL",
      message: "Internal error",
    },
  });
}
