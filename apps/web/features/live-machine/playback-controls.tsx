"use client";

import { playbackSpeeds, type PlaybackSpeed, type PlaybackState } from "./use-event-playback";

interface PlaybackControlsProps extends PlaybackState {
  eventCount: number;
  guideAnchor?: string | undefined;
  restart: () => void;
  toggle: () => void;
  step: () => void;
  leave: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
}

export function PlaybackControls({
  active,
  count,
  playing,
  speed,
  eventCount,
  guideAnchor,
  restart,
  toggle,
  step,
  leave,
  setSpeed,
}: PlaybackControlsProps) {
  return (
    <div
      className="playback-controls"
      aria-label="Timeline playback controls"
      data-guide-anchor={guideAnchor}
    >
      <button type="button" onClick={restart} disabled={eventCount === 0}>
        Restart
      </button>
      <button type="button" onClick={toggle} disabled={eventCount < 2}>
        {active && playing ? "Pause" : active ? "Resume" : "Play event history"}
      </button>
      <button
        type="button"
        onClick={step}
        disabled={eventCount === 0 || (active && count >= eventCount)}
      >
        Step
      </button>
      <button type="button" onClick={leave} disabled={!active}>
        Live edge
      </button>
      <label>
        Speed
        <select
          aria-label="Playback speed"
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value) as PlaybackSpeed)}
        >
          {playbackSpeeds.map((option) => (
            <option key={option} value={option}>
              {option}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
