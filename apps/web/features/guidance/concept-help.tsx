import type { ReactNode } from "react";

export function ConceptHelp({
  title,
  what,
  why,
  lookFor,
}: {
  title: string;
  what: ReactNode;
  why: ReactNode;
  lookFor: ReactNode;
}) {
  return (
    <details className="concept-help">
      <summary>{title}</summary>
      <dl>
        <dt>What is this?</dt>
        <dd>{what}</dd>
        <dt>Why does it matter?</dt>
        <dd>{why}</dd>
        <dt>What should I look for?</dt>
        <dd>{lookFor}</dd>
      </dl>
    </details>
  );
}
