interface WorkflowStage {
  name: string;
  action: string;
  evidence: string;
  href: string;
  control: string;
  conclusion: string;
  nonConclusion: string;
}

interface ScenarioGuide {
  id: string;
  name: string;
  expected: string;
  evidence: string;
  concept: string;
  nextAction: string;
}

interface GlossaryEntry {
  term: string;
  description: string;
}

export const operatorWorkflow: WorkflowStage[] = [
  {
    name: "Execute",
    action: "Run one of the five deterministic scenarios.",
    evidence: "The execution envelope, status, and attempt count.",
    href: "/",
    control: "Deterministic scenario and Start and watch execution",
    conclusion: "A specific policy-driven execution was accepted and recorded.",
    nonConclusion: "The provider produced a factually correct answer.",
  },
  {
    name: "Explain",
    action: "Read the normalized outcome and durable event evidence.",
    evidence: "Envelope fields, normalized failures, attempts, and investigation signals.",
    href: "/",
    control: "Open an execution from Recent executions",
    conclusion: "The product can explain the recorded control-flow outcome.",
    nonConclusion: "An unrecorded provider side effect did or did not occur.",
  },
  {
    name: "Watch",
    action: "Follow the execution machine as persisted events arrive.",
    evidence: "Live stream state, machine route, and append-only event timeline.",
    href: "/",
    control: "Start and watch execution",
    conclusion: "The UI reflects the latest persisted evidence it has received.",
    nonConclusion: "The browser stream itself is the durable source of truth.",
  },
  {
    name: "Replay",
    action: "Re-run eligible retained input under current replay capability.",
    evidence: "Replay state, reason, lineage, and the new execution envelope.",
    href: "/",
    control: "Replay execution on an eligible execution detail page",
    conclusion: "A new execution was derived from retained replay input.",
    nonConclusion: "Replay is always available or reproduces external provider effects exactly.",
  },
  {
    name: "Compare",
    action: "Change a bounded variation while retaining the original input.",
    evidence: "Resolved configurations, two machines, and named comparison dimensions.",
    href: "/",
    control: "Compare with variant on an eligible execution detail page",
    conclusion: "The displayed dimensions differ, improve, worsen, or remain unchanged.",
    nonConclusion: "One configuration is a universal winner.",
  },
  {
    name: "Investigate",
    action: "Inspect bounded aggregate and execution-level evidence.",
    evidence: "Time range, event-derived signals, observations, filters, and matching executions.",
    href: "/investigations",
    control: "Investigation Workbench",
    conclusion: "The selected tenant scope contains the displayed observations.",
    nonConclusion: "Counts establish a universal provider-health ranking.",
  },
  {
    name: "Preserve",
    action: "Save an exact question, scope, evidence references, and evolving interpretation.",
    evidence: "Saved range and filters, linked evidence, notes, timeline, finding, and resolution.",
    href: "/investigation-cases",
    control: "Save investigation or Create a case",
    conclusion: "The case preserves a durable investigation record and links to source evidence.",
    nonConclusion: "The case copied source evidence or identified the human actor.",
  },
];

export const deterministicScenarios: ScenarioGuide[] = [
  {
    id: "success",
    name: "Successful structured output",
    expected:
      "The first provider attempt succeeds and the requested structured output is accepted.",
    evidence: "An attempt succeeds, validation is recorded, and the execution succeeds.",
    concept: "A policy can complete without retry, fallback, or rejection.",
    nextAction: "Inspect the normalized output, event timeline, and replay capability.",
  },
  {
    id: "retry",
    name: "Retry after rate limit",
    expected: "A rate-limited first attempt schedules a bounded retry that succeeds.",
    evidence: "A normalized rate-limit failure, retry.scheduled, a second attempt, and success.",
    concept: "Recorded retry recovery is different from first-attempt success.",
    nextAction: "Open playback, then compare with an immediate-fallback variation.",
  },
  {
    id: "fallback",
    name: "Fallback provider",
    expected: "The primary route fails and policy selects the configured fallback route.",
    evidence: "A normalized provider failure, fallback.selected, and a fallback attempt.",
    concept: "A degraded success can depend on a secondary route.",
    nextAction: "Inspect the fallback signal and investigate matching executions.",
  },
  {
    id: "structured-reject",
    name: "Structured-output rejection",
    expected: "Provider output arrives but fails the requested structured-output requirement.",
    evidence: "structured_output.rejected and a normalized validation failure.",
    concept: "Transport success does not guarantee acceptable structured output.",
    nextAction: "Inspect the normalized failure and its investigation signal.",
  },
  {
    id: "budget",
    name: "Latency-budget rejection",
    expected: "Recorded latency exceeds the configured budget and the execution is rejected.",
    evidence: "budget.exceeded for latency and the terminal normalized outcome.",
    concept: "A reliability policy can reject work that exceeds an explicit budget.",
    nextAction: "Inspect duration evidence and investigate latency-budget signals.",
  },
];

const glossaryEntries: Array<[string, string]> = [
  ["Execution", "One policy-driven request envelope and its complete recorded lifecycle."],
  ["Attempt", "One provider call within an execution; an execution may contain several attempts."],
  ["Reliability policy", "Bounded rules for attempts, backoff, fallback, and related controls."],
  [
    "Normalized failure",
    "A provider-specific problem represented in the product's shared taxonomy.",
  ],
  ["Degraded success", "A terminal result that succeeded through recovery such as fallback."],
  ["Append-only event", "Durable lifecycle evidence added in sequence rather than rewritten."],
  ["Live stream", "Delivery of newly persisted events to the current browser view."],
  [
    "Recorded playback",
    "Presentation of persisted event history; it does not rerun the execution.",
  ],
  ["Replay capability", "The current evidence-backed state that says whether replay is available."],
  [
    "Replay capsule",
    "Retained replay input protected and governed separately from display evidence.",
  ],
  ["Variation", "The bounded configuration change requested for a comparison execution."],
  ["Comparison dimension", "One named evidence category compared between original and variant."],
  [
    "Investigation signal",
    "A queryable condition derived from persisted attempts, events, or lineage.",
  ],
  ["Saved scope", "The exact UTC range and canonical filters preserved with an investigation."],
  [
    "Investigation case",
    "A durable question, saved scope, references, notes, and current conclusion.",
  ],
  [
    "Tenant routing context",
    "The tenant header used to isolate prototype data; not authenticated identity.",
  ],
];

export const glossary: GlossaryEntry[] = glossaryEntries.map(([term, description]) => ({
  term,
  description,
}));

export const honestLimitations = [
  "Reliability evidence does not establish factual answer quality.",
  "The product does not claim exactly-once provider effects.",
  "The tenant header is routing context, not authenticated identity.",
  "The prototype has no RBAC or database row-level security.",
  "Replay key handling does not constitute a production KMS claim.",
  "Provider observations are bounded evidence, not a universal provider-health ranking.",
  "Recorded playback changes presentation only; it does not rerun or mutate an execution.",
  "Replay depends on the execution's current replay capability and retained input.",
];
