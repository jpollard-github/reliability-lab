/** Stable execution-facade errors mapped by the API composition layer. */
export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used with a different request");
  }
}

export class RateLimitRejectedError extends Error {
  constructor() {
    super("Tenant request rate limit exceeded");
  }
}

export class ExecutionNotFoundError extends Error {
  constructor() {
    super("Execution not found");
  }
}

export class ComparisonNotFoundError extends Error {
  constructor() {
    super("Comparison experiment not found");
  }
}
