/**
 * Fastify composition root: infrastructure, safe error handling, and feature route plugins.
 * Route schemas and handlers live with their domain route family.
 */
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify from "fastify";
import { pinoRedactionPaths } from "@reliability-lab/observability";
import type { AppOptions } from "./app-options.js";
import { installErrorHandler } from "./http/error-mapper.js";
import { registerPlatformPlugins } from "./plugins/platform.js";
import { comparisonRoutes } from "./routes/comparisons.js";
import { executionEventRoutes } from "./routes/execution-events.js";
import { executionRoutes } from "./routes/executions.js";
import { investigationCaseRoutes } from "./routes/investigation-cases.js";
import { investigationRoutes } from "./routes/investigations.js";
import { operationsRoutes } from "./routes/operations.js";
import { replayRoutes } from "./routes/replay.js";

export async function buildApp(options: AppOptions) {
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } },
    logger:
      options.logger ??
      ({
        level: process.env.LOG_LEVEL ?? "info",
        redact: { paths: pinoRedactionPaths, censor: "[REDACTED]" },
      } as const),
  }).withTypeProvider<TypeBoxTypeProvider>();

  await registerPlatformPlugins(app);
  installErrorHandler(app);

  await app.register(operationsRoutes, {
    ...(options.readiness === undefined ? {} : { readiness: options.readiness }),
  });
  await app.register(executionRoutes, {
    service: options.service,
    ...(options.enableFailureInjection === undefined
      ? {}
      : { enableFailureInjection: options.enableFailureInjection }),
  });
  await app.register(replayRoutes, { service: options.service });
  await app.register(investigationRoutes, { investigations: options.investigations });
  await app.register(investigationCaseRoutes, {
    investigationCases: options.investigationCases,
  });
  await app.register(executionEventRoutes, {
    service: options.service,
    ...(options.eventStreamPollMs === undefined
      ? {}
      : { eventStreamPollMs: options.eventStreamPollMs }),
    ...(options.eventStreamHeartbeatMs === undefined
      ? {}
      : { eventStreamHeartbeatMs: options.eventStreamHeartbeatMs }),
  });
  await app.register(comparisonRoutes, { service: options.service });

  return app;
}
