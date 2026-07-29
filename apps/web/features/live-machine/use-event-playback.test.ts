import { describe, expect, it } from "vitest";
import { initialPlaybackState, playbackReducer } from "./use-event-playback.js";

describe("recorded event playback", () => {
  it("restarts, pauses, steps, and returns to the live edge", () => {
    let state = playbackReducer(initialPlaybackState(4), { type: "restart", eventCount: 4 });
    expect(state).toMatchObject({ active: true, count: 1, playing: true });
    state = playbackReducer(state, { type: "toggle", eventCount: 4 });
    expect(state.playing).toBe(false);
    state = playbackReducer(state, { type: "step", eventCount: 4 });
    expect(state).toMatchObject({ count: 2, playing: false });
    state = playbackReducer(state, { type: "live-edge", eventCount: 4 });
    expect(state).toMatchObject({ active: false, count: 4, playing: false });
  });

  it("stops advancing at the final persisted event", () => {
    const state = playbackReducer(
      { active: true, count: 2, playing: true, speed: 1 },
      { type: "advance", eventCount: 3 },
    );
    expect(state).toMatchObject({ count: 3, playing: false });
  });
});
