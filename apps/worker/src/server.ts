import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { hostname } from "node:os";
import {
  DurableExecutionWorker,
  ExecutionService,
  MapProviderRegistry,
} from "@reliability-lab/core";
import {
  createDatabase,
  PostgresComparisonExperimentRepository,
  PostgresDurableExecutionStore,
  PostgresExecutionRepository,
  PostgresReplayCapsuleStore,
  readExecutionRuntimeConfig,
  readReplayRuntimeConfig,
} from "@reliability-lab/db";
import { OpenTelemetryExecutionTracer, startTelemetry } from "@reliability-lab/observability";
import { buildProviderRuntime } from "@reliability-lab/providers";
import { readWorkerRuntimeConfig } from "./config.js";

if (process.env.RELIABILITY_LAB_RUNTIME_IMPORT_SMOKE === "true") {
  process.stdout.write("worker built-runtime imports resolved\n");
  process.exit(0);
}

const executionConfig = readExecutionRuntimeConfig(process.env);
if (executionConfig.mode !== "postgres_worker" || !executionConfig.keyring) {
  throw new Error("The worker requires EXECUTION_MODE=postgres_worker and command encryption keys");
}
const replayConfig = readReplayRuntimeConfig(process.env);
if (replayConfig.storeMode !== "postgres" || !replayConfig.keyring) {
  throw new Error("The worker requires REPLAY_CAPSULE_STORE=postgres and replay encryption keys");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("The worker requires DATABASE_URL");
const workerConfig = readWorkerRuntimeConfig(process.env);
const workerId = workerConfig.workerId ?? `${hostname()}:${process.pid}:${randomUUID()}`;

const telemetry = startTelemetry({
  serviceName: process.env.WORKER_OTEL_SERVICE_NAME ?? "reliability-lab-worker",
  ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? { otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }
    : {}),
});
const { db, pool } = createDatabase(databaseUrl);
await pool.query("select 1 from execution_jobs limit 0");
await pool.query("select 1 from replay_capsules limit 0");
await pool.query("select 1 from comparison_experiments limit 0");
const jobs = new PostgresDurableExecutionStore(db, executionConfig.keyring);
const replayCapsules = new PostgresReplayCapsuleStore(db, replayConfig.keyring);
const providerRuntime = buildProviderRuntime(process.env);

const service = new ExecutionService({
  repository: new PostgresExecutionRepository(db),
  comparisons: new PostgresComparisonExperimentRepository(db),
  replayCapsules,
  providers: new MapProviderRegistry(providerRuntime.providers),
  tracer: new OpenTelemetryExecutionTracer(),
  allowLivePromptRetention: replayConfig.allowLivePromptRetention,
  replayRetentionMs: replayConfig.retentionMs,
});
const worker = new DurableExecutionWorker({
  jobs,
  service,
  workerId,
  leaseDurationMs: workerConfig.leaseDurationMs,
  heartbeatIntervalMs: workerConfig.heartbeatIntervalMs,
});
const healthServer = createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", executionMode: executionConfig.mode }));
    return;
  }
  response.writeHead(404).end();
});
await new Promise<void>((resolve, reject) => {
  healthServer.once("error", reject);
  healthServer.listen(workerConfig.healthPort, "127.0.0.1", resolve);
});

let stopping = false;
let wakePoll: (() => void) | undefined;
const delay = async (milliseconds: number) =>
  new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      wakePoll = undefined;
      resolve();
    }, milliseconds);
    wakePoll = () => {
      clearTimeout(timeout);
      wakePoll = undefined;
      resolve();
    };
  });
const loop = async () => {
  while (!stopping) {
    try {
      const claimed = await Promise.all(
        Array.from({ length: workerConfig.concurrency }, () => worker.runOnce()),
      );
      if (!claimed.some(Boolean)) await delay(workerConfig.pollIntervalMs);
    } catch {
      process.stderr.write("Durable worker polling failed; retrying after the poll interval\n");
      await delay(workerConfig.pollIntervalMs);
    }
  }
};

const running = loop();
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  wakePoll?.();
  const drained = await worker.shutdown(workerConfig.shutdownGraceMs);
  await Promise.race([
    running,
    new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1_000);
      timeout.unref();
    }),
  ]);
  if (!drained) {
    process.exitCode = 1;
    process.stderr.write(
      "Durable worker shutdown grace expired; active continuation was stopped without releasing its claim\n",
    );
  }
  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
  await telemetry.shutdown();
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.stdout.write(
  `Durable execution worker started as ${workerId}; health port ${workerConfig.healthPort}\n`,
);
