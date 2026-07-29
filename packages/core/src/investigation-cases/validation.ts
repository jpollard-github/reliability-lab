import type { InvestigationRange } from "@reliability-lab/contracts";
import { resolveInvestigationRange } from "../investigation/range.js";
import { InvestigationCaseInputError } from "./errors.js";

/** Shared saved-case text and exact-range validation without persistence concerns. */
export function canonicalArray<T extends string>(values: T[] | undefined): T[] {
  return [...new Set((values ?? []).map((value) => value.trim() as T).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function exactRange(range: InvestigationRange): InvestigationRange {
  if (!range?.from || !range.to)
    throw new InvestigationCaseInputError("Saved scope requires exact from and to instants");
  try {
    return resolveInvestigationRange({ from: range.from, to: range.to });
  } catch (error) {
    throw new InvestigationCaseInputError(
      error instanceof Error ? error.message : "Saved scope range is invalid",
    );
  }
}

export function plainText(value: string, label: string, minimum: number, maximum: number): string {
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum)
    throw new InvestigationCaseInputError(
      `${label} must be between ${minimum} and ${maximum} characters`,
    );
  if (/<\/?[a-z][^>]*>/iu.test(trimmed))
    throw new InvestigationCaseInputError(`${label} must be plain text without HTML`);
  return trimmed;
}
