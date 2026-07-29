import type {
  ExecutionEnvelope,
  ExecutionEvent,
  ExecutionEventPayload,
} from "@reliability-lab/contracts";
import type { Clock, IdSource } from "../infrastructure/clock.js";
import type { ExecutionRepository } from "./ports.js";

/**
 * Constructs execution events and optionally persists the newly appended event.
 * Callers provide only explicit payloads; generated metadata is assigned exactly once here.
 */
export class ExecutionEventRecorder {
  readonly #repository: ExecutionRepository;
  readonly #ids: IdSource;
  readonly #clock: Clock;

  constructor(options: { repository: ExecutionRepository; ids: IdSource; clock: Clock }) {
    this.#repository = options.repository;
    this.#ids = options.ids;
    this.#clock = options.clock;
  }

  add(execution: ExecutionEnvelope, payload: ExecutionEventPayload): ExecutionEvent {
    const event = {
      ...payload,
      schemaVersion: 1,
      eventId: this.#ids.eventId(),
      executionId: execution.executionId,
      sequence: execution.events.length + 1,
      occurredAt: this.#clock.now().toISOString(),
    } satisfies ExecutionEvent;
    execution.events.push(event);
    return event;
  }

  async append(
    execution: ExecutionEnvelope,
    payload: ExecutionEventPayload,
  ): Promise<ExecutionEvent> {
    const event = this.add(execution, payload);
    await this.#repository.appendEvent(event);
    return event;
  }
}
