/** Bounded Investigation Workbench search, summary, and provider-observation HTTP routes. */
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import {
  ExecutionSummaryPageSchema,
  ProviderObservationPageSchema,
  ReliabilitySummarySchema,
} from "@reliability-lab/contracts";
import type { AppOptions } from "../app-options.js";
import { arrayValue, investigationRange } from "../http/query-values.js";
import { ErrorSchema, TenantOnlyHeadersSchema } from "../schemas/common.js";
import {
  InvestigationExecutionQuerySchema,
  InvestigationProviderQuerySchema,
  InvestigationSummaryQuerySchema,
} from "../schemas/investigations.js";

type InvestigationRouteOptions = Pick<AppOptions, "investigations">;

export const investigationRoutes: FastifyPluginAsync<InvestigationRouteOptions> = async (
  app,
  options,
) => {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/v1/investigations/executions",
    {
      schema: {
        tags: ["investigations"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        querystring: InvestigationExecutionQuerySchema,
        response: { 200: ExecutionSummaryPageSchema, 400: ErrorSchema },
      },
    },
    async (request) => {
      const range = investigationRange(request.query);
      return options.investigations.searchExecutions(request.headers["x-tenant-id"], {
        range,
        limit: request.query.limit ?? 25,
        ...(request.query.cursor ? { cursor: request.query.cursor } : {}),
        ...(request.query.q ? { query: request.query.q } : {}),
        ...(request.query.status ? { statuses: arrayValue(request.query.status) } : {}),
        ...(request.query.provider ? { providers: arrayValue(request.query.provider) } : {}),
        ...(request.query.model ? { models: arrayValue(request.query.model) } : {}),
        ...(request.query.errorCategory ? { errorCategory: request.query.errorCategory } : {}),
        ...(request.query.errorCode ? { errorCode: request.query.errorCode } : {}),
        ...(request.query.signal ? { signal: request.query.signal } : {}),
      });
    },
  );

  api.get(
    "/v1/investigations/summary",
    {
      schema: {
        tags: ["investigations"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        querystring: InvestigationSummaryQuerySchema,
        response: { 200: ReliabilitySummarySchema, 400: ErrorSchema },
      },
    },
    async (request) =>
      options.investigations.summarize(
        request.headers["x-tenant-id"],
        investigationRange(request.query),
      ),
  );

  api.get(
    "/v1/investigations/providers",
    {
      schema: {
        tags: ["investigations"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        querystring: InvestigationProviderQuerySchema,
        response: { 200: ProviderObservationPageSchema, 400: ErrorSchema },
      },
    },
    async (request) => {
      const range = investigationRange(request.query);
      return options.investigations.observeProviders(request.headers["x-tenant-id"], {
        range,
        limit: request.query.limit ?? 50,
        ...(request.query.provider ? { providers: arrayValue(request.query.provider) } : {}),
        ...(request.query.model ? { models: arrayValue(request.query.model) } : {}),
      });
    },
  );
};
