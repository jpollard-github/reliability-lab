import { CreateCaseForm } from "@/features/investigation-cases/create-case-form";
import { CaseList } from "@/features/investigation-cases/case-list";
import {
  caseListQuery,
  evidenceFromParams,
  type SearchValue,
} from "@/features/investigation-cases/case-list-state";
import { getInvestigationCases } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function InvestigationCasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const raw = await searchParams;
  const query = caseListQuery(raw);
  const page = await getInvestigationCases(query);
  const now = new Date();
  const initialEvidence = evidenceFromParams(raw);
  const scope = {
    range: {
      from: new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
      to: now.toISOString(),
    },
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Durable investigation history</p>
          <h1>Investigation cases</h1>
          <p>
            Preserve one exact reliability question, its evidence references, notes, and current
            conclusion.
          </p>
        </div>
        <div className="environment-pill">
          <span />
          local · demo-tenant
        </div>
      </section>

      <section className="panel" aria-labelledby="new-case-heading">
        <div className="panel-heading">
          <div>
            <h2 id="new-case-heading">
              {initialEvidence.length ? "Begin a case from selected evidence" : "Create a case"}
            </h2>
            <p>
              This direct form uses an exact last-24-hours snapshot. For filtered scope, save from
              the workbench.
            </p>
          </div>
        </div>
        <CreateCaseForm initialEvidence={initialEvidence} scope={scope} />
      </section>

      <CaseList page={page} query={query} raw={raw} />
    </>
  );
}
