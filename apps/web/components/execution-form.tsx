"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const modes = [
  "none",
  "rate_limit",
  "provider_error",
  "malformed_json",
  "timeout",
  "latency",
] as const;

export function ExecutionForm() {
  const router = useRouter();
  const [mode, setMode] = useState<(typeof modes)[number]>("none");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const fallback = mode === "provider_error";
    const structured = mode === "malformed_json";
    try {
      const response = await fetch(`${apiUrl}/v1/executions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tenant-id": "demo-tenant",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          provider: "fake-primary",
          model: "deterministic-v1",
          input: "Classify this synthetic reliability incident.",
          ...(mode === "none" ? {} : { failureMode: mode }),
          ...(fallback
            ? {
                policy: {
                  maxAttempts: 1,
                  fallbackProvider: "fake-fallback",
                  fallbackModel: "deterministic-v1",
                },
              }
            : {}),
          ...(structured
            ? {
                structuredOutputSchema: {
                  type: "object",
                  required: ["result"],
                  properties: { result: { type: "string" } },
                  additionalProperties: false,
                },
              }
            : {}),
          ...(mode === "latency" ? { budget: { maxLatencyMs: 10 } } : {}),
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
      <div>
        <label htmlFor="failure-mode">Forced failure mode</label>
        <select
          id="failure-mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as typeof mode)}
        >
          {modes.map((item) => (
            <option key={item} value={item}>
              {item.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={submitting}>
        {submitting ? "Running…" : "Run deterministic execution"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
