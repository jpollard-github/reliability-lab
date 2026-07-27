import { createClient, type RedisClientType } from "redis";
import {
  ExecutionService,
  MapProviderRegistry,
  MemoryExecutionRepository,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { createDatabase, PostgresExecutionRepository } from "@reliability-lab/db";
import { OpenTelemetryExecutionTracer, startTelemetry } from "@reliability-lab/observability";
import {
  DeterministicFakeProvider,
  OpenAICompatibleHttpProvider,
  type LlmProvider,
} from "@reliability-lab/providers";
import { buildApp } from "./app.js";

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
let repository = new MemoryExecutionRepository();
if (process.env.DATABASE_URL) {
  const { db, pool } = createDatabase(process.env.DATABASE_URL);
  repository = new PostgresExecutionRepository(db) as unknown as MemoryExecutionRepository;
  closeDatabase = async () => pool.end();
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
  replayCapsules: new MemoryReplayCapsuleStore(),
  providers: new MapProviderRegistry(providers),
  tracer: new OpenTelemetryExecutionTracer(),
  allowLivePromptRetention: process.env.ALLOW_LIVE_PROMPT_RETENTION === "true",
});

const app = await buildApp({
  service,
  enableFailureInjection: process.env.ENABLE_FAILURE_INJECTION === "true",
  readiness: async () => {
    const checks: Record<string, string> = {
      repository: process.env.DATABASE_URL ? "postgres:ok" : "memory:ok",
      redis: redis ? ((await redis.ping()) === "PONG" ? "ok" : "unexpected") : "not_configured",
    };
    return { ready: !Object.values(checks).includes("unexpected"), checks };
  },
});

const shutdown = async () => {
  await app.close();
  if (redis) await redis.quit();
  if (closeDatabase) await closeDatabase();
  await telemetry.shutdown();
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await app.listen({ host: "0.0.0.0", port: Number(process.env.API_PORT ?? 4000) });
