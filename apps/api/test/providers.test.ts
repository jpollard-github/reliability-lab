import { describe, expect, it } from "vitest";
import { buildTestApp } from "./support/build-test-app.js";

describe("provider capability routes", () => {
  it("requires tenant routing and returns only bounded safe capability evidence", async () => {
    const { app } = await buildTestApp();
    try {
      expect((await app.inject({ method: "GET", url: "/v1/providers" })).statusCode).toBe(400);
      const response = await app.inject({
        method: "GET",
        url: "/v1/providers",
        headers: { "x-tenant-id": "tenant-a" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        count: 3,
        data: [
          {
            id: "fake-primary",
            kind: "deterministic",
            configured: true,
            supportsFailureInjection: true,
            operatorEligible: true,
          },
          {
            id: "fake-fallback",
            kind: "deterministic",
            configured: true,
            supportsFailureInjection: true,
            operatorEligible: true,
          },
          {
            id: "openai-compatible",
            kind: "live",
            configured: false,
            supportsFailureInjection: false,
            operatorEligible: false,
          },
        ],
      });
      expect(response.body).not.toMatch(/api[_-]?key|base[_-]?url|authorization|query/i);
      const openApi = await app.inject({ method: "GET", url: "/openapi.json" });
      expect(openApi.json().paths["/v1/providers"].get).toMatchObject({
        tags: ["providers"],
        security: [{ tenant: [] }],
      });
    } finally {
      await app.close();
    }
  });

  it("exposes an eligible safe model label but rejects browser-selected models and injection", async () => {
    const { app } = await buildTestApp({
      providerEnvironment: {
        OPENAI_COMPATIBLE_BASE_URL: "https://provider.example/v1",
        OPENAI_API_KEY: "never-visible-secret",
        OPENAI_MODEL: "server-model",
      },
    });
    try {
      const capabilities = await app.inject({
        method: "GET",
        url: "/v1/providers",
        headers: { "x-tenant-id": "tenant-a" },
      });
      expect(capabilities.json().data).toContainEqual({
        id: "openai-compatible",
        kind: "live",
        modelLabel: "server-model",
        transportFamily: "openai_compatible_chat_completions",
        configured: true,
        supportsFailureInjection: false,
        operatorEligible: true,
      });
      expect(capabilities.body).not.toContain("never-visible-secret");
      expect(capabilities.body).not.toContain("provider.example");

      for (const payload of [
        {
          provider: "openai-compatible",
          model: "browser-model",
          input: "safe",
        },
        {
          provider: "openai-compatible",
          model: "server-model",
          input: "safe",
          failureMode: "rate_limit",
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/executions",
          headers: { "x-tenant-id": "tenant-a" },
          payload,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toBe("live_provider_request_not_allowed");
      }
    } finally {
      await app.close();
    }
  });
});
