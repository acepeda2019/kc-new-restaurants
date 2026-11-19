/**
 * Personal top 3 (ARCHITECTURE.md §6): pure functions, safe to run in the browser.
 * With a location, rank by score − 10 × distance in miles; without, use the mart's rank.
 */
import type { Opening } from "@/lib/data";

export type LatLon = { lat: number; lon: number };
export type RankedOpening = Opening & { distanceMi?: number };

const EARTH_RADIUS_MI = 3958.8;
const POINTS_PER_MILE = 10;
const TOP_N = 3;
/** Radius for the "near you" headline number. */
export const NEAR_RADIUS_MI = 2;

/** Great-circle distance in miles. */
export function haversineMi(a: LatLon, b: LatLon): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

/** A fixed spot to measure to: none for food trucks or rows without coordinates. */
function spot(o: Opening): LatLon | null {
  if (o.category === "food_truck" || o.latitude === null || o.longitude === null) return null;
  return { lat: o.latitude, lon: o.longitude };
}

/**
 * Up to 3 openings not in `tried`. With `here`, mappable places come first, ordered by
 * score − 10 × distanceMi (distanceMi attached); trucks and unmapped rows follow in rank
 * order. Without `here`, plain rank order and no distances.
 */
export function personalTopThree(
  openings: Opening[],
  opts: { here?: LatLon; tried: Set<string> },
): RankedOpening[] {
  const left = openings.filter((o) => !opts.tried.has(o.restaurant_id));
  const byRank = (a: Opening, b: Opening) => a.rank - b.rank;
  const { here } = opts;
  if (!here) return [...left].sort(byRank).slice(0, TOP_N);

  const mapped: (RankedOpening & { distanceMi: number })[] = [];
  const unmapped: Opening[] = [];
  for (const o of left) {
    const at = spot(o);
    if (at) mapped.push({ ...o, distanceMi: haversineMi(here, at) });
    else unmapped.push(o);
  }
  const personal = (o: { score: number; distanceMi: number }) => o.score - POINTS_PER_MILE * o.distanceMi;
  mapped.sort((a, b) => personal(b) - personal(a) || byRank(a, b));
  return [...mapped, ...unmapped.sort(byRank)].slice(0, TOP_N);
}

/** How many openings have a fixed spot within `radiusMi` of `here`; trucks and unmapped rows never count. */
export function countNear(openings: Opening[], here: LatLon, radiusMi = NEAR_RADIUS_MI): number {
  return openings.filter((o) => {
    const at = spot(o);
    return at !== null && haversineMi(here, at) <= radiusMi;
  }).length;
}
