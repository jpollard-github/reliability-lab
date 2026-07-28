import Link from "next/link";
import type { InvestigationCaseEvidenceInput } from "@reliability-lab/contracts";
import { CreateCaseForm } from "@/components/create-case-form";
import { getInvestigationCases } from "@/lib/api";

export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;

export default async function InvestigationCasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["cursor", "status", "importance", "q", "executionId"] as const) {
    const value = first(raw[key]);
    if (value) query.set(key, value);
  }
  query.set("limit", "25");
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

      <section className="panel" aria-labelledby="case-list-heading">
        <div className="panel-heading">
          <div>
            <h2 id="case-list-heading">Saved cases</h2>
            <p>{page.total} matching tenant-scoped cases.</p>
          </div>
        </div>
        <form className="case-list-filters" method="get">
          <label>
            Search title or question
            <input defaultValue={first(raw.q)} maxLength={256} name="q" />
          </label>
          <label>
            Status
            <select defaultValue={first(raw.status) ?? ""} name="status">
              <option value="">Any status</option>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label>
            Importance
            <select defaultValue={first(raw.importance) ?? ""} name="importance">
              <option value="">Any importance</option>
              <option value="routine">Routine</option>
              <option value="notable">Notable</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <button type="submit">Filter cases</button>
        </form>
        {page.data.length ? (
          <div className="case-list">
            {page.data.map(({ case: item, evidenceCounts }) => (
              <article className="case-list-item" key={item.caseId}>
                <div>
                  <div className="case-list-title">
                    <Link href={`/investigation-cases/${item.caseId}`}>{item.title}</Link>
                    <span className={`case-status case-${item.status}`}>{item.status}</span>
                    {item.importance ? (
                      <span className={`case-importance importance-${item.importance}`}>
                        {item.importance}
                      </span>
                    ) : null}
                  </div>
                  <p>{excerpt(item.question, 180)}</p>
                  <span className="muted">
                    Saved {new Date(item.savedScope.range.from).toLocaleString()} through{" "}
                    {new Date(item.savedScope.range.to).toLocaleString()}
                  </span>
                </div>
                <div className="case-list-meta">
                  <span>{evidenceCounts.executions} executions</span>
                  <span>{evidenceCounts.comparisons} comparisons</span>
                  <span>{evidenceCounts.providerObservations} provider views</span>
                  <time dateTime={item.updatedAt}>
                    Updated {new Date(item.updatedAt).toLocaleString()}
                  </time>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>No investigation cases match these filters.</p>
          </div>
        )}
        <div className="pagination">
          {query.has("cursor") ? <Link href={withoutCursor(query)}>First page</Link> : <span />}
          {page.nextCursor ? (
            <Link href={withCursor(query, page.nextCursor)}>Next page</Link>
          ) : (
            <span className="muted">End of cases</span>
          )}
        </div>
      </section>
    </>
  );
}

function evidenceFromParams(params: Record<string, SearchValue>): InvestigationCaseEvidenceInput[] {
  const type = first(params.newEvidenceType);
  const id = first(params.newEvidenceId);
  if (type === "execution" && id) return [{ type, executionId: id }];
  if (type === "comparison" && id) return [{ type, experimentId: id }];
  return [];
}

function first(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

function excerpt(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function withoutCursor(params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.delete("cursor");
  next.delete("limit");
  return `/investigation-cases${next.size ? `?${next.toString()}` : ""}`;
}

function withCursor(params: URLSearchParams, cursor: string) {
  const next = new URLSearchParams(params);
  next.delete("limit");
  next.set("cursor", cursor);
  return `/investigation-cases?${next.toString()}`;
}
