import type {
  ComparisonExperiment,
  ComparisonView,
  CreateExecutionBody,
  ExecutionEnvelope,
  ExecutionEvent,
  ExecutionEventPayload,
  ExecutionId,
  ReplayCapability,
  ReplayResult,
  ReplayVariation,
  TenantId,
} from "@reliability-lab/contracts";
import { projectComparison } from "../comparison/comparison-projection.js";
import {
  MemoryComparisonExperimentRepository,
  type ComparisonExperimentRepository,
} from "../comparison/repository.js";
import {
  inferSafeOriginalConfiguration,
  resolveReplayVariation,
} from "../comparison/variation-resolution.js";
import { InvalidComparisonVariationError } from "../comparison/errors.js";
import {
  unrestrictedContinuationGuard,
  type ExecutionContinuationGuard,
} from "../durable/continuation-guard.js";
import {
  systemClock,
  systemIds,
  type Clock,
  type IdSource,
  type RandomSource,
} from "../infrastructure/clock.js";
import { hashCanonical } from "../infrastructure/hashing.js";
import type { ProviderRegistry } from "../infrastructure/provider-registry.js";
import {
  InMemoryCircuitBreaker,
  InMemoryRateLimiter,
  type CircuitBreaker,
  type RateLimiter,
} from "../infrastructure/resilience.js";
import { noOpTracer, type ExecutionTracer } from "../infrastructure/tracing.js";
import {
  type ReplayCapsuleDeleteResult,
  type ReplayCapsuleReadResult,
  type ReplayCapsuleStore,
} from "../replay/replay-store.js";
import type {
  ComparisonSubmission,
  DurableAcceptancePort,
  ExecuteCommand,
  ExecutionSubmission,
} from "./commands.js";
import { prepareExecution } from "./execution-builder.js";
import {
  ComparisonNotFoundError,
  ExecutionNotFoundError,
  IdempotencyConflictError,
  RateLimitRejectedError,
} from "./errors.js";
import { ExecutionEventRecorder } from "./execution-events.js";
import { ExecutionRunner } from "./execution-runner.js";
import { isTerminalStatus } from "./execution-state.js";
import { validateLiveProviderRequest } from "./live-provider-request.js";
import type { ExecutionRepository } from "./ports.js";

/**
 * Public facade for execution acceptance, replay, comparisons, and evidence reads.
 * Provider attempts and policy transitions are delegated to ExecutionRunner.
 */
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

export class ExecutionService {
  readonly #repository: ExecutionRepository;
  readonly #comparisons: ComparisonExperimentRepository;
  readonly #replayCapsules: ReplayCapsuleStore;
  readonly #providers: ProviderRegistry;
  readonly #clock: Clock;
  readonly #ids: IdSource;
  readonly #rateLimiter: RateLimiter;
  readonly #tracer: ExecutionTracer;
  readonly #durableAcceptance: DurableAcceptancePort | undefined;
  readonly #events: ExecutionEventRecorder;
  readonly #runner: ExecutionRunner;
  readonly #active = new Map<
    ExecutionId,
    { execution: ExecutionEnvelope; completion: Promise<ExecutionEnvelope> }
  >();

  constructor(options: ExecutionServiceOptions) {
    this.#repository = options.repository;
    this.#comparisons = options.comparisons ?? new MemoryComparisonExperimentRepository();
    this.#replayCapsules = options.replayCapsules;
    this.#providers = options.providers;
    this.#clock = options.clock ?? systemClock;
    this.#ids = options.ids ?? systemIds;
    this.#rateLimiter = options.rateLimiter ?? new InMemoryRateLimiter();
    this.#tracer = options.tracer ?? noOpTracer;
    this.#durableAcceptance = options.durableAcceptance;
    this.#events = new ExecutionEventRecorder({
      repository: this.#repository,
      ids: this.#ids,
      clock: this.#clock,
    });
    this.#runner = new ExecutionRunner({
      repository: this.#repository,
      replayCapsules: this.#replayCapsules,
      providers: this.#providers,
      clock: this.#clock,
      random: options.random ?? { next: Math.random },
      circuitBreaker: options.circuitBreaker ?? new InMemoryCircuitBreaker(),
      tracer: this.#tracer,
      allowLivePromptRetention: options.allowLivePromptRetention ?? false,
      replayRetentionMs: options.replayRetentionMs ?? 24 * 60 * 60 * 1_000,
      events: this.#events,
    });
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

    const rawCompletion = this.#runner.continueNewExecution(execution, command.body);
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
    return prepareExecution({
      command,
      requestHash,
      durable,
      clock: this.#clock,
      ids: this.#ids,
      events: this.#events,
    });
  }

  async continueAcceptedExecution(
    tenantId: TenantId,
    executionId: ExecutionId,
    body: CreateExecutionBody,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ) {
    return this.#runner.continueAcceptedExecution(tenantId, executionId, body, guard);
  }

  async failAcceptedExecution(
    tenantId: TenantId,
    executionId: ExecutionId,
    code: string,
    guard: ExecutionContinuationGuard = unrestrictedContinuationGuard,
  ): Promise<ExecutionEnvelope> {
    return this.#runner.failAcceptedExecution(tenantId, executionId, code, guard);
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
        replayRetention: "encrypted",
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
      replayRetention: "encrypted",
    };
    const originalProvider = original.attempts[0]?.provider ?? original.provider;
    const originalModel = original.attempts[0]?.model ?? original.model;
    const originalRuntimeProvider = this.#providers.resolve(originalProvider);
    if (originalRuntimeProvider?.kind === "live") {
      if (
        resolvedVariant.provider !== originalProvider ||
        resolvedVariant.model !== originalModel ||
        resolvedVariant.policy.fallbackProvider !== original.policy.fallbackProvider ||
        resolvedVariant.policy.fallbackModel !== original.policy.fallbackModel
      ) {
        throw new InvalidComparisonVariationError(
          "Live comparisons must inherit the configured provider, model, and fallback target",
        );
      }
      const validationError = validateLiveProviderRequest({
        body: variantBody,
        policy: resolvedVariant.policy,
        budget: resolvedVariant.budget,
        capability: originalRuntimeProvider.capability ?? {
          id: originalRuntimeProvider.id,
          kind: "live",
          modelLabel: originalModel,
          transportFamily: "openai_compatible_chat_completions",
          configured: true,
          supportsFailureInjection: false,
          operatorEligible: true,
        },
      });
      if (validationError) {
        throw new InvalidComparisonVariationError(
          `Live comparison variation is outside the allowed bounds (${validationError.code})`,
        );
      }
    }
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

  async #append(execution: ExecutionEnvelope, event: ExecutionEventPayload): Promise<void> {
    await this.#events.append(execution, event);
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
