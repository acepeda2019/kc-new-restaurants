/**
 * Map pins (ARCHITECTURE.md §7, Map): pure functions, safe to run in the browser. Turns the
 * openings into a GeoJSON FeatureCollection for MapLibre; the component only draws it.
 */
import type { Opening } from "@/lib/data";
import type { LatLon } from "@/lib/rank";

/** Pin colour group: the current top 3, places with red points at the latest inspection, other new places, the visitor. */
export type PinKind = "top" | "wary" | "new" | "you";
export type PinProps = { id: string; kind: PinKind; name: string; why: string };
export type PinFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [lon: number, lat: number] };
  properties: PinProps;
};
export type Pins = { type: "FeatureCollection"; features: PinFeature[] };
/** [[west, south], [east, north]], the order MapLibre's fitBounds takes. */
export type Bounds = [[number, number], [number, number]];

/** Roughly King County, for the initial view when there is nothing to fit. */
export const KING_COUNTY_BOUNDS: Bounds = [
  [-122.54, 47.08],
  [-121.06, 47.78],
];

function pin(id: string, kind: PinKind, at: LatLon, name: string, why: string): PinFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [at.lon, at.lat] },
    properties: { id, kind, name, why },
  };
}

/**
 * One pin per opening with a fixed spot (not a food truck, coordinates known), tried or not,
 * so visitors can pan around and see what is near them. Kind:
 * "top" if in `topIds`, else "wary" if the latest inspection had red points, else "new".
 * With `here`, adds one "you" pin.
 */
export function toPins(openings: Opening[], opts: { topIds: ReadonlySet<string>; here?: LatLon }): Pins {
  const features: PinFeature[] = [];
  for (const o of openings) {
    if (o.category === "food_truck" || o.latitude === null || o.longitude === null) continue;
    const kind: PinKind = opts.topIds.has(o.restaurant_id) ? "top" : o.latest_red_points > 0 ? "wary" : "new";
    features.push(pin(o.restaurant_id, kind, { lat: o.latitude, lon: o.longitude }, o.name, o.why));
  }
  if (opts.here) features.push(pin("you", "you", opts.here, "You are here", ""));
  return { type: "FeatureCollection", features };
}

/** Food trucks have no fixed spot to pin (their address is a base), so they are listed under the map. */
export function trucksOf(openings: Opening[]): Opening[] {
  return openings.filter((o) => o.category === "food_truck");
}

/** The box around every pin; King County when there are none. */
export function boundsOf(features: PinFeature[]): Bounds {
  if (features.length === 0) return KING_COUNTY_BOUNDS;
  const lons = features.map((f) => f.geometry.coordinates[0]);
  const lats = features.map((f) => f.geometry.coordinates[1]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

/** Popup text: "name · why", or just the name when there is no reason. */
export function popupText(p: Pick<PinProps, "name" | "why">): string {
  return p.why ? `${p.name} · ${p.why}` : p.name;
}
