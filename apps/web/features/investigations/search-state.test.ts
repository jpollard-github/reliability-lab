import { describe, expect, it } from "vitest";
import {
  activeFilterDescriptions,
  filterHref,
  resolveRange,
  returnUrl,
  routeHref,
  toSavedScope,
  toUrlSearchParams,
  withoutParam,
} from "./search-state.js";

describe("Investigation Workbench search state", () => {
  it("resolves the default and explicit preset ranges from a stable clock", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    expect(resolveRange({}, now)).toEqual({
      from: "2026-07-28T12:00:00.000Z",
      to: now.toISOString(),
    });
    expect(resolveRange({ window: "1h" }, now).from).toBe("2026-07-29T11:00:00.000Z");
  });

  it("preserves exact custom ranges and repeated parameters", () => {
    const raw = {
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-02T00:00:00.000Z",
      status: ["failed", "degraded"],
    };
    expect(resolveRange(raw)).toEqual({ from: raw.from, to: raw.to });
    expect(toUrlSearchParams(raw).getAll("status")).toEqual(["failed", "degraded"]);
  });

  it("reconstructs drill-down, route, removal, return, and cursor-safe hrefs", () => {
    const params = new URLSearchParams("window=24h&cursor=next&q=trace");
    expect(filterHref(params, "signal", "retry_recovered")).toBe(
      "/investigations?window=24h&q=trace&signal=retry_recovered#execution-explorer",
    );
    expect(routeHref(params, "fake-primary", "deterministic-v1")).toBe(
      "/investigations?window=24h&q=trace&provider=fake-primary&model=deterministic-v1#execution-explorer",
    );
    expect(withoutParam(params, "q")).toBe("/investigations?window=24h#execution-explorer");
    expect(returnUrl(params)).toBe("/investigations?window=24h&cursor=next&q=trace");
  });

  it("describes active filters and prepares canonical saved scope", () => {
    const params = new URLSearchParams(
      "window=24h&status=failed,degraded&provider=fake-primary&provider=fake-primary&model=deterministic-v1&signal=retry_recovered&cursor=ignored",
    );
    expect(activeFilterDescriptions(params).map(({ label }) => label)).toEqual([
      "status: failed,degraded",
      "provider: fake-primary",
      "provider: fake-primary",
      "model: deterministic-v1",
      "signal: retry_recovered",
    ]);
    expect(
      toSavedScope({ from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" }, params),
    ).toEqual({
      range: { from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" },
      statuses: ["degraded", "failed"],
      providers: ["fake-primary"],
      models: ["deterministic-v1"],
      signal: "retry_recovered",
    });
  });
});
