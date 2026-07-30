# Product Tour and Operator Guidance

This document maps the implemented operator guidance. It is for engineers who maintain the
Reliability Lab interface and for reviewers checking that guidance stays grounded in real product
evidence.

## Operator audience and surfaces

The guidance serves a new operator who needs to understand the product before reading source code.
It has three complementary surfaces:

- `/guide` is the server-rendered orientation page;
- `ConceptHelp` adds native, contextual disclosures at genuine concept boundaries;
- `Tour this page` starts a stateless tour of the current established route family.

The Guide owns the seven-stage operator workflow, five existing deterministic scenarios, canonical
glossary, honest limitations, and contextual workflow links. Its introduction contains only the
page identity and description; product orientation and its evidence boundaries share one coherent
full-width panel. It does not fetch evidence or simulate a second application.

## Content ownership

`apps/web/features/guidance/guide-content.ts` owns plain Guide data.
`guide-page.tsx` renders that data as semantic headings, lists, links, and definition lists.
`concept-help.tsx` owns the reusable `<details>` disclosure. Route pages provide the concise
route-specific wording so the help remains next to the concept it explains.

The operator workflow is:

```text
Execute → Explain → Watch → Replay → Compare → Investigate → Preserve
```

This is the product-use view. The roadmap's
`Execute → Explain → Preserve safely → Replay → Compare → Learn → Operate` sequence remains a
different system-evolution view.

## Page-tour model

`tour-registry.ts` owns six typed, route-specific `PageTour` records. Each `GuideStep` contains only
an anchor, title, body, and optional flag; executable HTML is not accepted. `resolveTourForPath`
matches the current pathname without changing it.

`page-tour.tsx` is the small pathname-aware client entrypoint. `tour-launcher.tsx` owns browser
focus, current-target annotation, scrolling, reduced-motion detection, and accessible controls.
`tour-state.ts` remains pure: it prepares available steps, skips missing optional targets, reports a
missing required target, and moves or restarts the step index.

The tour is on demand, never auto-launches, stores no progress, makes no API request, and performs no
product mutation. Opening it preserves form values, route state, and the current URL.

## Stable anchors

Product sections expose semantic `data-guide-anchor` values. They name durable concepts such as
`execution-scenario`, `live-machine`, `replay-capability`, `workbench-summary`, and
`case-evidence` and `case-review`. The case-detail tour uses `case-review` to explain current
bounded summaries and fixed readiness checks before it reaches conclusion controls and packet
download. Tours do not use incidental nesting, text matching, or child indexes.

When changing an anchor:

1. update the product section and `tour-registry.ts` together;
2. decide whether absence is a legitimate evidence state;
3. mark the step optional only when the product section can honestly be absent;
4. update focused unit and Playwright coverage;
5. run the structural, responsive, keyboard, and missing-anchor checks.

A required missing anchor stops the tour with a named error. An optional missing anchor is removed
from the prepared step list and reported in the panel.

## Accessibility and visual behavior

The Guide uses one `h1`, section `h2` headings, stage/scenario `h3` headings, ordered workflow
content, and a glossary definition list. Context help uses native summary/disclosure keyboard
behavior.

The tour launcher has a visible accessible name. The panel is a non-modal dialog so the page remains
usable. It announces step number and title, supports Back, Next, Exit, and Restart, marks the target
with both text and an outline, connects the target to the current description, supports Escape, and
returns focus to the launcher. JavaScript and CSS both honor `prefers-reduced-motion`.

`apps/web/styles/guidance.css` owns Guide, help, launcher, panel, active-target, narrow-screen, and
reduced-motion styles. It is imported after established feature styles and before
`responsive.css`.

## Server and client boundary

The Guide page, static content, contextual help, and route composition remain Server Components.
Only pathname resolution and tour interaction are Client Components. Guidance client modules do not
import `lib/server-api.ts`, `workbench-loader.ts`, tenant evidence, or replay input.

## Testing

Focused unit tests cover canonical Guide content, all six route resolutions, optional versus
required anchors, navigation clamping, and restart. `apps/web/tests/operator-guidance.spec.ts`
covers primary navigation, Guide content, keyboard disclosure behavior, tour navigation and active
targets, URL/form preservation, focus return, optional-anchor reporting, and 390 px fit.

The saved-case workflow additionally verifies the case-review step against a real derived review.
Existing execution, Live Machine, comparison, Workbench, and saved-case product operations remain
separate from tour state.

## Limitations

Tours describe only the current DOM and real evidence. They do not manufacture missing data, track
completion, identify a user, provide analytics, position tooltips, or cross routes automatically.
The Guide repeats the product's security, provider-effect, replay-capability, ranking, and
answer-quality limitations rather than advancing those claims.
Case guidance likewise describes readiness as workflow completeness and review packets as internal
trace artifacts; it does not claim conclusion truth.

## Add or change a tour step

1. Identify a durable product concept and add one semantic `data-guide-anchor` to its owning
   component.
2. Add plain title/body data to the matching tour in `tour-registry.ts`.
3. Use `optional: true` only for a conditionally absent product section.
4. Keep content evidence-based and name one useful operator conclusion without inventing a broader
   capability.
5. Update `tour-state.test.ts` or `guide-content.test.ts` when logic or canonical content changes.
6. Update `operator-guidance.spec.ts` when the operator workflow changes.
7. Verify keyboard focus, reduced motion, desktop and 390 px layout, console/network state, and all
   existing workflows.
