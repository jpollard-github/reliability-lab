/** Execution submission and compatibility list/detail HTTP routes. */
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { CreateExecutionBodySchema } from "@reliability-lab/contracts";
import type { AppOptions } from "../app-options.js";
import { submissionResponse } from "../http/response-builders.js";
import { ErrorSchema, TenantHeadersSchema, TenantOnlyHeadersSchema } from "../schemas/common.js";
import {
  ExecutionEnvelopeSchema,
  ExecutionListSchema,
  ExecutionParamsSchema,
  SubmissionResponseSchema,
} from "../schemas/executions.js";

type ExecutionRouteOptions = Pick<
  AppOptions,
  "service" | "enableFailureInjection" | "providerCapabilities"
>;

export const executionRoutes: FastifyPluginAsync<ExecutionRouteOptions> = async (app, options) => {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.post(
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
      const capability = options.providerCapabilities.find(
        (item) => item.id === request.body.provider,
      );
      if (
        capability?.kind === "live" &&
        (!capability.operatorEligible ||
          request.body.model !== capability.modelLabel ||
          request.body.failureMode !== undefined)
      ) {
        return reply.code(400).send({
          error: "live_provider_request_not_allowed",
          message: "The live provider request does not match the server-owned configuration",
          statusCode: 400,
        });
      }
      if (
        capability?.kind === "live" &&
        request.body.replayRetention === "encrypted" &&
        capability.liveReplayRetention?.available !== true
      ) {
        return reply.code(400).send({
          error: "live_replay_retention_unavailable",
          message: "Encrypted live replay retention is unavailable for this deployment",
          statusCode: 400,
        });
      }
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
      if (submission.completion)
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

  api.get(
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

  api.get(
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
};
