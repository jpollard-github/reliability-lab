# Reliability Lab: Product Tour and Operator Guidance Basics

> Established: the repository and product now teach operators how to use Reliability Lab without
> requiring source-code context. This document preserves the product rationale and acceptance
> boundary; `product-tour-and-operator-guidance.md` maps the implementation.

## Why this is the right next step

Reliability Lab already has enough connected product surface to teach a coherent workflow:

```text
Execute
  ↓
Explain
  ↓
Watch
  ↓
Replay
  ↓
Compare
  ↓
Investigate
  ↓
Preserve
```

The underlying capabilities are established:

- deterministic executions;
- normalized failure evidence;
- persisted event streaming;
- Timeline playback;
- encrypted replay capability;
- controlled comparison;
- bounded investigation;
- saved investigation cases.

Adding more machinery before checking whether a new operator can understand those capabilities would increase the product’s surface faster than its usability.

Product Tour and Operator Guidance is therefore not decorative polish.

It is an established Horizon 5 product movement that tests whether the existing system communicates
its value.

---

## The operator’s first questions

A new operator should be able to answer:

1. What is Reliability Lab?
2. What does “reliability” mean here?
3. What is an execution?
4. What is an attempt?
5. What evidence does the system record?
6. What is live, and what is Timeline playback?
7. When is replay available?
8. What changes during Comparative Replay?
9. What do Workbench signals mean?
10. Why would I save an investigation case?
11. What can the prototype prove?
12. What can it not prove?

The interface should answer those questions in the language of the product.

---

## The product promise

A useful concise explanation is:

> Reliability Lab is a flight recorder and wind tunnel for LLM calls. It records what happened, explains retry and fallback decisions, replays retained input under controlled conditions, compares evidence, and preserves investigations without pretending to judge factual answer quality.

That statement should be available in the product, not only in repository documentation.

---

## Guidance layers

Operator guidance should have three layers.

### 1. A Guide page

A dedicated `/guide` page should explain the complete workflow.

It should include:

- the product promise;
- the seven-stage operator loop;
- a glossary;
- deterministic scenarios already available in the development console;
- what evidence to inspect at each stage;
- honest prototype limitations;
- direct links into the existing console.

The Guide page is the stable home for operator education.

### 2. Contextual help

Important screens should provide short explanations near the concept being used.

Examples:

- execution versus attempt;
- normalized failure;
- degraded success;
- live evidence versus playback;
- replay capability;
- comparison dimensions;
- bounded Workbench signals;
- saved scope;
- case evidence versus copied evidence.

Contextual help should answer:

```text
What is this?
Why does it matter?
What should I look for?
```

It should not reproduce the entire Guide page.

### 3. On-demand page tours

An operator should be able to choose “Tour this page.”

The tour should:

- never start automatically;
- use the current page and current evidence;
- move through stable, named anchors;
- explain one visible concept per step;
- scroll the relevant element into view;
- highlight it without changing product state;
- allow Back, Next, Exit, and Restart;
- skip an unavailable optional anchor honestly;
- work with keyboard and screen-reader navigation;
- respect reduced-motion preferences.

A tour is a guided reading of the real interface, not a simulated product.

---

## Why the tour should be on-demand

Forced first-run tours are often dismissed before the operator understands why they matter.

Reliability Lab should not block the console with onboarding theater.

An on-demand model is better:

```text
Guide
Tour this page
What does this mean?
```

The operator can ask for help at the moment of curiosity.

No account or backend persistence is needed for the first version.

---

## A practical tour interaction

A lightweight page tour can use:

- a fixed guidance panel;
- stable `data-guide-anchor` attributes;
- a highlighted current target;
- `scrollIntoView`;
- a route-specific step registry;
- a small client controller.

It does not need:

- a third-party tour framework;
- floating arrow geometry;
- cross-route hidden state;
- analytics;
- authenticated progress;
- a generalized content-management system.

A robust first version is preferable to a flamboyant tooltip constellation.

---

## Suggested page tours

## Executions page

Explain:

1. execution summary;
2. deterministic scenario selector;
3. start-and-watch action;
4. recent execution evidence;
5. Investigation Workbench entry.

## Execution detail

Explain:

1. execution envelope and status;
2. replay capability;
3. live persisted event stream;
4. Timeline playback;
5. machine route;
6. normalized outcome;
7. investigation signals;
8. evidence and case linking.

## Comparative Replay

Explain:

1. original and variant conditions;
2. requested variation;
3. side-by-side machines;
4. comparison dimensions;
5. linked source evidence;
6. why there is no universal winner score.

## Investigation Workbench

Explain:

1. explicit time window;
2. reliability summary;
3. exact saved scope;
4. outcome trend;
5. provider/model observations;
6. filters;
7. execution explorer;
8. evidence-grounded drill-down.

## Investigation Cases

Explain:

1. case scope;
2. current finding and resolution;
3. evidence references;
4. append-only notes;
5. lifecycle timeline;
6. archive status;
7. reopening the saved Workbench scope.

---

## Stable guide anchors

Tour targets should be semantic and explicit.

Example:

```tsx
<section data-guide-anchor="live-machine">...</section>
```

Avoid selectors based on:

- generated CSS classes;
- text position;
- `nth-child`;
- brittle DOM nesting;
- test-only IDs with no product meaning.

A stable anchor names a visible product concept.

---

## Content registry

Tour and glossary content should live in typed, reviewable modules.

Example:

```ts
interface GuideStep {
  anchor: string;
  title: string;
  body: string;
  optional?: boolean;
}

interface PageTour {
  id: string;
  title: string;
  steps: GuideStep[];
}
```

The registry should not contain executable behavior or arbitrary HTML.

Keep content close enough to the product vocabulary that it stays reviewable.

---

## Contextual help component

A simple accessible disclosure is often enough:

```tsx
<ConceptHelp title="What is replay capability?">
  Replay is available only while the encrypted retained input can currently be read under retention
  and key policy.
</ConceptHelp>
```

A `<details>`-based implementation may be preferable to a custom popover when it meets the design.

The goal is understanding, not animation.

---

## Accessibility requirements

The guide must remain useful without a mouse.

Verify:

- the tour launcher has an accessible name;
- the panel has an appropriate dialog or region role;
- the current step is announced;
- Back, Next, Exit, and Restart are keyboard reachable;
- focus moves predictably;
- closing returns focus to the launcher;
- the highlighted target is not identified by color alone;
- narrow screens do not hide the target permanently;
- reduced motion is respected;
- the tour never traps the operator;
- contextual disclosures use native semantics where possible.

Do not weaken existing role- and label-based Playwright locators.

---

## Honest guidance

The interface should clearly state:

- reliability means predictable and explainable handling of provider calls;
- it does not mean factual answer correctness;
- counts are observations, not universal provider rankings;
- replay depends on current retained-input capability;
- playback changes presentation timing only;
- comparison exposes dimensions rather than declaring a universal winner;
- the tenant header is routing context, not authenticated identity;
- provider effects are not exactly once;
- cases reference evidence rather than copying it.

Guidance should reduce ambiguity without sanding off important limitations.

---

## Scenario guidance

The development console already contains useful deterministic scenarios:

- successful structured output;
- retry after rate limit;
- fallback provider;
- structured-output rejection;
- latency-budget rejection.

Each scenario should explain:

```text
What will happen
What evidence to watch
What reliability concept it demonstrates
What to try next
```

Do not expand the scenario catalog during the first guidance movement unless a tiny addition is required to make the guide coherent.

The goal is to teach the existing scenarios.

---

## Documentation inside versus outside the product

Repository documentation serves engineers.

Operator guidance serves product users.

They should agree, but they should not be identical.

### Repository documentation

Explains:

- architecture;
- code ownership;
- exact symbols;
- change recipes;
- verification;
- design tradeoffs.

### Product guidance

Explains:

- operator concepts;
- workflow;
- evidence interpretation;
- controls;
- limitations;
- next action.

The web interface should not expose filesystem paths or source-code archaeology.

---

## Roadmap vocabulary

Reliability Lab currently uses two related sequences.

### Operator workflow

```text
Execute → Explain → Watch → Replay → Compare → Investigate → Preserve
```

### System evolution

```text
Execute → Explain → Preserve safely → Replay → Compare → Learn → Operate
```

The roadmap should name these separately rather than presenting them as competing canonical loops.

The Product Tour should use the operator workflow.

---

## What not to build yet

Do not add:

- automatic onboarding;
- user accounts or saved tour progress;
- analytics;
- a help CMS;
- a support chatbot;
- broad scenario expansion;
- external trace/log integration;
- alerting;
- cancellation;
- authentication;
- RBAC;
- a universal provider-health score;
- a universal comparison score;
- a third-party tour library;
- a redesign of the console;
- a separate documentation application.

This movement should teach the current product.

---

## Definition of done

Product Tour and Operator Guidance is established when a fresh operator can:

1. open the Guide from primary navigation;
2. explain the product’s purpose;
3. distinguish execution from attempt;
4. launch an existing deterministic scenario;
5. identify live evidence and Timeline playback;
6. understand replay capability;
7. understand what a comparison changes;
8. interpret Workbench signals without treating them as rankings;
9. save or inspect an investigation case;
10. identify the prototype’s trust and consistency limitations;
11. use an on-demand tour without changing product state;
12. complete the workflow using accessible controls.

The movement is not complete merely because a few tooltips exist.

It is complete because the accepted interface teaches the product honestly through the Guide,
contextual help, and stateless tours while preserving the limitations above.
