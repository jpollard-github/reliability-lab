"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExecutionEnvelope, ReplayCapability } from "@reliability-lab/contracts";
import { browserApiUrl, browserTenantId, isRecord } from "@/lib/client-api";
import { emptyComparisonDraft, toReplayVariation, type ComparisonDraft } from "./comparison-draft";
import { ComparisonVariationFields } from "./comparison-variation-fields";

export function ComparisonBuilder({
  execution,
  capability,
  fixedTarget = false,
}: {
  execution: ExecutionEnvelope;
  capability: ReplayCapability;
  fixedTarget?: boolean;
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
              <p>
                The retained input is fixed. This creates another provider request and may incur
                cost. Blank controls inherit the original.
              </p>
            </div>
            <button type="button" className="quiet-button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <ComparisonVariationFields
            baseline={execution}
            draft={draft}
            onChange={setDraft}
            fixedTarget={fixedTarget}
          />
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
