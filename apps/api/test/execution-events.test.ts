import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ExecutionService,
  InvestigationCaseExperimentService,
  InvestigationCaseReviewService,
  InvestigationCaseService,
  MapProviderRegistry,
  MemoryComparisonExperimentRepository,
  MemoryExecutionRepository,
  MemoryInvestigationCaseRepository,
  MemoryInvestigationReadRepository,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import type { LlmProvider } from "@reliability-lab/providers";
import { buildApp } from "../src/app.js";
import { buildTestApp, sseEvents, waitForTerminal } from "./support/build-test-app.js";

describe("API execution event stream", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let service: ExecutionService;

  beforeEach(async () => {
    ({ app, service } = await buildTestApp());
  });

  afterEach(async () => app.close());

  it("backfills events in order, closes after terminal state, and honors a cursor", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: {
        "x-tenant-id": "tenant-a",
        "idempotency-key": "stream-terminal-cursor",
      },
      payload: {
        provider: "fake-primary",
        model: "v1",
        input: "stream evidence",
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const executionId = create.json().executionId as string;
    await waitForTerminal(service, "tenant-a", executionId);

    const stream = await app.inject({
      method: "GET",
      url: `/v1/executions/${executionId}/events`,
      headers: {
        "x-tenant-id": "tenant-a",
        origin: "http://127.0.0.1:3000",
      },
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3000");
    const events = sseEvents(stream.body);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(events.at(-1)?.type).toBe("execution.succeeded");

    const resumed = await app.inject({
      method: "GET",
      url: `/v1/executions/${executionId}/events?after=4`,
      headers: { "x-tenant-id": "tenant-a", "last-event-id": "2" },
    });
    expect(sseEvents(resumed.body).map((event) => event.sequence)).toEqual([5, 6, 7]);

    const caughtUp = await app.inject({
      method: "GET",
      url: `/v1/executions/${executionId}/events?after=7`,
      headers: { "x-tenant-id": "tenant-a", "last-event-id": "7" },
    });
    expect(caughtUp.body).toContain("event: complete");
    expect(caughtUp.body).toContain('"status":"succeeded"');

    await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: {
        "x-tenant-id": "tenant-a",
        "idempotency-key": "stream-terminal-cursor",
      },
      payload: {
        provider: "fake-primary",
        model: "v1",
        input: "stream evidence",
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const afterTerminalMetadata = await app.inject({
      method: "GET",
      url: `/v1/executions/${executionId}/events?after=7`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(afterTerminalMetadata.body).toContain("event: complete");
  });

  it("returns 202 while work is running and streams through terminal completion", async () => {
    let releaseProvider!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const provider: LlmProvider = {
      id: "gated",
      kind: "fake",
      capability: {
        id: "gated",
        kind: "deterministic",
        modelLabel: "v1",
        transportFamily: "in_process_fixture",
        configured: true,
        supportsFailureInjection: true,
        operatorEligible: true,
      },
      execute: async (request) => {
        await gate;
        return {
          ok: true,
          response: {
            provider: "gated",
            model: request.model,
            outputText: "done",
            usage: { inputTokens: 1, outputTokens: 1 },
            latencyMs: 1,
          },
        };
      },
    };
    const gatedRepository = new MemoryExecutionRepository();
    const gatedComparisons = new MemoryComparisonExperimentRepository();
    const gatedCases = new MemoryInvestigationCaseRepository();
    const gatedInvestigations = new MemoryInvestigationReadRepository(gatedRepository);
    const gatedReplayCapsules = new MemoryReplayCapsuleStore();
    const gatedService = new ExecutionService({
      repository: gatedRepository,
      comparisons: gatedComparisons,
      replayCapsules: gatedReplayCapsules,
      providers: new MapProviderRegistry([provider]),
    });
    const gatedCaseService = new InvestigationCaseService({
      cases: gatedCases,
      executions: gatedRepository,
      comparisons: gatedComparisons,
    });
    const gatedApp = await buildApp({
      service: gatedService,
      providerCapabilities: [provider.capability!],
      investigationCases: gatedCaseService,
      investigationCaseReviews: new InvestigationCaseReviewService({
        cases: gatedCases,
        executions: gatedRepository,
        comparisons: gatedComparisons,
        investigations: gatedInvestigations,
        replayCapsules: gatedReplayCapsules,
      }),
      investigationCaseExperiments: new InvestigationCaseExperimentService({
        cases: gatedCaseService,
        executions: gatedService,
      }),
      investigations: gatedInvestigations,
      logger: false,
      enableFailureInjection: true,
      eventStreamPollMs: 1,
    });
    try {
      const create = await gatedApp.inject({
        method: "POST",
        url: "/v1/executions",
        headers: { "x-tenant-id": "tenant-a" },
        payload: { provider: "gated", model: "v1", input: "gated" },
      });
      expect(create.statusCode).toBe(202);
      expect(create.json().status).toBe("running");
      const executionId = create.json().executionId as string;

      const streamPromise = gatedApp.inject({
        method: "GET",
        url: `/v1/executions/${executionId}/events`,
        headers: { "x-tenant-id": "tenant-a" },
      });
      releaseProvider();
      const stream = await streamPromise;
      expect(sseEvents(stream.body).map((event) => event.type)).toEqual([
        "execution.accepted",
        "attempt.started",
        "provider.response_received",
        "execution.succeeded",
      ]);
    } finally {
      await gatedApp.close();
    }
  });
});
