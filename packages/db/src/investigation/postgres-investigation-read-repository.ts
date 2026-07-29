/**
 * Thin PostgreSQL Investigation Workbench adapter.
 * Named query modules own search, aggregate, trend, and provider SQL.
 */
import type {
  InvestigationExecutionQuery,
  InvestigationProviderQuery,
  InvestigationRange,
  TenantId,
} from "@reliability-lab/contracts";
import type { InvestigationReadRepository } from "@reliability-lab/core";
import type { ReliabilityDatabase } from "../database/database.js";
import { searchExecutions } from "./execution-search-query.js";
import { observeProviders } from "./provider-observations-query.js";
import { summarizeReliability } from "./reliability-summary-query.js";

type QueryOperation = "search" | "search_count" | "summary" | "trend" | "providers";

export class PostgresInvestigationReadRepository implements InvestigationReadRepository {
  readonly #db: ReliabilityDatabase;
  readonly #onQuery: ((operation: QueryOperation) => void) | undefined;

  constructor(
    db: ReliabilityDatabase,
    options: { onQuery?: (operation: QueryOperation) => void } = {},
  ) {
    this.#db = db;
    this.#onQuery = options.onQuery;
  }

  searchExecutions(tenantId: TenantId, query: InvestigationExecutionQuery) {
    this.#onQuery?.("search");
    this.#onQuery?.("search_count");
    return searchExecutions(this.#db, tenantId, query);
  }

  summarize(tenantId: TenantId, range: InvestigationRange) {
    this.#onQuery?.("summary");
    this.#onQuery?.("trend");
    return summarizeReliability(this.#db, tenantId, range);
  }

  observeProviders(tenantId: TenantId, query: InvestigationProviderQuery) {
    this.#onQuery?.("providers");
    return observeProviders(this.#db, tenantId, query);
  }
}
