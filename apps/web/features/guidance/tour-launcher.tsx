"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  createTourNavigation,
  nextTourStep,
  prepareTour,
  previousTourStep,
  restartTour,
  type PageTour,
  type PreparedTour,
  type TourNavigation,
} from "./tour-state";

export function TourLauncher({ tour }: { tour: PageTour }) {
  const launcherRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const descriptionId = useId();
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<PreparedTour>();
  const [navigation, setNavigation] = useState<TourNavigation>(createTourNavigation);
  const step = prepared?.steps[navigation.index];

  function availableAnchors(): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-guide-anchor]"))
      .map((element) => element.dataset.guideAnchor)
      .filter((anchor): anchor is string => Boolean(anchor));
  }

  function launch() {
    setPrepared(prepareTour(tour, availableAnchors()));
    setNavigation(createTourNavigation());
    setOpen(true);
  }

  function close() {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }

  function restart() {
    setPrepared(prepareTour(tour, availableAnchors()));
    setNavigation(restartTour());
  }

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, prepared?.missingRequiredAnchor]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || !step) return;
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-guide-anchor]")).find(
      (element) => element.dataset.guideAnchor === step.anchor,
    );
    if (!target) return;

    const previousDescription = target.getAttribute("aria-describedby");
    target.dataset.guideActive = "true";
    target.setAttribute(
      "aria-describedby",
      [previousDescription, descriptionId].filter(Boolean).join(" "),
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });

    return () => {
      delete target.dataset.guideActive;
      if (previousDescription) target.setAttribute("aria-describedby", previousDescription);
      else target.removeAttribute("aria-describedby");
    };
  }, [descriptionId, open, step]);

  return (
    <>
      <button className="tour-launcher" onClick={launch} ref={launcherRef} type="button">
        Tour this page
      </button>
      {open ? (
        <aside aria-labelledby={headingId} aria-modal="false" className="tour-panel" role="dialog">
          <div className="tour-panel-heading">
            <div>
              <p className="eyebrow">On-demand guidance</p>
              <h2 id={headingId} ref={headingRef} tabIndex={-1}>
                {tour.title}
              </h2>
            </div>
            <button className="quiet-button" onClick={close} type="button">
              Exit
            </button>
          </div>

          {prepared?.missingRequiredAnchor ? (
            <div className="tour-message" role="alert">
              <h3>Tour cannot continue</h3>
              <p>
                The required target <code>{prepared.missingRequiredAnchor}</code> is unavailable on
                this page. Exit the tour or restart after the page finishes loading.
              </p>
            </div>
          ) : step && prepared ? (
            <>
              <div className="tour-step" id={descriptionId}>
                <p aria-live="polite" className="tour-progress">
                  Step {navigation.index + 1} of {prepared.steps.length}: {step.title}
                </p>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <p className="tour-target-label">
                  Current target: <span>{step.title}</span>
                </p>
                {prepared.skippedAnchors.length ? (
                  <p className="tour-skip-note" role="status">
                    {prepared.skippedAnchors.length} unavailable optional step
                    {prepared.skippedAnchors.length === 1 ? " was" : "s were"} skipped.
                  </p>
                ) : null}
              </div>
              <div className="tour-navigation">
                <button
                  className="quiet-button"
                  disabled={navigation.index === 0}
                  onClick={() => setNavigation(previousTourStep)}
                  type="button"
                >
                  Back
                </button>
                <button
                  disabled={navigation.index === prepared.steps.length - 1}
                  onClick={() =>
                    setNavigation((current) => nextTourStep(current, prepared.steps.length))
                  }
                  type="button"
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            <p className="tour-message">Preparing this page tour…</p>
          )}

          <button className="tour-restart quiet-button" onClick={restart} type="button">
            Restart
          </button>
        </aside>
      ) : null}
    </>
  );
}
