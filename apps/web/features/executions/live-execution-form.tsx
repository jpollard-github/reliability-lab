"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ProviderCapability } from "@reliability-lab/contracts";
import { requestJson } from "@/lib/client-api";

interface SubmissionResponse {
  executionId: string;
}

export function LiveExecutionForm({ provider }: { provider: ProviderCapability }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [retainEncrypted, setRetainEncrypted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await requestJson<SubmissionResponse>("/v1/executions", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          provider: provider.id,
          model: provider.modelLabel,
          input,
          policy: {
            maxAttempts: 1,
            baseBackoffMs: 0,
            maxBackoffMs: 0,
            jitterRatio: 0,
          },
          budget: { maxLatencyMs: 20_000 },
          replayRetention: retainEncrypted ? "encrypted" : "disabled",
        }),
      });
      router.push(`/executions/${result.executionId}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Live execution failed");
      setSubmitting(false);
    }
  }

  return (
    <form className="live-execution-form" onSubmit={(event) => void submit(event)}>
      <p className="live-provider-warning">
        This sends one external provider request and may incur cost. Use only non-sensitive input.
      </p>
      <label htmlFor="live-execution-input">
        Bounded live input
        <textarea
          id="live-execution-input"
          maxLength={2_000}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Enter a small, non-sensitive verification request."
          required
          rows={4}
          value={input}
        />
      </label>
      <div className="live-execution-meta">
        <span>
          {input.length}/2,000 characters · {provider.id} / {provider.modelLabel}
        </span>
        <button type="submit" disabled={submitting}>
          {submitting ? "Running live execution…" : "Run one live execution"}
        </button>
      </div>
      {provider.liveReplayRetention?.available ? (
        <div className="live-retention-choice">
          <label>
            <input
              type="checkbox"
              checked={retainEncrypted}
              onChange={(event) => setRetainEncrypted(event.target.checked)}
            />
            Retain this request with encrypted replay storage for{" "}
            {provider.liveReplayRetention.retentionHours} hours
          </label>
          <p className="form-warning">
            Reliability Lab encrypts and stores the request body for this execution only. Replay and
            Compare each create another external request and may incur cost. The original stays
            immutable; deletion or expiry removes future replay capability. This cannot be enabled
            retroactively.
          </p>
        </div>
      ) : (
        <p className="form-warning">
          Live-provider request retention is disabled. This execution remains usable, but its input
          cannot be retained or recovered retroactively; Timeline playback is recorded evidence, not
          Replay.
        </p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
