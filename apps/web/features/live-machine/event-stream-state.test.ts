import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@reliability-lab/contracts";
import {
  extractSseFrames,
  mergeExecutionEvents,
  parseExecutionEvent,
} from "./event-stream-state.js";

const event = (sequence: number): ExecutionEvent =>
  ({
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    executionId: "execution-1",
    sequence,
    occurredAt: `2026-07-29T00:00:0${sequence}.000Z`,
    type: "execution.accepted",
  }) as ExecutionEvent;

describe("live event stream state", () => {
  it("merges persisted and live events by sequence without duplicates", () => {
    expect(mergeExecutionEvents([event(2), event(1)], [event(2), event(3)])).toEqual([
      event(1),
      event(2),
      event(3),
    ]);
  });

  it("extracts complete SSE frames and retains an incomplete remainder", () => {
    expect(
      extractSseFrames('event: message\ndata: {"sequence":1}\n\n:data\n\nevent: next'),
    ).toEqual({
      frames: [{ event: "message", data: '{"sequence":1}' }],
      remainder: "event: next",
    });
  });

  it("accepts event-shaped JSON and rejects malformed payloads", () => {
    expect(parseExecutionEvent(JSON.stringify(event(1)))).toEqual(event(1));
    expect(parseExecutionEvent('{"sequence":"one"}')).toBeNull();
    expect(parseExecutionEvent("not-json")).toBeNull();
  });
});
