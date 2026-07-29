/** Maps domain and Fastify errors to safe established HTTP error envelopes. */
import type { FastifyInstance } from "fastify";
import {
  ComparisonNotFoundError,
  ExecutionNotFoundError,
  IdempotencyConflictError,
  InvestigationCaseInputError,
  InvestigationCaseNotFoundError,
  InvestigationQueryError,
  RateLimitRejectedError,
} from "@reliability-lab/core";

export function installErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error);
    request.log.warn({ err: error, statusCode: mapped.statusCode }, mapped.message);
    return reply.code(mapped.statusCode).send(mapped);
  });
}

function mapError(error: unknown) {
  if (error instanceof InvestigationCaseInputError) {
    return { error: "invalid_investigation_case", message: error.message, statusCode: 400 };
  }
  if (error instanceof InvestigationQueryError) {
    return { error: "invalid_investigation_query", message: error.message, statusCode: 400 };
  }
  if (
    error instanceof ExecutionNotFoundError ||
    error instanceof ComparisonNotFoundError ||
    error instanceof InvestigationCaseNotFoundError
  ) {
    return { error: "not_found", message: error.message, statusCode: 404 };
  }
  if (error instanceof IdempotencyConflictError) {
    return { error: "idempotency_conflict", message: error.message, statusCode: 409 };
  }
  if (error instanceof RateLimitRejectedError) {
    return { error: "rate_limit_rejected", message: error.message, statusCode: 429 };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return {
      error: "request_error",
      message: error instanceof Error ? error.message : "Request is invalid",
      statusCode: error.statusCode,
    };
  }
  const validation = typeof error === "object" && error !== null && "validation" in error;
  return {
    error: validation ? "validation_error" : "internal_error",
    message:
      validation && error instanceof Error ? error.message : "Request could not be completed",
    statusCode: validation ? 400 : 500,
  };
}
