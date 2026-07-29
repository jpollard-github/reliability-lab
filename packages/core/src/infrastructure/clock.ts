import { randomBytes, randomUUID } from "node:crypto";
import type { ExecutionId } from "@reliability-lab/contracts";

/**
 * Time, randomness, identifiers, and abort-aware sleeping used by domain services.
 * It does not own execution policy or worker lease decisions.
 */
export interface Clock {
  now(): Date;
  sleep(milliseconds: number): Promise<void>;
}

export interface RandomSource {
  next(): number;
}

export interface IdSource {
  executionId(): ExecutionId;
  experimentId(): string;
  eventId(): string;
  traceId(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: async (milliseconds) => {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  },
};

export const systemIds: IdSource = {
  executionId: randomUUID,
  experimentId: randomUUID,
  eventId: randomUUID,
  traceId: () => randomBytes(16).toString("hex"),
};

export async function abortableSleep(
  clock: Clock,
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw abortReason(signal);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([clock.sleep(milliseconds), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

export function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
