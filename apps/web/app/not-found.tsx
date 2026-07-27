import Link from "next/link";

export default function NotFound() {
  return (
    <section className="not-found">
      <p className="eyebrow">404</p>
      <h1>Execution not found</h1>
      <p>The execution is absent or outside the demo tenant boundary.</p>
      <Link href="/">Return to executions</Link>
    </section>
  );
}
