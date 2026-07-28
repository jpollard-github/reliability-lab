"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ExecutionEnvelope,
  ReplayCapability,
  ReplayVariation,
  ReplayVariationPolicy,
} from "@reliability-lab/contracts";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface Draft {
  provider: string;
  model: string;
  maxAttempts: string;
  baseBackoffMs: string;
  maxBackoffMs: string;
  jitterRatio: string;
  fallbackProvider: string;
  fallbackModel: string;
  maxLatencyMs: string;
  reproducibilityCheck: boolean;
}

const emptyDraft: Draft = {
  provider: "",
  model: "",
  maxAttempts: "",
  baseBackoffMs: "",
  maxBackoffMs: "",
  jitterRatio: "",
  fallbackProvider: "",
  fallbackModel: "",
  maxLatencyMs: "",
  reproducibilityCheck: false,
};

export function ComparisonBuilder({
  execution,
  capability,
}: {
  execution: ExecutionEnvelope;
  capability: ReplayCapability;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function applyPreset(value: string) {
    const inherited = execution.policy;
    switch (value) {
      case "same":
        setDraft({ ...emptyDraft, reproducibilityCheck: true });
        break;
      case "fewer":
        setDraft({
          ...emptyDraft,
          maxAttempts: String(Math.max(1, inherited.maxAttempts - 1)),
        });
        break;
      case "fallback":
        setDraft({
          ...emptyDraft,
          maxAttempts: "1",
          fallbackProvider: "fake-fallback",
          fallbackModel: "deterministic-v1",
        });
        break;
      case "tighter":
        setDraft({
          ...emptyDraft,
          maxLatencyMs: String(Math.max(1, Math.floor(execution.budget.maxLatencyMs / 2))),
        });
        break;
      case "patient":
        setDraft({
          ...emptyDraft,
          maxAttempts: String(Math.min(5, inherited.maxAttempts + 1)),
          baseBackoffMs: String(Math.min(30_000, Math.max(100, inherited.baseBackoffMs * 2))),
          maxBackoffMs: String(
            Math.min(60_000, Math.max(inherited.maxBackoffMs, inherited.baseBackoffMs * 4)),
          ),
        });
        break;
    }
  }

  async function createComparison() {
    setBusy(true);
    setMessage(null);
    try {
      const variation = toVariation(draft);
      const response = await fetch(
        `${apiUrl}/v1/executions/${encodeURIComponent(execution.executionId)}/comparisons`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-tenant-id": "demo-tenant" },
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
              onChange={(event) => applyPreset(event.target.value)}
            >
              <option value="" disabled>
                Choose a preset
              </option>
              <option value="same">Same conditions</option>
              <option value="fewer">Fewer retries</option>
              <option value="fallback">Immediate fallback</option>
              <option value="tighter">Tighter budget</option>
              <option value="patient">More patient retry</option>
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

function toVariation(draft: Draft): ReplayVariation {
  const policy: ReplayVariationPolicy = {};
  addNumber(policy, "maxAttempts", draft.maxAttempts);
  addNumber(policy, "baseBackoffMs", draft.baseBackoffMs);
  addNumber(policy, "maxBackoffMs", draft.maxBackoffMs);
  addNumber(policy, "jitterRatio", draft.jitterRatio);
  if (draft.fallbackProvider === "_remove") policy.fallbackProvider = null;
  else if (draft.fallbackProvider) policy.fallbackProvider = draft.fallbackProvider;
  if (draft.fallbackModel) policy.fallbackModel = draft.fallbackModel;

  const variation: ReplayVariation = {
    ...(draft.provider ? { provider: draft.provider } : {}),
    ...(draft.model ? { model: draft.model } : {}),
    ...(Object.keys(policy).length ? { policy } : {}),
    ...(draft.maxLatencyMs ? { budget: { maxLatencyMs: Number(draft.maxLatencyMs) } } : {}),
    ...(draft.reproducibilityCheck ? { reproducibilityCheck: true } : {}),
  };
  return variation;
}

function addNumber(
  target: ReplayVariationPolicy,
  key: "maxAttempts" | "baseBackoffMs" | "maxBackoffMs" | "jitterRatio",
  value: string,
) {
  if (value) target[key] = Number(value);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
