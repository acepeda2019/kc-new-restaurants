/**
 * Map pins (ARCHITECTURE.md §7, Map): pure functions, safe to run in the browser. Turns the
 * openings into a GeoJSON FeatureCollection for MapLibre; the component only draws it.
 */
import type { Opening, OpeningSoon } from "@/lib/data";
import { addressLine, latestInspection } from "@/lib/format";
import type { LatLon } from "@/lib/rank";

/**
 * Pin group: the current top 3, places with red points at the latest inspection, other new
 * places, Opening soon (licence applied for, not open yet), the visitor.
 */
export type PinKind = "top" | "wary" | "new" | "soon" | "you";
/**
 * Top pins only: `rank` (1-5) is the place's position in the answer's picks or the personal top 3,
 * the number on its card, and `label` is its name for the map's text layer.
 */
/**
 * `detail` is the popup line after the name (open places: street, city and latest inspection;
 * Opening soon: the licence line). `where` names the place's city for the hover label.
 */
export type PinProps = { id: string; kind: PinKind; name: string; detail: string; where: string; rank?: number; label?: string };
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

function pin(id: string, kind: PinKind, at: LatLon, name: string, detail: string, where: string, rank?: number): PinFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [at.lon, at.lat] },
    properties: rank ? { id, kind, name, detail, where, rank, label: name } : { id, kind, name, detail, where },
  };
}

type Placeable = Pick<Opening, "category" | "latitude" | "longitude">;

/** Where a place is pinned, or null: food trucks (the address is a base) and rows without coordinates get no pin. */
function fixedSpot(o: Placeable): LatLon | null {
  if (o.category === "food_truck" || o.latitude === null || o.longitude === null) return null;
  return { lat: o.latitude, lon: o.longitude };
}

/**
 * One pin per opening with a fixed spot (not a food truck, coordinates known), tried or not,
 * so visitors can pan around and see what is near them. Kind:
 * "top" if in `topIds`, else "wary" if the latest inspection was Unsatisfactory (the county's
 * verdict on that visit), else "new".
 * Top pins get `rank` from `topIds`' insertion order, so pass the top 3 in card order.
 * With `here`, adds one "you" pin.
 */
export function toPins(
  openings: Opening[],
  opts: { topIds: ReadonlySet<string>; here?: LatLon; openingSoon?: OpeningSoon[] },
): Pins {
  const topOrder = [...opts.topIds];
  const features: PinFeature[] = [];
  for (const o of openings) {
    const at = fixedSpot(o);
    if (!at) continue;
    const rank = topOrder.indexOf(o.restaurant_id) + 1; // 0 when not in the top 3
    const kind: PinKind = rank ? "top" : o.latest_inspection_result === "Unsatisfactory" ? "wary" : "new";
    // The popup says where (same-name places differ by street) and the latest inspection.
    const detail = `${addressLine(o)} · ${latestInspection(o).label}`;
    features.push(pin(o.restaurant_id, kind, at, o.name, detail, addressLine({ ...o, address: null }), rank));
  }
  for (const s of opts.openingSoon ?? []) {
    const at = soonSpot(s);
    if (at) features.push(pin(s.notice_id, "soon", at, s.trade_name, s.why, addressLine({ address: null, city: s.city ?? "King County", category: "restaurant" })));
  }
  if (opts.here) features.push(pin("you", "you", opts.here, "You are here", "", ""));
  return { type: "FeatureCollection", features };
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

/** Popup text: "name · detail", or just the name when there is no detail. */
export function popupText(p: Pick<PinProps, "name" | "detail">): string {
  return p.detail ? `${p.name} · ${p.detail}` : p.name;
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

/**
 * The "reset view" camera: around the visitor once located (as after "Use my location"),
 * else every pin (King County when there are none). The visitor's own pin is left out of the
 * bounds so the whole-county view doesn't depend on where they are.
 */
export function homeView(pins: Pins): { center: LonLat; zoom: number } | { bounds: Bounds } {
  const you = pins.features.find((f) => f.properties.kind === "you");
  if (you) return { center: you.geometry.coordinates, zoom: YOU_ZOOM };
  return { bounds: boundsOf(pins.features) };
}

/** Zoom for showing one place: its street and the blocks around it. */
export const FOCUS_ZOOM = 15;

/** Where to move the camera to show one place, or null when it has no pin (trucks, no coordinates). */
export function focusTarget(o: Placeable): { center: LonLat; zoom: number } | null {
  const at = fixedSpot(o);
  return at ? { center: [at.lon, at.lat], zoom: FOCUS_ZOOM } : null;
}

/** An Opening soon place's spot, or null until the geocoder has matched its address. */
export function soonSpot(s: Pick<OpeningSoon, "latitude" | "longitude">): LatLon | null {
  return s.latitude === null || s.longitude === null ? null : { lat: s.latitude, lon: s.longitude };
}

/** Why a place has no pin, for a short note beside its name; null when it is on the map. */
export function offMapNote(o: Placeable): "no fixed spot" | "not on the map" | null {
  if (o.category === "food_truck") return "no fixed spot";
  return fixedSpot(o) ? null : "not on the map";
}

/** A request to show one place: from a name in a list, or from its pin on the map. */
export type FocusRequest = { id: string; from: "list" | "map" };
/** A focus request plus where the camera goes; `from: "list"` moves the camera, `"map"` doesn't. */
export type MapFocus = FocusRequest & { center: LonLat; zoom: number };

/**
 * The focus after a click (or `null`: Escape, the popup closed, the map failed). Clicking the
 * focused place's name again clears it; anything else focuses the clicked place, as a new
 * object so a repeat request is seen as new.
 */
export function nextFocus(current: FocusRequest | null, clicked: FocusRequest | null): FocusRequest | null {
  if (!clicked) return null;
  if (clicked.from === "list" && current?.id === clicked.id) return null;
  return { ...clicked };
}

/** The focus with its camera target, or null when nothing is focused or the place has no pin. */
export function resolveFocus(
  focus: FocusRequest | null,
  openings: Opening[],
  openingSoon: OpeningSoon[] = [],
): MapFocus | null {
  if (!focus) return null;
  const place = openings.find((o) => o.restaurant_id === focus.id);
  if (place) {
    const target = focusTarget(place);
    return target ? { ...focus, ...target } : null;
  }
  const soon = openingSoon.find((s) => s.notice_id === focus.id);
  const at = soon && soonSpot(soon);
  return at ? { ...focus, center: [at.lon, at.lat], zoom: FOCUS_ZOOM } : null;
}

/** How far from a tap (in screen pixels) a pin still counts as tapped: about half a fingertip. */
export const TAP_RADIUS_PX = 22;

/**
 * The pin a tap meant (SAN-52): the nearest one within `radius` pixels of the tap, or null.
 * Small pins are hard to hit with a finger, and overlapping ones need a tie-break; on equal
 * distance the first candidate wins (MapLibre lists the top-drawn feature first).
 */
export function nearestPin<T>(
  candidates: { item: T; x: number; y: number }[],
  tap: { x: number; y: number },
  radius = TAP_RADIUS_PX,
): T | null {
  let best: T | null = null;
  let bestD = radius;
  for (const c of candidates) {
    const d = Math.hypot(c.x - tap.x, c.y - tap.y);
    if (d < bestD || (best === null && d <= radius)) {
      best = c.item;
      bestD = d;
    }
  }
  return best;
}
