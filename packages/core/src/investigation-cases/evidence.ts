import type {
  InvestigationCaseEvidence,
  InvestigationCaseEvidenceCounts,
  InvestigationCaseEvidenceInput,
} from "@reliability-lab/contracts";

/**
 * Creates stable typed evidence identities and safe internal navigation URLs.
 * Arbitrary external URLs and copied evidence payloads are outside this boundary.
 */
export function evidenceIdentity(input: InvestigationCaseEvidenceInput): string {
  if (input.type === "execution") return `execution:${input.executionId}`;
  if (input.type === "comparison") return `comparison:${input.experimentId}`;
  return JSON.stringify([
    "provider_observation",
    input.provider,
    input.model,
    input.range.from,
    input.range.to,
  ]);
}

export function evidenceUrl(input: InvestigationCaseEvidenceInput): string {
  if (input.type === "execution") return `/executions/${encodeURIComponent(input.executionId)}`;
  if (input.type === "comparison") return `/comparisons/${encodeURIComponent(input.experimentId)}`;
  const params = new URLSearchParams({
    from: input.range.from,
    to: input.range.to,
    provider: input.provider,
    model: input.model,
  });
  return `/investigations?${params.toString()}#provider-observations`;
}
export function evidenceCounts(
  evidence: InvestigationCaseEvidence[],
): InvestigationCaseEvidenceCounts {
  return {
    executions: evidence.filter((item) => item.type === "execution").length,
    comparisons: evidence.filter((item) => item.type === "comparison").length,
    providerObservations: evidence.filter((item) => item.type === "provider_observation").length,
  };
}
