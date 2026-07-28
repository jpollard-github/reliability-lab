"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReplayCapability } from "@reliability-lab/contracts";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function ReplayButton({
  executionId,
  capability: initialCapability,
}: {
  executionId: string;
  capability: ReplayCapability;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [capability, setCapability] = useState(initialCapability);

  async function replay() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `${apiUrl}/v1/executions/${encodeURIComponent(executionId)}/replay`,
        {
          method: "POST",
          headers: { "x-tenant-id": "demo-tenant" },
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
        `${apiUrl}/v1/executions/${encodeURIComponent(executionId)}/replay-capsule`,
        {
          method: "DELETE",
          headers: { "x-tenant-id": "demo-tenant" },
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
    <div className="replay-control">
      <div className="replay-actions">
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReplayCapability(value: unknown): value is ReplayCapability {
  return (
    isRecord(value) &&
    typeof value.state === "string" &&
    typeof value.available === "boolean" &&
    typeof value.reason === "string"
  );
}
