# Reliability Lab: Operator Console Composition Basics

This document explains the third phase of the human-comprehension refactor in plain language.

## The goal in one sentence

**The web application should make it obvious where a page loads data, where URL state is interpreted, where client interaction lives, which component renders each visible feature, and which end-to-end test proves each operator workflow.**

Phase 1 organized contracts and core behavior.

Phase 2 organized PostgreSQL persistence and Fastify routes.

Phase 3 organizes:

```text
apps/web
apps/web/tests
```

The product should look and behave the same.

The code behind the screen should become easier to locate and explain.

---

## Where the web application fits

Reliability Lab’s layers now have distinct responsibilities:

```text
contracts:
  portable data shapes

core:
  domain decisions and ports

db:
  PostgreSQL adapters and read models

api:
  validated HTTP transport

worker:
  durable execution

web:
  operator workflow and presentation
```

The web application should not reimplement:

- retry policy;
- fallback policy;
- comparison semantics;
- investigation metrics;
- tenant authorization;
- replay encryption;
- durable execution.

It presents those capabilities and sends operator actions to the API.

---

## Next.js App Router mental model

The web application uses the Next.js App Router.

A route is represented by a folder under `app/`.

Examples:

```text
app/page.tsx
app/investigations/page.tsx
app/executions/[executionId]/page.tsx
app/comparisons/[experimentId]/page.tsx
app/investigation-cases/[caseId]/page.tsx
```

A page file is a route entrypoint.

A good page file should mainly:

1. interpret route parameters;
2. load the required server data;
3. compose named feature sections;
4. handle not-found behavior.

It should not contain the entire product screen, every formatting helper, every query-state rule, and every table row.

A useful rule:

> Page files are composition roots, not feature warehouses.

---

## Server Components

A component is a Server Component by default unless it begins with:

```ts
"use client";
```

Server Components are useful for:

- reading route parameters;
- calling the API from the server;
- rendering initial evidence;
- keeping browser JavaScript smaller;
- preventing server-only configuration from entering the client bundle.

Example:

```ts
export default async function ExecutionPage({ params }) {
  const execution = await getExecution((await params).executionId);

  return <ExecutionDetail execution={execution} />;
}
```

The page loads data.

A named component presents it.

---

## Client Components

A Client Component begins with:

```ts
"use client";
```

It may use:

- state;
- effects;
- browser events;
- `fetch` from the browser;
- `useRouter`;
- live event streams;
- playback controls;
- form submissions.

Examples in Reliability Lab include:

- starting an execution;
- following SSE;
- controlling playback;
- creating a comparison;
- deleting replay data;
- editing a saved case;
- adding notes or evidence.

Client Components should be focused interaction islands.

The entire page should not become client-rendered merely because one button mutates data.

---

## The server/client boundary

A healthy page may look like:

```text
Server page
  ├── server-rendered heading
  ├── server-rendered evidence summary
  ├── server-rendered table
  └── focused client control
        ├── local state
        ├── mutation request
        └── router refresh
```

The server owns initial reading.

The client owns immediate interaction.

This keeps concerns legible and avoids moving every API call into effects.

---

## What is a feature folder?

A feature folder groups code by product purpose.

A reasonable operator-console structure might include:

```text
features/
  executions/
  live-machine/
  comparisons/
  investigations/
  investigation-cases/
```

A feature folder may contain:

- presentation components;
- server data preparation;
- URL-state parsing;
- browser mutation helpers;
- pure view-model functions;
- focused unit tests.

It should not become a second monolith with a vague name such as:

```text
features/shared/
```

Shared code should be genuinely shared and named by purpose.

---

## Page composition versus feature implementation

Consider the Investigation Workbench.

The route entrypoint should read like a table of contents:

```tsx
export default async function InvestigationsPage({ searchParams }) {
  const model = await loadInvestigationWorkbench(searchParams);

  return (
    <>
      <InvestigationHeader model={model.header} />
      <TimeWindowToolbar model={model.timeWindow} />
      <ReliabilitySummaryCards model={model.summary} />
      <SaveInvestigationPanel model={model.saveCase} />
      <OutcomeTrend model={model.trend} />
      <ProviderObservations model={model.providers} />
      <ExecutionExplorer model={model.executions} />
    </>
  );
}
```

The current page contains all those responsibilities in one file.

Phase 3 gives each visible concept a name and a home.

---

## URL state is product state

The Investigation Workbench stores important state in the URL:

- time range;
- search prefix;
- status;
- provider;
- model;
- normalized error;
- derived signal;
- pagination cursor.

This is valuable because the view can be:

- bookmarked;
- refreshed;
- shared;
- saved into an investigation case;
- returned to from execution detail.

URL behavior is therefore a public product contract.

A refactor must preserve:

- parameter names;
- repeated or comma-separated values;
- defaults;
- custom ranges;
- filter links;
- return context;
- cursor behavior.

The parsing and canonicalization should live in named pure modules rather than being scattered through JSX.

---

## What is a page model?

A page model is a presentation-oriented structure prepared before rendering.

Example:

```ts
interface InvestigationWorkbenchModel {
  range: ResolvedRange;
  activeFilters: ActiveFilter[];
  summary: ReliabilitySummary;
  providers: ProviderObservationPage;
  executions: ExecutionSummaryPage;
  savedScope: SavedInvestigationScope;
  returnTo: string;
}
```

It is not a new domain model.

It helps separate:

```text
load and interpret data
        ↓
render the screen
```

Page models should not duplicate the API contracts without purpose.

They should prepare exactly what the view needs.

---

## Pure presentation components

A pure presentation component receives data and renders markup.

```tsx
function ReliabilityCard({ label, value, note, href }) {
  return (
    <Link href={href}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </Link>
  );
}
```

It should not:

- call the API;
- parse the current URL;
- calculate domain metrics;
- know about encryption;
- own unrelated mutation state.

Pure components are easier to:

- read;
- test;
- reuse;
- render on the server;
- verify for accessibility.

---

## Hooks and interaction controllers

A large Client Component often contains several hidden responsibilities:

```text
stream connection
event merge
reconnect
playback timing
playback controls
rendering
navigation refresh
```

A focused hook can name one behavior:

```ts
useExecutionEventStream(...)
useEventPlayback(...)
useCaseMutation(...)
```

The hook is useful when it owns a real state machine.

It should not be created merely to move lines out of a file.

The component should become easier to explain:

```text
hook owns live state
component renders live state
pure projection explains event meaning
```

---

## Live evidence and playback are different state machines

The Live Machine View has two related but distinct concerns.

### Live stream

- connecting;
- live;
- reconnecting;
- complete;
- failed;
- merging persisted events;
- maintaining the live edge.

### Recorded playback

- stopped;
- playing;
- paused;
- current step;
- presentation speed;
- restart;
- step;
- return to live edge.

Separating those concerns makes it easier to prove that presentation timing never pretends to be execution timing.

The existing pure event projection should remain authoritative.

---

## Browser API client versus server API client

Server code and client code call the same API under different constraints.

### Server API calls

May use:

- server-only tenant configuration;
- `cache: "no-store"`;
- direct typed reads;
- not-found handling.

### Browser API calls

May use only `NEXT_PUBLIC_` configuration and browser-safe values.

They handle:

- mutations;
- user-visible errors;
- busy state;
- router refresh or navigation.

Do not accidentally import server-only environment access into a Client Component.

A small, explicit split such as:

```text
lib/server-api/
lib/client-api/
```

may clarify the boundary if the final code justifies it.

Do not build a generic networking framework.

---

## Form state and domain state

A browser form often stores strings because HTML inputs produce strings.

Example:

```ts
interface ComparisonDraft {
  maxAttempts: string;
  jitterRatio: string;
  maxLatencyMs: string;
}
```

That is form state.

Before submission, it becomes a validated domain request:

```text
form strings
  ↓
parse and validate
  ↓
ReplayVariation
```

Separating draft parsing from JSX makes comparison behavior easier to test and explain.

Do not treat unparsed form strings as domain values.

---

## What is a visible feature component?

A visible feature component corresponds to something an operator can point at.

Examples:

- Reliability summary cards;
- Outcome trend;
- Provider observations;
- Execution filters;
- Execution explorer;
- Playback controls;
- Machine route;
- Comparison variation form;
- Comparison dimension table;
- Case overview;
- Case notes;
- Case evidence;
- Case timeline.

Those names make the source tree searchable by product language.

---

## CSS is part of comprehension

A 1,300-line global stylesheet can become a visual god file.

Its selectors may still be valid, but finding one feature’s styles becomes difficult.

A low-risk structural split can preserve every selector and declaration while grouping them by purpose:

```text
styles/
  tokens.css
  base.css
  shell.css
  forms.css
  tables.css
  execution.css
  comparison.css
  investigations.css
  investigation-cases.css
  responsive.css
```

Import order must preserve the existing cascade.

The refactor should not redesign the UI or rename classes merely to make the stylesheet fashionable.

The goal is:

> Find the styles by feature name.

---

## Accessibility is observable behavior

The UI already uses semantic headings, labels, tables, lists, buttons, and status text.

Those are part of the product contract.

A structural refactor must preserve:

- heading names;
- form labels;
- button names;
- link names;
- live-region behavior;
- dialog confirmation;
- keyboard access;
- table semantics;
- readable empty states;
- non-color status meaning.

Playwright locators based on roles and labels are useful evidence that the accessible interface remained stable.

Do not “fix” test selectors by replacing semantic locators with brittle CSS selectors.

---

## End-to-end tests are workflow documentation

A Playwright test should describe one operator journey.

Good workflow files include:

```text
execution-lifecycle.spec.ts
live-machine.spec.ts
comparative-replay.spec.ts
investigation-workbench.spec.ts
saved-investigation-cases.spec.ts
```

A single `dashboard.spec.ts` eventually becomes another god file.

Shared helpers may own:

- creating deterministic executions;
- waiting for terminal status;
- creating a comparison;
- seeding pagination;
- generating unique idempotency keys;
- draining durable work;
- stable time-range construction.

Tests should not depend on one another or leave hidden work that breaks later suites.

---

## Test fixtures versus test assertions

A helper prepares evidence:

```ts
const execution = await createRetryExecution(request);
await waitForExecution(request, execution.executionId, "succeeded");
```

The test asserts the operator behavior:

```ts
await page.goto("/investigations?signal=retry_recovered");
await expect(page.getByRole("link", { name: shortId })).toBeVisible();
```

When setup dominates the test body, the workflow becomes hard to see.

Good helpers reveal intent without hiding important assertions.

---

## Avoiding test-helper fog

A helper should have a domain name:

```text
createRetryExecution
createFallbackExecution
waitForExecution
createComparison
seedInvestigationCases
```

Avoid helpers such as:

```text
setupThing
doRequest
prepareData
commonTestUtils
```

A test should still explain what evidence it creates.

---

## Visual stability

A structural refactor should preserve:

- page hierarchy;
- visible text;
- controls;
- layout behavior;
- responsive behavior;
- styles;
- loading and empty states.

Useful verification includes:

- existing Playwright workflows;
- targeted desktop and mobile screenshots;
- browser console review;
- no hydration warnings;
- no failed requests;
- keyboard navigation through interactive controls.

Pixel-perfect snapshot testing is optional and can become brittle.

A focused visual pass is still important.

---

## What is a product tour?

A product tour is future operator guidance inside the application.

It should eventually explain:

```text
Create evidence
→ Watch the machine
→ Replay or compare
→ Investigate signals
→ Save a case
```

The tour is a product feature, not part of this structural refactor.

Phase 3 should make the UI structure ready for it by giving visible features stable names and components.

The roadmap should preserve a later movement:

> Product Tour and Operator Guidance

That movement may include:

- on-demand guided tour;
- contextual page help;
- “What does this do?” explanations;
- “How do I use this?” guidance;
- links to human and API documentation.

Do not build the tour during the comprehension pass.

---

## What should remain stable?

Phase 3 should not intentionally change:

- routes;
- API calls;
- query parameters;
- visible workflows;
- labels and headings;
- client/server behavior;
- live stream behavior;
- playback behavior;
- comparison variation behavior;
- case mutations;
- CSS appearance;
- accessibility;
- Playwright assertions;
- product semantics.

The source tree changes.

The operator experience remains the same.

---

## What should Phase 3 make easy to find?

After the refactor, these questions should have quick answers:

- Where is the Investigation Workbench range parsed?
- Where are active filters constructed?
- Where are reliability cards rendered?
- Where is the outcome trend rendered?
- Where is the provider table rendered?
- Where is the execution explorer rendered?
- Where is the exact saved scope prepared?
- Where does SSE browser state live?
- Where does playback state live?
- Where is the machine route rendered?
- Where is a comparison draft parsed?
- Where are comparison presets defined?
- Where is replay deletion handled?
- Where is a case note submitted?
- Where is case evidence rendered?
- Which Playwright file proves Comparative Replay?
- Which helper creates retry evidence?

The codebase tour should answer all of them.

## Implemented Phase 3 map

Phase 3 now uses the vocabulary described above:

```text
features/investigations/
  search-state.ts
  workbench-loader.ts
  reliability-summary-cards.tsx
  outcome-trend.tsx
  provider-observations.tsx
  execution-filters.tsx
  execution-explorer.tsx

features/live-machine/
  use-execution-stream.ts
  event-stream-state.ts
  use-event-playback.ts
  playback-controls.tsx
  machine-readout.tsx
  machine-route.tsx
  event-timeline.tsx

features/comparisons/
  comparison-draft.ts
  comparison-presets.ts
  comparison-builder.tsx

features/investigation-cases/
  case-mutations.ts
  case-controls.tsx
  case-evidence.tsx
  case-notes.tsx
  case-timeline.tsx
```

`app/globals.css` is now an ordered import map over feature-named style files. The former catch-all
Playwright file is now five workflow specs covering the same eight journeys. The detailed current
conventions are in [Operator Console Patterns](operator-console-patterns.md).

---

## Final mental model

The route page is the stage manager.

Feature components are the performers.

Hooks control interactive machinery.

The API client carries messages backstage.

CSS defines the set.

Playwright rehearses complete scenes.

```text
Page:
  assemble the scene

Feature:
  present one operator concept

Client controller:
  manage one interaction

Test:
  prove one workflow
```

Phase 3 labels the stage without rewriting the play.
