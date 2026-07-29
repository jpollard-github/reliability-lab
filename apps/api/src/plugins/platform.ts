/** Installs CORS and OpenAPI/Swagger infrastructure before route plugins are registered. */
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";

export async function registerPlatformPlugins(app: FastifyInstance) {
  await app.register(cors, {
    origin: process.env.NODE_ENV === "production" ? false : true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
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
}
