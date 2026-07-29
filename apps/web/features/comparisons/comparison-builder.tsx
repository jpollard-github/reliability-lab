"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExecutionEnvelope, ReplayCapability } from "@reliability-lab/contracts";
import { browserApiUrl, browserTenantId, isRecord } from "@/lib/client-api";
import { emptyComparisonDraft, toReplayVariation, type ComparisonDraft } from "./comparison-draft";
import {
  applyComparisonPreset,
  comparisonPresets,
  type ComparisonPreset,
} from "./comparison-presets";

export function ComparisonBuilder({
  execution,
  capability,
}: {
  execution: ExecutionEnvelope;
  capability: ReplayCapability;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ComparisonDraft>(emptyComparisonDraft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function createComparison() {
    setBusy(true);
    setMessage(null);
    try {
      const variation = toReplayVariation(draft);
      const response = await fetch(
        `${browserApiUrl}/v1/executions/${encodeURIComponent(execution.executionId)}/comparisons`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-tenant-id": browserTenantId },
          body: JSON.stringify({ variation }),
        },
      );
      const body: unknown = await response.json();
      const experiment = isRecord(body) && isRecord(body.experiment) ? body.experiment : null;
      if (response.status === 202 && experiment && typeof experiment.experimentId === "string") {
        router.push(`/comparisons/${experiment.experimentId}`);
        router.refresh();
        return;
      }
      setMessage(
        experiment && typeof experiment.unavailableReason === "string"
          ? experiment.unavailableReason
          : isRecord(body) && typeof body.message === "string"
            ? body.message
            : "Comparison could not start",
      );
    } catch {
      setMessage("Comparison request could not reach the API");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="comparison-builder">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={!capability.available || busy}
      >
        Compare with variant
      </button>
      {!open ? null : (
        <div className="comparison-form">
          <div className="comparison-form-heading">
            <div>
              <strong>Variant conditions</strong>
              <p>The retained input is fixed. Blank controls inherit the original.</p>
            </div>
            <button type="button" className="quiet-button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <label>
            Preset
            <select
              aria-label="Comparison preset"
              defaultValue=""
              onChange={(event) =>
                setDraft(applyComparisonPreset(event.target.value as ComparisonPreset, execution))
              }
            >
              <option value="" disabled>
                Choose a preset
              </option>
              {comparisonPresets.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <div className="comparison-fields">
            <TextField
              label="Provider"
              value={draft.provider}
              inherited={execution.provider}
              onChange={(provider) => setDraft({ ...draft, provider, reproducibilityCheck: false })}
            />
            <TextField
              label="Model"
              value={draft.model}
              inherited={execution.model}
              onChange={(model) => setDraft({ ...draft, model, reproducibilityCheck: false })}
            />
            <NumberField
              label="Max attempts"
              value={draft.maxAttempts}
              inherited={execution.policy.maxAttempts}
              min="1"
              max="5"
              onChange={(maxAttempts) =>
                setDraft({ ...draft, maxAttempts, reproducibilityCheck: false })
              }
            />
            <NumberField
              label="Base backoff (ms)"
              value={draft.baseBackoffMs}
              inherited={execution.policy.baseBackoffMs}
              min="0"
              max="30000"
              onChange={(baseBackoffMs) =>
                setDraft({ ...draft, baseBackoffMs, reproducibilityCheck: false })
              }
            />
            <NumberField
              label="Max backoff (ms)"
              value={draft.maxBackoffMs}
              inherited={execution.policy.maxBackoffMs}
              min="0"
              max="60000"
              onChange={(maxBackoffMs) =>
                setDraft({ ...draft, maxBackoffMs, reproducibilityCheck: false })
              }
            />
            <NumberField
              label="Jitter ratio"
              value={draft.jitterRatio}
              inherited={execution.policy.jitterRatio}
              min="0"
              max="1"
              step="0.1"
              onChange={(jitterRatio) =>
                setDraft({ ...draft, jitterRatio, reproducibilityCheck: false })
              }
            />
            <label>
              Fallback
              <select
                aria-label="Fallback provider"
                value={draft.fallbackProvider}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    fallbackProvider: event.target.value,
                    reproducibilityCheck: false,
                  })
                }
              >
                <option value="">Inherit ({execution.policy.fallbackProvider ?? "none"})</option>
                <option value="_remove">Remove fallback</option>
                <option value="fake-fallback">fake-fallback</option>
                <option value="fake-primary">fake-primary</option>
              </select>
            </label>
            <TextField
              label="Fallback model"
              value={draft.fallbackModel}
              inherited={execution.policy.fallbackModel ?? execution.model}
              onChange={(fallbackModel) =>
                setDraft({ ...draft, fallbackModel, reproducibilityCheck: false })
              }
            />
            <NumberField
              label="Max latency (ms)"
              value={draft.maxLatencyMs}
              inherited={execution.budget.maxLatencyMs}
              min="1"
              max="300000"
              onChange={(maxLatencyMs) =>
                setDraft({ ...draft, maxLatencyMs, reproducibilityCheck: false })
              }
            />
          </div>
          <div className="comparison-submit">
            <span>
              {draft.reproducibilityCheck
                ? "Explicit same-conditions check"
                : "Same retained input"}
            </span>
            <button type="button" onClick={() => void createComparison()} disabled={busy}>
              {busy ? "Creating…" : "Create comparison"}
            </button>
          </div>
          {message ? (
            <span role="status" className="form-error">
              {message}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  inherited,
  onChange,
}: {
  label: string;
  value: string;
  inherited: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <input
        value={value}
        placeholder={`Inherit: ${inherited}`}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  inherited,
  onChange,
  ...bounds
}: {
  label: string;
  value: string;
  inherited: number;
  onChange: (value: string) => void;
  min: string;
  max: string;
  step?: string;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        value={value}
        placeholder={`Inherit: ${inherited}`}
        onChange={(event) => onChange(event.target.value)}
        {...bounds}
      />
    </label>
  );
}
