import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { Type, type Static } from "@sinclair/typebox";
import Fastify, { type FastifyBaseLogger } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  CreateComparisonBodySchema,
  CreateExecutionBodySchema,
  ExecutionStatusSchema,
  ReplayCapabilityStateSchema,
  type ComparisonView,
  type ExecutionEnvelope,
} from "@reliability-lab/contracts";
import {
  ComparisonNotFoundError,
  ExecutionNotFoundError,
  IdempotencyConflictError,
  RateLimitRejectedError,
  type ExecutionService,
} from "@reliability-lab/core";
import { pinoRedactionPaths } from "@reliability-lab/observability";
import {
  followExecutionEvents,
  formatExecutionSse,
  isTerminalExecutionEvent,
} from "./event-stream.js";

const TenantHeadersSchema = Type.Object({
  "x-tenant-id": Type.String({ minLength: 1, maxLength: 128 }),
  "idempotency-key": Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
});
const TenantOnlyHeadersSchema = Type.Object({
  "x-tenant-id": Type.String({ minLength: 1, maxLength: 128 }),
});
const ExecutionParamsSchema = Type.Object({
  executionId: Type.String({ minLength: 1 }),
});
const ComparisonParamsSchema = Type.Object({
  experimentId: Type.String({ minLength: 1 }),
});
const ExecutionEventQuerySchema = Type.Object({
  after: Type.Optional(Type.Integer({ minimum: 0 })),
});
const ExecutionEventHeadersSchema = Type.Object({
  "x-tenant-id": Type.String({ minLength: 1, maxLength: 128 }),
  "last-event-id": Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
});
const LinkSchema = Type.Object({
  self: Type.String(),
  replay: Type.String(),
});
const SubmissionResponseSchema = Type.Object({
  executionId: Type.String(),
  status: ExecutionStatusSchema,
  traceId: Type.String(),
  links: LinkSchema,
});
const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  statusCode: Type.Integer(),
});
const ReplayCapabilitySchema = Type.Object(
  {
    state: ReplayCapabilityStateSchema,
    available: Type.Boolean(),
    reason: Type.String(),
    expiresAt: Type.Optional(Type.String()),
    deletedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
const ExecutionEnvelopeSchema = Type.Unsafe<ExecutionEnvelope>({
  type: "object",
  required: [
    "schemaVersion",
    "executionId",
    "tenantId",
    "status",
    "provider",
    "model",
    "traceId",
    "requestHash",
    "policy",
    "budget",
    "attempts",
    "events",
    "createdAt",
    "updatedAt",
    "replayCapability",
    "replayable",
  ],
  additionalProperties: true,
  properties: {
    schemaVersion: { const: 1 },
    executionId: { type: "string" },
    tenantId: { type: "string" },
    status: { enum: ["queued", "running", "succeeded", "degraded", "failed", "cancelled"] },
    provider: { type: "string" },
    model: { type: "string" },
    traceId: { type: "string" },
    requestHash: { type: "string" },
    policy: { type: "object" },
    budget: { type: "object" },
    attempts: { type: "array" },
    events: { type: "array" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    replayCapability: ReplayCapabilitySchema,
    replayable: { type: "boolean" },
  },
});
const ExecutionListSchema = Type.Object({
  data: Type.Array(ExecutionEnvelopeSchema),
  count: Type.Integer(),
});
const ReplayResponseSchema = Type.Union([
  Type.Object({
    replayable: Type.Literal(true),
    originalExecutionId: Type.String(),
    replayExecution: ExecutionEnvelopeSchema,
    outcomeMatches: Type.Boolean(),
  }),
  Type.Object({
    replayable: Type.Literal(false),
    originalExecutionId: Type.String(),
    reason: Type.String(),
    capability: ReplayCapabilitySchema,
  }),
]);
const DeleteReplayResponseSchema = Type.Object({
  executionId: Type.String(),
  deleted: Type.Boolean(),
  replayCapability: ReplayCapabilitySchema,
});
const ComparisonExperimentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    experimentId: Type.String(),
    tenantId: Type.String(),
    originalExecutionId: Type.String(),
    variantExecutionId: Type.Optional(Type.String()),
    status: Type.Union([
      Type.Literal("running"),
      Type.Literal("completed"),
      Type.Literal("unavailable"),
    ]),
    requestedVariation: Type.Object({}, { additionalProperties: true }),
    resolvedVariant: Type.Object({}, { additionalProperties: true }),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    unavailableReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
const ComparisonSubmissionResponseSchema = Type.Object({
  experiment: ComparisonExperimentSchema,
  links: Type.Object({
    self: Type.String(),
    originalExecution: Type.String(),
    variantExecution: Type.Optional(Type.String()),
  }),
});
const ComparisonViewSchema = Type.Unsafe<ComparisonView>({
  type: "object",
  required: ["experiment", "originalExecution", "projection"],
  additionalProperties: false,
  properties: {
    experiment: ComparisonExperimentSchema,
    originalExecution: ExecutionEnvelopeSchema,
    variantExecution: ExecutionEnvelopeSchema,
    projection: { type: "object", additionalProperties: true },
  },
});

interface AppOptions {
  service: ExecutionService;
  readiness?: () => Promise<{ ready: boolean; checks: Record<string, string> }>;
  logger?: FastifyBaseLogger | boolean;
  enableFailureInjection?: boolean;
  eventStreamPollMs?: number;
  eventStreamHeartbeatMs?: number;
}

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

  await app.register(cors, {
    origin: process.env.NODE_ENV === "production" ? false : true,
    methods: ["GET", "HEAD", "POST", "DELETE"],
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Reliability Lab API",
        description: "Validated execution, inspection, and deterministic replay endpoints.",
        version: "0.1.0",
      },
      components: {
        securitySchemes: {
          tenant: { type: "apiKey", in: "header", name: "X-Tenant-Id" },
        },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  app.get(
    "/healthz",
    {
      schema: {
        tags: ["operations"],
        response: { 200: Type.Object({ status: Type.Literal("ok") }) },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  app.get(
    "/readyz",
    {
      schema: {
        tags: ["operations"],
        response: {
          200: Type.Object({
            status: Type.Literal("ready"),
            checks: Type.Record(Type.String(), Type.String()),
          }),
          503: Type.Object({
            status: Type.Literal("not_ready"),
            checks: Type.Record(Type.String(), Type.String()),
          }),
        },
      },
    },
    async (_request, reply) => {
      const result = await (options.readiness?.() ??
        Promise.resolve({ ready: true, checks: { repository: "memory" } }));
      return result.ready
        ? { status: "ready" as const, checks: result.checks }
        : reply.code(503).send({ status: "not_ready" as const, checks: result.checks });
    },
  );

  app.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());

  app.post(
    "/v1/executions",
    {
      schema: {
        tags: ["executions"],
        security: [{ tenant: [] }],
        headers: TenantHeadersSchema,
        body: CreateExecutionBodySchema,
        response: {
          202: SubmissionResponseSchema,
          400: ErrorSchema,
          409: ErrorSchema,
          429: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.body.failureMode && !options.enableFailureInjection) {
        return reply.code(400).send({
          error: "failure_injection_disabled",
          message: "Set ENABLE_FAILURE_INJECTION=true only in a safe local environment",
          statusCode: 400,
        });
      }
      const submission = await options.service.submit({
        tenantId: request.headers["x-tenant-id"],
        ...(request.headers["idempotency-key"]
          ? { idempotencyKey: request.headers["idempotency-key"] }
          : {}),
        body: request.body,
      });
      request.log.info(
        {
          executionId: submission.execution.executionId,
          tenantId: submission.execution.tenantId,
          traceId: submission.execution.traceId,
          status: submission.execution.status,
        },
        "execution accepted",
      );
      void submission.completion.then(
        (execution) => {
          app.log.info(
            {
              executionId: execution.executionId,
              tenantId: execution.tenantId,
              traceId: execution.traceId,
              status: execution.status,
            },
            "execution completed",
          );
        },
        () => {
          app.log.error(
            {
              executionId: submission.execution.executionId,
              tenantId: submission.execution.tenantId,
              traceId: submission.execution.traceId,
            },
            "execution continuation could not persist a terminal result",
          );
        },
      );
      return reply.code(202).send(submissionResponse(submission.execution));
    },
  );

  app.delete(
    "/v1/executions/:executionId/replay-capsule",
    {
      schema: {
        tags: ["replay"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: ExecutionParamsSchema,
        response: {
          200: DeleteReplayResponseSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request) => {
      const result = await options.service.deleteReplayCapsule(
        request.headers["x-tenant-id"],
        request.params.executionId,
      );
      return {
        executionId: request.params.executionId,
        deleted: result.deleted,
        replayCapability: result.capability,
      };
    },
  );

  app.get(
    "/v1/executions",
    {
      schema: {
        tags: ["executions"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        response: { 200: ExecutionListSchema },
      },
    },
    async (request) => {
      const data = await options.service.list(request.headers["x-tenant-id"]);
      return { data, count: data.length };
    },
  );

  app.get(
    "/v1/executions/:executionId",
    {
      schema: {
        tags: ["executions"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: ExecutionParamsSchema,
        response: { 200: ExecutionEnvelopeSchema, 404: ErrorSchema },
      },
    },
    async (request) =>
      options.service.get(request.headers["x-tenant-id"], request.params.executionId),
  );

  app.get(
    "/v1/executions/:executionId/events",
    {
      schema: {
        tags: ["executions"],
        security: [{ tenant: [] }],
        headers: ExecutionEventHeadersSchema,
        params: ExecutionParamsSchema,
        querystring: ExecutionEventQuerySchema,
        response: { 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const headerCursor = Number(request.headers["last-event-id"] ?? 0);
      const cursor = Math.max(request.query.after ?? 0, headerCursor);
      const initialEvents = await options.service.eventsAfter(
        request.headers["x-tenant-id"],
        request.params.executionId,
        cursor,
      );
      if (!initialEvents) {
        return reply.code(404).send({
          error: "not_found",
          message: "Execution not found",
          statusCode: 404,
        });
      }
      const terminalSnapshot = !initialEvents.some(isTerminalExecutionEvent)
        ? await options.service.get(request.headers["x-tenant-id"], request.params.executionId)
        : null;
      const caughtUpTerminalStatus =
        terminalSnapshot?.status === "succeeded" ||
        terminalSnapshot?.status === "degraded" ||
        terminalSnapshot?.status === "failed" ||
        terminalSnapshot?.status === "cancelled"
          ? terminalSnapshot.status
          : null;

      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
      reply.raw.setHeader("cache-control", "no-cache, no-transform");
      reply.raw.setHeader("connection", "keep-alive");
      reply.raw.setHeader("x-accel-buffering", "no");
      if (process.env.NODE_ENV !== "production" && request.headers.origin) {
        reply.raw.setHeader("access-control-allow-origin", request.headers.origin);
        reply.raw.setHeader("vary", "Origin");
      }
      reply.raw.flushHeaders();

      const controller = new AbortController();
      reply.raw.on("close", () => controller.abort());
      try {
        if (caughtUpTerminalStatus) {
          reply.raw.write(
            `event: complete\ndata: ${JSON.stringify({ status: caughtUpTerminalStatus })}\n\n`,
          );
          return reply;
        }
        for await (const item of followExecutionEvents({
          initialEvents,
          afterSequence: cursor,
          readAfter: async (afterSequence) =>
            options.service.eventsAfter(
              request.headers["x-tenant-id"],
              request.params.executionId,
              afterSequence,
            ),
          signal: controller.signal,
          ...(options.eventStreamPollMs === undefined ? {} : { pollMs: options.eventStreamPollMs }),
          ...(options.eventStreamHeartbeatMs === undefined
            ? {}
            : { heartbeatMs: options.eventStreamHeartbeatMs }),
        })) {
          reply.raw.write(
            item.type === "event" ? formatExecutionSse(item.event) : ": heartbeat\n\n",
          );
        }
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
      return reply;
    },
  );

  app.post(
    "/v1/executions/:executionId/replay",
    {
      schema: {
        tags: ["replay"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: ExecutionParamsSchema,
        response: { 202: ReplayResponseSchema, 404: ErrorSchema, 409: ReplayResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await options.service.replay(
        request.headers["x-tenant-id"],
        request.params.executionId,
      );
      return reply.code(result.replayable ? 202 : 409).send(result);
    },
  );

  app.post(
    "/v1/executions/:executionId/comparisons",
    {
      schema: {
        tags: ["comparisons"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: ExecutionParamsSchema,
        body: CreateComparisonBodySchema,
        response: {
          202: ComparisonSubmissionResponseSchema,
          400: ErrorSchema,
          404: ErrorSchema,
          409: ComparisonSubmissionResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const submission = await options.service.createComparison(
        request.headers["x-tenant-id"],
        request.params.executionId,
        request.body.variation,
      );
      if (submission.completion) {
        void submission.completion.catch(() => {
          app.log.error(
            { experimentId: submission.experiment.experimentId },
            "comparison variant continuation could not persist completion",
          );
        });
      }
      const response = {
        experiment: submission.experiment,
        links: {
          self: `/v1/comparisons/${submission.experiment.experimentId}`,
          originalExecution: `/v1/executions/${submission.experiment.originalExecutionId}`,
          ...(submission.experiment.variantExecutionId
            ? {
                variantExecution: `/v1/executions/${submission.experiment.variantExecutionId}`,
              }
            : {}),
        },
      };
      return reply.code(submission.experiment.status === "unavailable" ? 409 : 202).send(response);
    },
  );

  app.get(
    "/v1/comparisons/:experimentId",
    {
      schema: {
        tags: ["comparisons"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        params: ComparisonParamsSchema,
        response: { 200: ComparisonViewSchema, 404: ErrorSchema },
      },
    },
    async (request) =>
      options.service.getComparison(request.headers["x-tenant-id"], request.params.experimentId),
  );

  app.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error);
    request.log.warn({ err: error, statusCode: mapped.statusCode }, mapped.message);
    return reply.code(mapped.statusCode).send(mapped);
  });

  return app;
}

function submissionResponse(execution: ExecutionEnvelope): Static<typeof SubmissionResponseSchema> {
  return {
    executionId: execution.executionId,
    status: execution.status,
    traceId: execution.traceId,
    links: {
      self: `/v1/executions/${execution.executionId}`,
      replay: `/v1/executions/${execution.executionId}/replay`,
    },
  };
}

function mapError(error: unknown) {
  if (error instanceof ExecutionNotFoundError || error instanceof ComparisonNotFoundError) {
    return { error: "not_found", message: error.message, statusCode: 404 };
  }
  if (error instanceof IdempotencyConflictError) {
    return { error: "idempotency_conflict", message: error.message, statusCode: 409 };
  }
  if (error instanceof RateLimitRejectedError) {
    return { error: "rate_limit_rejected", message: error.message, statusCode: 429 };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return {
      error: "request_error",
      message: error instanceof Error ? error.message : "Request is invalid",
      statusCode: error.statusCode,
    };
  }
  const validation = typeof error === "object" && error !== null && "validation" in error;
  return {
    error: validation ? "validation_error" : "internal_error",
    message:
      validation && error instanceof Error ? error.message : "Request could not be completed",
    statusCode: validation ? 400 : 500,
  };
}
