import type { LlmProvider } from "@reliability-lab/providers";

/** Resolves configured providers without exposing adapter construction to the domain. */
export interface ProviderRegistry {
  resolve(provider: string): LlmProvider | null;
}

export class MapProviderRegistry implements ProviderRegistry {
  readonly #providers: Map<string, LlmProvider>;

  constructor(providers: LlmProvider[]) {
    this.#providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  resolve(provider: string) {
    return this.#providers.get(provider) ?? null;
  }
}
