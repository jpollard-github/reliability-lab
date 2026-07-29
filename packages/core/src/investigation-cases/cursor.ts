import { InvestigationCaseInputError } from "./errors.js";

/** Stable updated-time/case-ID cursors for saved-case lists. */
export function encodeCaseCursor(updatedAt: string, caseId: string): string {
  return Buffer.from(JSON.stringify({ v: 1, updatedAt, caseId }), "utf8").toString("base64url");
}

export function decodeCaseCursor(cursor: string): { updatedAt: string; caseId: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      v?: unknown;
      updatedAt?: unknown;
      caseId?: unknown;
    };
    if (
      parsed.v !== 1 ||
      typeof parsed.updatedAt !== "string" ||
      typeof parsed.caseId !== "string" ||
      !parsed.caseId ||
      !Number.isFinite(new Date(parsed.updatedAt).getTime())
    )
      throw new Error("invalid cursor");
    return { updatedAt: new Date(parsed.updatedAt).toISOString(), caseId: parsed.caseId };
  } catch {
    throw new InvestigationCaseInputError("The case cursor is invalid");
  }
}
