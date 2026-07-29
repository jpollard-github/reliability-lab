import type { ExecutionEnvelope, ProviderError } from "@reliability-lab/contracts";
import type { ExecutionContinuationGuard } from "../durable/continuation-guard.js";
import { unrestrictedContinuationGuard } from "../durable/continuation-guard.js";
import type { Clock } from "../infrastructure/clock.js";
import type { ExecutionEventRecorder } from "./execution-events.js";
import type { ExecutionRepository } from "./ports.js";

/**
 * Projects budget exhaustion and terminal normalized failures into execution evidence.
 * It does not decide whether an attempt should retry or fall back.
 */
export class ExecutionFailureRecorder {
  readonly #repository: ExecutionRepository;
  readonly #clock: Clock;
  readonly #events: ExecutionEventRecorder;

  constructor(options: {
    repository: ExecutionRepository;
    clock: Clock;
    events: ExecutionEventRecorder;
  }) {
    this.#repository = options.repository;
    this.#clock = options.clock;
    this.#events = options.events;
  }

  async budgetFailure(
    execution: ExecutionEnvelope,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    await guard.assertActive();
    const observed = Math.max(
      0,
      this.#clock.now().getTime() - new Date(execution.createdAt).getTime(),
    );
    await this.#events.append(execution, {
      type: "budget.exceeded",
      budget: "latency",
      limit: execution.budget.maxLatencyMs,
      observed,
    });
    return this.fail(
      execution,
      {
        category: "budget_exceeded",
        code: "latency_budget_exceeded",
        message: "Execution latency budget was exceeded",
        retryable: false,
      },
      guard,
    );
  }

  async fail(
    execution: ExecutionEnvelope,
    error: ProviderError,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    await guard.assertActive();
    execution.status = "failed";
    execution.error = error;
    execution.updatedAt = this.#clock.now().toISOString();
    execution.durationMs = this.#clock.now().getTime() - new Date(execution.createdAt).getTime();
    await this.#events.append(execution, { type: "execution.failed", error });
    await this.#repository.update(execution);
    return execution;
  }
}
