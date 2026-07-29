/** Replay execution and replay-capsule deletion routes; retention/encryption remain service concerns. */
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import type { AppOptions } from "../app-options.js";
import { ErrorSchema, TenantOnlyHeadersSchema } from "../schemas/common.js";
import { ExecutionParamsSchema } from "../schemas/executions.js";
import { DeleteReplayResponseSchema, ReplayResponseSchema } from "../schemas/replay.js";

type ReplayRouteOptions = Pick<AppOptions, "service">;

export const replayRoutes: FastifyPluginAsync<ReplayRouteOptions> = async (app, options) => {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.delete(
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

  api.post(
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
};
