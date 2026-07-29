/** Builds transport-only links without moving them into core domain contracts. */
import type { Static } from "@sinclair/typebox";
import type { ExecutionEnvelope } from "@reliability-lab/contracts";
import type { SubmissionResponseSchema } from "../schemas/executions.js";

export function submissionResponse(
  execution: ExecutionEnvelope,
): Static<typeof SubmissionResponseSchema> {
  return {
    executionId: execution.executionId,
    status: execution.status,
    traceId: execution.traceId,
    links: {
      self: `/v1/executions/${execution.executionId}`,
      replay: `/v1/executions/${execution.executionId}/replay`,
    },
  };
}
