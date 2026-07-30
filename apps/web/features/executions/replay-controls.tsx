"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExecutionEnvelope, ReplayCapability } from "@reliability-lab/contracts";
import { ComparisonBuilder } from "@/features/comparisons/comparison-builder";
import { browserApiUrl, browserTenantId, isRecord } from "@/lib/client-api";

export function ReplayControls({
  executionId,
  execution,
  capability: initialCapability,
}: {
  executionId: string;
  execution: ExecutionEnvelope;
  capability: ReplayCapability;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [capability, setCapability] = useState(initialCapability);

  useEffect(() => {
    setCapability(initialCapability);
  }, [initialCapability]);

  async function replay() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `${browserApiUrl}/v1/executions/${encodeURIComponent(executionId)}/replay`,
        {
          method: "POST",
          headers: { "x-tenant-id": browserTenantId },
        },
      );
      const body: unknown = await response.json();
      if (
        response.ok &&
        isRecord(body) &&
        isRecord(body.replayExecution) &&
        typeof body.replayExecution.executionId === "string"
      ) {
        router.push(`/executions/${body.replayExecution.executionId}`);
        router.refresh();
        return;
      }
      const reason =
        isRecord(body) && typeof body.reason === "string" ? body.reason : "Replay could not start";
      setMessage(reason);
    } catch {
      setMessage("Replay request could not reach the API");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCapsule() {
    if (
      !window.confirm(
        "Permanently delete retained replay data for this execution? The normalized execution evidence will remain.",
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `${browserApiUrl}/v1/executions/${encodeURIComponent(executionId)}/replay-capsule`,
        {
          method: "DELETE",
          headers: { "x-tenant-id": browserTenantId },
        },
      );
      const body: unknown = await response.json();
      if (response.ok && isRecord(body) && isReplayCapability(body.replayCapability)) {
        setCapability(body.replayCapability);
        setMessage(
          body.deleted === true
            ? "Retained replay data deleted."
            : "Replay data was already absent or deleted.",
        );
        router.refresh();
        return;
      }
      setMessage("Replay data could not be deleted");
    } catch {
      setMessage("Delete request could not reach the API");
    } finally {
      setBusy(false);
    }
  }

  const canDelete = !["retention_disabled", "missing", "deleted"].includes(capability.state);

  return (
    <div className="replay-control" data-guide-anchor="replay-capability">
      <div className="replay-actions">
        <ComparisonBuilder execution={execution} capability={capability} />
        <button
          type="button"
          onClick={() => void replay()}
          disabled={!capability.available || busy}
        >
          {busy ? "Working…" : "Replay execution"}
        </button>
        <button
          type="button"
          className="danger-button"
          onClick={() => void deleteCapsule()}
          disabled={!canDelete || busy}
        >
          Delete replay data
        </button>
      </div>
      <span>{capability.reason}</span>
      {message ? (
        <span role="status" className="form-message">
          {message}
        </span>
      ) : null}
    </div>
  );
}

function isReplayCapability(value: unknown): value is ReplayCapability {
  return (
    isRecord(value) &&
    typeof value.state === "string" &&
    typeof value.available === "boolean" &&
    typeof value.reason === "string"
  );
}
