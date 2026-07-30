"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { browserApiUrl, browserTenantId, isRecord } from "@/lib/client-api";
const scenarios = [
  { value: "success", label: "Successful structured output" },
  { value: "retry", label: "Retry after rate limit" },
  { value: "fallback", label: "Fallback provider" },
  { value: "structured-reject", label: "Structured output rejection" },
  { value: "budget", label: "Latency budget rejection" },
] as const;
type Scenario = (typeof scenarios)[number]["value"];

export function ExecutionForm() {
  const router = useRouter();
  const [scenario, setScenario] = useState<Scenario>("success");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${browserApiUrl}/v1/executions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": browserTenantId,
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          provider: "fake-primary",
          model: "deterministic-v1",
          input: `Run deterministic ${scenario} evidence.`,
          ...scenarioConfiguration(scenario),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || typeof body.executionId !== "string") {
        const message =
          isRecord(body) && typeof body.message === "string" ? body.message : "Execution failed";
        throw new Error(message);
      }
      router.push(`/executions/${body.executionId}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Execution failed");
      setSubmitting(false);
    }
  }

  return (
    <form className="dev-form" onSubmit={(event) => void submit(event)}>
      <div data-guide-anchor="execution-scenario">
        <label htmlFor="scenario">Deterministic scenario</label>
        <select
          id="scenario"
          value={scenario}
          onChange={(event) => setScenario(event.target.value as Scenario)}
        >
          {scenarios.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <button data-guide-anchor="start-execution" type="submit" disabled={submitting}>
        {submitting ? "Starting…" : "Start and watch execution"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function scenarioConfiguration(scenario: Scenario): Record<string, unknown> {
  const structuredOutputSchema = {
    type: "object",
    required: ["result"],
    properties: { result: { type: "string" } },
    additionalProperties: false,
  };
  switch (scenario) {
    case "success":
      return { structuredOutputSchema };
    case "retry":
      return {
        failureMode: "rate_limit",
        policy: {
          maxAttempts: 2,
          baseBackoffMs: 1_500,
          maxBackoffMs: 1_500,
          jitterRatio: 0,
        },
      };
    case "fallback":
      return {
        failureMode: "provider_error",
        policy: {
          maxAttempts: 1,
          fallbackProvider: "fake-fallback",
          fallbackModel: "deterministic-v1",
        },
      };
    case "structured-reject":
      return { failureMode: "malformed_json", structuredOutputSchema };
    case "budget":
      return {
        failureMode: "latency",
        policy: {
          maxAttempts: 2,
          baseBackoffMs: 100,
          maxBackoffMs: 100,
          jitterRatio: 0,
        },
        budget: { maxLatencyMs: 10 },
      };
  }
}
