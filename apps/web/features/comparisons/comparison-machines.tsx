import type { ComparisonView } from "@reliability-lab/contracts";
import { ExecutionMachineView } from "@/features/live-machine/live-execution-view";

export function ComparisonMachines({ comparison }: { comparison: ComparisonView }) {
  return (
    <section
      className="comparison-machines"
      aria-label="Side-by-side execution machines"
      data-guide-anchor="comparison-machines"
    >
      <ExecutionMachineView
        followLive={false}
        initialExecution={comparison.originalExecution}
        title="Original machine"
      />
      {comparison.variantExecution ? (
        <ExecutionMachineView
          initialExecution={comparison.variantExecution}
          title="Variant machine"
        />
      ) : (
        <div className="panel empty-state">
          <h2>Variant machine</h2>
          <p>No variant envelope was created.</p>
        </div>
      )}
    </section>
  );
}
