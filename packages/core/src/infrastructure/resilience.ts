import type { TenantId } from "@reliability-lab/contracts";

/**
 * Process-local circuit and rate-limit ports plus their memory implementations.
 * Redis classes remain explicit non-runtime skeletons rather than implied distributed controls.
 */
export interface CircuitBreaker {
  allow(provider: string): boolean;
  recordSuccess(provider: string): void;
  recordFailure(provider: string): void;
}

export interface RateLimiter {
  consume(tenantId: TenantId): Promise<boolean>;
}

export class InMemoryCircuitBreaker implements CircuitBreaker {
  readonly #failures = new Map<string, number>();
  readonly #threshold: number;

  constructor(threshold = 5) {
    this.#threshold = threshold;
  }

  allow(provider: string) {
    return (this.#failures.get(provider) ?? 0) < this.#threshold;
  }

  recordSuccess(provider: string) {
    this.#failures.delete(provider);
  }

  recordFailure(provider: string) {
    this.#failures.set(provider, (this.#failures.get(provider) ?? 0) + 1);
  }
}

export class InMemoryRateLimiter implements RateLimiter {
  readonly #remaining: number;
  readonly #counts = new Map<TenantId, number>();

  constructor(limit = Number.POSITIVE_INFINITY) {
    this.#remaining = limit;
  }

  async consume(tenantId: TenantId) {
    const used = this.#counts.get(tenantId) ?? 0;
    if (used >= this.#remaining) return false;
    this.#counts.set(tenantId, used + 1);
    return true;
  }
}

// Contract-only skeleton: production wiring still needs atomic Redis scripts,
// per-tenant configuration, expiry, and failure-mode policy.
export class RedisRateLimiterSkeleton implements RateLimiter {
  async consume(_tenantId: TenantId): Promise<boolean> {
    throw new Error("RedisRateLimiterSkeleton is not wired for runtime use");
  }
}

export class RedisCircuitBreakerSkeleton implements CircuitBreaker {
  allow(_provider: string): boolean {
    throw new Error("RedisCircuitBreakerSkeleton is not wired for runtime use");
  }

  recordSuccess(_provider: string): void {
    throw new Error("RedisCircuitBreakerSkeleton is not wired for runtime use");
  }

  recordFailure(_provider: string): void {
    throw new Error("RedisCircuitBreakerSkeleton is not wired for runtime use");
  }
}
