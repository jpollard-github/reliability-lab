import type { ExecutionEvent } from "@reliability-lab/contracts";

export function mergeExecutionEvents(
  current: ExecutionEvent[],
  incoming: ExecutionEvent[],
): ExecutionEvent[] {
  return [
    ...new Map([...current, ...incoming].map((event) => [event.sequence, event])).values(),
  ].sort((left, right) => left.sequence - right.sequence);
}

export function extractSseFrames(value: string): {
  frames: Array<{ event: string; data: string }>;
  remainder: string;
} {
  const sections = value.split(/\r?\n\r?\n/);
  const remainder = sections.pop() ?? "";
  return {
    frames: sections.flatMap((section) => {
      if (section.startsWith(":")) return [];
      let event = "message";
      const data: string[] = [];
      for (const line of section.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      return data.length > 0 ? [{ event, data: data.join("\n") }] : [];
    }),
    remainder,
  };
}

export function parseExecutionEvent(value: string): ExecutionEvent | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("eventId" in parsed) ||
      typeof parsed.eventId !== "string" ||
      !("sequence" in parsed) ||
      typeof parsed.sequence !== "number" ||
      !("type" in parsed) ||
      typeof parsed.type !== "string" ||
      !("occurredAt" in parsed) ||
      typeof parsed.occurredAt !== "string"
    ) {
      return null;
    }
    return parsed as ExecutionEvent;
  } catch {
    return null;
  }
}
