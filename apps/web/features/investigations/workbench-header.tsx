import Link from "next/link";

export function WorkbenchHeader({ current }: { current: URLSearchParams }) {
  return (
    <section className="page-heading">
      <div>
        <p className="eyebrow">Operator evidence</p>
        <h1>Investigation workbench</h1>
        <p>
          Bounded, tenant-scoped reliability evidence. Counts are observations, not provider
          rankings.
        </p>
      </div>
      <div className="workbench-context">
        <Link className="workbench-link" href={`/investigations?${current.toString()}`}>
          Refresh evidence
        </Link>
        <div className="environment-pill">
          <span />
          local · demo-tenant
        </div>
      </div>
    </section>
  );
}
