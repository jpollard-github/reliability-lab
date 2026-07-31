import type { ProviderCapability } from "@reliability-lab/contracts";
import { DeterministicFakeProvider } from "./deterministic-fake-provider.js";
import { OpenAICompatibleHttpProvider } from "./openai-compatible-http-provider.js";
import type { LlmProvider } from "./types.js";

export interface ProviderRuntime {
  providers: LlmProvider[];
  capabilities: ProviderCapability[];
}

/**
 * Constructs the same provider set for API and worker while projecting only public-safe evidence.
 */
export function buildProviderRuntime(environment: NodeJS.ProcessEnv): ProviderRuntime {
  const providers: LlmProvider[] = [
    new DeterministicFakeProvider({ id: "fake-primary", seed: 17 }),
    new DeterministicFakeProvider({ id: "fake-fallback", seed: 29 }),
  ];
  const baseUrl = environment.OPENAI_COMPATIBLE_BASE_URL?.trim();
  const apiKey = environment.OPENAI_API_KEY?.trim();
  const model = environment.OPENAI_MODEL?.trim();
  const liveConfigured =
    baseUrl !== undefined &&
    apiKey !== undefined &&
    model !== undefined &&
    validBaseUrl(baseUrl) &&
    /^[A-Za-z0-9._:/-]{1,128}$/.test(model);

  if (liveConfigured) {
    providers.push(new OpenAICompatibleHttpProvider({ baseUrl, apiKey, model }));
  }

  const capabilities = providers.map((provider) => {
    if (!provider.capability) throw new Error("Constructed provider capability is unavailable");
    return provider.capability;
  });
  if (!liveConfigured) {
    capabilities.push({
      id: "openai-compatible",
      kind: "live",
      modelLabel: model && /^[A-Za-z0-9._:/-]{1,128}$/.test(model) ? model : "Not configured",
      transportFamily: "openai_compatible_chat_completions",
      configured: false,
      supportsFailureInjection: false,
      operatorEligible: false,
      unavailableReason:
        baseUrl || apiKey || model
          ? "Live provider configuration is incomplete or invalid."
          : "Live provider is not configured.",
    });
  }
  return { providers, capabilities };
}

function validBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    return (
      (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
