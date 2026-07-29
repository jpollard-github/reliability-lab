import type {
  ExecutionSummaryPage,
  InvestigationExecutionQuery,
  InvestigationProviderQuery,
  InvestigationRange,
  ProviderObservationPage,
  ReliabilitySummary,
  TenantId,
} from "@reliability-lab/contracts";

/**
 * Framework-independent Investigation Workbench read port.
 * It returns bounded projections and never exposes retained replay or command content.
 */
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
