/** Comparative replay create/read transport mapping. Experiment semantics remain in core. */
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import { CreateComparisonBodySchema } from "@reliability-lab/contracts";
import type { AppOptions } from "../app-options.js";
import { ErrorSchema, TenantOnlyHeadersSchema } from "../schemas/common.js";
import {
  ComparisonParamsSchema,
  ComparisonSubmissionResponseSchema,
  ComparisonViewSchema,
} from "../schemas/comparisons.js";
import { ExecutionParamsSchema } from "../schemas/executions.js";

type ComparisonRouteOptions = Pick<AppOptions, "service">;

export const comparisonRoutes: FastifyPluginAsync<ComparisonRouteOptions> = async (
  app,
  options,
) => {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.post(
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

  api.get(
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
};
