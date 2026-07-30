import Link from "next/link";
import { windowPresets, type ResolvedWorkbenchRange, type WindowPreset } from "./search-state";

export function TimeWindowToolbar({
  range,
  selectedWindow,
}: {
  range: ResolvedWorkbenchRange;
  selectedWindow: WindowPreset;
}) {
  return (
    <section
      className="workbench-toolbar panel"
      aria-labelledby="time-window-heading"
      data-guide-anchor="workbench-time-window"
    >
      <div className="panel-heading">
        <div>
          <h2 id="time-window-heading">Time window</h2>
          <p>
            {formatDate(range.from)} through {formatDate(range.to)}
          </p>
        </div>
        <div className="preset-links" aria-label="Time window presets">
          {windowPresets.map((preset) => (
            <Link
              aria-current={selectedWindow === preset ? "page" : undefined}
              className={selectedWindow === preset ? "active" : undefined}
              href={`/investigations?window=${preset}`}
              key={preset}
            >
              {preset}
            </Link>
          ))}
        </div>
      </div>
      <form className="custom-range-form" method="get">
        <label>
          From
          <input
            defaultValue={range.from.slice(0, 16)}
            max={range.to.slice(0, 16)}
            name="from"
            type="datetime-local"
          />
        </label>
        <label>
          To
          <input
            defaultValue={range.to.slice(0, 16)}
            min={range.from.slice(0, 16)}
            name="to"
            type="datetime-local"
          />
        </label>
        <button type="submit">Apply custom range</button>
      </form>
    </section>
  );
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
