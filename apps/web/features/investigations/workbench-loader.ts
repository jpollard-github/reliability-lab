import "server-only";

import type {
  ExecutionSummaryPage,
  InvestigationCaseEvidenceInput,
  ProviderObservationPage,
  ReliabilitySummary,
  SavedInvestigationScope,
} from "@reliability-lab/contracts";
import {
  getInvestigationSummary,
  getProviderObservations,
  searchInvestigationExecutions,
} from "@/lib/server-api";
import {
  activeProviderEvidence,
  buildApiParams,
  resolveRange,
  returnUrl,
  selectedWindow,
  toSavedScope,
  toUrlSearchParams,
  type ResolvedWorkbenchRange,
  type WindowPreset,
  type WorkbenchSearchParams,
} from "./search-state";

export interface InvestigationWorkbenchModel {
  raw: WorkbenchSearchParams;
  current: URLSearchParams;
  range: ResolvedWorkbenchRange;
  selectedWindow: WindowPreset;
  returnTo: string;
  savedScope: SavedInvestigationScope;
  providerEvidence: Extract<
    InvestigationCaseEvidenceInput,
    { type: "provider_observation" }
  > | null;
  summary: ReliabilitySummary;
  providers: ProviderObservationPage;
  executions: ExecutionSummaryPage;
}

export async function loadInvestigationWorkbench(
  raw: WorkbenchSearchParams,
): Promise<InvestigationWorkbenchModel> {
  const current = toUrlSearchParams(raw);
  const range = resolveRange(raw);
  const { rangeParams, executionParams, providerParams } = buildApiParams(range, current);
  const [summary, providers, executions] = await Promise.all([
    getInvestigationSummary(rangeParams),
    getProviderObservations(providerParams),
    searchInvestigationExecutions(executionParams),
  ]);
  const savedScope = toSavedScope(range, current);
  return {
    raw,
    current,
    range,
    selectedWindow: selectedWindow(raw),
    returnTo: returnUrl(current),
    savedScope,
    providerEvidence: activeProviderEvidence(savedScope),
    summary,
    providers,
    executions,
  };
}
