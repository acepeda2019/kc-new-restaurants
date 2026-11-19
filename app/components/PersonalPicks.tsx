"use client";

/**
 * Browser-only state for the home page: the visitor's location (asked on click, never sent
 * anywhere) and "Tried it" marks (localStorage). Ranking and counting come from lib/rank;
 * Metrics and TopThree stay presentational. The first render has no location and nothing
 * tried (the server snapshot), so it matches the static HTML; stored marks apply after hydration.
 */
import { useState, useSyncExternalStore } from "react";
import { HiddenTried } from "@/components/HiddenTried";
import { Metrics } from "@/components/Metrics";
import { TopThree } from "@/components/TopThree";
import type { Metrics as MetricsData, Opening } from "@/lib/data";
import { requestLocation } from "@/lib/location";
import { NEAR_RADIUS_MI, countNear, personalTopThree, type LatLon } from "@/lib/rank";
import {
  clearTried,
  hiddenCount,
  hiddenFromTop,
  nextJustMarked,
  subscribeTried,
  toggleTried,
  triedSnapshot,
} from "@/lib/tried";

type Props = { openings: Opening[]; metrics: MetricsData };
type LocationStatus = "idle" | "asking" | "found" | "unavailable";

const NOTHING_TRIED = new Set<string>();
const serverSnapshot = () => NOTHING_TRIED;
const browserSnapshot = () => triedSnapshot();

export function PersonalPicks({ openings, metrics }: Props) {
  const [here, setHere] = useState<LatLon | undefined>(undefined);
  const [status, setStatus] = useState<LocationStatus>("idle");
  const tried = useSyncExternalStore(subscribeTried, browserSnapshot, serverSnapshot);
  // The place just marked stays on screen (button pressed) so it can be undone in place.
  const [justMarked, setJustMarked] = useState<string | null>(null);

  async function locate() {
    if (status === "asking") return; // aria-disabled (not disabled) keeps focus, so ignore clicks here
    setStatus("asking");
    const found = await requestLocation();
    setHere(found ?? undefined);
    setStatus(found ? "found" : "unavailable");
  }

  function toggle(id: string) {
    setJustMarked(nextJustMarked(id, toggleTried(id)));
  }

  function clear() {
    clearTried();
    setJustMarked(null);
  }

  const top = personalTopThree(openings, { here, tried: hiddenFromTop(tried, justMarked) });
  const near = here ? { count: countNear(openings, here), radiusMi: NEAR_RADIUS_MI } : undefined;

  return (
    <>
      <Metrics metrics={metrics} near={near} />

      <section aria-labelledby="top-three">
        <h2 id="top-three">Top 3 new openings</h2>
        <p className="locate">
          <button type="button" onClick={locate} aria-disabled={status === "asking"}>
            {status === "asking" ? "Finding you…" : "Use my location"}
          </button>
          <span role="status">
            {status === "unavailable" && "Location unavailable — showing default order"}
            {status === "found" && "Ranked by score and distance from you"}
          </span>
        </p>
        <TopThree items={top} tried={tried} onToggleTried={toggle} />
        <HiddenTried count={hiddenCount(openings, tried, justMarked)} onClear={clear} />
      </section>
    </>
  );
}
