import type { ExecutionBudget, ExecutionPolicy, ExecutionStatus } from "@reliability-lab/contracts";

export interface CaseExperimentCandidate {
  evidenceId: string;
  executionId: string;
  status: ExecutionStatus;
  provider: string;
  model: string;
  policy: ExecutionPolicy;
  budget: ExecutionBudget;
  replayState: string;
  replayReason: string;
}
