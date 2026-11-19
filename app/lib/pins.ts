/**
 * Map pins (ARCHITECTURE.md §7, Map): pure functions, safe to run in the browser. Turns the
 * openings into a GeoJSON FeatureCollection for MapLibre; the component only draws it.
 */
import type { Opening } from "@/lib/data";
import type { LatLon } from "@/lib/rank";

/** Pin colour group: the current top 3, places with red points at the latest inspection, other new places, the visitor. */
export type PinKind = "top" | "wary" | "new" | "you";
/** `rank` (1-3, top pins only) is the place's position in the personal top 3, the number on its card. */
export type PinProps = { id: string; kind: PinKind; name: string; why: string; rank?: number };
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

function pin(id: string, kind: PinKind, at: LatLon, name: string, why: string, rank?: number): PinFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [at.lon, at.lat] },
    properties: rank ? { id, kind, name, why, rank } : { id, kind, name, why },
  };
}

/**
 * One pin per opening with a fixed spot (not a food truck, coordinates known), tried or not,
 * so visitors can pan around and see what is near them. Kind:
 * "top" if in `topIds`, else "wary" if the latest inspection had red points, else "new".
 * Top pins get `rank` from `topIds`' insertion order, so pass the top 3 in card order.
 * With `here`, adds one "you" pin.
 */
export function toPins(openings: Opening[], opts: { topIds: ReadonlySet<string>; here?: LatLon }): Pins {
  const topOrder = [...opts.topIds];
  const features: PinFeature[] = [];
  for (const o of openings) {
    if (o.category === "food_truck" || o.latitude === null || o.longitude === null) continue;
    const rank = topOrder.indexOf(o.restaurant_id) + 1; // 0 when not in the top 3
    const kind: PinKind = rank ? "top" : o.latest_red_points > 0 ? "wary" : "new";
    features.push(pin(o.restaurant_id, kind, { lat: o.latitude, lon: o.longitude }, o.name, o.why, rank));
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

/** Zoom for centring on the visitor: a few neighbourhoods across. */
export const YOU_ZOOM = 12;
type LonLat = [lon: number, lat: number];

/**
 * Where to move the camera after the pins change: onto the "you" pin when it is at a
 * different spot from `lastCentered` (the last location centred on), else nowhere (null),
 * so a top 3 or "Tried it" change never moves the map.
 */
export function cameraTarget(pins: Pins, lastCentered: LonLat | null): { center: LonLat; zoom: number } | null {
  const you = pins.features.find((f) => f.properties.kind === "you");
  if (!you) return null;
  const [lon, lat] = you.geometry.coordinates;
  if (lastCentered && lastCentered[0] === lon && lastCentered[1] === lat) return null;
  return { center: [lon, lat], zoom: YOU_ZOOM };
}
