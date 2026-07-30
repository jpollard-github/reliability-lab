import type { PageTour } from "./tour-state";

export const pageTours = {
  executions: {
    id: "executions",
    title: "Executions page tour",
    steps: [
      {
        anchor: "execution-summary",
        title: "Execution summary",
        body: "These are tenant-scoped execution outcomes from the current 24-hour summary.",
      },
      {
        anchor: "execution-scenario",
        title: "Deterministic scenario",
        body: "Choose one of five fake-provider scenarios to produce known reliability evidence.",
      },
      {
        anchor: "start-execution",
        title: "Start and watch",
        body: "This action creates a real local execution and opens its evidence as it arrives.",
      },
      {
        anchor: "recent-executions",
        title: "Recent executions",
        body: "Open any execution to inspect its envelope, attempts, events, and replay capability.",
      },
      {
        anchor: "workbench-entry",
        title: "Investigation entry",
        body: "Move from individual executions to bounded aggregate evidence in the Workbench.",
      },
    ],
  },
  executionDetail: {
    id: "execution-detail",
    title: "Execution detail tour",
    steps: [
      {
        anchor: "execution-envelope",
        title: "Envelope and status",
        body: "This identity and status belong to one policy-governed execution, not one attempt.",
      },
      {
        anchor: "replay-capability",
        title: "Replay capability",
        body: "Current capability determines whether replay and comparison controls are available.",
        optional: true,
      },
      {
        anchor: "live-machine",
        title: "Live machine",
        body: "The machine follows newly persisted events without treating the browser stream as the durable source of truth.",
      },
      {
        anchor: "playback-controls",
        title: "Playback controls",
        body: "Restart, play, step, change speed, or return to live edge. These controls change presentation only.",
      },
      {
        anchor: "machine-route",
        title: "Machine route",
        body: "The visible route is projected from append-only events and shows attempt and policy transitions actually recorded.",
      },
      {
        anchor: "normalized-outcome",
        title: "Normalized outcome",
        body: "Read shared outcome evidence here, including failures or degraded recovery, without inferring answer quality.",
      },
      {
        anchor: "investigation-signals",
        title: "Investigation signals",
        body: "These queryable signals are derived from persisted attempts, events, and replay lineage.",
      },
      {
        anchor: "case-linking",
        title: "Link evidence to a case",
        body: "A case stores a reference to this execution rather than copying its prompt, output, attempts, or events.",
        optional: true,
      },
    ],
  },
  comparisonDetail: {
    id: "comparison-detail",
    title: "Comparative Replay tour",
    steps: [
      {
        anchor: "comparison-configurations",
        title: "Original and variation",
        body: "The retained input stays fixed while the resolved variation changes bounded configuration.",
      },
      {
        anchor: "comparison-machines",
        title: "Side-by-side machines",
        body: "Each side is a normal execution envelope with its own recorded event route.",
      },
      {
        anchor: "comparison-dimensions",
        title: "Comparison dimensions",
        body: "Named dimensions describe evidence changes without collapsing them into one score.",
      },
      {
        anchor: "comparison-source-links",
        title: "Source evidence",
        body: "Open either source execution to inspect its full authoritative evidence.",
      },
      {
        anchor: "comparison-dimensions",
        title: "No universal winner",
        body: "Improvement in one dimension does not prove one configuration is universally better.",
      },
    ],
  },
  investigations: {
    id: "investigations",
    title: "Investigation Workbench tour",
    steps: [
      {
        anchor: "workbench-time-window",
        title: "Bounded time window",
        body: "Every aggregate and execution query is bounded by this resolved UTC range.",
      },
      {
        anchor: "workbench-summary",
        title: "Summary signals",
        body: "These are evidence-backed counts and rates that drill into the current scope.",
      },
      {
        anchor: "workbench-saved-scope",
        title: "Exact saved scope",
        body: "Saving preserves the resolved range and canonical filters, not a moving preset.",
      },
      {
        anchor: "workbench-trend",
        title: "Outcome trend",
        body: "Buckets show terminal outcomes observed inside the selected time window.",
      },
      {
        anchor: "workbench-provider-observations",
        title: "Provider/model observations",
        body: "Attempt-level observations include sample sizes and are not a provider ranking.",
      },
      {
        anchor: "workbench-filters",
        title: "Evidence filters",
        body: "Filter by recorded identity, route, outcome, failure, or derived signal.",
      },
      {
        anchor: "workbench-explorer",
        title: "Execution explorer",
        body: "Open matching executions while preserving the Workbench return context.",
      },
    ],
  },
  caseList: {
    id: "case-list",
    title: "Investigation cases tour",
    steps: [
      {
        anchor: "case-creation",
        title: "Create a case",
        body: "Start a durable reliability question with an exact saved range.",
      },
      {
        anchor: "case-filters",
        title: "Case filters",
        body: "Find cases by title or question, lifecycle status, and importance.",
      },
      {
        anchor: "case-list",
        title: "Saved cases",
        body: "Each row summarizes saved scope and linked evidence counts for one tenant-scoped case.",
      },
      {
        anchor: "case-list",
        title: "Archive status",
        body: "Archived is an explicit lifecycle status; it does not delete the investigation record.",
      },
    ],
  },
  caseDetail: {
    id: "case-detail",
    title: "Investigation case detail tour",
    steps: [
      {
        anchor: "case-saved-workbench",
        title: "Reopen saved scope",
        body: "Return to the exact range and canonical filters preserved with this case.",
      },
      {
        anchor: "case-overview",
        title: "Question and saved scope",
        body: "The overview pairs the reliability question with the fixed evidence boundary.",
      },
      {
        anchor: "case-experiment",
        title: "Run a controlled experiment",
        body: "Choose replay-capable execution evidence and one bounded variation. The tour never submits this form. A created comparison returns as case evidence, or exposes link-only recovery.",
      },
      {
        anchor: "case-review",
        title: "Evidence review and readiness",
        body: "Current authoritative summaries and explicit unavailable states support a deterministic completeness checklist. Ready does not mean correct.",
      },
      {
        anchor: "case-controls",
        title: "Current interpretation",
        body: "Finding and resolution may evolve, but both are required while the case remains resolved. Download the bounded review packet here.",
      },
      {
        anchor: "case-evidence",
        title: "Manage evidence references",
        body: "Add or remove authoritative links without deleting or copying their source evidence.",
      },
      {
        anchor: "case-notes",
        title: "Append-only notes",
        body: "Corrections are later notes. The prototype records time but cannot identify an actor.",
      },
      {
        anchor: "case-timeline",
        title: "Metadata timeline",
        body: "Lifecycle metadata records that changes occurred without duplicating operational prose.",
      },
    ],
  },
} satisfies Record<string, PageTour>;

export function resolveTourForPath(pathname: string): PageTour | undefined {
  if (pathname === "/") return pageTours.executions;
  if (/^\/executions\/[^/]+$/u.test(pathname)) return pageTours.executionDetail;
  if (/^\/comparisons\/[^/]+$/u.test(pathname)) return pageTours.comparisonDetail;
  if (pathname === "/investigations") return pageTours.investigations;
  if (pathname === "/investigation-cases") return pageTours.caseList;
  if (/^\/investigation-cases\/[^/]+$/u.test(pathname)) return pageTours.caseDetail;
  return undefined;
}
