import type {
  ExecutionEnvelope,
  ExecutionStatus,
  ExecutionSummary,
  ExecutionSummaryPage,
  InvestigationExecutionQuery,
  InvestigationProviderQuery,
  InvestigationRange,
  InvestigationSignal,
  ProviderObservation,
  ProviderObservationPage,
  ReliabilitySummary,
  ReliabilityTrendBucket,
  TenantId,
} from "@reliability-lab/contracts";
import type { ExecutionRepository } from "./index.js";

const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1_000;
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;
const TERMINAL_STATUSES = new Set<ExecutionStatus>([
  "succeeded",
  "degraded",
  "failed",
  "cancelled",
]);

export class InvestigationQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvestigationQueryError";
  }
}

export interface InvestigationReadRepository {
  searchExecutions(
    tenantId: TenantId,
    query: InvestigationExecutionQuery,
  ): Promise<ExecutionSummaryPage>;
  summarize(tenantId: TenantId, range: InvestigationRange): Promise<ReliabilitySummary>;
  observeProviders(
    tenantId: TenantId,
    query: InvestigationProviderQuery,
  ): Promise<ProviderObservationPage>;
}

export function resolveInvestigationRange(
  input: { from?: string; to?: string },
  now = new Date(),
): InvestigationRange {
  const to = input.to ? parseIsoDate(input.to, "to") : now;
  const from = input.from
    ? parseIsoDate(input.from, "from")
    : new Date(to.getTime() - DEFAULT_RANGE_MS);
  const duration = to.getTime() - from.getTime();
  if (duration <= 0) throw new InvestigationQueryError('"from" must be earlier than "to"');
  if (duration > MAX_RANGE_MS)
    throw new InvestigationQueryError("Investigation ranges cannot exceed 90 days");
  return { from: from.toISOString(), to: to.toISOString() };
}

export function encodeExecutionCursor(createdAt: string, executionId: string): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt, executionId }), "utf8").toString(
    "base64url",
  );
}

export function decodeExecutionCursor(cursor: string): {
  createdAt: string;
  executionId: string;
} {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      v?: unknown;
      createdAt?: unknown;
      executionId?: unknown;
    };
    if (
      decoded.v !== 1 ||
      typeof decoded.createdAt !== "string" ||
      typeof decoded.executionId !== "string" ||
      decoded.executionId.length === 0
    ) {
      throw new Error("invalid shape");
    }
    parseIsoDate(decoded.createdAt, "cursor createdAt");
    return { createdAt: decoded.createdAt, executionId: decoded.executionId };
  } catch {
    throw new InvestigationQueryError("The investigation cursor is invalid");
  }
}

export function deriveInvestigationSignals(execution: ExecutionEnvelope): InvestigationSignal[] {
  const eventTypes = new Set(execution.events.map((event) => event.type));
  const signals: InvestigationSignal[] = [];
  if (
    (eventTypes.has("retry.scheduled") ||
      (execution.attempts.length > 1 &&
        execution.attempts.slice(0, -1).some((attempt) => attempt.status !== "succeeded"))) &&
    (execution.status === "succeeded" || execution.status === "degraded")
  )
    signals.push("retry_recovered");
  if (
    eventTypes.has("fallback.selected") &&
    (execution.status === "succeeded" || execution.status === "degraded")
  )
    signals.push("fallback_used");
  if (
    execution.events.some(
      (event) => event.type === "budget.exceeded" && event.budget === "latency",
    ) ||
    execution.error?.code === "latency_budget_exceeded"
  )
    signals.push("latency_budget_exceeded");
  if (eventTypes.has("structured_output.rejected")) signals.push("structured_output_rejected");
  if (
    eventTypes.has("attempt.outcome_ambiguous") ||
    execution.error?.code === "provider_call_outcome_unknown"
  )
    signals.push("provider_outcome_ambiguous");
  if (execution.replayOfExecutionId) signals.push("replay_derived");
  return signals;
}

export function projectExecutionSummary(
  execution: ExecutionEnvelope,
  comparisonCount?: number,
): ExecutionSummary {
  const finalAttempt = [...execution.attempts]
    .reverse()
    .find((attempt) => attempt.status !== "running");
  const signals = deriveInvestigationSignals(execution);
  return {
    executionId: execution.executionId,
    status: execution.status,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    initialProvider: execution.provider,
    initialModel: execution.model,
    traceId: execution.traceId,
    attemptCount: execution.attempts.length,
    retryCount: Math.max(0, execution.attempts.length - 1),
    signals,
    retryRecovered: signals.includes("retry_recovered"),
    fallbackUsed: signals.includes("fallback_used"),
    latencyBudgetExceeded: signals.includes("latency_budget_exceeded"),
    structuredOutputRejected: signals.includes("structured_output_rejected"),
    providerOutcomeAmbiguous: signals.includes("provider_outcome_ambiguous"),
    ...(comparisonCount === undefined ? {} : { comparisonCount }),
    ...(execution.durationMs === undefined ? {} : { durationMs: execution.durationMs }),
    ...(finalAttempt
      ? { finalProvider: finalAttempt.provider, finalModel: finalAttempt.model }
      : {}),
    ...(execution.error
      ? { errorCategory: execution.error.category, errorCode: execution.error.code }
      : {}),
    ...(execution.replayOfExecutionId
      ? { replayOfExecutionId: execution.replayOfExecutionId }
      : {}),
  };
}

export class MemoryInvestigationReadRepository implements InvestigationReadRepository {
  readonly #executions: ExecutionRepository;

  constructor(executions: ExecutionRepository) {
    this.#executions = executions;
  }

  async searchExecutions(
    tenantId: TenantId,
    query: InvestigationExecutionQuery,
  ): Promise<ExecutionSummaryPage> {
    const cursor = query.cursor ? decodeExecutionCursor(query.cursor) : undefined;
    const filtered = (await this.#executions.list(tenantId))
      .filter((execution) => isInRange(execution.createdAt, query.range))
      .filter((execution) => matchesExecution(execution, query))
      .sort(compareExecutions);
    const afterCursor = cursor
      ? filtered.filter((execution) => compareToCursor(execution, cursor) > 0)
      : filtered;
    const page = afterCursor.slice(0, query.limit + 1);
    const hasNext = page.length > query.limit;
    const data = page.slice(0, query.limit).map((execution) => projectExecutionSummary(execution));
    const last = data.at(-1);
    return {
      range: query.range,
      data,
      total: filtered.length,
      ...(hasNext && last
        ? { nextCursor: encodeExecutionCursor(last.createdAt, last.executionId) }
        : {}),
    };
  }

  async summarize(tenantId: TenantId, range: InvestigationRange): Promise<ReliabilitySummary> {
    const executions = (await this.#executions.list(tenantId)).filter((execution) =>
      isInRange(execution.createdAt, range),
    );
    return summarizeReliability(executions, range);
  }

  async observeProviders(
    tenantId: TenantId,
    query: InvestigationProviderQuery,
  ): Promise<ProviderObservationPage> {
    const executions = (await this.#executions.list(tenantId)).filter(
      (execution) =>
        isInRange(execution.createdAt, query.range) &&
        routeMatches(execution, query.providers, query.models),
    );
    return {
      range: query.range,
      data: observeProviders(executions)
        .filter(
          (observation) =>
            (!query.providers?.length || query.providers.includes(observation.provider)) &&
            (!query.models?.length || query.models.includes(observation.model)),
        )
        .slice(0, query.limit),
    };
  }
}

export function summarizeReliability(
  executions: ExecutionEnvelope[],
  range: InvestigationRange,
): ReliabilitySummary {
  const count = (status: ExecutionStatus) =>
    executions.filter((execution) => execution.status === status).length;
  const succeeded = count("succeeded");
  const degraded = count("degraded");
  const failed = count("failed");
  const terminal = succeeded + degraded + failed + count("cancelled");
  const summaries = executions.map((execution) => projectExecutionSummary(execution));
  const completedDurations = executions
    .filter((execution) => TERMINAL_STATUSES.has(execution.status))
    .flatMap((execution) => (execution.durationMs === undefined ? [] : [execution.durationMs]));
  const usageExecutions = executions.filter((execution) =>
    execution.attempts.some((attempt) => attempt.usage),
  );
  const costExecutions = executions.filter((execution) =>
    execution.attempts.some((attempt) => attempt.usage?.estimatedCostUsd !== undefined),
  );
  const allUsage = executions.flatMap((execution) =>
    execution.attempts.flatMap((attempt) => (attempt.usage ? [attempt.usage] : [])),
  );
  const replayChecks = executions.flatMap((execution) =>
    execution.events.filter((event) => event.type === "replay.completed"),
  );
  return {
    range,
    population: {
      total: executions.length,
      terminal,
      inFlight: count("queued") + count("running"),
      queued: count("queued"),
      running: count("running"),
      cancelled: count("cancelled"),
    },
    outcomes: {
      succeeded,
      degraded,
      failed,
      successRate: rate(succeeded, terminal),
      degradedRate: rate(degraded, terminal),
      failureRate: rate(failed, terminal),
    },
    signals: {
      retryRecovered: summaries.filter((item) => item.signals.includes("retry_recovered")).length,
      fallbackUsed: summaries.filter((item) => item.signals.includes("fallback_used")).length,
      latencyBudgetExceeded: summaries.filter((item) =>
        item.signals.includes("latency_budget_exceeded"),
      ).length,
      structuredOutputRejected: summaries.filter((item) =>
        item.signals.includes("structured_output_rejected"),
      ).length,
      providerOutcomeAmbiguous: summaries.filter((item) =>
        item.signals.includes("provider_outcome_ambiguous"),
      ).length,
      rateLimitFailures: executions.filter((execution) =>
        execution.attempts.some((attempt) => attempt.error?.category === "rate_limit"),
      ).length,
      timeoutFailures: executions.filter((execution) =>
        execution.attempts.some((attempt) => attempt.error?.category === "timeout"),
      ).length,
      providerUnavailableFailures: executions.filter((execution) =>
        execution.attempts.some((attempt) => attempt.error?.category === "provider_unavailable"),
      ).length,
    },
    latency: {
      sampleSize: completedDurations.length,
      p50Ms: percentile(completedDurations, 0.5),
      p95Ms: percentile(completedDurations, 0.95),
    },
    usage: {
      executionCoverage: usageExecutions.length,
      costCoverage: costExecutions.length,
      inputTokens: sum(allUsage.map((usage) => usage.inputTokens)),
      outputTokens: sum(allUsage.map((usage) => usage.outputTokens)),
      estimatedCostUsd: sum(allUsage.map((usage) => usage.estimatedCostUsd ?? 0)),
    },
    comparisons: {
      completed: 0,
      reproducibilityChecks: replayChecks.length,
      exactOutputMatches: replayChecks.filter(
        (event) => event.type === "replay.completed" && event.outcomeMatches === true,
      ).length,
    },
    trend: buildTrend(executions, range),
  };
}

export function observeProviders(executions: ExecutionEnvelope[]): ProviderObservation[] {
  const groups = new Map<
    string,
    {
      provider: string;
      model: string;
      attempts: ExecutionEnvelope["attempts"];
      executionIds: Set<string>;
      fallbackSelectedToRoute: number;
    }
  >();
  for (const execution of executions) {
    for (const attempt of execution.attempts) {
      const key = `${attempt.provider}\u0000${attempt.model}`;
      const group = groups.get(key) ?? {
        provider: attempt.provider,
        model: attempt.model,
        attempts: [],
        executionIds: new Set<string>(),
        fallbackSelectedToRoute: 0,
      };
      group.attempts.push(attempt);
      group.executionIds.add(execution.executionId);
      groups.set(key, group);
    }
    for (const selected of execution.events.filter((event) => event.type === "fallback.selected")) {
      if (selected.type !== "fallback.selected") continue;
      const key = `${selected.provider}\u0000${selected.model}`;
      const group = groups.get(key);
      if (group) group.fallbackSelectedToRoute += 1;
    }
  }
  return [...groups.values()]
    .map(
      ({
        provider,
        model,
        attempts,
        executionIds,
        fallbackSelectedToRoute,
      }): ProviderObservation => {
        const durations = attempts.flatMap((attempt) =>
          attempt.durationMs === undefined ? [] : [attempt.durationMs],
        );
        const terminalAttemptCount = attempts.filter(
          (attempt) => attempt.status !== "running",
        ).length;
        const succeededAttempts = attempts.filter(
          (attempt) => attempt.status === "succeeded",
        ).length;
        return {
          provider,
          model,
          attemptCount: attempts.length,
          executionCount: executionIds.size,
          terminalAttemptCount,
          succeededAttempts,
          failedAttempts: attempts.filter((attempt) => attempt.status === "failed").length,
          timedOutAttempts: attempts.filter((attempt) => attempt.status === "timed_out").length,
          rejectedAttempts: attempts.filter((attempt) => attempt.status === "rejected").length,
          runningAttempts: attempts.filter((attempt) => attempt.status === "running").length,
          observedSuccessRate: rate(succeededAttempts, terminalAttemptCount),
          latencySampleSize: durations.length,
          p50LatencyMs: percentile(durations, 0.5),
          p95LatencyMs: percentile(durations, 0.95),
          rateLimitedAttempts: attempts.filter(
            (attempt) => attempt.error?.category === "rate_limit",
          ).length,
          providerUnavailableAttempts: attempts.filter(
            (attempt) => attempt.error?.category === "provider_unavailable",
          ).length,
          providerErrors: attempts.filter((attempt) => attempt.error !== undefined).length,
          structuredOutputRejections: attempts.filter(
            (attempt) => attempt.validation?.valid === false,
          ).length,
          fallbackSelectedToRoute,
          sampleAssessment:
            attempts.length === 0
              ? "no_evidence"
              : attempts.length < 5
                ? "insufficient_sample"
                : "observed",
        };
      },
    )
    .sort(
      (left, right) =>
        right.attemptCount - left.attemptCount ||
        left.provider.localeCompare(right.provider) ||
        left.model.localeCompare(right.model),
    );
}

function matchesExecution(
  execution: ExecutionEnvelope,
  query: InvestigationExecutionQuery,
): boolean {
  const normalizedQuery = query.query?.trim().toLowerCase();
  if (
    normalizedQuery &&
    !execution.executionId.toLowerCase().startsWith(normalizedQuery) &&
    !execution.traceId.toLowerCase().startsWith(normalizedQuery)
  )
    return false;
  if (query.statuses?.length && !query.statuses.includes(execution.status)) return false;
  if (!routeMatches(execution, query.providers, query.models)) return false;
  if (query.errorCategory && execution.error?.category !== query.errorCategory) return false;
  if (query.errorCode && execution.error?.code !== query.errorCode) return false;
  if (query.signal && !deriveInvestigationSignals(execution).includes(query.signal)) return false;
  return true;
}

function routeMatches(
  execution: ExecutionEnvelope,
  providers?: string[],
  models?: string[],
): boolean {
  if (!providers?.length && !models?.length) return true;
  const routes = execution.attempts.length
    ? execution.attempts
    : [{ provider: execution.provider, model: execution.model }];
  return routes.some(
    (route) =>
      (!providers?.length || providers.includes(route.provider)) &&
      (!models?.length || models.includes(route.model)),
  );
}

function compareExecutions(left: ExecutionEnvelope, right: ExecutionEnvelope) {
  return (
    right.createdAt.localeCompare(left.createdAt) ||
    right.executionId.localeCompare(left.executionId)
  );
}

function compareToCursor(
  execution: ExecutionEnvelope,
  cursor: { createdAt: string; executionId: string },
) {
  if (execution.createdAt < cursor.createdAt) return 1;
  if (execution.createdAt > cursor.createdAt) return -1;
  if (execution.executionId < cursor.executionId) return 1;
  if (execution.executionId > cursor.executionId) return -1;
  return 0;
}

function buildTrend(
  executions: ExecutionEnvelope[],
  range: InvestigationRange,
): ReliabilityTrendBucket[] {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const bucketMs =
    to.getTime() - from.getTime() <= DEFAULT_RANGE_MS ? 60 * 60 * 1_000 : 24 * 60 * 60 * 1_000;
  const buckets: ReliabilityTrendBucket[] = [];
  for (let cursor = from.getTime(); cursor < to.getTime(); cursor += bucketMs) {
    const bucketTo = Math.min(cursor + bucketMs, to.getTime());
    const members = executions.filter((execution) => {
      const createdAt = new Date(execution.createdAt).getTime();
      return createdAt >= cursor && createdAt < bucketTo;
    });
    const succeeded = members.filter((item) => item.status === "succeeded").length;
    const degraded = members.filter((item) => item.status === "degraded").length;
    const failed = members.filter((item) => item.status === "failed").length;
    const cancelled = members.filter((item) => item.status === "cancelled").length;
    buckets.push({
      from: new Date(cursor).toISOString(),
      to: new Date(bucketTo).toISOString(),
      total: members.length,
      terminal: succeeded + degraded + failed + cancelled,
      succeeded,
      degraded,
      failed,
    });
  }
  return buckets;
}

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[rank] ?? null;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function isInRange(createdAt: string, range: InvestigationRange) {
  return createdAt >= range.from && createdAt < range.to;
}

function parseIsoDate(value: string, label: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || !value.includes("T"))
    throw new InvestigationQueryError(`"${label}" must be a valid ISO-8601 date-time`);
  return date;
}
