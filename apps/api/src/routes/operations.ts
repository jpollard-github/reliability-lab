/** Health, readiness, and OpenAPI document routes. */
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsync } from "fastify";
import type { AppOptions } from "../app-options.js";

type OperationsOptions = Pick<AppOptions, "readiness">;

export const operationsRoutes: FastifyPluginAsync<OperationsOptions> = async (app, options) => {
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
};
