import { describe, expect, it } from "vitest";
import { buildProviderRuntime } from "../src/provider-runtime.js";

describe("buildProviderRuntime", () => {
  it("projects deterministic providers and an unavailable live capability without secrets", () => {
    const runtime = buildProviderRuntime({});
    expect(runtime.providers.map((provider) => provider.id)).toEqual([
      "fake-primary",
      "fake-fallback",
    ]);
    expect(runtime.capabilities.find((item) => item.kind === "live")).toMatchObject({
      configured: false,
      operatorEligible: false,
      unavailableReason: "Live provider is not configured.",
    });
  });

  it("constructs one eligible live provider only from complete valid configuration", () => {
    const runtime = buildProviderRuntime({
      OPENAI_COMPATIBLE_BASE_URL: "https://api.openai.example/v1",
      OPENAI_API_KEY: "secret-value",
      OPENAI_MODEL: "configured-model",
    });
    expect(runtime.providers.map((provider) => provider.id)).toContain("openai-compatible");
    expect(runtime.capabilities.find((item) => item.kind === "live")).toEqual({
      id: "openai-compatible",
      kind: "live",
      modelLabel: "configured-model",
      transportFamily: "openai_compatible_chat_completions",
      configured: true,
      supportsFailureInjection: false,
      operatorEligible: true,
    });
    expect(JSON.stringify(runtime.capabilities)).not.toContain("secret-value");
    expect(JSON.stringify(runtime.capabilities)).not.toContain("api.openai.example");
  });

  it("fails closed for partial configuration, unsafe endpoints, or unsafe model labels", () => {
    for (const environment of [
      { OPENAI_API_KEY: "secret-value" },
      {
        OPENAI_COMPATIBLE_BASE_URL: "http://provider.example/v1",
        OPENAI_API_KEY: "secret-value",
        OPENAI_MODEL: "model",
      },
      {
        OPENAI_COMPATIBLE_BASE_URL: "https://provider.example/v1?key=value",
        OPENAI_API_KEY: "secret-value",
        OPENAI_MODEL: "model",
      },
      {
        OPENAI_COMPATIBLE_BASE_URL: "https://provider.example/v1",
        OPENAI_API_KEY: "secret-value",
        OPENAI_MODEL: "model?secret=value",
      },
    ]) {
      const runtime = buildProviderRuntime(environment);
      expect(runtime.providers.map((provider) => provider.id)).not.toContain("openai-compatible");
      expect(runtime.capabilities.find((item) => item.kind === "live")).toMatchObject({
        configured: false,
        operatorEligible: false,
        unavailableReason: "Live provider configuration is incomplete or invalid.",
      });
      expect(JSON.stringify(runtime.capabilities)).not.toContain("secret-value");
    }
  });

  it("permits loopback HTTP for the local wire-compatible proof", () => {
    const runtime = buildProviderRuntime({
      OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:43123/v1",
      OPENAI_API_KEY: "local-fake-key",
      OPENAI_MODEL: "wire-model",
    });
    expect(runtime.capabilities.find((item) => item.kind === "live")).toMatchObject({
      configured: true,
      operatorEligible: true,
    });
  });
});
