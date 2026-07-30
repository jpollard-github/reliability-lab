import type {
  CaseEvidenceReviewItem,
  InvestigationCaseReview,
  SavedInvestigationScope,
} from "@reliability-lab/contracts";

/**
 * Renders the API and browser download from the same safe case-review projection.
 * Only static headings create Markdown structure; all bounded prose and links are escaped.
 */
export function renderInvestigationCaseReviewPacket(review: InvestigationCaseReview): string {
  const item = review.case;
  const lines = [
    `# Reliability case: ${escapeMarkdown(item.title)}`,
    "",
    `- Case ID: ${escapeMarkdown(item.caseId)}`,
    `- Status: ${escapeMarkdown(item.status)}`,
    ...(item.importance ? [`- Importance: ${escapeMarkdown(item.importance)}`] : []),
    `- Generated: ${escapeMarkdown(review.generatedAt)}`,
    "",
    "## Reliability question",
    "",
    escapeMarkdown(item.question),
    "",
    "## Exact saved scope",
    "",
    `- From: ${escapeMarkdown(review.scope.range.from)}`,
    `- To: ${escapeMarkdown(review.scope.range.to)}`,
    ...scopeLines(review.scope),
    "",
    "## Current finding",
    "",
    escapeMarkdown(item.finding ?? "Not recorded."),
    "",
    "## Current resolution",
    "",
    escapeMarkdown(item.resolution ?? "Not recorded."),
    "",
    "## Conclusion readiness",
    "",
    `Record completeness: ${review.readiness.ready ? "ready to resolve" : "not ready to resolve"}. This checklist does not establish correctness or truth.`,
    "",
    ...review.readiness.checks.flatMap((check) => [
      `- [${check.satisfied ? "x" : " "}] ${escapeMarkdown(check.label)} — ${escapeMarkdown(check.explanation)}`,
    ]),
    "",
    "## Linked evidence review",
    "",
    ...(review.evidence.length
      ? review.evidence.flatMap((evidence, index) => evidenceLines(evidence, index))
      : ["No evidence references are linked.", ""]),
    "## Notes",
    "",
    `${review.noteCount} append-only note${review.noteCount === 1 ? " exists" : "s exist"}. Note bodies are excluded from this packet.`,
    "",
    "## Prototype and evidence limitations",
    "",
    "- This packet contains bounded tenant-scoped operational prose; it is not public-safe.",
    "- Readiness means record completeness, not factual correctness, causation, or conclusion truth.",
    "- Provider observations describe only the exact saved evidence window and are not universal provider health.",
    "- Comparison dimensions do not assign a winner, confidence score, or semantic quality judgment.",
    "- Tenant routing is not authenticated identity, authorship, RBAC, or database row-level security.",
    "- Remote provider effects are not guaranteed exactly once.",
    "- Raw prompts, messages, outputs, provider bodies, attempts, events, replay material, commands, credentials, cookies, authorization headers, and note bodies are excluded.",
    "",
    "## Internal source routes",
    "",
    `- Case review: ${internalMarkdownLink("Open current review", review.links.self)}`,
    `- Saved Workbench scope: ${internalMarkdownLink("Open exact saved scope", review.links.savedWorkbench)}`,
    ...review.evidence.map(
      (evidence) =>
        `- ${escapeMarkdown(evidence.type.replaceAll("_", " "))}: ${internalMarkdownLink("Open authoritative source", evidence.sourceUrl)}`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function caseReviewPacketFilename(caseId: string): string {
  const safe = caseId
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return `reliability-case-${safe || "case"}.md`;
}

export function escapeMarkdown(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/([\\`*_[\]{}()<>#+\-.!|])/gu, "\\$1");
}

function scopeLines(scope: SavedInvestigationScope): string[] {
  return [
    ...(scope.query ? [`- Query: ${escapeMarkdown(scope.query)}`] : []),
    ...(scope.statuses?.length
      ? [`- Statuses: ${scope.statuses.map(escapeMarkdown).join(", ")}`]
      : []),
    ...(scope.providers?.length
      ? [`- Providers: ${scope.providers.map(escapeMarkdown).join(", ")}`]
      : []),
    ...(scope.models?.length ? [`- Models: ${scope.models.map(escapeMarkdown).join(", ")}`] : []),
    ...(scope.errorCategory ? [`- Error category: ${escapeMarkdown(scope.errorCategory)}`] : []),
    ...(scope.errorCode ? [`- Error code: ${escapeMarkdown(scope.errorCode)}`] : []),
    ...(scope.signal ? [`- Signal: ${escapeMarkdown(scope.signal)}`] : []),
  ];
}

function evidenceLines(evidence: CaseEvidenceReviewItem, index: number): string[] {
  const lines = [
    `### Evidence ${index + 1}: ${escapeMarkdown(evidence.type.replaceAll("_", " "))}`,
    "",
    `- Evidence ID: ${escapeMarkdown(evidence.evidenceId)}`,
    `- Added: ${escapeMarkdown(evidence.addedAt)}`,
    `- Availability: ${escapeMarkdown(evidence.availability)}`,
    `- Source: ${internalMarkdownLink("Open authoritative source", evidence.sourceUrl)}`,
  ];
  if (evidence.availability === "unavailable") {
    return [
      ...lines,
      `- Reason: ${escapeMarkdown(evidence.reason)}`,
      `- Explanation: ${escapeMarkdown(evidence.explanation)}`,
      `- Reference: ${escapeMarkdown(JSON.stringify(evidence.reference))}`,
      "",
    ];
  }
  if (evidence.type === "execution") {
    const summary = evidence.summary;
    return [
      ...lines,
      `- Execution: ${escapeMarkdown(summary.executionId)}`,
      `- Status: ${escapeMarkdown(summary.status)}`,
      `- Created / updated: ${escapeMarkdown(summary.createdAt)} / ${escapeMarkdown(summary.updatedAt)}`,
      `- Duration: ${summary.durationMs === undefined ? "unavailable" : `${summary.durationMs} ms`}`,
      `- Initial route: ${escapeMarkdown(`${summary.initialProvider}/${summary.initialModel}`)}`,
      `- Final route: ${escapeMarkdown(`${summary.finalProvider ?? "unavailable"}/${summary.finalModel ?? "unavailable"}`)}`,
      `- Attempts / retries: ${summary.attemptCount} / ${summary.retryCount}`,
      `- Signals: ${summary.signals.length ? summary.signals.map(escapeMarkdown).join(", ") : "none recorded"}`,
      `- Terminal error: ${escapeMarkdown(summary.errorCategory && summary.errorCode ? `${summary.errorCategory}/${summary.errorCode}` : "none recorded")}`,
      `- Replay capability: ${escapeMarkdown(`${summary.replayCapability.state} — ${summary.replayCapability.reason}`)}`,
      "",
    ];
  }
  if (evidence.type === "comparison") {
    const summary = evidence.summary;
    return [
      ...lines,
      `- Experiment: ${escapeMarkdown(summary.experimentId)}`,
      `- Status: ${escapeMarkdown(summary.status)}`,
      `- Original: ${escapeMarkdown(`${summary.originalExecutionId} (${summary.originalStatus})`)}`,
      `- Variant: ${escapeMarkdown(summary.variantExecutionId ? `${summary.variantExecutionId} (${summary.variantStatus ?? "unavailable"})` : "unavailable")}`,
      `- Requested variation: ${escapeMarkdown(JSON.stringify(summary.requestedVariation))}`,
      `- Resolved safe variation: ${escapeMarkdown(JSON.stringify(summary.resolvedVariant))}`,
      `- Conditions: ${summary.conditions.map((condition) => `${escapeMarkdown(condition.label)}=${condition.state}`).join(", ")}`,
      `- Summary: ${escapeMarkdown(summary.summary)}`,
      ...summary.dimensions.map(
        (dimension) =>
          `- ${escapeMarkdown(dimension.label)}: original=${escapeMarkdown(String(dimension.original))}; variant=${escapeMarkdown(String(dimension.variant))}; change=${escapeMarkdown(dimension.change)}; ${escapeMarkdown(dimension.explanation)}`,
      ),
      "",
    ];
  }
  const observation = evidence.summary.observation;
  return [
    ...lines,
    `- Route: ${escapeMarkdown(`${evidence.summary.provider}/${evidence.summary.model}`)}`,
    `- Exact range: ${escapeMarkdown(evidence.summary.range.from)} / ${escapeMarkdown(evidence.summary.range.to)}`,
    `- Attempts / executions / terminal attempts: ${observation.attemptCount} / ${observation.executionCount} / ${observation.terminalAttemptCount}`,
    `- Succeeded / failed / timed out / rejected / running: ${observation.succeededAttempts} / ${observation.failedAttempts} / ${observation.timedOutAttempts} / ${observation.rejectedAttempts} / ${observation.runningAttempts}`,
    `- Observed success rate: ${observation.observedSuccessRate === null ? "unavailable" : `${(observation.observedSuccessRate * 100).toFixed(1)}%`} of ${observation.terminalAttemptCount} terminal attempts`,
    `- Latency sample / p50 / p95: ${observation.latencySampleSize} / ${observation.p50LatencyMs ?? "unavailable"} / ${observation.p95LatencyMs ?? "unavailable"} ms`,
    `- Rate limited / provider unavailable / provider errors: ${observation.rateLimitedAttempts} / ${observation.providerUnavailableAttempts} / ${observation.providerErrors}`,
    `- Structured-output rejections / fallback selections to route: ${observation.structuredOutputRejections} / ${observation.fallbackSelectedToRoute}`,
    `- Sample assessment: ${escapeMarkdown(observation.sampleAssessment)}`,
    "",
  ];
}

function internalMarkdownLink(label: string, destination: string): string {
  const safe = destination.startsWith("/") && !destination.startsWith("//") ? destination : "/";
  const parsed = new URL(safe, "http://reliability-lab.internal");
  const normalizedDestination = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const escapedDestination = normalizedDestination
    .replace(/\(/gu, "%28")
    .replace(/\)/gu, "%29")
    .replace(/\\/gu, "%5C");
  return `[${escapeMarkdown(label)}](${escapedDestination})`;
}
