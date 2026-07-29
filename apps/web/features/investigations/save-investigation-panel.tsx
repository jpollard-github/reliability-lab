import { CreateCaseForm } from "@/features/investigation-cases/create-case-form";
import type { InvestigationWorkbenchModel } from "./workbench-loader";

export function SaveInvestigationPanel({
  model,
}: {
  model: Pick<InvestigationWorkbenchModel, "providerEvidence" | "savedScope" | "executions">;
}) {
  return (
    <section className="panel" aria-labelledby="save-investigation-heading">
      <div className="panel-heading">
        <div>
          <h2 id="save-investigation-heading">Save investigation</h2>
          <p>
            Preserve this exact UTC range and canonical filters. Cursor, page size, and moving
            preset are deliberately excluded.
          </p>
        </div>
      </div>
      <CreateCaseForm
        optionalEvidence={
          model.providerEvidence
            ? [
                {
                  label: `${model.providerEvidence.provider} / ${model.providerEvidence.model} in this exact range`,
                  evidence: model.providerEvidence,
                },
              ]
            : []
        }
        scope={model.savedScope}
        visibleExecutionIds={model.executions.data.map((execution) => execution.executionId)}
      />
    </section>
  );
}
