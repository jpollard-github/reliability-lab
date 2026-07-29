import type { ComparisonChange, ComparisonView } from "@reliability-lab/contracts";

export function ComparisonSummary({ comparison }: { comparison: ComparisonView }) {
  return (
    <section className="panel comparison-summary">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Normalized evidence</p>
          <h2>Comparison summary</h2>
          <p>{comparison.projection.summary}</p>
        </div>
      </div>
      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Dimension</th>
              <th>Original</th>
              <th>Variant</th>
              <th>Change</th>
              <th>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {comparison.projection.dimensions.map((dimension) => (
              <tr key={dimension.key}>
                <th scope="row">{dimension.label}</th>
                <td>{formatValue(dimension.original)}</td>
                <td>{formatValue(dimension.variant)}</td>
                <td>
                  <ChangeBadge change={dimension.change} />
                </td>
                <td className="comparison-explanation">{dimension.explanation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ChangeBadge({ change }: { change: ComparisonChange }) {
  return <span className={`comparison-change change-${change}`}>{change}</span>;
}

function formatValue(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
