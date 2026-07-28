import type { ExecutionEvent } from "@reliability-lab/contracts";

type ExecutionStreamItem = { type: "event"; event: ExecutionEvent } | { type: "heartbeat" };

interface FollowExecutionEventsOptions {
  initialEvents: ExecutionEvent[];
  afterSequence: number;
  readAfter: (afterSequence: number) => Promise<ExecutionEvent[] | null>;
  signal: AbortSignal;
  pollMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = async (milliseconds: number) => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

export async function* followExecutionEvents(
  options: FollowExecutionEventsOptions,
): AsyncGenerator<ExecutionStreamItem> {
  const pollMs = options.pollMs ?? 100;
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let cursor = options.afterSequence;
  let lastWriteAt = now();
  let pending = orderedAfter(options.initialEvents, cursor);

  while (!options.signal.aborted) {
    if (pending.length > 0) {
      for (const event of pending) {
        if (event.sequence <= cursor) continue;
        cursor = event.sequence;
        lastWriteAt = now();
        yield { type: "event", event };
        if (isTerminalExecutionEvent(event)) return;
      }
    }

    await sleep(pollMs);
    if (options.signal.aborted) return;
    pending = orderedAfter((await options.readAfter(cursor)) ?? [], cursor);
    if (pending.length === 0 && now() - lastWriteAt >= heartbeatMs) {
      lastWriteAt = now();
      yield { type: "heartbeat" };
    }
  }
}

export function formatExecutionSse(event: ExecutionEvent): string {
  return `id: ${event.sequence}\nevent: execution\ndata: ${JSON.stringify(event)}\n\n`;
}

export function isTerminalExecutionEvent(event: ExecutionEvent): boolean {
  return event.type === "execution.succeeded" || event.type === "execution.failed";
}

function orderedAfter(events: ExecutionEvent[], cursor: number): ExecutionEvent[] {
  return events
    .filter((event) => event.sequence > cursor)
    .sort((left, right) => left.sequence - right.sequence);
}
