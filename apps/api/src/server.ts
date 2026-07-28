import { createClient, type RedisClientType } from "redis";
import {
  ExecutionService,
  InvestigationCaseService,
  MapProviderRegistry,
  MemoryComparisonExperimentRepository,
  MemoryExecutionRepository,
  MemoryInvestigationReadRepository,
  MemoryInvestigationCaseRepository,
  MemoryReplayCapsuleStore,
  type ComparisonExperimentRepository,
  type ExecutionRepository,
  type ReplayCapsuleStore,
} from "@reliability-lab/core";
import {
  createDatabase,
  PostgresComparisonExperimentRepository,
  PostgresDurableExecutionStore,
  PostgresExecutionRepository,
  PostgresInvestigationReadRepository,
  PostgresInvestigationCaseRepository,
  PostgresReplayCapsuleStore,
} from "@reliability-lab/db";
import { OpenTelemetryExecutionTracer, startTelemetry } from "@reliability-lab/observability";
import {
  DeterministicFakeProvider,
  OpenAICompatibleHttpProvider,
  type LlmProvider,
} from "@reliability-lab/providers";
import { buildApp } from "./app.js";
import { readExecutionRuntimeConfig, readReplayRuntimeConfig } from "./config.js";

const replayConfig = readReplayRuntimeConfig(process.env);
const executionConfig = readExecutionRuntimeConfig(process.env);
const telemetry = startTelemetry({
  serviceName: process.env.OTEL_SERVICE_NAME ?? "reliability-lab-api",
  ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? { otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }
    : {}),
});

const providers: LlmProvider[] = [
  new DeterministicFakeProvider({ id: "fake-primary", seed: 17 }),
  new DeterministicFakeProvider({ id: "fake-fallback", seed: 29 }),
];
if (
  process.env.OPENAI_COMPATIBLE_BASE_URL &&
  process.env.OPENAI_API_KEY &&
  process.env.OPENAI_MODEL
) {
  providers.push(
    new OpenAICompatibleHttpProvider({
      baseUrl: process.env.OPENAI_COMPATIBLE_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY,
    }),
  );
}

let closeDatabase: (() => Promise<void>) | undefined;
let databasePool: ReturnType<typeof createDatabase>["pool"] | undefined;
let database: ReturnType<typeof createDatabase>["db"] | undefined;
let repository: ExecutionRepository = new MemoryExecutionRepository();
let comparisons: ComparisonExperimentRepository = new MemoryComparisonExperimentRepository();
let durableStore: PostgresDurableExecutionStore | undefined;
if (process.env.DATABASE_URL) {
  const { db, pool } = createDatabase(process.env.DATABASE_URL);
  database = db;
  databasePool = pool;
  repository = new PostgresExecutionRepository(db);
  comparisons = new PostgresComparisonExperimentRepository(db);
  if (executionConfig.mode === "postgres_worker") {
    if (!executionConfig.keyring) {
      throw new Error("PostgreSQL worker command keyring is unavailable");
    }
    durableStore = new PostgresDurableExecutionStore(db, executionConfig.keyring);
  }
  closeDatabase = async () => pool.end();
}
if (executionConfig.mode === "postgres_worker" && !durableStore) {
  throw new Error("EXECUTION_MODE=postgres_worker requires PostgreSQL");
}
if (executionConfig.mode === "postgres_worker" && replayConfig.storeMode !== "postgres") {
  throw new Error(
    "EXECUTION_MODE=postgres_worker requires REPLAY_CAPSULE_STORE=postgres so API and worker share replay capsules",
  );
}

let replayCapsules: ReplayCapsuleStore;
if (replayConfig.storeMode === "postgres") {
  if (!database || !replayConfig.keyring) {
    throw new Error("PostgreSQL replay store prerequisites are unavailable");
  }
  replayCapsules = new PostgresReplayCapsuleStore(database, replayConfig.keyring);
} else {
  replayCapsules = new MemoryReplayCapsuleStore();
}

let redis: RedisClientType | undefined;
if (process.env.REDIS_URL) {
  redis = createClient({ url: process.env.REDIS_URL });
  redis.on("error", (error) => {
    process.stderr.write(`Redis readiness connection error: ${error.message}\n`);
  });
  await redis.connect();
}

const service = new ExecutionService({
  repository,
  comparisons,
  replayCapsules,
  providers: new MapProviderRegistry(providers),
  tracer: new OpenTelemetryExecutionTracer(),
  allowLivePromptRetention: replayConfig.allowLivePromptRetention,
  replayRetentionMs: replayConfig.retentionMs,
  ...(durableStore ? { durableAcceptance: durableStore } : {}),
});
const investigationCases = new InvestigationCaseService({
  cases: database
    ? new PostgresInvestigationCaseRepository(database)
    : new MemoryInvestigationCaseRepository(),
  executions: repository,
  comparisons,
});

const app = await buildApp({
  service,
  investigationCases,
  investigations: database
    ? new PostgresInvestigationReadRepository(database)
    : new MemoryInvestigationReadRepository(repository),
  enableFailureInjection: process.env.ENABLE_FAILURE_INJECTION === "true",
  readiness: async () => {
    const checks: Record<string, string> = {
      repository: database ? "postgres:ok" : "memory:ok",
      execution_mode: executionConfig.mode,
      execution_jobs: durableStore ? "postgres:ok" : "not_configured",
      replay_store: `${replayConfig.storeMode}:ok`,
      redis: redis ? ((await redis.ping()) === "PONG" ? "ok" : "unexpected") : "not_configured",
    };
    if (databasePool) {
      try {
        await databasePool.query("select 1");
        if (replayConfig.storeMode === "postgres") {
          await databasePool.query("select 1 from replay_capsules limit 0");
        }
        await databasePool.query("select 1 from comparison_experiments limit 0");
        await databasePool.query("select 1 from investigation_cases limit 0");
        if (durableStore) await databasePool.query("select 1 from execution_jobs limit 0");
      } catch {
        checks.repository = "postgres:unavailable";
        if (replayConfig.storeMode === "postgres") {
          checks.replay_store = "postgres:unavailable";
        }
        if (durableStore) checks.execution_jobs = "postgres:unavailable";
      }
    }
    return {
      ready: !Object.values(checks).some(
        (value) => value === "unexpected" || value.endsWith(":unavailable"),
      ),
      checks,
    };
  },
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  if (redis) await redis.quit();
  if (closeDatabase) await closeDatabase();
  await telemetry.shutdown();
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host: "0.0.0.0", port: Number(process.env.API_PORT ?? 4000) });
