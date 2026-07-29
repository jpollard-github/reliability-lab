/**
 * Execution transport schemas. ExecutionEnvelope uses Type.Unsafe because the established
 * contract exposes a TypeScript interface but no complete runtime schema.
 */
import { Type } from "@sinclair/typebox";
import {
  ExecutionStatusSchema,
  ReplayCapabilityStateSchema,
  type ExecutionEnvelope,
} from "@reliability-lab/contracts";

export const ExecutionParamsSchema = Type.Object({
  executionId: Type.String({ minLength: 1 }),
});

export const ExecutionEventQuerySchema = Type.Object({
  after: Type.Optional(Type.Integer({ minimum: 0 })),
});

export const ExecutionEventHeadersSchema = Type.Object({
  "x-tenant-id": Type.String({ minLength: 1, maxLength: 128 }),
  "last-event-id": Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
});

const LinkSchema = Type.Object({
  self: Type.String(),
  replay: Type.String(),
});

export const SubmissionResponseSchema = Type.Object({
  executionId: Type.String(),
  status: ExecutionStatusSchema,
  traceId: Type.String(),
  links: LinkSchema,
});

export const ReplayCapabilitySchema = Type.Object(
  {
    state: ReplayCapabilityStateSchema,
    available: Type.Boolean(),
    reason: Type.String(),
    expiresAt: Type.Optional(Type.String()),
    deletedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ExecutionEnvelopeSchema = Type.Unsafe<ExecutionEnvelope>({
  type: "object",
  required: [
    "schemaVersion",
    "executionId",
    "tenantId",
    "status",
    "provider",
    "model",
    "traceId",
    "requestHash",
    "policy",
    "budget",
    "attempts",
    "events",
    "createdAt",
    "updatedAt",
    "replayCapability",
    "replayable",
  ],
  additionalProperties: true,
  properties: {
    schemaVersion: { const: 1 },
    executionId: { type: "string" },
    tenantId: { type: "string" },
    status: { enum: ["queued", "running", "succeeded", "degraded", "failed", "cancelled"] },
    provider: { type: "string" },
    model: { type: "string" },
    traceId: { type: "string" },
    requestHash: { type: "string" },
    policy: { type: "object", additionalProperties: true },
    budget: { type: "object", additionalProperties: true },
    attempts: { type: "array" },
    events: { type: "array" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    replayCapability: ReplayCapabilitySchema,
    replayable: { type: "boolean" },
  },
});

export const ExecutionListSchema = Type.Object({
  data: Type.Array(ExecutionEnvelopeSchema),
  count: Type.Integer(),
});
