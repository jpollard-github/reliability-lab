# Operator Console Patterns

This guide maps the implemented Next.js operator console to the source modules that own each
behavior. The console remains a server-rendered App Router application with focused client
interaction islands; it is not a client-side SPA.

## App Router pages

Route entrypoints stay under `apps/web/app`:

```text
app/page.tsx
app/investigations/page.tsx
app/executions/[executionId]/page.tsx
app/comparisons/[experimentId]/page.tsx
app/investigation-cases/page.tsx
app/investigation-cases/[caseId]/page.tsx
app/guide/page.tsx
```

Pages await Next.js route/search parameters, call server reads or a named loader, handle
`notFound()`, and compose visible feature sections. The Investigation Workbench page is the clearest
example: it loads one `InvestigationWorkbenchModel` and renders the header, time window, summary
cards, save panel, trend, provider observations, and execution explorer in screen order.

All established `dynamic = "force-dynamic"` declarations remain on routes that read current
evidence.

## Server and Client Components

Components are Server Components unless they begin with `"use client"`.

Server Components own initial reads and evidence presentation. Examples include:

- Workbench summary/trend/provider/execution sections;
- execution and comparison detail evidence;
- saved-case list, overview, derived evidence review, readiness, notes, and timeline;
- Guide content and native contextual disclosures.

Client Components are focused mutation or live-interaction islands:

- `features/executions/execution-form.tsx`;
- `features/executions/replay-controls.tsx`;
- `features/live-machine/live-execution-view.tsx` and its controllers;
- `features/comparisons/comparison-builder.tsx`;
- saved-case creation, add-to-case, controls, evidence removal, and review-packet download;
- `features/guidance/page-tour.tsx` and `tour-launcher.tsx`.

Client modules never import `lib/server-api.ts` or the server-only Workbench loader. The structural
audit enforces that obvious boundary.

## Feature folders

The source tree uses operator language:

```text
features/
  executions/
  live-machine/
  comparisons/
  investigations/
  investigation-cases/
  guidance/
```

`components/status-badge.tsx` remains shared because status is a stable cross-feature visual
concept. Other components stay with the workflow that owns them.

## Workbench page model and loader

`features/investigations/workbench-loader.ts` owns `loadInvestigationWorkbench`. It:

1. resolves URL-backed state with `search-state.ts`;
2. constructs bounded API parameters;
3. starts summary, provider, and execution reads together with `Promise.all`;
4. prepares the exact return URL and canonical saved scope;
5. returns a presentation-oriented `InvestigationWorkbenchModel`.

The loader imports Next's `server-only` marker and never exposes server tenant configuration to
browser code. The marker is a development/build-time boundary dependency; it does not add a browser
runtime capability. Fetch caching and error propagation remain unchanged.

## URL-backed investigation state

`features/investigations/search-state.ts` is the pure source of truth for web URL behavior:

- raw `SearchParams` conversion;
- `1h`, `24h`, `7d`, and `30d` preset resolution;
- exact custom ranges;
- execution/provider API query reconstruction;
- drill-down, route, filter-removal, and pagination links;
- active-filter descriptions;
- execution-detail return context;
- saved-scope preparation;
- optional active provider evidence.

It prepares UI state and then uses the established saved-scope contract shape. Core remains the
authority that canonicalizes saved scope at the service boundary. Focused unit tests use a fixed
clock and cover defaults, exact ranges, repeated filters, canonical values, and cursor removal.

## Live stream controller

`features/live-machine/use-execution-stream.ts` owns the browser SSE lifecycle:

- connecting, live, reconnecting, complete, and failed states;
- the sequence cursor;
- streamed frame parsing;
- persisted snapshot refresh;
- duplicate-free event merging;
- reconnect delay;
- terminal close and cleanup.

The browser keeps fetch streaming because tenant routing uses a request header, which native
`EventSource` cannot attach. The endpoint and SSE semantics are unchanged.

`event-stream-state.ts` contains pure frame parsing, event validation, and event merge behavior.
`execution-machine.ts` remains the pure projection from persisted events to operator-readable
machine steps.

## Playback controller

`features/live-machine/use-event-playback.ts` owns recorded presentation state:

- active versus live edge;
- playing and paused;
- current visible event count;
- speed;
- restart, toggle, step, advance, and return-to-live actions.

Its reducer has focused unit tests. Playback's 650 ms presentation interval is deliberately separate
from the real `occurredAt` timestamps and actual elapsed evidence.

Presentation is split into `playback-controls.tsx`, `machine-readout.tsx`, `machine-route.tsx`, and
`event-timeline.tsx`. No component invents events or alters execution timing.

## Browser versus server API calls

`lib/server-api.ts` imports the `server-only` marker. It owns current server reads, server tenant
configuration, `cache: "no-store"`, and established not-found behavior. Importing it from a Client
Component is a trust-boundary error, not merely a bundling preference.

`lib/client-api.ts` exposes only browser-safe `NEXT_PUBLIC_` configuration, tenant headers, JSON
requests, and safe error extraction. Feature-specific mutation names remain in their feature:

- replay and deletion in `features/executions/replay-controls.tsx`;
- comparison submission in `features/comparisons/comparison-builder.tsx`;
- saved-case requests and tenant-aware packet download in
  `features/investigation-cases/case-mutations.ts`.

There is no generated SDK or generic application data framework.

## Comparison form drafts

HTML controls produce strings. `features/comparisons/comparison-draft.ts` names that form state as
`ComparisonDraft` and converts it to `ReplayVariation` only at submission.

It preserves blank-value inheritance, numeric conversion, explicit `null` fallback removal, and the
explicit reproducibility flag. `comparison-presets.ts` owns the five established preset names and
values. Focused tests cover empty, same-condition, immediate-fallback, patient-retry, and fallback
removal behavior.

Comparison detail presentation is split into configuration cards, side-by-side machines, and the
dimension summary without changing projection semantics.

`comparison-variation-fields.tsx` is the shared bounded editor used by both execution-detail and
case-driven comparison forms. It receives a safe baseline plus `ComparisonDraft`; it does not fetch
an execution or inspect retained input. Preset ownership remains in `comparison-presets.ts`, so
blank inheritance, explicit fallback removal, and numeric conversion cannot diverge by route.

## Saved investigation cases

The saved-case feature separates:

- list state and pagination: `case-list-state.ts`;
- list presentation: `case-list.tsx`;
- creation: `create-case-form.tsx`;
- existing-case linking: `add-to-case.tsx`;
- current controls: `case-controls.tsx`;
- typed browser requests: `case-mutations.ts`;
- linked evidence: `case-evidence.tsx`;
- bounded current evidence summaries: `case-evidence-review.tsx`;
- five fixed conclusion checks: `conclusion-readiness.tsx`;
- overview/scope: `case-overview.tsx`;
- notes: `case-notes.tsx`;
- metadata timeline: `case-timeline.tsx`.

The case detail route obtains both detail and derived review through `lib/server-api.ts`, so evidence
review and readiness are useful in the first HTML response and with JavaScript disabled. The
review-packet button is a focused client action because browsers must receive and save the Markdown
body. Notes remain append-only, source evidence remains authoritative, unavailable links remain
visible, and no actor identity or correctness score is fabricated.

## Case-driven policy experiments

`case-policy-experiments.tsx` is a Server Component. It derives linked execution candidates and
current replay eligibility from `InvestigationCaseReview`, so the explanation, unavailable state,
and existing comparison evidence remain useful without JavaScript.

`case-experiment-form.tsx` is the focused Client Component. It receives only safe candidate
identity and baseline policy/budget fields, reuses the shared variation editor, and posts one
evidence ID plus `ReplayVariation`. A ref-backed in-flight guard and disabled result state prevent
ordinary duplicate clicks. They do not establish cross-client or transport idempotency.

The client displays the ordinary comparison link for both orchestration results. If automatic case
linking fails, its only recovery action calls `addInvestigationCaseEvidence` with the existing
experiment ID. It never repeats comparison creation. A router refresh brings the linked comparison
through the normal server review and packet path.

## Operator guidance

`features/guidance/guide-content.ts` owns reviewable product workflow, deterministic scenario,
glossary, and limitation data. `guide-page.tsx` renders it on the server. `ConceptHelp` is a native
disclosure that route pages compose at established concept boundaries.

`tour-registry.ts` contains six plain route-specific tours. `PageTour` resolves the current route;
`TourLauncher` is the focused client controller; and `tour-state.ts` owns pure preparation and
navigation rules. Semantic `data-guide-anchor` values live on the product sections they name.
Optional missing anchors are skipped and reported; required missing anchors stop the tour. Tours
never auto-launch, persist state, call an API, navigate, or mutate product state.

## CSS organization

`app/globals.css` is an ordered import map:

```text
tokens.css
base.css
shell.css
forms.css
tables.css
executions.css
comparisons.css
live-machine.css
investigations.css
investigation-cases.css
guidance.css
responsive.css
```

Feature CSS stays in this stable cascade order. `guidance.css` owns only the Guide, contextual help,
tour panel, active target, narrow-screen guidance, and reduced-motion rules.

## Workflow-test organization

The eight established product workflows and the focused guidance workflow live in:

```text
tests/execution-lifecycle.spec.ts
tests/live-machine.spec.ts
tests/comparative-replay.spec.ts
tests/investigation-workbench.spec.ts
tests/saved-investigation-cases.spec.ts
tests/case-driven-policy-experiments.spec.ts
tests/operator-guidance.spec.ts
```

Support modules use domain names: `createExecution`, `createRetryExecution`,
`createFallbackExecution`, `waitForExecution`, `createComparison`, `seedExecutions`, `seedCases`,
and `resolvedTestRange`.

Every API-created execution receives a unique idempotency key. Tests explicitly await terminal
worker evidence when later assertions depend on it, and pagination seeding is bounded. Workflow
assertions remain in the spec files.

## Accessibility conventions

Visible labels are compatibility contracts. Preserve:

- heading text and hierarchy;
- explicit form labels;
- role/name-based buttons and links;
- table headers and row semantics;
- ordered lists for event, note, and timeline evidence;
- `aria-live` stream and mutation messages;
- non-color status text;
- the native confirmation dialog for replay deletion;
- readable empty and error states.

Playwright continues to locate the interface by these semantics rather than implementation classes.

Representative UI modifications are mapped in
[Change recipes](change-recipes.md#9-add-an-operator-console-section) and
[the Playwright workflow recipe](change-recipes.md#10-add-a-playwright-workflow).
