/** Public core-domain surface. Internal modules import their direct owners. */
export * from "./execution/ports.js";
export * from "./execution/commands.js";
export * from "./execution/errors.js";
export { hasAmbiguousProviderAttempt } from "./execution/execution-state.js";
export * from "./execution/execution-service.js";
export * from "./execution/memory-execution-repository.js";

export * from "./replay/replay-store.js";
export * from "./replay/memory-replay-store.js";

export * from "./comparison.js";
export * from "./comparison/repository.js";

export * from "./durable/job-store.js";
export {
  ExecutionContinuationStoppedError,
  LeaseOwnershipLostError,
  isExecutionContinuationStoppedError,
  isLeaseOwnershipLostError,
  type ExecutionContinuationGuard,
} from "./durable/continuation-guard.js";
export {
  LeaseHeartbeatController,
  type LeaseHeartbeatTimers,
} from "./durable/lease-heartbeat-controller.js";
export * from "./durable/durable-execution-worker.js";

export * from "./investigation.js";
export * from "./investigation-cases.js";

export {
  abortableSleep,
  type Clock,
  type IdSource,
  type RandomSource,
} from "./infrastructure/clock.js";
export * from "./infrastructure/hashing.js";
export * from "./infrastructure/provider-registry.js";
export * from "./infrastructure/resilience.js";
export type { ExecutionTracer } from "./infrastructure/tracing.js";

export type { ComparisonExperiment } from "@reliability-lab/contracts";
