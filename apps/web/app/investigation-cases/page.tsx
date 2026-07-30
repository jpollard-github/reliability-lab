import { CreateCaseForm } from "@/features/investigation-cases/create-case-form";
import { CaseList } from "@/features/investigation-cases/case-list";
import {
  caseListQuery,
  evidenceFromParams,
  type SearchValue,
} from "@/features/investigation-cases/case-list-state";
import { getInvestigationCases } from "@/lib/server-api";
import { ConceptHelp } from "@/features/guidance/concept-help";

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
      <ConceptHelp
        title="What does an investigation case preserve?"
        what="A case saves an exact scope and links to authoritative evidence instead of copying execution or comparison contents."
        why="Append-only notes preserve corrections over time, while current finding and resolution fields may evolve. This prototype cannot identify the actor."
        lookFor="Confirm the fixed range, evidence counts and links, note history, current status, and the explicit actor limitation."
      />

      <section
        className="panel"
        aria-labelledby="new-case-heading"
        data-guide-anchor="case-creation"
      >
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
