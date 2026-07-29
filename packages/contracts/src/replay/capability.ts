import { Type, type Static } from "@sinclair/typebox";

/**
 * Replay availability is a current capability, not a permanent execution flag.
 * Storage adapters determine the state; this module only defines its portable shape.
 */
export const ReplayCapabilityStateSchema = Type.Union([
  Type.Literal("available"),
  Type.Literal("retention_disabled"),
  Type.Literal("expired"),
  Type.Literal("deleted"),
  Type.Literal("missing"),
  Type.Literal("key_unavailable"),
  Type.Literal("unreadable"),
]);
export type ReplayCapabilityState = Static<typeof ReplayCapabilityStateSchema>;

export interface ReplayCapability {
  state: ReplayCapabilityState;
  available: boolean;
  reason: string;
  expiresAt?: string;
  deletedAt?: string;
}
