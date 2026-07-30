import { describe, expect, it } from "vitest";
import {
  deterministicScenarios,
  glossary,
  honestLimitations,
  operatorWorkflow,
} from "./guide-content";

describe("canonical operator guide content", () => {
  it("preserves the seven-stage workflow and five established scenarios", () => {
    expect(operatorWorkflow.map((stage) => stage.name)).toEqual([
      "Execute",
      "Explain",
      "Watch",
      "Replay",
      "Compare",
      "Investigate",
      "Preserve",
    ]);
    expect(deterministicScenarios.map((scenario) => scenario.id)).toEqual([
      "success",
      "retry",
      "fallback",
      "structured-reject",
      "budget",
    ]);
  });

  it("includes the required vocabulary and honest product boundaries", () => {
    expect(glossary.length).toBeGreaterThanOrEqual(16);
    expect(glossary.map((entry) => entry.term)).toContain("Tenant routing context");
    expect(honestLimitations).toHaveLength(8);
    expect(honestLimitations.join(" ")).toMatch(/exactly-once/i);
    expect(honestLimitations.join(" ")).toMatch(/universal provider-health ranking/i);
  });
});
