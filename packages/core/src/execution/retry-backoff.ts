import type { ExecutionPolicy } from "@reliability-lab/contracts";
import type { RandomSource } from "../infrastructure/clock.js";

/**
 * Calculates the existing capped exponential backoff with symmetric jitter.
 * Sleeping and continuation checks remain the runner's responsibility.
 */
export function calculateRetryDelay(
  policy: ExecutionPolicy,
  attemptNumber: number,
  random: RandomSource,
): number {
  const base = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * 2 ** (attemptNumber - 1));
  const jitter = base * policy.jitterRatio * (random.next() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}
