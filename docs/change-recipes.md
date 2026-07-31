# Reliability Lab Change Recipes

These recipes identify where representative changes belong. They are maintenance maps, not feature
requests; none of the examples is implemented by this document. Start with the primary owner, trace
adjacent boundaries, and preserve the stated invariant. The
[design-review walkthrough](design-review-walkthrough.md) explains why the boundaries exist.

## 1. Add an execution event

**Product intent.** Add one durable piece of execution evidence that helps an operator explain an
existing lifecycle decision.

- **Primary owner:** add a named payload, stored event, and union member in
  `packages/contracts/src/execution/events.ts`.
- **Adjacent modules:** record it at the actual decision point in
  `packages/core/src/execution/execution-runner.ts`, `execution-service.ts`, or a named collaborator.
  `ExecutionEventRecorder` remains the only generated-metadata owner. Update
  `apps/web/features/live-machine/execution-machine.ts` only if the event changes the visible
  machine.
- **Contract implications:** choose a stable discriminator and bounded operator-safe fields. Do not
  put generated metadata in the caller payload.
- **Persistence implications:** JSON event payload storage usually needs mapper/test updates but no
  migration. Confirm `toExecutionEventInsert` and hydration in
  `packages/db/src/execution/execution-row-mappers.ts`. A new column or index is a separate schema
  decision.
- **API implications:** persisted SSE transports the event through
  `apps/api/src/routes/execution-events.ts`; update explicit runtime/OpenAPI schemas if its public
  shape requires them.
- **Web implications:** decide whether raw timeline display is sufficient or whether
  `projectExecutionEvents` needs one evidence-grounded step.
- **Tests:** extend `packages/core/test/execution-events.test.ts`, the focused policy test that emits
  it, `packages/db/test/execution-repository.integration.test.ts` when mapping changes, SSE tests
  when transport semantics change, and a workflow spec only when an operator-visible workflow
  changes.
- **Documentation:** update `docs/execution-envelope.md`, relevant flow/ADR status, and the
  walkthrough if the event changes a guarantee.
- **Invariant:** events are append-only, ordered, versioned, tenant-bound through their execution,
  and free of prompt, credential, command, or replay-capsule content.
- **Avoid:** optional-field “mega-events,” fabricated UI events, or changing historical events in
  place.

## 2. Add a normalized failure category

**Product intent.** Give several provider-specific outcomes one stable operational meaning without
claiming more than the evidence proves.

- **Primary owner:** `ProviderErrorCategorySchema` and `ProviderError` in
  `packages/contracts/src/execution/status.ts`.
- **Adjacent modules:** provider normalization in `packages/providers/src/index.ts`; retry/fallback
  interpretation in `ExecutionRunner`; terminal projection in `ExecutionFailureRecorder`; query
  predicates in `packages/db/src/investigation/investigation-conditions.ts`.
- **Contract implications:** this changes portable error vocabulary and every exhaustive switch.
  Define the category independently from one provider's message or HTTP string.
- **Persistence implications:** errors are stored in execution/attempt JSON. Check mappers and
  investigation JSON predicates; add a migration only if the stored schema/index truly changes.
- **API implications:** contract reuse may propagate the category automatically, but Workbench
  query schemas, error filters, and OpenAPI must be reviewed.
- **Web implications:** update filter options and readable evidence labels only where the category
  is selectable or interpreted.
- **Tests:** provider mapping tests, retry/fallback unit tests, investigation projection tests,
  PostgreSQL investigation integration, API validation, and Workbench E2E if selectable.
- **Documentation:** update `docs/failure-model.md`, metric definitions, and any design-review claim
  using the category.
- **Invariant:** normalized failure describes observed operational evidence; it does not become a
  provider-health, capacity, or factual-quality claim.
- **Avoid:** leaking provider bodies, making unknown strings into categories, or silently changing
  retryability for existing categories.

## 3. Add a provider adapter

**Product intent.** Connect another provider-compatible execution edge while preserving one
provider-independent policy engine.

- **Primary owner:** implement `LlmProvider` beside the current adapters in
  `packages/providers/src/` (split the package by provider if growth makes the existing index
  incoherent).
- **Adjacent modules:** `MapProviderRegistry` in
  `packages/core/src/infrastructure/provider-registry.ts`; API and worker composition in
  `apps/api/src/server.ts` and `apps/worker/src/server.ts`; runtime configuration and
  `.env.example`.
- **Contract implications:** translate to/from existing `ProviderRequest`, `ProviderResponse`, and
  `ProviderError`. Do not export SDK-specific types through contracts or core.
- **Persistence implications:** normally none; attempts persist normalized provider/model/error
  evidence. A new secret or provider body must not become a row or audit field.
- **API implications:** no new route is normally required. Configuration readiness may need a safe
  state that reveals no key.
- **Web implications:** no hard-coded choice should be added unless the operator can actually
  configure and execute it; comparison presets require separate product intent.
- **Tests:** deterministic adapter tests with injected fetch/SDK behavior, normalization and abort
  tests, composition/config tests, and optional explicitly authorized live verification. Run E2E
  only if the established operator workflow changes.
- **Documentation:** configuration, supported subset, retention posture, and limitations.
- **Invariant:** core sees a bounded normalized provider result; credentials, raw request bodies,
  and SDK objects remain at the adapter boundary and out of logs/spans.
- **Avoid:** provider policy inside Fastify routes, provider-specific retry categories, real network
  calls in unit tests, or claiming universal compatibility.

## 4. Add a reliability-policy input

**Product intent.** Let callers control one bounded, explainable execution decision.

- **Primary owner:** `packages/contracts/src/execution/policy.ts` for policy/budget shape and
  `execution/create-execution.ts` for request validation.
- **Adjacent modules:** defaults in `prepareExecution`; enforcement and events in
  `ExecutionRunner` or a named policy collaborator; replay capsule shape; variation resolution and
  comparison projection.
- **Contract implications:** specify bounds, default, optional/null meaning, and whether the value
  belongs to policy, budget, provider configuration, or replay variation.
- **Persistence implications:** the execution envelope is persisted as JSON-backed policy/budget
  evidence. Review row mappers and whether old executions can be hydrated without the field.
- **API implications:** reuse the contract schema where possible; confirm failure-injection and
  transport-only schemas remain separate and OpenAPI is stable.
- **Web implications:** update `execution-form.tsx`, `comparison-draft.ts`,
  `comparison-presets.ts`, and detail/summary presentation only when the product exposes the input.
  HTML form strings must be parsed at the draft boundary.
- **Tests:** contract/API bounds, execution policy units, replay/variation tests, persistence
  integration if stored shape changes, draft parsing, and relevant execution/comparison workflows.
- **Documentation:** execution envelope, policy examples, change recipe implications, and the
  walkthrough if the guarantee changes.
- **Invariant:** omitted values resolve predictably; replay input stays fixed; policy decisions
  remain bounded and recorded as evidence.
- **Avoid:** browser-only fields, unbounded numeric input, ambiguous `null`, or a comparison control
  that core cannot resolve.

## 5. Add an Investigation Workbench filter

**Product intent.** Narrow a bounded evidence window by one stable, tenant-scoped semantic
criterion.

- **Primary owner:** query shape in `packages/contracts/src/investigation/workbench.ts`.
- **Adjacent modules:** `apps/api/src/schemas/investigations.ts` and
  `http/query-values.ts`; memory parity in `MemoryInvestigationReadRepository`; PostgreSQL
  predicates in `investigation-conditions.ts` and `execution-search-query.ts`; saved scope in
  `packages/contracts/src/investigation/cases.ts` and core `saved-scope.ts`; web URL behavior in
  `features/investigations/search-state.ts`.
- **Contract implications:** define scalar versus repeated values, bounds, canonical ordering, and
  cursor interaction. Decide explicitly whether the filter belongs in saved scope.
- **Persistence implications:** keep tenant and `[from,to)` predicates in every SQL path. Add an
  index only with query evidence; do not fall back to envelope hydration.
- **API implications:** preserve comma/repeated query normalization and exact paired ranges. Cursor
  totals must still represent all selected records, not only the remaining page.
- **Web implications:** add the control in `execution-filters.tsx`, active-filter description,
  add/remove/drill-down links, pagination preservation, return context, and saved-scope conversion.
- **Tests:** core/memory filter and cursor tests, query-value/API validation, PostgreSQL fixed-query
  integration, `search-state.test.ts`, and the Workbench Playwright workflow.
- **Documentation:** Workbench basics, operator-console patterns, system flow, and saved-scope
  semantics.
- **Invariant:** scope is tenant-bound, half-open and bounded; URL state round-trips; removing a
  filter removes the cursor; saved cases contain exact semantic scope, not presentation state.
- **Avoid:** client-side filtering of a server page, moving presets in saved scope, or an unbounded
  query.

## 6. Add an investigation signal

**Product intent.** Name one evidence-grounded execution condition that supports aggregate
drill-down.

- **Primary owner:** signal contract in `packages/contracts/src/investigation/workbench.ts` and
  storage-independent semantics in `packages/core/src/investigation/signals.ts`.
- **Adjacent modules:** memory summary/search, PostgreSQL event predicates in
  `investigation-conditions.ts`, aggregate/trend query in `reliability-summary-query.ts`, execution
  search, Workbench summary cards and filter links.
- **Contract implications:** define the signal precisely, including terminal/in-flight treatment
  and unavailable evidence. Add it to saved scope only if reopening must preserve it.
- **Persistence implications:** use explicit event or normalized evidence predicates under tenant
  and range bounds. Keep aggregate and drill-down semantics identical.
- **API implications:** extend validated signal query/response shapes and preserve fixed statement
  counts.
- **Web implications:** add readable non-color text, a drill-down link, exact URL reconstruction,
  and an honest empty state.
- **Tests:** core signal semantics, memory/PostgreSQL parity, fixed-query integration, API query
  validation, URL state, and Workbench E2E.
- **Documentation:** metric definition, limitations, Workbench guide, and architecture when the
  signal could be mistaken for a service guarantee.
- **Invariant:** an aggregate card and its execution drill-down identify the same evidence;
  incomplete samples and missing values do not become zero.
- **Avoid:** composite scores, provider rankings, inferred causal claims, or signals derived only in
  the UI.

## 7. Add a saved-case evidence type

**Product intent.** Let a case reference another authoritative, tenant-owned evidence source without
copying its sensitive body.

- **Primary owner:** evidence input/stored unions in
  `packages/contracts/src/investigation/cases.ts`.
- **Adjacent modules:** identity, validation, and internal URL mapping in
  `packages/core/src/investigation-cases/evidence.ts`; ownership validation in
  `InvestigationCaseService`; repository port; DB schema/mapper/transactions; API schema; case
  controls and `CaseEvidence`.
- **Contract implications:** define a discriminated shape and canonical identity. Do not accept an
  arbitrary URL.
- **Persistence implications:** inspect `schema/investigation-cases.ts`. A new identity column or
  constraint requires an explicit migration and integration test; JSON stuffing is not a shortcut.
  Add/remove lifecycle metadata must remain non-sensitive.
- **API implications:** extend `InvestigationCaseEvidenceInputSchema`, transport params only if
  necessary, domain-error mapping, and OpenAPI/injection tests.
- **Web implications:** add form parsing, readable linked evidence, internal navigation, and remove
  behavior without copying the source record.
- **Tests:** service ownership/idempotency/removal tests, mapper/transaction integration,
  cross-tenant API rejection, and saved-case Playwright workflow.
- **Documentation:** ADR 0009 current status if the decision materially changes, security/retention,
  case basics, codebase tour, and walkthrough.
- **Invariant:** the source API remains authoritative; evidence identity is tenant-validated;
  removal deletes only the association; no prompt/output/capsule/command/credential body is copied.
- **Avoid:** external URLs, attachments, shadow envelopes, fabricated authors, or a migrationless
  schema change.

## 8. Add an API read endpoint

**Product intent.** Expose one bounded, tenant-scoped read that the product actually needs.

- **Primary owner:** a feature route plugin under `apps/api/src/routes/` with transport schemas under
  `apps/api/src/schemas/`.
- **Adjacent modules:** a core read port/service when domain semantics are required, a memory
  adapter for infrastructure-free parity, a PostgreSQL purpose-named query module, `AppOptions`,
  `app.ts` registration, and `server.ts` composition.
- **Contract implications:** portable result shapes belong in contracts; Fastify-only headers,
  params, query wrappers, links, and error bodies stay in the API.
- **Persistence implications:** define tenant/range/limit/cursor predicates and query counts.
  Hydrate full envelopes only when detail semantics require them.
- **API implications:** TypeBox runtime validation, explicit response codes, safe error mapping,
  security declaration, OpenAPI comparison, and redacted logging.
- **Web implications:** server reads use `apps/web/lib/server-api.ts`; browser calls use
  `client-api.ts` only when interaction truly occurs in the browser.
- **Tests:** core read semantics, PostgreSQL integration, focused API injection including
  cross-tenant/bounds/not-found behavior, OpenAPI compatibility, and E2E only for a changed operator
  workflow.
- **Documentation:** README API surface when public, codebase tour, system flow, and architecture
  trust/read boundaries.
- **Invariant:** the route is thin; domain policy stays out of Fastify; SQL stays out of routes;
  responses do not expose secrets or unbounded data accidentally.
- **Avoid:** adding behavior to `app.ts`, inventing a generic repository query, or using the
  compatibility execution list for analytics.

## 9. Add an operator-console section

**Product intent.** Present one existing evidence or mutation capability at the point an operator
needs it.

- **Primary owner:** the operator-named folder under `apps/web/features/`; the route `page.tsx`
  remains composition.
- **Adjacent modules:** `lib/server-api.ts` for initial server reads, `lib/client-api.ts` plus a
  feature-specific helper for browser mutation, nearby route page, feature stylesheet, and workflow
  spec.
- **Contract implications:** consume existing portable contracts. A missing contract or API is a
  separate cross-layer product change, not a UI shortcut.
- **Persistence implications:** none directly. The UI must not infer stored truth or copy sensitive
  evidence into browser-only state.
- **API implications:** preserve server/browser runtime and configuration boundaries; use
  authoritative route responses and safe errors.
- **Web implications:** default to a Server Component. Introduce the smallest Client Component for
  interaction, keep URL-backed state shareable when it defines scope, and preserve semantic
  headings, labels, links, status text, empty/error states, and responsive local table scrolling.
- **Tests:** unit-test pure URL/draft/projection logic, update the relevant Playwright workflow, and
  run browser console/network and narrow/desktop visual checks.
- **Documentation:** operator-console patterns, codebase tour, and workflow docs when ownership or
  behavior changes.
- **Invariant:** server-only configuration never enters the client graph; presentation is grounded
  in API evidence; accessibility labels and established URLs are compatibility contracts.
- **Avoid:** turning the whole page into a Client Component, adding a global state framework, or
  placing feature behavior in `app/page.tsx`.

## 10. Add a Playwright workflow

**Product intent.** Prove one distinct operator outcome across the real browser/API/worker/database
boundary.

- **Primary owner:** a workflow-named `apps/web/tests/*.spec.ts` file.
- **Adjacent modules:** domain-named support under `apps/web/tests/support/`, Playwright server
  configuration, and the feature code being exercised.
- **Contract implications:** tests should use public API/visible UI contracts rather than private
  database setup wherever practical.
- **Persistence implications:** seed the minimum bounded evidence and await worker-produced terminal
  state before dependent assertions.
- **API implications:** give every API-created execution a unique idempotency key; assert status and
  response shape where setup correctness matters.
- **Web implications:** locate controls by role, accessible name, label, heading, link, and visible
  evidence—not CSS implementation classes.
- **Tests:** keep assertions in the spec; helpers may create/drain evidence but should not hide the
  workflow's meaning. Run the new spec alone, then all E2E tests concurrently.
- **Documentation:** update the workflow inventory and the recipe/walkthrough only when a new
  product journey becomes established.
- **Invariant:** tests are order-independent, bounded, tenant-scoped, and leave no running jobs that
  can affect another worker test.
- **Avoid:** a new catch-all dashboard spec, fixed shared idempotency keys, arbitrary sleeps,
  unbounded pagination seeds, or helpers that contain the assertions.

## 11. Add or revise operator guidance

**Product intent.** Help an operator interpret one established product concept without inventing a
new capability or mutating the evidence being explained.

- **Primary owner:** plain Guide or tour data under `apps/web/features/guidance/`; the established
  product component owns its semantic `data-guide-anchor`.
- **Adjacent modules:** `guide-page.tsx` for Guide presentation, `concept-help.tsx` for native
  disclosure structure, `tour-launcher.tsx` for browser interaction, `guidance.css` for feature
  styling, and the relevant route composition.
- **Contract implications:** none. Guidance describes existing contracts and must not introduce a
  parallel data shape that claims authority over product evidence.
- **Persistence and API implications:** none. Tours are stateless and on demand; static guidance
  requires no API request.
- **Web implications:** keep Guide content server-rendered, step content plain and reviewable, and
  the controller a focused Client Component. Use one stable semantic anchor per concept.
- **Tests:** update canonical-content or tour-state unit tests and
  `apps/web/tests/operator-guidance.spec.ts`; verify required and optional absence, keyboard focus,
  reduced motion, desktop, and 390 px behavior.
- **Documentation:** update `product-tour-and-operator-guidance.md`, the codebase find-it drill, and
  roadmap wording only when established versus future capability changes.
- **Invariant:** a tour never auto-launches, changes navigation, submits a form, stores evidence, or
  claims more than the underlying interface proves.
- **Avoid:** arbitrary HTML in registry data, text/nesting selectors, a third-party tour runtime,
  fake tour evidence, persistent completion state, or converting a route wholesale to client
  rendering.

See [Product Tour and Operator Guidance](product-tour-and-operator-guidance.md) for the step-level
procedure.

## 12. Revise evidence-backed case conclusions

**Product intent.** Change how a saved case derives current, bounded evidence or communicates
workflow readiness without creating a copied evidence store or a correctness score.

- **Primary owners:** review schemas in `packages/contracts/src/investigation/case-review.ts`;
  evidence resolution and readiness in
  `packages/core/src/investigation-cases/case-review-service.ts`; packet rendering in
  `review-packet.ts`.
- **Adjacent modules:** the existing execution/replay/comparison/investigation repository ports,
  `InvestigationCaseService.update` for the resolved invariant, case routes, server/browser API
  clients, and the named case review/readiness components.
- **Contract implications:** keep every evidence item tied to its link identity and model
  unavailability explicitly. Add no raw prompt, output, command, capsule, note body, credential, or
  provider payload.
- **Persistence implications:** none for a projection-only change. A new authoritative evidence
  source must first receive a tenant-scoped owner and integration coverage; do not persist derived
  review copies.
- **API implications:** JSON and Markdown routes must use the same review projection. Preserve
  tenant-scoped not-found behavior, bounded response schemas, metadata-only logs, safe content
  disposition, and escaped deterministic Markdown.
- **Web implications:** initial review/readiness stays server-rendered and useful without
  JavaScript. Packet download is the focused tenant-aware client action.
- **Tests:** cover every evidence type, ordering, unavailable states, sensitive-field exclusion,
  readiness transitions, historical inconsistent rows, cross-tenant reads, packet determinism,
  no-JavaScript rendering, and narrow-screen overflow.
- **Documentation:** update the evidence-backed conclusion basics, ADR if the durable decision
  changes, system flow, design review, operator pattern, product tour, and codebase find-it drill.
- **Invariant:** `resolved` requires non-empty finding and resolution. Readiness reports workflow
  completeness only and never proves factual correctness, causation, or universal provider health.
- **Avoid:** copied envelopes, AI-written findings, a numeric score, silently dropping unavailable
  links, public-safe packet claims, or resolving a blank conclusion.

## 13. Change a case-driven policy experiment

**Product intent.** Change how a saved case selects linked execution evidence, creates one ordinary
controlled comparison, or recovers its separate evidence link without inventing a second
comparison system.

- **Primary owners:** request/result schemas in
  `packages/contracts/src/investigation/case-experiments.ts`; coordination in
  `packages/core/src/investigation-cases/case-experiment-service.ts`; case route in
  `apps/api/src/routes/investigation-cases.ts`.
- **Adjacent modules:** `ExecutionService.createComparison`, `InvestigationCaseService.addEvidence`,
  `comparison-link-recovery.ts`, the case repository event boundary, shared comparison
  draft/preset/field components, and derived case review.
- **Contract implications:** accept the persisted execution evidence ID and bounded
  `ReplayVariation`. Keep successful link and created-but-unlinked results distinct. Responses may
  expose safe internal identifiers and links, never retained input or provider content.
- **Persistence implications:** use `ComparisonExperiment` as the authoritative experiment and the
  case evidence row as the association. Add no experiment-suite table or copied result. Keep
  timeline payloads metadata-only and backward-readable. Persist explicit recovery completion in
  the same transaction as a new evidence link, and handle an already-linked completion idempotently.
- **API implications:** preserve tenant-scoped missing behavior and delegate replay eligibility and
  comparison semantics to the ordinary service. A created-but-unlinked result must retain the
  experiment ID and link-only recovery action rather than becoming a generic 500.
- **Web implications:** eligibility and pending recovery remain server-rendered from case review. Reuse
  `ComparisonDraft`, presets, and `ComparisonVariationFields`. Disable repeat submission while
  active and after a result; recovery links the existing comparison and never resubmits it.
- **Tests:** cover same-case/type/tenant eligibility, unavailable/missing comparisons, automatic
  link, repeated failure dedupe, reload/re-instantiation, idempotent recovery without a second
  experiment, post-removal non-resurrection, safe diagnostics/timeline, API links,
  server-rendered no-JavaScript content, busy state, desktop/390 px fit, and packet appearance and
  removal.
- **Documentation:** update the case experiment basics, ADR 0011 for orchestration decisions, ADR
  0012 for durable recovery decisions, system flow, architecture, operator patterns, Guide/tour,
  roadmap, and codebase find-it drill.
- **Invariant:** retained input stays fixed; ordinary comparison semantics keep one owner; a valid
  comparison survives a separate case-link failure.
- **Avoid:** free execution IDs, endpoint-to-endpoint core calls, copied envelopes, batch campaigns,
  broad idempotency, automatic recommendations, winners, scores, conclusions, or claims of atomic
  create-and-link persistence.

## Verification chooser

| Change boundary                            | Minimum focused evidence before broader verification     |
| ------------------------------------------ | -------------------------------------------------------- |
| Pure type/projection/parser                | Focused unit tests, typecheck, structure/docs audit      |
| Provider adapter                           | Adapter/config tests; optional authorized live check     |
| PostgreSQL mapper/query/transaction/crypto | Focused integration test plus unit/type checks           |
| Fastify route/schema/error mapping         | Focused API injection and OpenAPI comparison             |
| Browser URL/draft/controller               | Focused unit plus relevant Playwright workflow           |
| Cross-process execution/lease/SSE          | Unit, integration, and E2E                               |
| Documentation/ownership map                | `pnpm audit:docs`, link/path/symbol drill, `pnpm verify` |

Every completed change still receives the repository-appropriate final checks from `AGENTS.md`.
Architecture changes also update this recipe map so the next maintainer does not follow a stale
path.

## 14. Change provider capability or live execution behavior

**Product intent.** Change one safe configured-provider fact or one bounded external execution
behavior without exposing configuration or creating a second execution engine.

- **Primary owners:** portable projection in
  `packages/contracts/src/provider/capabilities.ts`; construction in
  `packages/providers/src/provider-runtime.ts`; live wire behavior in
  `openai-compatible-http-provider.ts`; core bounds in
  `packages/core/src/execution/live-provider-request.ts`.
- **Adjacent modules:** `apps/api/src/routes/providers.ts`, execution submission, API/worker
  composition, `apps/web/lib/server-api.ts`, `LiveExecutionForm`, Guide/tour terminology, and the
  local/external proof scripts.
- **Contract implications:** expose only provider ID, deterministic/live kind, safe model label,
  transport family, configured/failure-injection/operator flags, and a fixed safe unavailable
  reason. Never add endpoint, key, query, header, raw config, body, or health claims.
- **Runtime implications:** API and worker must use the same construction owner. Live model
  identity and bounded input/schema/policy/budget stay server enforced. Failure injection must stop
  before fetch. Root web/API/worker development and the explicit live verifier inherit one
  repository-local environment through `scripts/register-local-environment.mjs`; exported values
  win and production package entrypoints remain injection-only.
- **Retention implications:** Timeline playback uses recorded events only. Replay remains a new
  execution gated by separately configured retained input; do not enable retention to make the
  live form work.
- **Tests:** injected-fetch adapter cases, capability/config redaction, API/OpenAPI validation,
  core request bounds, one built loopback wire drill, and loopback-only Playwright/no-JavaScript
  coverage. Normal verification must make no paid request.
- **External proof:** keep `pnpm verify:live-provider` explicitly opt-in, one request, one attempt,
  bounded, non-sensitive, and safe-output-only. Only normalized `succeeded` exits zero; missing
  requested configuration, non-success terminal state, timeout, or malformed evidence exits
  nonzero.
- **Documentation:** Live Provider Proof basics, ADR 0013 if the transport decision changes,
  architecture, flows, codebase tour, Guide/tours, security, README, and roadmap.
- **Avoid:** browser provider config, selectable arbitrary live models, raw error bodies, health
  inference from configuration, automatic external calls, hidden Responses/Chat Completions
  switching, or test retries that multiply cost.
