import type { InvestigationCaseDetail } from "@reliability-lab/contracts";

export function CaseNotes({ notes }: { notes: InvestigationCaseDetail["notes"] }) {
  return (
    <article className="panel" data-guide-anchor="case-notes">
      <div className="panel-heading">
        <div>
          <h2>Append-only notes</h2>
          <p>Corrections appear as later notes.</p>
        </div>
      </div>
      {notes.length ? (
        <ol className="case-notes">
          {notes.map((note) => (
            <li key={note.noteId}>
              <time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString()}</time>
              <p>{note.body}</p>
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-state">
          <p>No notes recorded yet.</p>
        </div>
      )}
    </article>
  );
}
