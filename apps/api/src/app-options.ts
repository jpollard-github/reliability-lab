import type { FastifyBaseLogger } from "fastify";
import type {
  ExecutionService,
  InvestigationCaseReviewService,
  InvestigationCaseService,
  InvestigationReadRepository,
} from "@reliability-lab/core";

/** Dependencies supplied by the API composition root; route plugins receive only what they use. */
export interface AppOptions {
  service: ExecutionService;
  investigations: InvestigationReadRepository;
  investigationCases: InvestigationCaseService;
  investigationCaseReviews: InvestigationCaseReviewService;
  readiness?: () => Promise<{ ready: boolean; checks: Record<string, string> }>;
  logger?: FastifyBaseLogger | boolean;
  enableFailureInjection?: boolean;
  eventStreamPollMs?: number;
  eventStreamHeartbeatMs?: number;
}
