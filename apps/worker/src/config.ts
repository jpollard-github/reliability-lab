interface WorkerRuntimeConfig {
  workerId?: string;
  healthPort: number;
  pollIntervalMs: number;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  concurrency: number;
}

export function readWorkerRuntimeConfig(environment: NodeJS.ProcessEnv): WorkerRuntimeConfig {
  const workerId = environment.WORKER_ID || undefined;
  if (workerId && !/^[A-Za-z0-9._:-]{1,128}$/.test(workerId)) {
    throw new Error("WORKER_ID must use 1-128 safe identifier characters");
  }
  const healthPort = readInteger(environment.WORKER_HEALTH_PORT, 4_001, 1, 65_535);
  const pollIntervalMs = readInteger(environment.WORKER_POLL_INTERVAL_MS, 250, 10, 60_000);
  const leaseDurationMs = readInteger(environment.WORKER_LEASE_DURATION_MS, 30_000, 1_000, 300_000);
  const heartbeatIntervalMs = readInteger(
    environment.WORKER_HEARTBEAT_INTERVAL_MS,
    10_000,
    100,
    299_999,
  );
  const concurrency = readInteger(environment.WORKER_CONCURRENCY, 1, 1, 16);
  if (heartbeatIntervalMs >= leaseDurationMs) {
    throw new Error("WORKER_HEARTBEAT_INTERVAL_MS must be less than WORKER_LEASE_DURATION_MS");
  }
  return {
    ...(workerId ? { workerId } : {}),
    healthPort,
    pollIntervalMs,
    leaseDurationMs,
    heartbeatIntervalMs,
    concurrency,
  };
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Worker setting must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}
