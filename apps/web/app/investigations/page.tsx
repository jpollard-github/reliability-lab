import { ExecutionExplorer } from "@/features/investigations/execution-explorer";
import { loadInvestigationWorkbench } from "@/features/investigations/workbench-loader";
import { OutcomeTrend } from "@/features/investigations/outcome-trend";
import { ProviderObservations } from "@/features/investigations/provider-observations";
import { ReliabilitySummaryCards } from "@/features/investigations/reliability-summary-cards";
import { SaveInvestigationPanel } from "@/features/investigations/save-investigation-panel";
import type { WorkbenchSearchParams } from "@/features/investigations/search-state";
import { TimeWindowToolbar } from "@/features/investigations/time-window-toolbar";
import { WorkbenchHeader } from "@/features/investigations/workbench-header";

export const dynamic = "force-dynamic";

export default async function InvestigationsPage({
  searchParams,
}: {
  searchParams: Promise<WorkbenchSearchParams>;
}) {
  const model = await loadInvestigationWorkbench(await searchParams);
  return (
    <>
      <WorkbenchHeader current={model.current} />
      <TimeWindowToolbar range={model.range} selectedWindow={model.selectedWindow} />
      <ReliabilitySummaryCards current={model.current} summary={model.summary} />
      <SaveInvestigationPanel model={model} />
      <OutcomeTrend summary={model.summary} />
      <ProviderObservations current={model.current} providers={model.providers} />
      <ExecutionExplorer model={model} />
    </>
  );
}
