import type {
  CreateExecutionBody,
  ExecutionEnvelope,
  ExecutionId,
  ProviderError,
  ReplayCapability,
  TenantId,
} from "@reliability-lab/contracts";
import type { LlmProvider } from "@reliability-lab/providers";
import {
  isExecutionContinuationStoppedError,
  unrestrictedContinuationGuard,
  type ExecutionContinuationGuard,
} from "../durable/continuation-guard.js";
import { abortableSleep, type Clock, type RandomSource } from "../infrastructure/clock.js";
import type { ProviderRegistry } from "../infrastructure/provider-registry.js";
import type { CircuitBreaker } from "../infrastructure/resilience.js";
import type { ExecutionTracer } from "../infrastructure/tracing.js";
import {
  unavailableCapability,
  type ReplayCapsule,
  type ReplayCapsuleStore,
} from "../replay/replay-store.js";
import { ExecutionNotFoundError } from "./errors.js";
import { ExecutionFailureRecorder } from "./execution-failure.js";
import type { ExecutionEventRecorder } from "./execution-events.js";
import { calculateRetryDelay } from "./retry-backoff.js";
import { StructuredOutputValidator } from "./structured-output-validator.js";
import {
  hasAmbiguousProviderAttempt,
  isTerminalStatus,
  latestUnresolvedAttempt,
} from "./execution-state.js";
import type { ExecutionRepository } from "./ports.js";

/**
 * Runs provider attempts and policy transitions for one accepted execution.
 * It does not create executions, accept durable jobs, orchestrate comparisons, or manage replay reads.
 * Every provider result is checked against the continuation guard before persistence.
 */
export class ExecutionRunner {
  readonly #repository: ExecutionRepository;
  readonly #replayCapsules: ReplayCapsuleStore;
  readonly #providers: ProviderRegistry;
  readonly #clock: Clock;
  readonly #random: RandomSource;
  readonly #circuitBreaker: CircuitBreaker;
  readonly #tracer: ExecutionTracer;
  readonly #allowLivePromptRetention: boolean;
  readonly #replayRetentionMs: number;
  readonly #events: ExecutionEventRecorder;
  readonly #validator = new StructuredOutputValidator();
  readonly #failures: ExecutionFailureRecorder;

  constructor(options: {
    repository: ExecutionRepository;
    replayCapsules: ReplayCapsuleStore;
    providers: ProviderRegistry;
    clock: Clock;
    random: RandomSource;
    circuitBreaker: CircuitBreaker;
    tracer: ExecutionTracer;
    allowLivePromptRetention: boolean;
    replayRetentionMs: number;
    events: ExecutionEventRecorder;
  }) {
    this.#repository = options.repository;
    this.#replayCapsules = options.replayCapsules;
    this.#providers = options.providers;
    this.#clock = options.clock;
    this.#random = options.random;
    this.#circuitBreaker = options.circuitBreaker;
    this.#tracer = options.tracer;
    this.#allowLivePromptRetention = options.allowLivePromptRetention;
    this.#replayRetentionMs = options.replayRetentionMs;
    this.#events = options.events;
    this.#failures = new ExecutionFailureRecorder({
      repository: this.#repository,
      clock: this.#clock,
      events: this.#events,
    });
  }

  async continueNewExecution(
    execution: ExecutionEnvelope,
    body: CreateExecutionBody,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    return this.#continueSafely(execution, body, guard);
  }

  async continueAcceptedExecution(
    tenantId: TenantId,
    executionId: ExecutionId,
    body: CreateExecutionBody,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<{
    kind: "completed" | "already_terminal" | "ambiguous";
    execution: ExecutionEnvelope;
  }> {
    await guard.assertActive();
    const execution = await this.#repository.findById(tenantId, executionId);
    if (!execution) throw new ExecutionNotFoundError();
    if (isTerminalStatus(execution.status)) {
      return { kind: "already_terminal", execution };
    }
    if (hasAmbiguousProviderAttempt(execution)) {
      const ambiguous = await this.#markAmbiguousRecovery(execution, guard);
      return { kind: "ambiguous", execution: ambiguous };
    }
    await guard.assertActive();
    execution.status = "running";
    execution.updatedAt = this.#clock.now().toISOString();
    await this.#append(execution, { type: "worker.claimed" });
    await this.#repository.update(execution);
    const completed = await this.#continueSafely(execution, body, guard);
    await this.#appendDurableReplayCompletion(completed, guard);
    return { kind: "completed", execution: completed };
  }

  async #appendDurableReplayCompletion(
    execution: ExecutionEnvelope,
    guard: ExecutionContinuationGuard,
  ): Promise<void> {
    if (
      !execution.replayOfExecutionId ||
      !isTerminalStatus(execution.status) ||
      execution.events.some((event) => event.type === "replay.completed")
    ) {
      return;
    }
    const original = await this.#repository.findById(
      execution.tenantId,
      execution.replayOfExecutionId,
    );
    if (!original) return;
    const outcomeMatches =
      original.status === execution.status &&
      original.outputText === execution.outputText &&
      original.error?.category === execution.error?.category;
    await guard.assertActive();
    await this.#append(execution, {
      type: "replay.completed",
      originalExecutionId: original.executionId,
      replayExecutionId: execution.executionId,
      outcomeMatches,
    });
    await this.#repository.update(execution);
  }

  async failAcceptedExecution(
    tenantId: TenantId,
    executionId: ExecutionId,
    code: string,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    await guard.assertActive();
    const execution = await this.#repository.findById(tenantId, executionId);
    if (!execution) throw new ExecutionNotFoundError();
    if (isTerminalStatus(execution.status)) return execution;
    return this.#failures.fail(
      execution,
      {
        category: "unknown",
        code,
        message: "Durable execution could not be safely continued",
        retryable: false,
      },
      guard,
    );
  }

  async #markAmbiguousRecovery(
    execution: ExecutionEnvelope,
    guard: ExecutionContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    const attempt = latestUnresolvedAttempt(execution);
    await guard.assertActive();
    await this.#append(execution, {
      type: "execution.recovery_detected",
      reason: "expired_lease_with_provider_activity",
    });
    if (attempt) {
      await this.#append(execution, {
        type: "attempt.outcome_ambiguous",
        attemptNumber: attempt.attemptNumber,
        provider: attempt.provider,
        model: attempt.model,
      });
    }
    return this.#failures.fail(
      execution,
      {
        category: "provider_unavailable",
        code: "provider_call_outcome_unknown",
        message:
          "The provider may have received the request; automatic duplication was avoided because no durable outcome was recorded",
        retryable: false,
      },
      guard,
    );
  }

  async #continueSafely(
    execution: ExecutionEnvelope,
    body: CreateExecutionBody,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    try {
      return await this.#continueExecution(execution, body, guard);
    } catch (error) {
      if (isExecutionContinuationStoppedError(error)) throw error;
      if (execution.status === "succeeded" || execution.status === "degraded") return execution;
      await guard.assertActive();
      const internalError: ProviderError = {
        category: "unknown",
        code: "execution_internal_failure",
        message: "Execution could not be completed",
        retryable: false,
      };
      const runningAttempt = execution.attempts.find((attempt) => attempt.status === "running");
      if (runningAttempt) {
        const completedAt = this.#clock.now();
        runningAttempt.status = "failed";
        runningAttempt.completedAt = completedAt.toISOString();
        runningAttempt.durationMs = Math.max(
          0,
          completedAt.getTime() - new Date(runningAttempt.startedAt).getTime(),
        );
        runningAttempt.error = internalError;
        await this.#append(execution, {
          type: "attempt.failed",
          attemptNumber: runningAttempt.attemptNumber,
          provider: runningAttempt.provider,
          model: runningAttempt.model,
          latencyMs: runningAttempt.durationMs,
          error: internalError,
        });
      }
      return this.#failures.fail(execution, internalError, guard);
    }
  }

  async #continueExecution(
    execution: ExecutionEnvelope,
    body: CreateExecutionBody,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    await guard.assertActive();
    const primary = this.#providers.resolve(body.provider);
    if (!primary) {
      return this.#failures.fail(
        execution,
        {
          category: "invalid_request",
          code: "provider_not_configured",
          message: `Provider '${body.provider}' is not configured`,
          retryable: false,
        },
        guard,
      );
    }

    const capsule: ReplayCapsule = {
      providerRequest: {
        tenantId: execution.tenantId,
        provider: body.provider,
        model: body.model,
        ...(body.messages ? { messages: body.messages } : {}),
        ...(body.input ? { input: body.input } : {}),
        ...(body.structuredOutputSchema
          ? { structuredOutputSchema: body.structuredOutputSchema }
          : {}),
        ...(body.failureMode ? { failureMode: body.failureMode } : {}),
      },
    };
    if (primary.kind === "fake" || this.#allowLivePromptRetention) {
      const expiresAt = new Date(
        this.#clock.now().getTime() + this.#replayRetentionMs,
      ).toISOString();
      try {
        const capability = await this.#replayCapsules.put({
          tenantId: execution.tenantId,
          executionId: execution.executionId,
          capsule,
          payloadSchemaVersion: 1,
          expiresAt,
        });
        this.#setCapability(execution, capability);
      } catch {
        this.#setCapability(
          execution,
          unavailableCapability("missing", "Replay capsule persistence failed"),
        );
        if (primary.kind === "live") {
          return this.#failures.fail(
            execution,
            {
              category: "provider_unavailable",
              code: "replay_retention_failed",
              message: "Required replay retention could not be established",
              retryable: true,
            },
            guard,
          );
        }
      }
    } else {
      this.#setCapability(
        execution,
        unavailableCapability("retention_disabled", "Live-provider request retention is disabled"),
      );
    }
    await guard.assertActive();
    await this.#repository.update(execution);

    return this.#tracer.withSpan(
      "policy.evaluate",
      {
        "execution.id": execution.executionId,
        "execution.trace_id": execution.traceId,
        "provider.id": primary.id,
      },
      async () => this.#runPolicy(execution, body, primary, false, guard),
    );
  }
  async #runPolicy(
    execution: ExecutionEnvelope,
    body: CreateExecutionBody,
    primary: LlmProvider,
    fallbackUsed: boolean,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    await guard.assertActive();
    const startedAtMs = this.#clock.now().getTime();
    let provider = primary;
    let model = body.model;
    let lastError: ProviderError | undefined;
    let attemptNumber = execution.attempts.length;
    let attemptsForProvider = 0;
    const maxAttempts = fallbackUsed ? 1 : execution.policy.maxAttempts;

    while (attemptsForProvider < maxAttempts) {
      await guard.assertActive();
      attemptNumber += 1;
      attemptsForProvider += 1;
      if (!this.#circuitBreaker.allow(provider.id)) {
        await guard.assertActive();
        await this.#append(execution, { type: "circuit.rejected", provider: provider.id });
        lastError = {
          category: "provider_unavailable",
          code: "circuit_open",
          message: "Provider circuit is open",
          retryable: true,
        };
        break;
      }

      const elapsed = this.#clock.now().getTime() - startedAtMs;
      const remainingBudget = execution.budget.maxLatencyMs - elapsed;
      if (remainingBudget <= 0) {
        return this.#failures.budgetFailure(execution, guard);
      }

      await guard.assertActive();
      const attemptStarted = this.#clock.now();
      execution.attempts.push({
        attemptNumber,
        provider: provider.id,
        model,
        status: "running",
        startedAt: attemptStarted.toISOString(),
      });
      await this.#append(execution, {
        type: "attempt.started",
        attemptNumber,
        provider: provider.id,
        model,
      });
      await this.#repository.update(execution);
      await guard.assertActive();
      const latencyController = new AbortController();
      const timeout = setTimeout(() => latencyController.abort(), remainingBudget);
      const providerSignal = AbortSignal.any([latencyController.signal, guard.signal]);
      const result = await this.#tracer
        .withSpan(
          "provider.attempt",
          {
            "execution.id": execution.executionId,
            "execution.trace_id": execution.traceId,
            "attempt.number": attemptNumber,
            "provider.id": provider.id,
          },
          async () =>
            provider.execute(
              {
                executionId: execution.executionId,
                tenantId: execution.tenantId,
                provider: provider.id,
                model,
                ...(body.messages ? { messages: body.messages } : {}),
                ...(body.input ? { input: body.input } : {}),
                ...(body.structuredOutputSchema
                  ? { structuredOutputSchema: body.structuredOutputSchema }
                  : {}),
                ...(fallbackUsed ? {} : body.failureMode ? { failureMode: body.failureMode } : {}),
                attempt: attemptNumber,
              },
              { signal: providerSignal, timeoutMs: remainingBudget },
            ),
        )
        .finally(() => clearTimeout(timeout));
      await guard.assertActive();
      const attempt = execution.attempts.at(-1);
      if (!attempt) throw new Error("Attempt invariant violated");

      if (result.ok) {
        attempt.status = "succeeded";
        attempt.completedAt = this.#clock.now().toISOString();
        attempt.durationMs = result.response.latencyMs;
        attempt.usage = result.response.usage;
        await this.#append(execution, {
          type: "provider.response_received",
          attemptNumber,
          provider: provider.id,
          model,
          latencyMs: result.response.latencyMs,
        });
        this.#circuitBreaker.recordSuccess(provider.id);

        if (body.structuredOutputSchema) {
          await guard.assertActive();
          const validation = await this.#tracer.withSpan(
            "structured_output.validate",
            {
              "execution.id": execution.executionId,
              "execution.trace_id": execution.traceId,
            },
            async () =>
              this.#validator.validate(body.structuredOutputSchema!, result.response.outputJson),
          );
          attempt.validation = validation;
          if (!validation.valid) {
            await guard.assertActive();
            attempt.status = "rejected";
            await this.#append(execution, {
              type: "structured_output.rejected",
              attemptNumber,
              errors: validation.errors ?? ["Structured output is invalid"],
            });
            return this.#failures.fail(
              execution,
              {
                category: "malformed_response",
                code: "structured_output_invalid",
                message: "Structured output failed JSON Schema validation",
                retryable: false,
              },
              guard,
            );
          }
          await guard.assertActive();
          await this.#append(execution, {
            type: "structured_output.validated",
            attemptNumber,
          });
        }

        execution.status = fallbackUsed ? "degraded" : "succeeded";
        execution.outputText = result.response.outputText;
        if (result.response.outputJson !== undefined)
          execution.outputJson = result.response.outputJson;
        execution.durationMs = this.#clock.now().getTime() - startedAtMs;
        execution.updatedAt = this.#clock.now().toISOString();
        await guard.assertActive();
        await this.#append(execution, {
          type: "execution.succeeded",
          status: execution.status,
        });
        await this.#repository.update(execution);
        return execution;
      }

      attempt.status = result.error.category === "timeout" ? "timed_out" : "failed";
      attempt.completedAt = this.#clock.now().toISOString();
      attempt.durationMs = result.latencyMs;
      attempt.error = result.error;
      lastError = result.error;
      this.#circuitBreaker.recordFailure(provider.id);
      await this.#append(execution, {
        type: "attempt.failed",
        attemptNumber,
        provider: provider.id,
        model,
        latencyMs: result.latencyMs,
        error: result.error,
      });
      await this.#repository.update(execution);

      if (result.error.retryable && attemptsForProvider < maxAttempts) {
        await guard.assertActive();
        const delayMs = calculateRetryDelay(execution.policy, attemptsForProvider, this.#random);
        if (this.#clock.now().getTime() - startedAtMs + delayMs >= execution.budget.maxLatencyMs) {
          return this.#failures.budgetFailure(execution, guard);
        }
        await this.#append(execution, {
          type: "retry.scheduled",
          attemptNumber,
          delayMs,
          reason: result.error.category,
        });
        await abortableSleep(this.#clock, delayMs, guard.signal);
        await guard.assertActive();
        continue;
      }
      break;
    }

    if (execution.policy.fallbackProvider && !fallbackUsed) {
      await guard.assertActive();
      const fallback = this.#providers.resolve(execution.policy.fallbackProvider);
      if (fallback) {
        provider = fallback;
        model = execution.policy.fallbackModel ?? body.model;
        execution.provider = provider.id;
        execution.model = model;
        await this.#append(execution, {
          type: "fallback.selected",
          provider: provider.id,
          model,
          reason: lastError?.category ?? "primary_failed",
        });
        const { failureMode: _failureMode, ...fallbackBody } = body;
        return this.#runPolicy(execution, fallbackBody, provider, true, guard);
      }
    }

    return this.#failures.fail(
      execution,
      lastError ?? {
        category: "unknown",
        code: "execution_failed",
        message: "Execution failed without a normalized provider error",
        retryable: false,
      },
      guard,
    );
  }

  async #append(
    execution: ExecutionEnvelope,
    payload: Parameters<ExecutionEventRecorder["append"]>[1],
  ): Promise<void> {
    await this.#events.append(execution, payload);
  }

  #setCapability(execution: ExecutionEnvelope, capability: ReplayCapability): void {
    execution.replayCapability = capability;
    execution.replayable = capability.available;
    if (capability.available) {
      delete execution.replayUnavailableReason;
    } else {
      execution.replayUnavailableReason = capability.reason;
    }
  }
}
