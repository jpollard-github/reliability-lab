export class FakeClock {
  #current: number;
  readonly sleeps: number[] = [];
  constructor(start = Date.parse("2026-01-01T00:00:00.000Z")) {
    this.#current = start;
  }
  now() {
    return new Date(this.#current);
  }
  async sleep(milliseconds: number) {
    this.sleeps.push(milliseconds);
    this.#current += milliseconds;
  }
  advance(milliseconds: number) {
    this.#current += milliseconds;
  }
}

export class SequenceIds {
  #execution = 0;
  #event = 0;
  #trace = 0;
  executionId() {
    this.#execution += 1;
    return `execution-${this.#execution}`;
  }
  eventId() {
    this.#event += 1;
    return `event-${this.#event}`;
  }
  traceId() {
    this.#trace += 1;
    return this.#trace.toString(16).padStart(32, "0");
  }
}

export class FixedRandom {
  constructor(readonly value = 0.5) {}
  next() {
    return this.value;
  }
}
