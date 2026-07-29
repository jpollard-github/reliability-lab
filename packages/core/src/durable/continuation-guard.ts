/**
 * Cancellation boundary between durable lease ownership and domain continuation.
 * Lease loss stops local work; it is not normalized as a provider timeout.
 */
export interface ExecutionContinuationGuard {
  readonly signal: AbortSignal;
  assertActive(): Promise<void>;
}

export class ExecutionContinuationStoppedError extends Error {
  constructor(message = "Execution continuation was stopped by the worker runtime") {
    super(message);
    this.name = "ExecutionContinuationStoppedError";
  }
}

export class LeaseOwnershipLostError extends ExecutionContinuationStoppedError {
  constructor() {
    super("Execution continuation stopped because lease ownership was lost");
    this.name = "LeaseOwnershipLostError";
  }
}

export function isExecutionContinuationStoppedError(
  error: unknown,
): error is ExecutionContinuationStoppedError {
  return error instanceof ExecutionContinuationStoppedError;
}

export function isLeaseOwnershipLostError(error: unknown): error is LeaseOwnershipLostError {
  return error instanceof LeaseOwnershipLostError;
}

const unrestrictedContinuationController = new AbortController();

export const unrestrictedContinuationGuard: ExecutionContinuationGuard = {
  signal: unrestrictedContinuationController.signal,
  assertActive: async () => undefined,
};
