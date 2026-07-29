import { describe, expect, it } from "vitest";
import { InvestigationQueryError } from "@reliability-lab/core";
import { arrayValue, investigationRange } from "../src/http/query-values.js";

describe("API query values", () => {
  it("normalizes repeated and comma-separated values without empty entries", () => {
    expect(arrayValue([" primary, fallback ", "primary", ""])).toEqual([
      "primary",
      "fallback",
      "primary",
    ]);
    expect(arrayValue("single")).toEqual(["single"]);
  });

  it("preserves an exact paired investigation range", () => {
    const range = {
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-02T00:00:00.000Z",
    };
    expect(investigationRange(range)).toEqual(range);
  });

  it("rejects a partial exact range", () => {
    expect(() => investigationRange({ from: "2026-07-01T00:00:00.000Z" })).toThrow(
      InvestigationQueryError,
    );
  });
});
