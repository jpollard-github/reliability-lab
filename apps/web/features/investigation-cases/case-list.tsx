import Link from "next/link";
import type { InvestigationCasePage } from "@reliability-lab/contracts";
import type { SearchValue } from "./case-list-state";
import { first, withCursor, withoutCursor } from "./case-list-state";

export function CaseList({
  page,
  query,
  raw,
}: {
  page: InvestigationCasePage;
  query: URLSearchParams;
  raw: Record<string, SearchValue>;
}) {
  return (
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
  );
}

function excerpt(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
