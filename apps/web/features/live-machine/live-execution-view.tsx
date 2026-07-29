"use client";

import { useId, useMemo } from "react";
import type { ExecutionEnvelope } from "@reliability-lab/contracts";
import { StatusBadge } from "@/components/status-badge";
import { EventTimeline } from "./event-timeline";
import { projectExecutionEvents } from "./execution-machine";
import { MachineReadout } from "./machine-readout";
import { MachineRoute } from "./machine-route";
import { PlaybackControls } from "./playback-controls";
import { useEventPlayback } from "./use-event-playback";
import { useExecutionStream, type StreamState } from "./use-execution-stream";

export function LiveExecutionView({ initialExecution }: { initialExecution: ExecutionEnvelope }) {
  return <ExecutionMachineView initialExecution={initialExecution} />;
}

export function ExecutionMachineView({
  initialExecution,
  title = "Live execution machine",
  followLive = true,
}: {
  initialExecution: ExecutionEnvelope;
  title?: string;
  followLive?: boolean;
}) {
  const headingId = useId();
  const stream = useExecutionStream(initialExecution, followLive);
  const playback = useEventPlayback(stream.events.length, initialExecution.events.length);
  const visibleEvents = playback.active ? stream.events.slice(0, playback.count) : stream.events;
  const visibleProjection = useMemo(() => projectExecutionEvents(visibleEvents), [visibleEvents]);
  const actualStatus = stream.projection.terminal
    ? stream.projection.status
    : stream.execution.status;

  return (
    <section className="panel live-machine" aria-labelledby={headingId}>
      <div className="panel-heading live-machine-heading">
        <div>
          <p className="eyebrow">Persisted event stream</p>
          <h2 id={headingId}>{title}</h2>
          <p>Actual state follows append-only evidence. Playback changes presentation time only.</p>
        </div>
        <div className="live-status">
          <StatusBadge status={actualStatus} />
          <span className={`stream-state stream-${stream.streamState}`} aria-live="polite">
            {followLive ? streamLabel(stream.streamState) : "Recorded evidence"}
          </span>
        </div>
      </div>
      <MachineReadout
        elapsedMs={stream.elapsedMs}
        eventCount={stream.events.length}
        execution={stream.execution}
        playbackActive={playback.active}
        playbackCount={playback.count}
        projection={stream.projection}
      />
      <PlaybackControls
        active={playback.active}
        count={playback.count}
        eventCount={stream.events.length}
        leave={playback.leave}
        playing={playback.playing}
        restart={playback.restart}
        setSpeed={playback.setSpeed}
        speed={playback.speed}
        step={playback.step}
        toggle={playback.toggle}
      />
      <MachineRoute
        latestVisibleSequence={visibleEvents.at(-1)?.sequence ?? 0}
        playbackActive={playback.active}
        projection={visibleProjection}
      />
      <div className="raw-timeline">
        <div className="panel-heading">
          <div>
            <h2>Event timeline</h2>
            <p>Raw append-only evidence at the selected presentation point.</p>
          </div>
          <span className="muted">{visibleEvents.length} events</span>
        </div>
        <EventTimeline events={visibleEvents} />
      </div>
    </section>
  );
}

function streamLabel(state: StreamState): string {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "live":
      return "Live";
    case "reconnecting":
      return "Reconnecting";
    case "complete":
      return "Stream complete";
    case "failed":
      return "Stream unavailable";
  }
}
