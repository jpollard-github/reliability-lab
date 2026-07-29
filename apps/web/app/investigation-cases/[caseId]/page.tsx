import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseControls } from "@/features/investigation-cases/case-controls";
import { CaseNotes } from "@/features/investigation-cases/case-notes";
import { CaseOverview } from "@/features/investigation-cases/case-overview";
import { CaseTimeline } from "@/features/investigation-cases/case-timeline";
import { getInvestigationCase } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function InvestigationCaseDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const detail = await getInvestigationCase(caseId);
  if (!detail) notFound();
  const item = detail.case;

  return (
    <>
      <div className="breadcrumb">
        <Link href="/investigation-cases">Cases</Link>
        <span>/</span>
        <span className="mono">{item.caseId}</span>
      </div>
      <section className="detail-heading">
        <div>
          <p className="eyebrow">Investigation case v{item.schemaVersion}</p>
          <h1>{item.title}</h1>
          <div className="detail-subtitle">
            <span className={`case-status case-${item.status}`}>{item.status}</span>
            {item.importance ? (
              <span className={`case-importance importance-${item.importance}`}>
                {item.importance}
              </span>
            ) : null}
            <span className="mono">{item.caseId}</span>
          </div>
        </div>
        <Link className="workbench-link" href={detail.links.savedWorkbench}>
          Open saved workbench scope
        </Link>
      </section>

      <section className="panel actor-limitation" aria-labelledby="actor-limitation-heading">
        <h2 id="actor-limitation-heading">Actor identity is unavailable</h2>
        <p>
          This prototype has tenant routing but no authenticated users. Notes and lifecycle events
          intentionally record timestamps without claiming who made a change.
        </p>
      </section>

      <CaseOverview detail={detail} />
      <CaseControls detail={detail} />
      <section className="case-two-column">
        <CaseNotes notes={detail.notes} />
        <CaseTimeline timeline={detail.timeline} />
      </section>
    </>
  );
}
