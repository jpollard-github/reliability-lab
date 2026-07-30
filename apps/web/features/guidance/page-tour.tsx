"use client";

import { usePathname } from "next/navigation";
import { TourLauncher } from "./tour-launcher";
import { resolveTourForPath } from "./tour-registry";

export function PageTour() {
  const pathname = usePathname();
  const tour = resolveTourForPath(pathname);
  return tour ? <TourLauncher key={tour.id} tour={tour} /> : null;
}
