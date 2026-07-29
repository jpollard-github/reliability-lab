/** Normalizes established repeated/comma-separated query values and exact investigation ranges. */
import { InvestigationQueryError, resolveInvestigationRange } from "@reliability-lab/core";

export function investigationRange(query: { from?: string; to?: string }) {
  if (Boolean(query.from) !== Boolean(query.to))
    throw new InvestigationQueryError('"from" and "to" must be supplied together');
  return resolveInvestigationRange(query);
}

export function arrayValue<T>(value: T | T[]): T[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) =>
    typeof item === "string"
      ? (item
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean) as T[])
      : [item],
  );
}
