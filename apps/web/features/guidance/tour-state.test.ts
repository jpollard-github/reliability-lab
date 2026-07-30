import { describe, expect, it } from "vitest";
import { pageTours, resolveTourForPath } from "./tour-registry";
import {
  createTourNavigation,
  nextTourStep,
  prepareTour,
  previousTourStep,
  restartTour,
  type PageTour,
} from "./tour-state";

describe("operator guidance tour registry", () => {
  it("resolves all six established route families without matching unrelated paths", () => {
    expect(resolveTourForPath("/")?.id).toBe("executions");
    expect(resolveTourForPath("/executions/execution-1")?.id).toBe("execution-detail");
    expect(resolveTourForPath("/comparisons/comparison-1")?.id).toBe("comparison-detail");
    expect(resolveTourForPath("/investigations")?.id).toBe("investigations");
    expect(resolveTourForPath("/investigation-cases")?.id).toBe("case-list");
    expect(resolveTourForPath("/investigation-cases/case-1")?.id).toBe("case-detail");
    expect(resolveTourForPath("/guide")).toBeUndefined();
    expect(resolveTourForPath("/executions")).toBeUndefined();
  });

  it("skips optional anchors and stops clearly at a missing required anchor", () => {
    const tour: PageTour = {
      id: "test",
      title: "Test",
      steps: [
        { anchor: "first", title: "First", body: "First body" },
        { anchor: "optional", title: "Optional", body: "Optional body", optional: true },
        { anchor: "last", title: "Last", body: "Last body" },
      ],
    };
    expect(prepareTour(tour, ["first", "last"])).toEqual({
      steps: [tour.steps[0], tour.steps[2]],
      skippedAnchors: ["optional"],
    });
    expect(prepareTour(tour, ["first"])).toEqual({
      steps: [],
      skippedAnchors: ["optional"],
      missingRequiredAnchor: "last",
    });
  });

  it("moves, clamps, backs up, and restarts navigation state", () => {
    const initial = createTourNavigation();
    expect(initial).toEqual({ index: 0 });
    expect(nextTourStep(initial, 3)).toEqual({ index: 1 });
    expect(nextTourStep({ index: 2 }, 3)).toEqual({ index: 2 });
    expect(previousTourStep({ index: 1 })).toEqual({ index: 0 });
    expect(previousTourStep(initial)).toEqual({ index: 0 });
    expect(restartTour()).toEqual(initial);
  });

  it("keeps every registered tour reviewable and anchored", () => {
    expect(Object.values(pageTours)).toHaveLength(6);
    for (const tour of Object.values(pageTours)) {
      expect(tour.steps.length).toBeGreaterThan(0);
      expect(tour.steps.every((step) => step.anchor && step.title && step.body)).toBe(true);
    }
  });
});
