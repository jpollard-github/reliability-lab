import type { ExecutionService } from "../execution/execution-service.js";
import { unrefTimer } from "../infrastructure/clock.js";
import { isExecutionContinuationStoppedError } from "./continuation-guard.js";
import {
  LeaseHeartbeatController,
  type LeaseHeartbeatTimers,
} from "./lease-heartbeat-controller.js";
import type { DurableJobStore, JobClaim } from "./job-store.js";

/**
 * Claims durable jobs and delegates execution continuation under a fenced heartbeat guard.
 * It does not implement provider policy or persist command ciphertext itself.
 */
export class DurableExecutionWorker {
  readonly #jobs: DurableJobStore;
  readonly #service: ExecutionService;
  readonly #workerId: string;
  readonly #leaseDurationMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #now: (() => Date) | undefined;
  readonly #timers: LeaseHeartbeatTimers | undefined;
  readonly #activeHeartbeats = new Set<LeaseHeartbeatController>();
  readonly #idleWaiters = new Set<() => void>();
  #acceptingClaims = true;
  #activeRuns = 0;

  constructor(options: {
    jobs: DurableJobStore;
    service: ExecutionService;
    workerId: string;
    leaseDurationMs: number;
    heartbeatIntervalMs: number;
    now?: () => Date;
    timers?: LeaseHeartbeatTimers;
  }) {
    this.#jobs = options.jobs;
    this.#service = options.service;
    this.#workerId = options.workerId;
    this.#leaseDurationMs = options.leaseDurationMs;
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs;
    this.#now = options.now;
    this.#timers = options.timers;
  }

  async runOnce(): Promise<boolean> {
    if (!this.#acceptingClaims) return false;
    this.#activeRuns += 1;
    try {
      return await this.#runOnceClaim();
    } finally {
      this.#activeRuns -= 1;
      if (this.#activeRuns === 0) {
        for (const resolve of this.#idleWaiters) resolve();
        this.#idleWaiters.clear();
      }
    }
  }

  async #runOnceClaim(): Promise<boolean> {
    const job = await this.#jobs.claimNext({
      workerId: this.#workerId,
      leaseDurationMs: this.#leaseDurationMs,
    });
    if (!job) return false;
    const claim: JobClaim = {
      tenantId: job.tenantId,
      executionId: job.executionId,
      workerId: job.workerId,
      claimVersion: job.claimVersion,
      leaseExpiresAt: job.leaseExpiresAt,
    };
    const heartbeat = new LeaseHeartbeatController({
      jobs: this.#jobs,
      claim,
      leaseDurationMs: this.#leaseDurationMs,
      heartbeatIntervalMs: this.#heartbeatIntervalMs,
      ...(this.#now ? { now: this.#now } : {}),
      ...(this.#timers ? { timers: this.#timers } : {}),
    });
    this.#activeHeartbeats.add(heartbeat);
    heartbeat.start();
    try {
      if (!job.command) {
        const safeErrorCode = job.safeErrorCode ?? "execution_command_unavailable";
        await this.#service.failAcceptedExecution(
          job.tenantId,
          job.executionId,
          safeErrorCode,
          heartbeat,
        );
        await this.#jobs.finish({
          claim,
          status: "failed",
          safeErrorCode,
        });
        return true;
      }

      const result = await this.#service.continueAcceptedExecution(
        job.tenantId,
        job.executionId,
        job.command,
        heartbeat,
      );
      const ambiguous =
        result.kind === "ambiguous" ||
        result.execution.error?.code === "provider_call_outcome_unknown";
      await this.#jobs.finish({
        claim,
        status: ambiguous
          ? "ambiguous"
          : result.execution.status === "failed"
            ? "failed"
            : "completed",
        ...(result.execution.error ? { safeErrorCode: result.execution.error.code } : {}),
      });
    } catch (error) {
      if (isExecutionContinuationStoppedError(error)) return true;
      try {
        await heartbeat.assertActive();
        await this.#service.failAcceptedExecution(
          job.tenantId,
          job.executionId,
          "worker_internal_failure",
          heartbeat,
        );
        await this.#jobs.finish({
          claim,
          status: "failed",
          safeErrorCode: "worker_internal_failure",
        });
      } catch (failureError) {
        if (!isExecutionContinuationStoppedError(failureError)) throw failureError;
      }
    } finally {
      await heartbeat.stop();
      this.#activeHeartbeats.delete(heartbeat);
    }
    return true;
  }

  async shutdown(gracePeriodMs: number): Promise<boolean> {
    this.#acceptingClaims = false;
    if (this.#activeRuns === 0) return true;
    if (await this.#waitForIdle(gracePeriodMs)) return true;
    for (const heartbeat of this.#activeHeartbeats) heartbeat.cancel();
    return this.#waitForIdle(Math.min(1_000, gracePeriodMs));
  }

  async #waitForIdle(timeoutMs: number): Promise<boolean> {
    if (this.#activeRuns === 0) return true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<true>((resolve) => {
      const onIdle = () => resolve(true);
      this.#idleWaiters.add(onIdle);
    });
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
      unrefTimer(timeout);
    });
    const result = await Promise.race([idle, timedOut]);
    if (timeout) clearTimeout(timeout);
    return result;
  }
}
