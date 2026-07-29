"use client";

import { useEffect, useReducer } from "react";

export const playbackSpeeds = [0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof playbackSpeeds)[number];

export interface PlaybackState {
  active: boolean;
  count: number;
  playing: boolean;
  speed: PlaybackSpeed;
}

type PlaybackAction =
  | { type: "restart"; eventCount: number }
  | { type: "toggle"; eventCount: number }
  | { type: "step"; eventCount: number }
  | { type: "advance"; eventCount: number }
  | { type: "live-edge"; eventCount: number }
  | { type: "speed"; speed: PlaybackSpeed };

export function initialPlaybackState(eventCount: number): PlaybackState {
  return { active: false, count: eventCount, playing: false, speed: 1 };
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case "restart":
      return {
        ...state,
        active: true,
        count: Math.min(1, action.eventCount),
        playing: action.eventCount > 1,
      };
    case "toggle":
      return state.active
        ? { ...state, playing: !state.playing }
        : playbackReducer(state, { type: "restart", eventCount: action.eventCount });
    case "step":
      return {
        ...state,
        active: true,
        playing: false,
        count: Math.min(Math.max(1, state.count + 1), action.eventCount),
      };
    case "advance": {
      const count = Math.min(state.count + 1, action.eventCount);
      return { ...state, count, playing: count < action.eventCount };
    }
    case "live-edge":
      return { ...state, active: false, count: action.eventCount, playing: false };
    case "speed":
      return { ...state, speed: action.speed };
  }
}

export function useEventPlayback(eventCount: number, initialEventCount: number) {
  const [state, dispatch] = useReducer(playbackReducer, initialEventCount, initialPlaybackState);

  useEffect(() => {
    if (!state.active || !state.playing) return;
    if (state.count >= eventCount) {
      dispatch({ type: "advance", eventCount });
      return;
    }
    const timer = window.setTimeout(
      () => dispatch({ type: "advance", eventCount }),
      650 / state.speed,
    );
    return () => window.clearTimeout(timer);
  }, [eventCount, state.active, state.count, state.playing, state.speed]);

  return {
    ...state,
    restart: () => dispatch({ type: "restart", eventCount }),
    toggle: () => dispatch({ type: "toggle", eventCount }),
    step: () => dispatch({ type: "step", eventCount }),
    leave: () => dispatch({ type: "live-edge", eventCount }),
    setSpeed: (speed: PlaybackSpeed) => dispatch({ type: "speed", speed }),
  };
}
