"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="not-found">
      <p className="eyebrow">Control plane unavailable</p>
      <h1>The execution API could not be reached</h1>
      <p>Start the API on port 4000, then retry this request.</p>
      <button type="button" onClick={reset}>
        Retry
      </button>
    </section>
  );
}
