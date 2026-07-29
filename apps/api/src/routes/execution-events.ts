/**
 * Tenant-scoped persisted execution-event SSE route.
 * Iterator polling/formatting stays transport-independent in event-stream.ts.
 */
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import type { AppOptions } from "../app-options.js";
import {
  followExecutionEvents,
  formatExecutionSse,
  isTerminalExecutionEvent,
} from "../event-stream.js";
import {
  ExecutionEventHeadersSchema,
  ExecutionEventQuerySchema,
  ExecutionParamsSchema,
} from "../schemas/executions.js";
import { ErrorSchema } from "../schemas/common.js";

type EventRouteOptions = Pick<
  AppOptions,
  "service" | "eventStreamPollMs" | "eventStreamHeartbeatMs"
>;

export const executionEventRoutes: FastifyPluginAsync<EventRouteOptions> = async (app, options) => {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
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
};
