/**
 * Place ordering and distances (ARCHITECTURE.md §6): pure functions, safe to run in the browser.
 * With a location, nearest first; without, the mart's rank.
 */
import type { Opening, OpeningSoon } from "@/lib/data";

export type LatLon = { lat: number; lon: number };
export type RankedOpening = Opening & { distanceMi?: number };

const EARTH_RADIUS_MI = 3958.8;
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

/** How many openings have a fixed spot within `radiusMi` of `here`; trucks and unmapped rows never count. */
export function countNear(openings: Opening[], here: LatLon, radiusMi = NEAR_RADIUS_MI): number {
  return openings.filter((o) => {
    const at = spot(o);
    return at !== null && haversineMi(here, at) <= radiusMi;
  }).length;
}

export type PlaceListItem = RankedOpening & { tried: boolean };

/**
 * Every opening, tried or not, for the full list. With `here`: fixed spots nearest first
 * (distanceMi attached, ties by rank), then trucks and unmapped rows in rank order. Without:
 * rank order, no distances. Each item says whether it is marked tried.
 */
export function allPlaces(openings: Opening[], opts: { here?: LatLon; tried: Set<string> }): PlaceListItem[] {
  const byRank = (a: Opening, b: Opening) => a.rank - b.rank;
  const withTried = (o: RankedOpening): PlaceListItem => ({ ...o, tried: opts.tried.has(o.restaurant_id) });
  const { here } = opts;
  if (!here) return [...openings].sort(byRank).map(withTried);

  const mapped: (RankedOpening & { distanceMi: number })[] = [];
  const unmapped: Opening[] = [];
  for (const o of openings) {
    const at = spot(o);
    if (at) mapped.push({ ...o, distanceMi: haversineMi(here, at) });
    else unmapped.push(o);
  }
  mapped.sort((a, b) => a.distanceMi - b.distanceMi || byRank(a, b));
  return [...mapped, ...unmapped.sort(byRank)].map(withTried);
}

/**
 * Opening soon in display order: with `here`, places with coordinates nearest first (with
 * `distanceMi`), then the rest by rank; without it, by rank (newest application first).
 */
export function rankOpeningSoon(
  places: OpeningSoon[],
  here?: LatLon,
): Array<OpeningSoon & { distanceMi?: number }> {
  const byRank = (a: OpeningSoon, b: OpeningSoon) => a.rank - b.rank;
  if (!here) return [...places].sort(byRank);
  const located: Array<OpeningSoon & { distanceMi: number }> = [];
  const rest: OpeningSoon[] = [];
  for (const p of places) {
    if (p.latitude === null || p.longitude === null) rest.push(p);
    else located.push({ ...p, distanceMi: haversineMi(here, { lat: p.latitude, lon: p.longitude }) });
  }
  located.sort((a, b) => a.distanceMi - b.distanceMi || byRank(a, b));
  return [...located, ...rest.sort(byRank)];
}
