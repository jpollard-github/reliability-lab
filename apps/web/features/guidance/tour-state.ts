export interface GuideStep {
  anchor: string;
  title: string;
  body: string;
  optional?: boolean;
}

export interface PageTour {
  id: string;
  title: string;
  steps: GuideStep[];
}

export interface PreparedTour {
  steps: GuideStep[];
  skippedAnchors: string[];
  missingRequiredAnchor?: string;
}

export interface TourNavigation {
  index: number;
}

export function prepareTour(tour: PageTour, availableAnchors: Iterable<string>): PreparedTour {
  const available = new Set(availableAnchors);
  const steps: GuideStep[] = [];
  const skippedAnchors: string[] = [];

  for (const step of tour.steps) {
    if (available.has(step.anchor)) {
      steps.push(step);
    } else if (step.optional) {
      skippedAnchors.push(step.anchor);
    } else {
      return {
        steps: [],
        skippedAnchors,
        missingRequiredAnchor: step.anchor,
      };
    }
  }

  return { steps, skippedAnchors };
}

export function createTourNavigation(): TourNavigation {
  return { index: 0 };
}

export function nextTourStep(state: TourNavigation, stepCount: number): TourNavigation {
  return { index: Math.min(state.index + 1, Math.max(0, stepCount - 1)) };
}

export function previousTourStep(state: TourNavigation): TourNavigation {
  return { index: Math.max(0, state.index - 1) };
}

export function restartTour(): TourNavigation {
  return { index: 0 };
}
