import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Ajv, type ErrorObject } from "ajv/dist/ajv.js";
import type {
  ComparisonExperiment,
  ComparisonView,
  CreateExecutionBody,
  ExecutionEnvelope,
  ExecutionEvent,
  ExecutionId,
  ExecutionPolicy,
  ProviderError,
  ProviderRequest,
  ReplayCapability,
  ReplayResult,
  ReplayVariation,
  TenantId,
} from "@reliability-lab/contracts";
import type { LlmProvider } from "@reliability-lab/providers";
import {
  inferSafeOriginalConfiguration,
  projectComparison,
  resolveReplayVariation,
} from "./comparison.js";

export * from "./comparison.js";
export * from "./investigation.js";
export * from "./investigation-cases.js";

export interface Clock {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
}

export interface RandomSource {
  next(): number;
}

export interface IdSource {
  executionId(): ExecutionId;
  experimentId(): string;
  eventId(): string;
  traceId(): string;
}

export interface CircuitBreaker {
  allow(provider: string): boolean;
  recordSuccess(provider: string): void;
  recordFailure(provider: string): void;
}

export interface RateLimiter {
  consume(tenantId: TenantId): Promise<boolean>;
}

export interface ExecutionRepository {
  create(execution: ExecutionEnvelope): Promise<void>;
  update(execution: ExecutionEnvelope): Promise<void>;
  appendEvent(event: ExecutionEvent): Promise<void>;
  eventsAfter(
    tenantId: TenantId,
    executionId: ExecutionId,
    afterSequence: number,
  ): Promise<ExecutionEvent[] | null>;
  findById(tenantId: TenantId, executionId: ExecutionId): Promise<ExecutionEnvelope | null>;
  list(tenantId?: TenantId): Promise<ExecutionEnvelope[]>;
  findIdempotent(tenantId: TenantId, keyHash: string): Promise<ExecutionEnvelope | null>;
  recordIdempotency(
    tenantId: TenantId,
    keyHash: string,
    requestHash: string,
    executionId: ExecutionId,
  ): Promise<void>;
}

export interface ComparisonExperimentRepository {
  create(experiment: ComparisonExperiment): Promise<void>;
  update(experiment: ComparisonExperiment): Promise<void>;
  findById(tenantId: TenantId, experimentId: string): Promise<ComparisonExperiment | null>;
}

export interface ReplayCapsule {
  providerRequest: Omit<ProviderRequest, "executionId" | "attempt">;
}

export interface StoreReplayCapsule {
  tenantId: TenantId;
  executionId: ExecutionId;
  capsule: ReplayCapsule;
  payloadSchemaVersion: 1;
  expiresAt: string;
}

export type ReplayCapsuleReadResult =
  | { available: true; capability: ReplayCapability; capsule: ReplayCapsule }
  | { available: false; capability: ReplayCapability };

export interface ReplayCapsuleDeleteResult {
  deleted: boolean;
  capability: ReplayCapability;
}

export interface ReplayCapsuleStore {
  put(input: StoreReplayCapsule): Promise<ReplayCapability>;
  inspect(tenantId: TenantId, executionId: ExecutionId): Promise<ReplayCapability>;
  getForReplay(tenantId: TenantId, executionId: ExecutionId): Promise<ReplayCapsuleReadResult>;
  delete(tenantId: TenantId, executionId: ExecutionId): Promise<ReplayCapsuleDeleteResult>;
}

export interface ProviderRegistry {
  resolve(provider: string): LlmProvider | null;
}

export interface ExecutionTracer {
  withSpan<T>(
    name: string,
    attributes: Record<string, string | number>,
    run: () => Promise<T>,
  ): Promise<T>;
}

export interface ExecuteCommand {
  tenantId: TenantId;
  idempotencyKey?: string;
  body: CreateExecutionBody;
  replayOfExecutionId?: ExecutionId;
}

export interface ExecutionSubmission {
  execution: ExecutionEnvelope;
  completion?: Promise<ExecutionEnvelope>;
}

export interface ComparisonSubmission {
  experiment: ComparisonExperiment;
  variantExecution?: ExecutionEnvelope;
  completion?: Promise<ExecutionEnvelope>;
}

export interface DurableAcceptanceInput {
  execution: ExecutionEnvelope;
  command: CreateExecutionBody;
  requestHash: string;
  idempotencyKeyHash?: string;
}

export interface DurableComparisonAcceptanceInput extends DurableAcceptanceInput {
  experiment: ComparisonExperiment;
}

export interface DurableAcceptancePort {
  acceptExecution(input: DurableAcceptanceInput): Promise<ExecutionId>;
  acceptComparison(input: DurableComparisonAcceptanceInput): Promise<ExecutionId>;
}

export interface JobClaim {
  tenantId: TenantId;
  executionId: ExecutionId;
  workerId: string;
  claimVersion: number;
  leaseExpiresAt: string;
}

export interface ClaimedExecutionJob extends JobClaim {
  command?: CreateExecutionBody;
  reclaimed: boolean;
  safeErrorCode?: string;
}

export type LeaseOwnershipOutcome =
  { kind: "owned"; leaseExpiresAt: string } | { kind: "ownership_lost" };

export type FinishJobOutcome = { kind: "finished" } | { kind: "ownership_lost" };

export interface DurableJobStore {
  claimNext(input: {
    workerId: string;
    leaseDurationMs: number;
  }): Promise<ClaimedExecutionJob | null>;
  heartbeat(input: { claim: JobClaim; leaseDurationMs: number }): Promise<LeaseOwnershipOutcome>;
  assertOwned(claim: JobClaim): Promise<LeaseOwnershipOutcome>;
  finish(input: {
    claim: JobClaim;
    status: "completed" | "failed" | "ambiguous";
    safeErrorCode?: string;
  }): Promise<FinishJobOutcome>;
}

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

export interface ExecutionServiceOptions {
  repository: ExecutionRepository;
  comparisons?: ComparisonExperimentRepository;
  replayCapsules: ReplayCapsuleStore;
  providers: ProviderRegistry;
  clock?: Clock;
  random?: RandomSource;
  ids?: IdSource;
  circuitBreaker?: CircuitBreaker;
  rateLimiter?: RateLimiter;
  tracer?: ExecutionTracer;
  allowLivePromptRetention?: boolean;
  replayRetentionMs?: number;
  durableAcceptance?: DurableAcceptancePort;
}

const DEFAULT_POLICY: ExecutionPolicy = {
  maxAttempts: 2,
  baseBackoffMs: 50,
  maxBackoffMs: 1_000,
  jitterRatio: 0.2,
};
const DEFAULT_BUDGET = { maxLatencyMs: 10_000 };

const systemClock: Clock = {
  now: () => new Date(),
  sleep: async (milliseconds) => {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  },
};

const unrestrictedContinuationController = new AbortController();
const unrestrictedContinuationGuard: ExecutionContinuationGuard = {
  signal: unrestrictedContinuationController.signal,
  assertActive: async () => undefined,
};

export async function abortableSleep(
  clock: Clock,
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw abortReason(signal);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([clock.sleep(milliseconds), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

const systemIds: IdSource = {
  executionId: randomUUID,
  experimentId: randomUUID,
  eventId: randomUUID,
  traceId: () => randomBytes(16).toString("hex"),
};

const noOpTracer: ExecutionTracer = {
  withSpan: async (_name, _attributes, run) => run(),
};

export class ExecutionService {
  readonly #repository: ExecutionRepository;
  readonly #comparisons: ComparisonExperimentRepository;
  readonly #replayCapsules: ReplayCapsuleStore;
  readonly #providers: ProviderRegistry;
  readonly #clock: Clock;
  readonly #random: RandomSource;
  readonly #ids: IdSource;
  readonly #circuitBreaker: CircuitBreaker;
  readonly #rateLimiter: RateLimiter;
  readonly #tracer: ExecutionTracer;
  readonly #allowLivePromptRetention: boolean;
  readonly #replayRetentionMs: number;
  readonly #durableAcceptance: DurableAcceptancePort | undefined;
  readonly #active = new Map<
    ExecutionId,
    { execution: ExecutionEnvelope; completion: Promise<ExecutionEnvelope> }
  >();
  readonly #ajv = new Ajv({ allErrors: true, strict: false });

  constructor(options: ExecutionServiceOptions) {
    this.#repository = options.repository;
    this.#comparisons = options.comparisons ?? new MemoryComparisonExperimentRepository();
    this.#replayCapsules = options.replayCapsules;
    this.#providers = options.providers;
    this.#clock = options.clock ?? systemClock;
    this.#random = options.random ?? { next: Math.random };
    this.#ids = options.ids ?? systemIds;
    this.#circuitBreaker = options.circuitBreaker ?? new InMemoryCircuitBreaker();
    this.#rateLimiter = options.rateLimiter ?? new InMemoryRateLimiter();
    this.#tracer = options.tracer ?? noOpTracer;
    this.#allowLivePromptRetention = options.allowLivePromptRetention ?? false;
    this.#replayRetentionMs = options.replayRetentionMs ?? 24 * 60 * 60 * 1_000;
    this.#durableAcceptance = options.durableAcceptance;
  }

  async execute(command: ExecuteCommand): Promise<ExecutionEnvelope> {
    const submission = await this.submit(command);
    if (!submission.completion) {
      throw new Error("execute() is unavailable when durable worker mode is enabled");
    }
    return submission.completion;
  }

  async submit(command: ExecuteCommand): Promise<ExecutionSubmission> {
    const requestHash = hashCanonical(command.body);
    const idempotencyKeyHash = command.idempotencyKey
      ? hashCanonical(command.idempotencyKey)
      : undefined;
    if (idempotencyKeyHash && !this.#durableAcceptance) {
      const existing = await this.#repository.findIdempotent(command.tenantId, idempotencyKeyHash);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }
        const active = this.#active.get(existing.executionId);
        const target = active?.execution ?? existing;
        await this.#append(target, {
          type: "idempotency.hit",
          idempotencyKeyHash,
        });
        await this.#repository.update(target);
        return {
          execution: structuredClone(target),
          completion: active?.completion ?? Promise.resolve(structuredClone(target)),
        };
      }
    }

    if (!(await this.#rateLimiter.consume(command.tenantId))) {
      throw new RateLimitRejectedError();
    }

    const execution = this.#prepareExecution(
      command,
      requestHash,
      Boolean(this.#durableAcceptance),
    );
    if (this.#durableAcceptance) {
      const acceptedExecutionId = await this.#durableAcceptance.acceptExecution({
        execution,
        command: structuredClone(command.body),
        requestHash,
        ...(idempotencyKeyHash ? { idempotencyKeyHash } : {}),
      });
      const accepted =
        acceptedExecutionId === execution.executionId
          ? execution
          : await this.#repository.findById(command.tenantId, acceptedExecutionId);
      if (!accepted) throw new Error("Durable acceptance returned an unavailable execution");
      return { execution: structuredClone(accepted) };
    }

    await this.#tracer.withSpan(
      "persistence.create",
      { "execution.id": execution.executionId, "execution.trace_id": execution.traceId },
      async () => {
        await this.#repository.create(execution);
      },
    );
    if (idempotencyKeyHash) {
      await this.#repository.recordIdempotency(
        command.tenantId,
        idempotencyKeyHash,
        requestHash,
        execution.executionId,
      );
    }

    const rawCompletion = this.#continueSafely(execution, command.body);
    const completion: Promise<ExecutionEnvelope> = rawCompletion.then(
      (result) => {
        if (this.#active.get(execution.executionId)?.completion === completion) {
          this.#active.delete(execution.executionId);
        }
        return result;
      },
      (error: unknown) => {
        if (this.#active.get(execution.executionId)?.completion === completion) {
          this.#active.delete(execution.executionId);
        }
        throw error;
      },
    );
    this.#active.set(execution.executionId, { execution, completion });
    return { execution: structuredClone(execution), completion };
  }

  #prepareExecution(
    command: ExecuteCommand,
    requestHash: string,
    durable: boolean,
  ): ExecutionEnvelope {
    const createdAt = this.#clock.now().toISOString();
    const execution: ExecutionEnvelope = {
      schemaVersion: 1,
      executionId: this.#ids.executionId(),
      tenantId: command.tenantId,
      status: durable ? "queued" : "running",
      provider: command.body.provider,
      model: command.body.model,
      traceId: this.#ids.traceId(),
      requestHash,
      policy: { ...DEFAULT_POLICY, ...command.body.policy },
      budget: { ...DEFAULT_BUDGET, ...command.body.budget },
      attempts: [],
      events: [],
      createdAt,
      updatedAt: createdAt,
      replayCapability: unavailableCapability("missing", "Replay capsule has not been retained"),
      replayable: false,
      ...(command.replayOfExecutionId ? { replayOfExecutionId: command.replayOfExecutionId } : {}),
    };
    this.#addEvent(execution, {
      type: "execution.accepted",
      tenantId: command.tenantId,
      requestHash,
    });
    if (command.replayOfExecutionId) {
      this.#addEvent(execution, {
        type: "replay.started",
        originalExecutionId: command.replayOfExecutionId,
      });
    }
    if (durable) this.#addEvent(execution, { type: "execution.queued" });
    return execution;
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
    return this.#fail(
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
    return this.#fail(
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
      return this.#fail(execution, internalError, guard);
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
      return this.#fail(
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
          return this.#fail(
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

  async replay(tenantId: TenantId, originalExecutionId: ExecutionId): Promise<ReplayResult> {
    const original = await this.#repository.findById(tenantId, originalExecutionId);
    if (!original) throw new ExecutionNotFoundError();
    if (original.replayCapability.state === "retention_disabled") {
      return {
        replayable: false,
        originalExecutionId,
        reason: original.replayCapability.reason,
        capability: original.replayCapability,
      };
    }
    const capsuleResult = await this.#replayCapsules.getForReplay(tenantId, originalExecutionId);
    if (!capsuleResult.available) {
      this.#setCapability(original, capsuleResult.capability);
      return {
        replayable: false,
        originalExecutionId,
        reason: capsuleResult.capability.reason,
        capability: capsuleResult.capability,
      };
    }
    const request = capsuleResult.capsule.providerRequest;
    const replaySubmission = await this.submit({
      tenantId,
      replayOfExecutionId: originalExecutionId,
      body: {
        provider: request.provider,
        model: request.model,
        ...(request.messages ? { messages: request.messages } : {}),
        ...(request.input ? { input: request.input } : {}),
        ...(request.structuredOutputSchema
          ? { structuredOutputSchema: request.structuredOutputSchema }
          : {}),
        ...(request.failureMode ? { failureMode: request.failureMode } : {}),
        policy: original.policy,
        budget: original.budget,
      },
    });
    if (!replaySubmission.completion) {
      return {
        replayable: true,
        originalExecutionId,
        replayExecution: replaySubmission.execution,
        outcomeMatches: null,
      };
    }
    const replayExecution = await replaySubmission.completion;
    const outcomeMatches =
      original.status === replayExecution.status &&
      original.outputText === replayExecution.outputText &&
      original.error?.category === replayExecution.error?.category;
    await this.#append(replayExecution, {
      type: "replay.completed",
      originalExecutionId,
      replayExecutionId: replayExecution.executionId,
      outcomeMatches,
    });
    await this.#repository.update(replayExecution);
    return { replayable: true, originalExecutionId, replayExecution, outcomeMatches };
  }

  async createComparison(
    tenantId: TenantId,
    originalExecutionId: ExecutionId,
    variation: ReplayVariation,
  ): Promise<ComparisonSubmission> {
    const original = await this.#repository.findById(tenantId, originalExecutionId);
    if (!original) throw new ExecutionNotFoundError();
    const createdAt = this.#clock.now().toISOString();
    const capsuleResult: ReplayCapsuleReadResult =
      original.replayCapability.state === "retention_disabled"
        ? { available: false, capability: original.replayCapability }
        : await this.#replayCapsules.getForReplay(tenantId, originalExecutionId);
    const safeOriginal = inferSafeOriginalConfiguration(original);
    const resolvedVariant = resolveReplayVariation({
      original,
      variation,
      structuredOutputRequired: capsuleResult.available
        ? capsuleResult.capsule.providerRequest.structuredOutputSchema !== undefined
        : safeOriginal.structuredOutputRequired,
      ...(capsuleResult.available && capsuleResult.capsule.providerRequest.failureMode
        ? { failureMode: capsuleResult.capsule.providerRequest.failureMode }
        : {}),
      providerAvailable: (provider) => this.#providers.resolve(provider) !== null,
    });
    const experiment: ComparisonExperiment = {
      schemaVersion: 1,
      experimentId: this.#ids.experimentId(),
      tenantId,
      originalExecutionId,
      status: capsuleResult.available ? "running" : "unavailable",
      requestedVariation: structuredClone(variation),
      resolvedVariant,
      createdAt,
      updatedAt: createdAt,
      ...(!capsuleResult.available ? { unavailableReason: capsuleResult.capability.reason } : {}),
    };

    if (!capsuleResult.available) {
      this.#setCapability(original, capsuleResult.capability);
      await this.#repository.update(original);
      await this.#comparisons.create(experiment);
      return { experiment: structuredClone(experiment) };
    }

    const request = capsuleResult.capsule.providerRequest;
    const variantBody: CreateExecutionBody = {
      provider: resolvedVariant.provider,
      model: resolvedVariant.model,
      ...(request.messages ? { messages: request.messages } : {}),
      ...(request.input ? { input: request.input } : {}),
      ...(request.structuredOutputSchema
        ? { structuredOutputSchema: request.structuredOutputSchema }
        : {}),
      ...(request.failureMode ? { failureMode: request.failureMode } : {}),
      policy: resolvedVariant.policy,
      budget: resolvedVariant.budget,
    };
    if (this.#durableAcceptance) {
      if (!(await this.#rateLimiter.consume(tenantId))) throw new RateLimitRejectedError();
      const requestHash = hashCanonical(variantBody);
      const variantExecution = this.#prepareExecution(
        { tenantId, replayOfExecutionId: originalExecutionId, body: variantBody },
        requestHash,
        true,
      );
      experiment.variantExecutionId = variantExecution.executionId;
      await this.#durableAcceptance.acceptComparison({
        execution: variantExecution,
        command: structuredClone(variantBody),
        requestHash,
        experiment,
      });
      return {
        experiment: structuredClone(experiment),
        variantExecution: structuredClone(variantExecution),
      };
    }
    const submission = await this.submit({
      tenantId,
      replayOfExecutionId: originalExecutionId,
      body: variantBody,
    });
    experiment.variantExecutionId = submission.execution.executionId;
    await this.#comparisons.create(experiment);
    const completion = submission.completion!.then(async (execution) => {
      experiment.status = "completed";
      experiment.updatedAt = this.#clock.now().toISOString();
      await this.#comparisons.update(experiment);
      return execution;
    });
    return {
      experiment: structuredClone(experiment),
      variantExecution: submission.execution,
      completion,
    };
  }

  async getComparison(tenantId: TenantId, experimentId: string): Promise<ComparisonView> {
    const experiment = await this.#comparisons.findById(tenantId, experimentId);
    if (!experiment) throw new ComparisonNotFoundError();
    const original = await this.#repository.findById(tenantId, experiment.originalExecutionId);
    if (!original) throw new ExecutionNotFoundError();
    const variant = experiment.variantExecutionId
      ? await this.#repository.findById(tenantId, experiment.variantExecutionId)
      : null;
    if (variant && experiment.status === "running" && isTerminalStatus(variant.status)) {
      experiment.status = "completed";
      experiment.updatedAt = this.#clock.now().toISOString();
      await this.#comparisons.update(experiment);
    }
    return {
      experiment,
      originalExecution: await this.#withCurrentCapability(original),
      ...(variant ? { variantExecution: await this.#withCurrentCapability(variant) } : {}),
      projection: projectComparison(original, variant ?? undefined),
    };
  }

  async get(tenantId: TenantId, executionId: ExecutionId): Promise<ExecutionEnvelope> {
    const execution = await this.#repository.findById(tenantId, executionId);
    if (!execution) throw new ExecutionNotFoundError();
    return this.#withCurrentCapability(execution);
  }

  async list(tenantId?: TenantId): Promise<ExecutionEnvelope[]> {
    const executions = await this.#repository.list(tenantId);
    return Promise.all(executions.map((execution) => this.#withCurrentCapability(execution)));
  }

  eventsAfter(
    tenantId: TenantId,
    executionId: ExecutionId,
    afterSequence: number,
  ): Promise<ExecutionEvent[] | null> {
    return this.#repository.eventsAfter(tenantId, executionId, afterSequence);
  }

  async deleteReplayCapsule(
    tenantId: TenantId,
    executionId: ExecutionId,
  ): Promise<ReplayCapsuleDeleteResult> {
    const execution = await this.#repository.findById(tenantId, executionId);
    if (!execution) throw new ExecutionNotFoundError();
    const result = await this.#replayCapsules.delete(tenantId, executionId);
    this.#setCapability(execution, result.capability);
    await this.#repository.update(execution);
    return result;
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
        return this.#budgetFailure(execution, guard);
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
            async () => this.#validate(body.structuredOutputSchema!, result.response.outputJson),
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
            return this.#fail(
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
        const delayMs = this.#backoff(execution.policy, attemptsForProvider);
        if (this.#clock.now().getTime() - startedAtMs + delayMs >= execution.budget.maxLatencyMs) {
          return this.#budgetFailure(execution, guard);
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

    return this.#fail(
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

  #validate(schema: Record<string, unknown>, data: unknown) {
    const validate = this.#ajv.compile(schema);
    const valid = validate(data);
    return {
      valid,
      ...(valid
        ? {}
        : {
            errors: (validate.errors ?? []).map(
              (error: ErrorObject) => `${error.instancePath} ${error.message}`,
            ),
          }),
    };
  }

  #backoff(policy: ExecutionPolicy, attemptNumber: number) {
    const base = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * 2 ** (attemptNumber - 1));
    const jitter = base * policy.jitterRatio * (this.#random.next() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  async #budgetFailure(
    execution: ExecutionEnvelope,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    await guard.assertActive();
    const observed = Math.max(
      0,
      this.#clock.now().getTime() - new Date(execution.createdAt).getTime(),
    );
    await this.#append(execution, {
      type: "budget.exceeded",
      budget: "latency",
      limit: execution.budget.maxLatencyMs,
      observed,
    });
    return this.#fail(
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

  async #fail(
    execution: ExecutionEnvelope,
    error: ProviderError,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    await guard.assertActive();
    execution.status = "failed";
    execution.error = error;
    execution.updatedAt = this.#clock.now().toISOString();
    execution.durationMs = this.#clock.now().getTime() - new Date(execution.createdAt).getTime();
    await this.#append(execution, { type: "execution.failed", error });
    await this.#repository.update(execution);
    return execution;
  }

  #addEvent(execution: ExecutionEnvelope, event: EventPayload): void {
    execution.events.push({
      ...event,
      schemaVersion: 1,
      eventId: this.#ids.eventId(),
      executionId: execution.executionId,
      sequence: execution.events.length + 1,
      occurredAt: this.#clock.now().toISOString(),
    } as ExecutionEvent);
  }

  async #append(execution: ExecutionEnvelope, event: EventPayload): Promise<void> {
    this.#addEvent(execution, event);
    const appended = execution.events.at(-1);
    if (appended) await this.#repository.appendEvent(appended);
  }

  async #withCurrentCapability(execution: ExecutionEnvelope): Promise<ExecutionEnvelope> {
    if (execution.replayCapability.state === "retention_disabled") return execution;
    const capability = await this.#replayCapsules.inspect(
      execution.tenantId,
      execution.executionId,
    );
    this.#setCapability(execution, capability);
    return execution;
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

export interface LeaseHeartbeatTimers {
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const systemLeaseHeartbeatTimers: LeaseHeartbeatTimers = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (timer) => clearTimeout(timer),
};

export class LeaseHeartbeatController implements ExecutionContinuationGuard {
  readonly #jobs: DurableJobStore;
  readonly #claim: JobClaim;
  readonly #leaseDurationMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #now: () => Date;
  readonly #timers: LeaseHeartbeatTimers;
  readonly #abortController = new AbortController();
  #confirmedLeaseExpiresAtMs: number;
  #heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  #deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatInFlight: Promise<void> | undefined;
  #started = false;
  #stopped = false;

  constructor(options: {
    jobs: DurableJobStore;
    claim: JobClaim;
    leaseDurationMs: number;
    heartbeatIntervalMs: number;
    now?: () => Date;
    timers?: LeaseHeartbeatTimers;
  }) {
    this.#jobs = options.jobs;
    this.#claim = { ...options.claim };
    this.#leaseDurationMs = options.leaseDurationMs;
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs;
    this.#now = options.now ?? (() => new Date());
    this.#timers = options.timers ?? systemLeaseHeartbeatTimers;
    this.#confirmedLeaseExpiresAtMs = parseLeaseDeadline(options.claim.leaseExpiresAt);
  }

  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  get confirmedLeaseExpiresAt(): string {
    return new Date(this.#confirmedLeaseExpiresAtMs).toISOString();
  }

  start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    if (!this.#deadlineStillValid()) {
      this.#loseOwnership();
      return;
    }
    this.#scheduleDeadline();
    this.#scheduleHeartbeat(this.#heartbeatIntervalMs);
  }

  cancel(reason = new ExecutionContinuationStoppedError()): void {
    if (!this.signal.aborted) this.#abortController.abort(reason);
    this.#clearTimers();
  }

  async assertActive(): Promise<void> {
    while (true) {
      this.#throwIfInactive();
      if (!this.#deadlineStillValid()) {
        this.#loseOwnership();
        this.#throwIfInactive();
      }
      try {
        const outcome = await this.#jobs.assertOwned(this.#claim);
        if (outcome.kind === "ownership_lost") {
          this.#loseOwnership();
          throw abortReason(this.signal);
        }
        this.#confirmLease(outcome.leaseExpiresAt);
        return;
      } catch (error) {
        if (isLeaseOwnershipLostError(error)) throw error;
        this.#throwIfInactive();
        const remainingMs = this.#confirmedLeaseExpiresAtMs - this.#now().getTime();
        if (remainingMs <= 0) {
          this.#loseOwnership();
          this.#throwIfInactive();
        }
        await this.#wait(Math.min(this.#heartbeatIntervalMs, remainingMs));
      }
    }
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#clearTimers();
    await this.#heartbeatInFlight;
  }

  #scheduleHeartbeat(milliseconds: number): void {
    if (this.#stopped || this.signal.aborted || this.#heartbeatTimer) return;
    this.#heartbeatTimer = this.#timers.setTimeout(
      () => {
        this.#heartbeatTimer = undefined;
        const heartbeat = this.#renewLease();
        this.#heartbeatInFlight = heartbeat;
        void heartbeat.finally(() => {
          if (this.#heartbeatInFlight === heartbeat) this.#heartbeatInFlight = undefined;
        });
      },
      Math.max(0, milliseconds),
    );
    unrefTimer(this.#heartbeatTimer);
  }

  #scheduleDeadline(): void {
    if (this.#stopped || this.signal.aborted) return;
    if (this.#deadlineTimer) this.#timers.clearTimeout(this.#deadlineTimer);
    const remainingMs = Math.max(0, this.#confirmedLeaseExpiresAtMs - this.#now().getTime());
    this.#deadlineTimer = this.#timers.setTimeout(() => {
      this.#deadlineTimer = undefined;
      if (this.#deadlineStillValid()) {
        this.#scheduleDeadline();
      } else {
        this.#loseOwnership();
      }
    }, remainingMs);
    unrefTimer(this.#deadlineTimer);
  }

  async #renewLease(): Promise<void> {
    if (this.#stopped || this.signal.aborted) return;
    if (!this.#deadlineStillValid()) {
      this.#loseOwnership();
      return;
    }
    try {
      const outcome = await this.#jobs.heartbeat({
        claim: this.#claim,
        leaseDurationMs: this.#leaseDurationMs,
      });
      if (outcome.kind === "ownership_lost") {
        this.#loseOwnership();
        return;
      }
      this.#confirmLease(outcome.leaseExpiresAt);
    } catch {
      if (!this.#deadlineStillValid()) {
        this.#loseOwnership();
        return;
      }
    }
    this.#scheduleHeartbeat(this.#heartbeatIntervalMs);
  }

  #confirmLease(leaseExpiresAt: string): void {
    const leaseExpiresAtMs = parseLeaseDeadline(leaseExpiresAt);
    if (leaseExpiresAtMs <= this.#now().getTime()) {
      this.#loseOwnership();
      this.#throwIfInactive();
    }
    this.#confirmedLeaseExpiresAtMs = leaseExpiresAtMs;
    this.#scheduleDeadline();
  }

  #deadlineStillValid(): boolean {
    return this.#now().getTime() < this.#confirmedLeaseExpiresAtMs;
  }

  #loseOwnership(): void {
    if (!this.signal.aborted) this.#abortController.abort(new LeaseOwnershipLostError());
    this.#clearTimers();
  }

  #throwIfInactive(): void {
    if (this.signal.aborted) throw abortReason(this.signal);
  }

  async #wait(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (this.signal.aborted) {
        reject(abortReason(this.signal));
        return;
      }
      const onAbort = () => {
        this.#timers.clearTimeout(timer);
        reject(abortReason(this.signal));
      };
      const timer = this.#timers.setTimeout(
        () => {
          this.signal.removeEventListener("abort", onAbort);
          resolve();
        },
        Math.max(0, milliseconds),
      );
      unrefTimer(timer);
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  #clearTimers(): void {
    if (this.#heartbeatTimer) {
      this.#timers.clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    if (this.#deadlineTimer) {
      this.#timers.clearTimeout(this.#deadlineTimer);
      this.#deadlineTimer = undefined;
    }
  }
}

export class DurableExecutionWorker {
  readonly #jobs: DurableJobStore;
  readonly #service: ExecutionService;
  readonly #workerId: string;
  readonly #leaseDurationMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #now: (() => Date) | undefined;
  readonly #timers: LeaseHeartbeatTimers | undefined;
  readonly #activeHeartbeats = new Set<LeaseHeartbeatController>();
  readonly #idleWaiters = new Set<() => void>();
  #acceptingClaims = true;
  #activeRuns = 0;

  constructor(options: {
    jobs: DurableJobStore;
    service: ExecutionService;
    workerId: string;
    leaseDurationMs: number;
    heartbeatIntervalMs: number;
    now?: () => Date;
    timers?: LeaseHeartbeatTimers;
  }) {
    this.#jobs = options.jobs;
    this.#service = options.service;
    this.#workerId = options.workerId;
    this.#leaseDurationMs = options.leaseDurationMs;
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs;
    this.#now = options.now;
    this.#timers = options.timers;
  }

  async runOnce(): Promise<boolean> {
    if (!this.#acceptingClaims) return false;
    this.#activeRuns += 1;
    try {
      return await this.#runOnceClaim();
    } finally {
      this.#activeRuns -= 1;
      if (this.#activeRuns === 0) {
        for (const resolve of this.#idleWaiters) resolve();
        this.#idleWaiters.clear();
      }
    }
  }

  async #runOnceClaim(): Promise<boolean> {
    const job = await this.#jobs.claimNext({
      workerId: this.#workerId,
      leaseDurationMs: this.#leaseDurationMs,
    });
    if (!job) return false;
    const claim: JobClaim = {
      tenantId: job.tenantId,
      executionId: job.executionId,
      workerId: job.workerId,
      claimVersion: job.claimVersion,
      leaseExpiresAt: job.leaseExpiresAt,
    };
    const heartbeat = new LeaseHeartbeatController({
      jobs: this.#jobs,
      claim,
      leaseDurationMs: this.#leaseDurationMs,
      heartbeatIntervalMs: this.#heartbeatIntervalMs,
      ...(this.#now ? { now: this.#now } : {}),
      ...(this.#timers ? { timers: this.#timers } : {}),
    });
    this.#activeHeartbeats.add(heartbeat);
    heartbeat.start();
    try {
      if (!job.command) {
        const safeErrorCode = job.safeErrorCode ?? "execution_command_unavailable";
        await this.#service.failAcceptedExecution(
          job.tenantId,
          job.executionId,
          safeErrorCode,
          heartbeat,
        );
        await this.#jobs.finish({
          claim,
          status: "failed",
          safeErrorCode,
        });
        return true;
      }

      const result = await this.#service.continueAcceptedExecution(
        job.tenantId,
        job.executionId,
        job.command,
        heartbeat,
      );
      const ambiguous =
        result.kind === "ambiguous" ||
        result.execution.error?.code === "provider_call_outcome_unknown";
      await this.#jobs.finish({
        claim,
        status: ambiguous
          ? "ambiguous"
          : result.execution.status === "failed"
            ? "failed"
            : "completed",
        ...(result.execution.error ? { safeErrorCode: result.execution.error.code } : {}),
      });
    } catch (error) {
      if (isExecutionContinuationStoppedError(error)) return true;
      try {
        await heartbeat.assertActive();
        await this.#service.failAcceptedExecution(
          job.tenantId,
          job.executionId,
          "worker_internal_failure",
          heartbeat,
        );
        await this.#jobs.finish({
          claim,
          status: "failed",
          safeErrorCode: "worker_internal_failure",
        });
      } catch (failureError) {
        if (!isExecutionContinuationStoppedError(failureError)) throw failureError;
      }
    } finally {
      await heartbeat.stop();
      this.#activeHeartbeats.delete(heartbeat);
    }
    return true;
  }

  async shutdown(gracePeriodMs: number): Promise<boolean> {
    this.#acceptingClaims = false;
    if (this.#activeRuns === 0) return true;
    if (await this.#waitForIdle(gracePeriodMs)) return true;
    for (const heartbeat of this.#activeHeartbeats) heartbeat.cancel();
    return this.#waitForIdle(Math.min(1_000, gracePeriodMs));
  }

  async #waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.#activeRuns === 0) return true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<true>((resolve) => {
      const onIdle = () => resolve(true);
      this.#idleWaiters.add(onIdle);
    });
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      unrefTimer(timeout);
    });
    const result = await Promise.race([idle, timedOut]);
    if (timeout) clearTimeout(timeout);
    return result;
  }
}

type EventGenerated = {
  schemaVersion: 1;
  eventId: string;
  executionId: string;
  sequence: number;
  occurredAt: string;
};
type EventPayload = ExecutionEvent extends infer Event
  ? Event extends ExecutionEvent
    ? Omit<Event, keyof EventGenerated>
    : never
  : never;

export function availableCapability(expiresAt: string): ReplayCapability {
  return {
    state: "available",
    available: true,
    reason: "Replay capsule is available",
    expiresAt,
  };
}

export function unavailableCapability(
  state: Exclude<ReplayCapability["state"], "available" | "deleted">,
  reason: string,
): ReplayCapability {
  return { state, available: false, reason };
}

export function deletedCapability(deletedAt: string, expiresAt?: string): ReplayCapability {
  return {
    state: "deleted",
    available: false,
    reason: "Replay capsule was deleted",
    deletedAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

export class MemoryExecutionRepository implements ExecutionRepository {
  readonly #executions = new Map<string, ExecutionEnvelope>();
  readonly #idempotency = new Map<string, { requestHash: string; executionId: string }>();

  async create(execution: ExecutionEnvelope) {
    this.#executions.set(execution.executionId, structuredClone(execution));
  }
  async update(execution: ExecutionEnvelope) {
    this.#executions.set(execution.executionId, structuredClone(execution));
  }
  async appendEvent(event: ExecutionEvent) {
    const execution = this.#executions.get(event.executionId);
    if (execution && !execution.events.some((item) => item.eventId === event.eventId)) {
      execution.events.push(structuredClone(event));
    }
  }
  async eventsAfter(tenantId: TenantId, executionId: ExecutionId, afterSequence: number) {
    const execution = this.#executions.get(executionId);
    if (execution?.tenantId !== tenantId) return null;
    return execution.events
      .filter((event) => event.sequence > afterSequence)
      .sort((left, right) => left.sequence - right.sequence)
      .map((event) => structuredClone(event));
  }
  async findById(tenantId: TenantId, executionId: ExecutionId) {
    const execution = this.#executions.get(executionId);
    return execution?.tenantId === tenantId ? structuredClone(execution) : null;
  }
  async list(tenantId?: TenantId) {
    return [...this.#executions.values()]
      .filter((execution) => !tenantId || execution.tenantId === tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((execution) => structuredClone(execution));
  }
  async findIdempotent(tenantId: TenantId, keyHash: string) {
    const record = this.#idempotency.get(`${tenantId}:${keyHash}`);
    if (!record) return null;
    return this.findById(tenantId, record.executionId);
  }
  async recordIdempotency(
    tenantId: TenantId,
    keyHash: string,
    requestHash: string,
    executionId: ExecutionId,
  ) {
    this.#idempotency.set(`${tenantId}:${keyHash}`, { requestHash, executionId });
  }
}

export class MemoryComparisonExperimentRepository implements ComparisonExperimentRepository {
  readonly #experiments = new Map<string, ComparisonExperiment>();

  async create(experiment: ComparisonExperiment) {
    this.#experiments.set(experiment.experimentId, structuredClone(experiment));
  }

  async update(experiment: ComparisonExperiment) {
    this.#experiments.set(experiment.experimentId, structuredClone(experiment));
  }

  async findById(tenantId: TenantId, experimentId: string) {
    const experiment = this.#experiments.get(experimentId);
    return experiment?.tenantId === tenantId ? structuredClone(experiment) : null;
  }
}

export class MemoryReplayCapsuleStore implements ReplayCapsuleStore {
  readonly #capsules = new Map<
    string,
    {
      capsule: ReplayCapsule;
      expiresAt: string;
      deletedAt?: string;
    }
  >();
  readonly #audits: Array<{
    tenantId: TenantId;
    executionId: ExecutionId;
    operation: "store" | "inspect" | "read_for_replay" | "delete";
    outcome: string;
    occurredAt: string;
  }> = [];
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async put(input: StoreReplayCapsule) {
    this.#capsules.set(this.#key(input.tenantId, input.executionId), {
      capsule: structuredClone(input.capsule),
      expiresAt: input.expiresAt,
    });
    this.#audit(input.tenantId, input.executionId, "store", "stored");
    return availableCapability(input.expiresAt);
  }

  async inspect(tenantId: TenantId, executionId: ExecutionId) {
    const capability = this.#capability(tenantId, executionId);
    this.#audit(tenantId, executionId, "inspect", capability.state);
    return capability;
  }

  async getForReplay(
    tenantId: TenantId,
    executionId: ExecutionId,
  ): Promise<ReplayCapsuleReadResult> {
    const capability = this.#capability(tenantId, executionId);
    this.#audit(tenantId, executionId, "read_for_replay", capability.state);
    if (!capability.available) return { available: false, capability };
    const row = this.#capsules.get(this.#key(tenantId, executionId));
    if (!row) {
      return {
        available: false,
        capability: unavailableCapability("missing", "Replay capsule is unavailable"),
      };
    }
    return { available: true, capability, capsule: structuredClone(row.capsule) };
  }

  async delete(tenantId: TenantId, executionId: ExecutionId): Promise<ReplayCapsuleDeleteResult> {
    const row = this.#capsules.get(this.#key(tenantId, executionId));
    if (!row) {
      const capability = unavailableCapability("missing", "Replay capsule is unavailable");
      this.#audit(tenantId, executionId, "delete", "already_absent");
      return { deleted: false, capability };
    }
    if (row.deletedAt) {
      const capability = deletedCapability(row.deletedAt, row.expiresAt);
      this.#audit(tenantId, executionId, "delete", "already_deleted");
      return { deleted: false, capability };
    }
    row.deletedAt = this.#now().toISOString();
    const capability = deletedCapability(row.deletedAt, row.expiresAt);
    this.#audit(tenantId, executionId, "delete", "deleted");
    return { deleted: true, capability };
  }

  audits() {
    return structuredClone(this.#audits);
  }

  #capability(tenantId: TenantId, executionId: ExecutionId): ReplayCapability {
    const row = this.#capsules.get(this.#key(tenantId, executionId));
    if (!row) return unavailableCapability("missing", "Replay capsule is unavailable");
    if (row.deletedAt) return deletedCapability(row.deletedAt, row.expiresAt);
    if (new Date(row.expiresAt).getTime() <= this.#now().getTime()) {
      return {
        ...unavailableCapability("expired", "Replay capsule retention has expired"),
        expiresAt: row.expiresAt,
      };
    }
    return availableCapability(row.expiresAt);
  }

  #audit(
    tenantId: TenantId,
    executionId: ExecutionId,
    operation: "store" | "inspect" | "read_for_replay" | "delete",
    outcome: string,
  ) {
    this.#audits.push({
      tenantId,
      executionId,
      operation,
      outcome,
      occurredAt: this.#now().toISOString(),
    });
  }

  #key(tenantId: TenantId, executionId: ExecutionId) {
    return `${tenantId}\u0000${executionId}`;
  }
}

export class MapProviderRegistry implements ProviderRegistry {
  readonly #providers: Map<string, LlmProvider>;
  constructor(providers: LlmProvider[]) {
    this.#providers = new Map(providers.map((provider) => [provider.id, provider]));
  }
  resolve(provider: string) {
    return this.#providers.get(provider) ?? null;
  }
}

export class InMemoryCircuitBreaker implements CircuitBreaker {
  readonly #failures = new Map<string, number>();
  readonly #threshold: number;
  constructor(threshold = 5) {
    this.#threshold = threshold;
  }
  allow(provider: string) {
    return (this.#failures.get(provider) ?? 0) < this.#threshold;
  }
  recordSuccess(provider: string) {
    this.#failures.delete(provider);
  }
  recordFailure(provider: string) {
    this.#failures.set(provider, (this.#failures.get(provider) ?? 0) + 1);
  }
}

export class InMemoryRateLimiter implements RateLimiter {
  readonly #remaining: number;
  readonly #counts = new Map<TenantId, number>();
  constructor(limit = Number.POSITIVE_INFINITY) {
    this.#remaining = limit;
  }
  async consume(tenantId: TenantId) {
    const used = this.#counts.get(tenantId) ?? 0;
    if (used >= this.#remaining) return false;
    this.#counts.set(tenantId, used + 1);
    return true;
  }
}

// Contract-only skeleton: production wiring still needs atomic Redis scripts,
// per-tenant configuration, expiry, and failure-mode policy.
export class RedisRateLimiterSkeleton implements RateLimiter {
  async consume(_tenantId: TenantId): Promise<boolean> {
    throw new Error("RedisRateLimiterSkeleton is not wired for runtime use");
  }
}

export class RedisCircuitBreakerSkeleton implements CircuitBreaker {
  allow(_provider: string): boolean {
    throw new Error("RedisCircuitBreakerSkeleton is not wired for runtime use");
  }
  recordSuccess(_provider: string): void {
    throw new Error("RedisCircuitBreakerSkeleton is not wired for runtime use");
  }
  recordFailure(_provider: string): void {
    throw new Error("RedisCircuitBreakerSkeleton is not wired for runtime use");
  }
}

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

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function isTerminalStatus(status: ExecutionEnvelope["status"]): boolean {
  return ["succeeded", "degraded", "failed", "cancelled"].includes(status);
}

function parseLeaseDeadline(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("Lease deadline is invalid");
  return milliseconds;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}

export function hasAmbiguousProviderAttempt(execution: ExecutionEnvelope): boolean {
  return !isTerminalStatus(execution.status) && latestUnresolvedAttempt(execution) !== undefined;
}

function latestUnresolvedAttempt(execution: ExecutionEnvelope) {
  const started = execution.events.filter(
    (event): event is Extract<ExecutionEvent, { type: "attempt.started" }> =>
      event.type === "attempt.started",
  );
  return started.at(-1);
}
