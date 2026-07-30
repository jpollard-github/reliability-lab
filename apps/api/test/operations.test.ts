import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { buildApp } from "../src/app.js";
import { buildTestApp } from "./support/build-test-app.js";

describe("API operations", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    ({ app } = await buildTestApp());
  });

  afterEach(async () => app.close());

  it("publishes health, readiness, and OpenAPI documents", async () => {
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
    const openapi = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(openapi.statusCode).toBe(200);
    expect(openapi.json().paths["/v1/executions"]).toBeDefined();
    expect(openapi.json().paths["/v1/executions/{executionId}/events"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigations/executions"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigations/summary"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigations/providers"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigation-cases"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigation-cases/{caseId}"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigation-cases/{caseId}/notes"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigation-cases/{caseId}/comparisons"]).toBeDefined();
  });

  it("serves Swagger UI and its static assets", async () => {
    const docs = await app.inject({ method: "GET", url: "/docs/" });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers["content-type"]).toContain("text/html");
    expect(docs.body).toContain("./static/swagger-ui.css");

    const stylesheet = await app.inject({
      method: "GET",
      url: "/docs/static/swagger-ui.css",
    });
    expect(stylesheet.statusCode).toBe(200);
    expect(stylesheet.headers["content-type"]).toContain("text/css");
    expect(stylesheet.body).toContain(".swagger-ui");
  });
});
