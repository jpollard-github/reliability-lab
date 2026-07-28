import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Ajv, type ErrorObject } from "ajv/dist/ajv.js";
import type {
  CreateExecutionBody,
  ExecutionEnvelope,
  ExecutionEvent,
  ExecutionId,
  ExecutionPolicy,
  ProviderError,
  ProviderRequest,
  ReplayCapability,
  ReplayResult,
  TenantId,
} from "@reliability-lab/contracts";
import type { LlmProvider } from "@reliability-lab/providers";

export interface Clock {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
}

export interface RandomSource {
  next(): number;
}

export interface IdSource {
  executionId(): ExecutionId;
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
  completion: Promise<ExecutionEnvelope>;
}

export interface ExecutionServiceOptions {
  repository: ExecutionRepository;
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

const systemIds: IdSource = {
  executionId: randomUUID,
  eventId: randomUUID,
  traceId: () => randomBytes(16).toString("hex"),
};

const noOpTracer: ExecutionTracer = {
  withSpan: async (_name, _attributes, run) => run(),
};

export class ExecutionService {
  readonly #repository: ExecutionRepository;
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
  readonly #active = new Map<
    ExecutionId,
    { execution: ExecutionEnvelope; completion: Promise<ExecutionEnvelope> }
  >();
  readonly #ajv = new Ajv({ allErrors: true, strict: false });

  constructor(options: ExecutionServiceOptions) {
    this.#repository = options.repository;
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
  }

  async execute(command: ExecuteCommand): Promise<ExecutionEnvelope> {
    return (await this.submit(command)).completion;
  }

  async submit(command: ExecuteCommand): Promise<ExecutionSubmission> {
    const requestHash = hashCanonical(command.body);
    const idempotencyKeyHash = command.idempotencyKey
      ? hashCanonical(command.idempotencyKey)
      : undefined;
    if (idempotencyKeyHash) {
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

    const createdAt = this.#clock.now().toISOString();
    const policy: ExecutionPolicy = { ...DEFAULT_POLICY, ...command.body.policy };
    const budget = { ...DEFAULT_BUDGET, ...command.body.budget };
    const execution: ExecutionEnvelope = {
      schemaVersion: 1,
      executionId: this.#ids.executionId(),
      tenantId: command.tenantId,
      status: "running",
      provider: command.body.provider,
      model: command.body.model,
      traceId: this.#ids.traceId(),
      requestHash,
      policy,
      budget,
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

  async #continueSafely(
    execution: ExecutionEnvelope,
    body: CreateExecutionBody,
  ): Promise<ExecutionEnvelope> {
    try {
      return await this.#continueExecution(execution, body);
    } catch {
      if (execution.status === "succeeded" || execution.status === "degraded") return execution;
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
      return this.#fail(execution, internalError);
    }
  }

  async #continueExecution(
    execution: ExecutionEnvelope,
    body: CreateExecutionBody,
  ): Promise<ExecutionEnvelope> {
    const primary = this.#providers.resolve(body.provider);
    if (!primary) {
      return this.#fail(execution, {
        category: "invalid_request",
        code: "provider_not_configured",
        message: `Provider '${body.provider}' is not configured`,
        retryable: false,
      });
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
          return this.#fail(execution, {
            category: "provider_unavailable",
            code: "replay_retention_failed",
            message: "Required replay retention could not be established",
            retryable: true,
          });
        }
      }
    } else {
      this.#setCapability(
        execution,
        unavailableCapability("retention_disabled", "Live-provider request retention is disabled"),
      );
    }
    await this.#repository.update(execution);

    return this.#tracer.withSpan(
      "policy.evaluate",
      {
        "execution.id": execution.executionId,
        "execution.trace_id": execution.traceId,
        "provider.id": primary.id,
      },
      async () => this.#runPolicy(execution, body, primary, false),
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
    const replayExecution = await this.execute({
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
  ): Promise<ExecutionEnvelope> {
    const startedAtMs = this.#clock.now().getTime();
    let provider = primary;
    let model = body.model;
    let lastError: ProviderError | undefined;
    let attemptNumber = execution.attempts.length;
    let attemptsForProvider = 0;
    const maxAttempts = fallbackUsed ? 1 : execution.policy.maxAttempts;

    while (attemptsForProvider < maxAttempts) {
      attemptNumber += 1;
      attemptsForProvider += 1;
      if (!this.#circuitBreaker.allow(provider.id)) {
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
        return this.#budgetFailure(execution);
      }

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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remainingBudget);
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
              { signal: controller.signal, timeoutMs: remainingBudget },
            ),
        )
        .finally(() => clearTimeout(timeout));
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
            attempt.status = "rejected";
            await this.#append(execution, {
              type: "structured_output.rejected",
              attemptNumber,
              errors: validation.errors ?? ["Structured output is invalid"],
            });
            return this.#fail(execution, {
              category: "malformed_response",
              code: "structured_output_invalid",
              message: "Structured output failed JSON Schema validation",
              retryable: false,
            });
          }
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

      if (result.error.retryable && attemptsForProvider < maxAttempts) {
        const delayMs = this.#backoff(execution.policy, attemptsForProvider);
        if (this.#clock.now().getTime() - startedAtMs + delayMs >= execution.budget.maxLatencyMs) {
          return this.#budgetFailure(execution);
        }
        await this.#append(execution, {
          type: "retry.scheduled",
          attemptNumber,
          delayMs,
          reason: result.error.category,
        });
        await this.#clock.sleep(delayMs);
        continue;
      }
      break;
    }

    if (execution.policy.fallbackProvider && !fallbackUsed) {
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
        return this.#runPolicy(execution, fallbackBody, provider, true);
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

  async #budgetFailure(execution: ExecutionEnvelope): Promise<ExecutionEnvelope> {
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
    return this.#fail(execution, {
      category: "budget_exceeded",
      code: "latency_budget_exceeded",
      message: "Execution latency budget was exceeded",
      retryable: false,
    });
  }

  async #fail(execution: ExecutionEnvelope, error: ProviderError): Promise<ExecutionEnvelope> {
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
