import Link from "next/link";
import { ExecutionTable } from "@/features/executions/execution-table";
import { ExecutionFilters } from "./execution-filters";
import { filterHref, withoutParam } from "./search-state";
import type { InvestigationWorkbenchModel } from "./workbench-loader";

export function ExecutionExplorer({
  model,
}: {
  model: Pick<
    InvestigationWorkbenchModel,
    "current" | "executions" | "raw" | "returnTo" | "selectedWindow"
  >;
}) {
  return (
    <section className="panel" data-guide-anchor="workbench-explorer" id="execution-explorer">
      <div className="panel-heading">
        <div>
          <h2>Execution explorer</h2>
          <p>Exact-prefix identity search and evidence-backed filters.</p>
        </div>
        <span className="muted">{model.executions.total} matching records</span>
      </div>
      <ExecutionFilters
        current={model.current}
        raw={model.raw}
        selectedWindow={model.selectedWindow}
      />
      <ExecutionTable executions={model.executions.data} returnTo={model.returnTo} />
      <div className="pagination">
        {model.current.has("cursor") ? (
          <Link href={withoutParam(model.current, "cursor")}>First page</Link>
        ) : (
          <span />
        )}
        <span className="muted">Use browser back for the previous cursor page.</span>
        {model.executions.nextCursor ? (
          <Link href={filterHref(model.current, "cursor", model.executions.nextCursor)}>
            Next page
          </Link>
        ) : (
          <span className="muted">End of results</span>
        )}
      </div>
    </section>
  );
}
