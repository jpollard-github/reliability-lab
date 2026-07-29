import type {
  ExecutionEnvelope,
  ExecutionEvent,
  ExecutionId,
  TenantId,
} from "@reliability-lab/contracts";
import type { ExecutionRepository } from "./ports.js";

/**
 * Process-local execution evidence repository used by tests and in-process mode.
 * It preserves tenant filtering and event idempotence without claiming durability.
 */
export class MemoryExecutionRepository implements ExecutionRepository {
  readonly #executions = new Map<string, ExecutionEnvelope>();
  readonly #idempotency = new Map<string, { requestHash: string; executionId: string }>();

  async create(execution: ExecutionEnvelope) {
    this.#executions.set(execution.executionId, structuredClone(execution));
  }
  async update(execution: ExecutionEnvelope) {
    this.#executions.set(execution.executionId, structuredClone(execution));
  }
  async appendEvent(event: ExecutionEvent) {
    const execution = this.#executions.get(event.executionId);
    if (execution && !execution.events.some((item) => item.eventId === event.eventId)) {
      execution.events.push(structuredClone(event));
    }
  }
  async eventsAfter(tenantId: TenantId, executionId: ExecutionId, afterSequence: number) {
    const execution = this.#executions.get(executionId);
    if (execution?.tenantId !== tenantId) return null;
    return execution.events
      .filter((event) => event.sequence > afterSequence)
      .sort((left, right) => left.sequence - right.sequence)
      .map((event) => structuredClone(event));
  }
  async findById(tenantId: TenantId, executionId: ExecutionId) {
    const execution = this.#executions.get(executionId);
    return execution?.tenantId === tenantId ? structuredClone(execution) : null;
  }
  async list(tenantId?: TenantId) {
    return [...this.#executions.values()]
      .filter((execution) => !tenantId || execution.tenantId === tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((execution) => structuredClone(execution));
  }
  async findIdempotent(tenantId: TenantId, keyHash: string) {
    const record = this.#idempotency.get(`${tenantId}:${keyHash}`);
    if (!record) return null;
    return this.findById(tenantId, record.executionId);
  }
  async recordIdempotency(
    tenantId: TenantId,
    keyHash: string,
    requestHash: string,
    executionId: ExecutionId,
  ) {
    this.#idempotency.set(`${tenantId}:${keyHash}`, { requestHash, executionId });
  }
}
