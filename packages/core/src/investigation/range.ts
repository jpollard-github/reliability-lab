import type { InvestigationRange } from "@reliability-lab/contracts";
import { InvestigationQueryError } from "./read-repository.js";

/**
 * Resolves bounded exact time ranges and validates opaque execution cursors.
 * It does not read executions or calculate aggregate signals.
 */
export const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1_000;
const MAX_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;

export function resolveInvestigationRange(
  input: { from?: string; to?: string },
  now = new Date(),
): InvestigationRange {
  const to = input.to ? parseIsoDate(input.to, "to") : now;
  const from = input.from
    ? parseIsoDate(input.from, "from")
    : new Date(to.getTime() - DEFAULT_RANGE_MS);
  const duration = to.getTime() - from.getTime();
  if (duration <= 0) throw new InvestigationQueryError('"from" must be earlier than "to"');
  if (duration > MAX_RANGE_MS)
    throw new InvestigationQueryError("Investigation ranges cannot exceed 90 days");
  return { from: from.toISOString(), to: to.toISOString() };
}

export function encodeExecutionCursor(createdAt: string, executionId: string): string {
  return Buffer.from(JSON.stringify({ v: 1, createdAt, executionId }), "utf8").toString(
    "base64url",
  );
}

export function decodeExecutionCursor(cursor: string): {
  createdAt: string;
  executionId: string;
} {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      v?: unknown;
      createdAt?: unknown;
      executionId?: unknown;
    };
    if (
      decoded.v !== 1 ||
      typeof decoded.createdAt !== "string" ||
      typeof decoded.executionId !== "string" ||
      decoded.executionId.length === 0
    ) {
      throw new Error("invalid shape");
    }
    parseIsoDate(decoded.createdAt, "cursor createdAt");
    return { createdAt: decoded.createdAt, executionId: decoded.executionId };
  } catch {
    throw new InvestigationQueryError("The investigation cursor is invalid");
  }
}

function parseIsoDate(value: string, label: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || !value.includes("T"))
    throw new InvestigationQueryError(`"${label}" must be a valid ISO-8601 date-time`);
  return date;
}
