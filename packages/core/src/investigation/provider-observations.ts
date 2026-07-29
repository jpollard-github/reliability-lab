import type { ExecutionEnvelope, ProviderObservation } from "@reliability-lab/contracts";
import { percentile, rate } from "./statistics.js";

/**
 * Groups attempt evidence by provider and model with explicit sample assessment.
 * It reports observations only and deliberately does not calculate a health score.
 */
export function observeProviders(executions: ExecutionEnvelope[]): ProviderObservation[] {
  const groups = new Map<
    string,
    {
      provider: string;
      model: string;
      attempts: ExecutionEnvelope["attempts"];
      executionIds: Set<string>;
      fallbackSelectedToRoute: number;
    }
  >();
  for (const execution of executions) {
    for (const attempt of execution.attempts) {
      const key = `${attempt.provider}\u0000${attempt.model}`;
      const group = groups.get(key) ?? {
        provider: attempt.provider,
        model: attempt.model,
        attempts: [],
        executionIds: new Set<string>(),
        fallbackSelectedToRoute: 0,
      };
      group.attempts.push(attempt);
      group.executionIds.add(execution.executionId);
      groups.set(key, group);
    }
    for (const selected of execution.events.filter((event) => event.type === "fallback.selected")) {
      if (selected.type !== "fallback.selected") continue;
      const key = `${selected.provider}\u0000${selected.model}`;
      const group = groups.get(key);
      if (group) group.fallbackSelectedToRoute += 1;
    }
  }
  return [...groups.values()]
    .map(
      ({
        provider,
        model,
        attempts,
        executionIds,
        fallbackSelectedToRoute,
      }): ProviderObservation => {
        const durations = attempts.flatMap((attempt) =>
          attempt.durationMs === undefined ? [] : [attempt.durationMs],
        );
        const terminalAttemptCount = attempts.filter(
          (attempt) => attempt.status !== "running",
        ).length;
        const succeededAttempts = attempts.filter(
          (attempt) => attempt.status === "succeeded",
        ).length;
        return {
          provider,
          model,
          attemptCount: attempts.length,
          executionCount: executionIds.size,
          terminalAttemptCount,
          succeededAttempts,
          failedAttempts: attempts.filter((attempt) => attempt.status === "failed").length,
          timedOutAttempts: attempts.filter((attempt) => attempt.status === "timed_out").length,
          rejectedAttempts: attempts.filter((attempt) => attempt.status === "rejected").length,
          runningAttempts: attempts.filter((attempt) => attempt.status === "running").length,
          observedSuccessRate: rate(succeededAttempts, terminalAttemptCount),
          latencySampleSize: durations.length,
          p50LatencyMs: percentile(durations, 0.5),
          p95LatencyMs: percentile(durations, 0.95),
          rateLimitedAttempts: attempts.filter(
            (attempt) => attempt.error?.category === "rate_limit",
          ).length,
          providerUnavailableAttempts: attempts.filter(
            (attempt) => attempt.error?.category === "provider_unavailable",
          ).length,
          providerErrors: attempts.filter((attempt) => attempt.error !== undefined).length,
          structuredOutputRejections: attempts.filter(
            (attempt) => attempt.validation?.valid === false,
          ).length,
          fallbackSelectedToRoute,
          sampleAssessment:
            attempts.length === 0
              ? "no_evidence"
              : attempts.length < 5
                ? "insufficient_sample"
                : "observed",
        };
      },
    )
    .sort(
      (left, right) =>
        right.attemptCount - left.attemptCount ||
        left.provider.localeCompare(right.provider) ||
        left.model.localeCompare(right.model),
    );
}
