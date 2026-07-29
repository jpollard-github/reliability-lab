import { abortReason, unrefTimer } from "../infrastructure/clock.js";
import {
  ExecutionContinuationStoppedError,
  LeaseOwnershipLostError,
  isLeaseOwnershipLostError,
  type ExecutionContinuationGuard,
} from "./continuation-guard.js";
import type { DurableJobStore, JobClaim } from "./job-store.js";

/**
 * Serializes heartbeat observation and aborts continuation when ownership cannot be confirmed.
 * It does not claim jobs or record provider failures; claim version and deadline remain authoritative.
 */
export interface LeaseHeartbeatTimers {
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const systemLeaseHeartbeatTimers: LeaseHeartbeatTimers = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (timer) => clearTimeout(timer),
};

export class LeaseHeartbeatController implements ExecutionContinuationGuard {
  readonly #jobs: DurableJobStore;
  readonly #claim: JobClaim;
  readonly #leaseDurationMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #now: () => Date;
  readonly #timers: LeaseHeartbeatTimers;
  readonly #abortController = new AbortController();
  #confirmedLeaseExpiresAtMs: number;
  #heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  #deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatInFlight: Promise<void> | undefined;
  #started = false;
  #stopped = false;

  constructor(options: {
    jobs: DurableJobStore;
    claim: JobClaim;
    leaseDurationMs: number;
    heartbeatIntervalMs: number;
    now?: () => Date;
    timers?: LeaseHeartbeatTimers;
  }) {
    this.#jobs = options.jobs;
    this.#claim = { ...options.claim };
    this.#leaseDurationMs = options.leaseDurationMs;
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs;
    this.#now = options.now ?? (() => new Date());
    this.#timers = options.timers ?? systemLeaseHeartbeatTimers;
    this.#confirmedLeaseExpiresAtMs = parseLeaseDeadline(options.claim.leaseExpiresAt);
  }

  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  get confirmedLeaseExpiresAt(): string {
    return new Date(this.#confirmedLeaseExpiresAtMs).toISOString();
  }

  start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    if (!this.#deadlineStillValid()) {
      this.#loseOwnership();
      return;
    }
    this.#scheduleDeadline();
    this.#scheduleHeartbeat(this.#heartbeatIntervalMs);
  }

  cancel(reason = new ExecutionContinuationStoppedError()): void {
    if (!this.signal.aborted) this.#abortController.abort(reason);
    this.#clearTimers();
  }

  async assertActive(): Promise<void> {
    while (true) {
      this.#throwIfInactive();
      if (!this.#deadlineStillValid()) {
        this.#loseOwnership();
        this.#throwIfInactive();
      }
      try {
        const outcome = await this.#jobs.assertOwned(this.#claim);
        if (outcome.kind === "ownership_lost") {
          this.#loseOwnership();
          throw abortReason(this.signal);
        }
        this.#confirmLease(outcome.leaseExpiresAt);
        return;
      } catch (error) {
        if (isLeaseOwnershipLostError(error)) throw error;
        this.#throwIfInactive();
        const remainingMs = this.#confirmedLeaseExpiresAtMs - this.#now().getTime();
        if (remainingMs <= 0) {
          this.#loseOwnership();
          this.#throwIfInactive();
        }
        await this.#wait(Math.min(this.#heartbeatIntervalMs, remainingMs));
      }
    }
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#clearTimers();
    await this.#heartbeatInFlight;
  }

  #scheduleHeartbeat(milliseconds: number): void {
    if (this.#stopped || this.signal.aborted || this.#heartbeatTimer) return;
    this.#heartbeatTimer = this.#timers.setTimeout(
      () => {
        this.#heartbeatTimer = undefined;
        const heartbeat = this.#renewLease();
        this.#heartbeatInFlight = heartbeat;
        void heartbeat.finally(() => {
          if (this.#heartbeatInFlight === heartbeat) this.#heartbeatInFlight = undefined;
        });
      },
      Math.max(0, milliseconds),
    );
    unrefTimer(this.#heartbeatTimer);
  }

  #scheduleDeadline(): void {
    if (this.#stopped || this.signal.aborted) return;
    if (this.#deadlineTimer) this.#timers.clearTimeout(this.#deadlineTimer);
    const remainingMs = Math.max(0, this.#confirmedLeaseExpiresAtMs - this.#now().getTime());
    this.#deadlineTimer = this.#timers.setTimeout(() => {
      this.#deadlineTimer = undefined;
      if (this.#deadlineStillValid()) {
        this.#scheduleDeadline();
      } else {
        this.#loseOwnership();
      }
    }, remainingMs);
    unrefTimer(this.#deadlineTimer);
  }

  async #renewLease(): Promise<void> {
    if (this.#stopped || this.signal.aborted) return;
    if (!this.#deadlineStillValid()) {
      this.#loseOwnership();
      return;
    }
    try {
      const outcome = await this.#jobs.heartbeat({
        claim: this.#claim,
        leaseDurationMs: this.#leaseDurationMs,
      });
      if (outcome.kind === "ownership_lost") {
        this.#loseOwnership();
        return;
      }
      this.#confirmLease(outcome.leaseExpiresAt);
    } catch {
      if (!this.#deadlineStillValid()) {
        this.#loseOwnership();
        return;
      }
    }
    this.#scheduleHeartbeat(this.#heartbeatIntervalMs);
  }

  #confirmLease(leaseExpiresAt: string): void {
    const leaseExpiresAtMs = parseLeaseDeadline(leaseExpiresAt);
    if (leaseExpiresAtMs <= this.#now().getTime()) {
      this.#loseOwnership();
      this.#throwIfInactive();
    }
    this.#confirmedLeaseExpiresAtMs = leaseExpiresAtMs;
    this.#scheduleDeadline();
  }

  #deadlineStillValid(): boolean {
    return this.#now().getTime() < this.#confirmedLeaseExpiresAtMs;
  }

  #loseOwnership(): void {
    if (!this.signal.aborted) this.#abortController.abort(new LeaseOwnershipLostError());
    this.#clearTimers();
  }

  #throwIfInactive(): void {
    if (this.signal.aborted) throw abortReason(this.signal);
  }

  async #wait(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (this.signal.aborted) {
        reject(abortReason(this.signal));
        return;
      }
      const onAbort = () => {
        this.#timers.clearTimeout(timer);
        reject(abortReason(this.signal));
      };
      const timer = this.#timers.setTimeout(
        () => {
          this.signal.removeEventListener("abort", onAbort);
          resolve();
        },
        Math.max(0, milliseconds),
      );
      unrefTimer(timer);
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  #clearTimers(): void {
    if (this.#heartbeatTimer) {
      this.#timers.clearTimeout(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    if (this.#deadlineTimer) {
      this.#timers.clearTimeout(this.#deadlineTimer);
      this.#deadlineTimer = undefined;
    }
  }
}

function parseLeaseDeadline(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("Lease deadline is invalid");
  return milliseconds;
}
