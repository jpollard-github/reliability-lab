"use client";

import type { ComparisonDraft } from "./comparison-draft";
import {
  applyComparisonPreset,
  comparisonPresets,
  type ComparisonBaseline,
  type ComparisonPreset,
} from "./comparison-presets";

/** Shared bounded variation controls for execution-detail and case-driven comparisons. */
export function ComparisonVariationFields({
  baseline,
  draft,
  onChange,
}: {
  baseline: ComparisonBaseline;
  draft: ComparisonDraft;
  onChange: (draft: ComparisonDraft) => void;
}) {
  return (
    <>
      <label>
        Preset
        <select
          aria-label="Comparison preset"
          defaultValue=""
          onChange={(event) =>
            onChange(applyComparisonPreset(event.target.value as ComparisonPreset, baseline))
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
          inherited={baseline.provider}
          onChange={(provider) => onChange({ ...draft, provider, reproducibilityCheck: false })}
        />
        <TextField
          label="Model"
          value={draft.model}
          inherited={baseline.model}
          onChange={(model) => onChange({ ...draft, model, reproducibilityCheck: false })}
        />
        <NumberField
          label="Max attempts"
          value={draft.maxAttempts}
          inherited={baseline.policy.maxAttempts}
          min="1"
          max="5"
          onChange={(maxAttempts) =>
            onChange({ ...draft, maxAttempts, reproducibilityCheck: false })
          }
        />
        <NumberField
          label="Base backoff (ms)"
          value={draft.baseBackoffMs}
          inherited={baseline.policy.baseBackoffMs}
          min="0"
          max="30000"
          onChange={(baseBackoffMs) =>
            onChange({ ...draft, baseBackoffMs, reproducibilityCheck: false })
          }
        />
        <NumberField
          label="Max backoff (ms)"
          value={draft.maxBackoffMs}
          inherited={baseline.policy.maxBackoffMs}
          min="0"
          max="60000"
          onChange={(maxBackoffMs) =>
            onChange({ ...draft, maxBackoffMs, reproducibilityCheck: false })
          }
        />
        <NumberField
          label="Jitter ratio"
          value={draft.jitterRatio}
          inherited={baseline.policy.jitterRatio}
          min="0"
          max="1"
          step="0.1"
          onChange={(jitterRatio) =>
            onChange({ ...draft, jitterRatio, reproducibilityCheck: false })
          }
        />
        <label>
          Fallback
          <select
            aria-label="Fallback provider"
            value={draft.fallbackProvider}
            onChange={(event) =>
              onChange({
                ...draft,
                fallbackProvider: event.target.value,
                reproducibilityCheck: false,
              })
            }
          >
            <option value="">Inherit ({baseline.policy.fallbackProvider ?? "none"})</option>
            <option value="_remove">Remove fallback</option>
            <option value="fake-fallback">fake-fallback</option>
            <option value="fake-primary">fake-primary</option>
          </select>
        </label>
        <TextField
          label="Fallback model"
          value={draft.fallbackModel}
          inherited={baseline.policy.fallbackModel ?? baseline.model}
          onChange={(fallbackModel) =>
            onChange({ ...draft, fallbackModel, reproducibilityCheck: false })
          }
        />
        <NumberField
          label="Max latency (ms)"
          value={draft.maxLatencyMs}
          inherited={baseline.budget.maxLatencyMs}
          min="1"
          max="300000"
          onChange={(maxLatencyMs) =>
            onChange({ ...draft, maxLatencyMs, reproducibilityCheck: false })
          }
        />
      </div>
    </>
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
