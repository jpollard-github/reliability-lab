"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function ReplayButton({
  executionId,
  replayable,
}: {
  executionId: string;
  replayable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  return (
    <div className="replay-control">
      <button type="button" onClick={() => void replay()} disabled={!replayable || busy}>
        {busy ? "Replaying…" : "Replay execution"}
      </button>
      {!replayable ? (
        <span>Replay capsule unavailable under the active retention policy.</span>
      ) : null}
      {message ? (
        <span role="alert" className="form-error">
          {message}
        </span>
      ) : null}
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
