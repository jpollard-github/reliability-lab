/** Public-safe provider configuration evidence; this route never probes an external provider. */
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsync } from "fastify";
import type { AppOptions } from "../app-options.js";
import { TenantOnlyHeadersSchema } from "../schemas/common.js";
import { ProviderCapabilityListSchema } from "../schemas/providers.js";

type ProviderRouteOptions = Pick<AppOptions, "providerCapabilities">;

export const providerRoutes: FastifyPluginAsync<ProviderRouteOptions> = async (app, options) => {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get(
    "/v1/providers",
    {
      schema: {
        tags: ["providers"],
        security: [{ tenant: [] }],
        headers: TenantOnlyHeadersSchema,
        response: { 200: ProviderCapabilityListSchema },
      },
    },
    async () => ({
      data: options.providerCapabilities,
      count: options.providerCapabilities.length,
    }),
  );
};
