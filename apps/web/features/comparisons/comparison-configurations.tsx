import type { ComparisonView, ExecutionBudget, ExecutionPolicy } from "@reliability-lab/contracts";

export function ComparisonConfigurations({ comparison }: { comparison: ComparisonView }) {
  const { experiment, originalExecution } = comparison;
  return (
    <section
      className="comparison-configs"
      aria-label="Execution configurations"
      data-guide-anchor="comparison-configurations"
    >
      <ConfigurationCard
        budget={originalExecution.budget}
        model={originalExecution.attempts[0]?.model ?? originalExecution.model}
        policy={originalExecution.policy}
        provider={originalExecution.attempts[0]?.provider ?? originalExecution.provider}
        structuredOutputRequired={originalExecution.attempts.some(
          (attempt) => attempt.validation !== undefined,
        )}
        title="Original conditions"
      />
      <ConfigurationCard
        budget={experiment.resolvedVariant.budget}
        model={experiment.resolvedVariant.model}
        policy={experiment.resolvedVariant.policy}
        provider={experiment.resolvedVariant.provider}
        structuredOutputRequired={experiment.resolvedVariant.structuredOutputRequired}
        title="Resolved variant conditions"
      />
    </section>
  );
}

function ConfigurationCard({
  title,
  provider,
  model,
  policy,
  budget,
  structuredOutputRequired,
}: {
  title: string;
  provider: string;
  model: string;
  policy: ExecutionPolicy;
  budget: ExecutionBudget;
  structuredOutputRequired: boolean;
}) {
  return (
    <article className="panel facts">
      <h2>{title}</h2>
      <dl>
        <Fact label="Provider" value={provider} />
        <Fact label="Model" value={model} />
        <Fact label="Attempts" value={String(policy.maxAttempts)} />
        <Fact label="Backoff" value={`${policy.baseBackoffMs}–${policy.maxBackoffMs} ms`} />
        <Fact label="Jitter" value={String(policy.jitterRatio)} />
        <Fact
          label="Fallback"
          value={
            policy.fallbackProvider
              ? `${policy.fallbackProvider} / ${policy.fallbackModel ?? model}`
              : "none"
          }
        />
        <Fact label="Latency" value={`${budget.maxLatencyMs} ms`} />
        <Fact label="Structured" value={structuredOutputRequired ? "required" : "not requested"} />
      </dl>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
