"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExecutionEnvelope, ExecutionEvent } from "@reliability-lab/contracts";
import { EventTimeline } from "@/components/event-timeline";
import { StatusBadge } from "@/components/status-badge";
import { projectExecutionEvents } from "@/lib/execution-machine";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const tenantId = "demo-tenant";
const playbackSpeeds = [0.5, 1, 2] as const;

type StreamState = "connecting" | "live" | "reconnecting" | "complete" | "failed";
type PlaybackSpeed = (typeof playbackSpeeds)[number];

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
  const router = useRouter();
  const headingId = useId();
  const [execution, setExecution] = useState(initialExecution);
  const [events, setEvents] = useState(() => mergeEvents([], initialExecution.events));
  const [streamState, setStreamState] = useState<StreamState>(
    followLive ? "connecting" : "complete",
  );
  const [playbackActive, setPlaybackActive] = useState(false);
  const [playbackCount, setPlaybackCount] = useState(initialExecution.events.length);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [now, setNow] = useState(() => Date.parse(initialExecution.createdAt));
  const cursorRef = useRef(events.at(-1)?.sequence ?? 0);

  const actualProjection = useMemo(() => projectExecutionEvents(events), [events]);
  const visibleEvents = playbackActive ? events.slice(0, playbackCount) : events;
  const visibleProjection = useMemo(() => projectExecutionEvents(visibleEvents), [visibleEvents]);
  const actualStatus = actualProjection.terminal ? actualProjection.status : execution.status;

  useEffect(() => {
    if (actualProjection.terminal) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [actualProjection.terminal]);

  useEffect(() => {
    if (!playbackActive || !playing) return;
    if (playbackCount >= events.length) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(
      () => setPlaybackCount((current) => Math.min(current + 1, events.length)),
      650 / speed,
    );
    return () => window.clearTimeout(timer);
  }, [events.length, playbackActive, playbackCount, playing, speed]);

  useEffect(() => {
    if (!followLive) return;
    const controller = new AbortController();
    let stopped = false;
    let connectedOnce = false;

    async function refreshExecution() {
      const response = await fetch(
        `${apiUrl}/v1/executions/${encodeURIComponent(initialExecution.executionId)}`,
        { headers: { "x-tenant-id": tenantId }, cache: "no-store" },
      );
      if (!response.ok || stopped) return;
      const snapshot = (await response.json()) as ExecutionEnvelope;
      if (stopped) return;
      setExecution(snapshot);
      setEvents((current) => mergeEvents(current, snapshot.events));
      router.refresh();
    }

    async function followStream() {
      let terminal = false;
      while (!stopped && !terminal) {
        setStreamState(connectedOnce ? "reconnecting" : "connecting");
        try {
          const response = await fetch(
            `${apiUrl}/v1/executions/${encodeURIComponent(
              initialExecution.executionId,
            )}/events?after=${cursorRef.current}`,
            {
              headers: {
                accept: "text/event-stream",
                "x-tenant-id": tenantId,
                "last-event-id": String(cursorRef.current),
              },
              cache: "no-store",
              signal: controller.signal,
            },
          );
          if (!response.ok || !response.body) {
            throw new Error(`Event stream failed with HTTP ${response.status}`);
          }
          connectedOnce = true;
          setStreamState("live");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!stopped) {
            const chunk = await reader.read();
            buffer += decoder.decode(chunk.value, { stream: !chunk.done });
            const parsed = extractSseFrames(buffer);
            buffer = parsed.remainder;
            for (const frame of parsed.frames) {
              if (frame.event === "complete") {
                terminal = true;
                break;
              }
              const event = parseExecutionEvent(frame.data);
              if (!event || event.sequence <= cursorRef.current) continue;
              cursorRef.current = event.sequence;
              setEvents((current) => mergeEvents(current, [event]));
              if (event.type === "execution.succeeded" || event.type === "execution.failed") {
                terminal = true;
                break;
              }
            }
            if (chunk.done || terminal) break;
          }
        } catch {
          if (controller.signal.aborted || stopped) return;
          setStreamState("reconnecting");
          await wait(400);
          continue;
        }

        if (!terminal) {
          setStreamState("reconnecting");
          await wait(400);
        }
      }

      if (!stopped) {
        setStreamState("complete");
        await refreshExecution().catch(() => undefined);
      }
    }

    void followStream().catch(() => {
      if (!stopped) setStreamState("failed");
    });
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [followLive, initialExecution.executionId, router]);

  const elapsedMs =
    execution.durationMs ??
    (actualProjection.terminal
      ? actualProjection.realEventSpanMs
      : Math.max(0, now - Date.parse(execution.createdAt)));
  const latestVisibleSequence = visibleEvents.at(-1)?.sequence ?? 0;

  function restartPlayback() {
    setPlaybackActive(true);
    setPlaybackCount(Math.min(1, events.length));
    setPlaying(events.length > 1);
  }

  function leavePlayback() {
    setPlaybackActive(false);
    setPlaybackCount(events.length);
    setPlaying(false);
  }

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
          <span className={`stream-state stream-${streamState}`} aria-live="polite">
            {followLive ? streamLabel(streamState) : "Recorded evidence"}
          </span>
        </div>
      </div>

      <div className="machine-readout">
        <div>
          <span>Actual elapsed</span>
          <strong className="mono">{formatElapsed(elapsedMs)}</strong>
        </div>
        <div>
          <span>Persisted events</span>
          <strong className="mono">{events.length}</strong>
        </div>
        <div>
          <span>Latest sequence</span>
          <strong className="mono">#{actualProjection.latestSequence}</strong>
        </div>
        <div>
          <span>Latency budget</span>
          <strong className="mono">
            {execution.budget.maxLatencyMs === undefined
              ? "No limit"
              : `${execution.budget.maxLatencyMs} ms`}
          </strong>
        </div>
        <div>
          <span>Presentation</span>
          <strong>
            {playbackActive
              ? `Step ${playbackCount} of ${events.length}`
              : actualProjection.terminal
                ? "Recorded history"
                : "Live edge"}
          </strong>
        </div>
      </div>

      <div className="playback-controls" aria-label="Timeline playback controls">
        <button type="button" onClick={restartPlayback} disabled={events.length === 0}>
          Restart
        </button>
        <button
          type="button"
          onClick={() => {
            if (!playbackActive) restartPlayback();
            else setPlaying((current) => !current);
          }}
          disabled={events.length < 2}
        >
          {playbackActive && playing ? "Pause" : playbackActive ? "Resume" : "Play event history"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaybackActive(true);
            setPlaying(false);
            setPlaybackCount((current) => Math.min(Math.max(1, current + 1), events.length));
          }}
          disabled={events.length === 0 || (playbackActive && playbackCount >= events.length)}
        >
          Step
        </button>
        <button type="button" onClick={leavePlayback} disabled={!playbackActive}>
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

      <ol className="machine-route" aria-label="Execution state route">
        {visibleProjection.steps.map((step) => (
          <li
            key={step.id}
            className={`machine-step machine-${step.kind} tone-${step.tone}`}
            aria-current={
              !playbackActive && step.sequence === latestVisibleSequence ? "step" : undefined
            }
          >
            <div className="machine-step-heading">
              <span className="step-sequence mono">#{step.sequence}</span>
              <strong>{step.title}</strong>
              {step.attemptNumber ? (
                <span className="step-attempt">Attempt {step.attemptNumber}</span>
              ) : null}
            </div>
            <p>{step.detail}</p>
            <time dateTime={step.occurredAt}>{new Date(step.occurredAt).toLocaleTimeString()}</time>
          </li>
        ))}
      </ol>

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

function mergeEvents(current: ExecutionEvent[], incoming: ExecutionEvent[]): ExecutionEvent[] {
  return [
    ...new Map([...current, ...incoming].map((event) => [event.sequence, event])).values(),
  ].sort((left, right) => left.sequence - right.sequence);
}

function extractSseFrames(value: string): {
  frames: Array<{ event: string; data: string }>;
  remainder: string;
} {
  const sections = value.split(/\r?\n\r?\n/);
  const remainder = sections.pop() ?? "";
  return {
    frames: sections.flatMap((section) => {
      if (section.startsWith(":")) return [];
      let event = "message";
      const data: string[] = [];
      for (const line of section.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      return data.length > 0 ? [{ event, data: data.join("\n") }] : [];
    }),
    remainder,
  };
}

function parseExecutionEvent(value: string): ExecutionEvent | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("eventId" in parsed) ||
      typeof parsed.eventId !== "string" ||
      !("sequence" in parsed) ||
      typeof parsed.sequence !== "number" ||
      !("type" in parsed) ||
      typeof parsed.type !== "string" ||
      !("occurredAt" in parsed) ||
      typeof parsed.occurredAt !== "string"
    ) {
      return null;
    }
    return parsed as ExecutionEvent;
  } catch {
    return null;
  }
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

function formatElapsed(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(2)} s`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
