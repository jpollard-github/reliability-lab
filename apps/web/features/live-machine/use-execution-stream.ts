"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExecutionEnvelope, ExecutionEvent } from "@reliability-lab/contracts";
import { browserApiUrl, browserTenantId } from "@/lib/client-api";
import { projectExecutionEvents } from "./execution-machine";
import { extractSseFrames, mergeExecutionEvents, parseExecutionEvent } from "./event-stream-state";

export type StreamState = "connecting" | "live" | "reconnecting" | "complete" | "failed";

export function useExecutionStream(initialExecution: ExecutionEnvelope, followLive: boolean) {
  const router = useRouter();
  const [execution, setExecution] = useState(initialExecution);
  const [events, setEvents] = useState<ExecutionEvent[]>(() =>
    mergeExecutionEvents([], initialExecution.events),
  );
  const [streamState, setStreamState] = useState<StreamState>(
    followLive ? "connecting" : "complete",
  );
  const [now, setNow] = useState(() => Date.parse(initialExecution.createdAt));
  const cursorRef = useRef(events.at(-1)?.sequence ?? 0);
  const projection = useMemo(() => projectExecutionEvents(events), [events]);

  useEffect(() => {
    if (projection.terminal) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [projection.terminal]);

  useEffect(() => {
    if (!followLive) return;
    const controller = new AbortController();
    let stopped = false;
    let connectedOnce = false;

    async function refreshExecution() {
      const response = await fetch(
        `${browserApiUrl}/v1/executions/${encodeURIComponent(initialExecution.executionId)}`,
        { headers: { "x-tenant-id": browserTenantId }, cache: "no-store" },
      );
      if (!response.ok || stopped) return;
      const snapshot = (await response.json()) as ExecutionEnvelope;
      if (stopped) return;
      setExecution(snapshot);
      setEvents((current) => mergeExecutionEvents(current, snapshot.events));
      router.refresh();
    }

    async function followStream() {
      let terminal = false;
      while (!stopped && !terminal) {
        setStreamState(connectedOnce ? "reconnecting" : "connecting");
        try {
          const response = await fetch(
            `${browserApiUrl}/v1/executions/${encodeURIComponent(
              initialExecution.executionId,
            )}/events?after=${cursorRef.current}`,
            {
              headers: {
                accept: "text/event-stream",
                "x-tenant-id": browserTenantId,
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
              setEvents((current) => mergeExecutionEvents(current, [event]));
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
    (projection.terminal
      ? projection.realEventSpanMs
      : Math.max(0, now - Date.parse(execution.createdAt)));
  return { execution, events, projection, streamState, elapsedMs };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
