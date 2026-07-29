import type {
  ExecutionEnvelope,
  ExecutionSummaryPage,
  InvestigationExecutionQuery,
  InvestigationProviderQuery,
  InvestigationRange,
  ProviderObservationPage,
  ReliabilitySummary,
  TenantId,
} from "@reliability-lab/contracts";
import type { ExecutionRepository } from "../execution/ports.js";
import { observeProviders } from "./provider-observations.js";
import { decodeExecutionCursor, encodeExecutionCursor } from "./range.js";
import type { InvestigationReadRepository } from "./read-repository.js";
import { summarizeReliability } from "./reliability-summary.js";
import { deriveInvestigationSignals, projectExecutionSummary } from "./signals.js";

/**
 * Projects bounded workbench reads from the process-local execution repository.
 * It mirrors PostgreSQL semantics but is not intended for large analytical data sets.
 */
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
function isInRange(createdAt: string, range: InvestigationRange) {
  return createdAt >= range.from && createdAt < range.to;
}
