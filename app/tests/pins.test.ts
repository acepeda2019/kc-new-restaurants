import { describe, expect, it } from "vitest";
import type { Opening } from "@/lib/data";
import {
  FOCUS_ZOOM, KING_COUNTY_BOUNDS, YOU_ZOOM, boundsOf, cameraTarget, focusTarget, nextFocus, offMapNote, popupText,
  resolveFocus, toPins,
} from "@/lib/pins";

const SEATTLE = { lat: 47.6062, lon: -122.3321 };
const BELLEVUE = { lat: 47.6101, lon: -122.2015 };

// Only the fields the map reads matter; the rest are filled to satisfy the type.
function opening(
  id: string,
  at: { lat: number; lon: number } | null,
  extra: Partial<Opening> = {},
): Opening {
  return {
    restaurant_id: id, name: `Name ${id}`, address: "1 Main St", city: "SEATTLE", zip5: "98101",
    latitude: at?.lat ?? null, longitude: at?.lon ?? null, geocode_match_status: at ? "Match" : null,
    category: "restaurant", opening_type: "new_opening", replaces_name: null, likely_cuisine: null,
    first_inspection_date: "2026-11-01", days_open: 16, first_inspection_type: "Routine Inspection/Field Review",
    first_inspection_result: "Satisfactory", first_inspection_red_points: 0,
    latest_inspection_date: "2026-11-01", latest_red_points: 0, red_violations: [],
    freshness: 0.7, safety: 1, score: 80, rank: 1, why: `Why ${id}`,
    source: "claude", confidence: 0.9, classification_reason: "test",
    ...extra,
  };
}

const kinds = (fc: ReturnType<typeof toPins>) =>
  Object.fromEntries(fc.features.map((f) => [f.properties.id, f.properties.kind]));

describe("toPins", () => {
  it("numbers answer picks by card position, up to 5, even when an Opening soon pick sits between", () => {
    const places = ["A", "B", "C", "D", "E", "F"].map((id) => opening(id, SEATTLE));
    // Card order: A, a soon place (no number on the map), C, D, E.
    const fc = toPins(places, { topIds: new Set(["A", "SOON-1", "C", "D", "E"]) });
    const rank = Object.fromEntries(fc.features.map((f) => [f.properties.id, f.properties.rank]));
    expect(rank).toMatchObject({ A: 1, C: 3, D: 4, E: 5 });
    expect(rank.B).toBeUndefined();
    expect(rank.F).toBeUndefined();
  });

  it("marks the top 3 as top, red points as wary, the rest as new; top wins over wary", () => {
    const rows = [
      opening("a", SEATTLE),
      opening("b", SEATTLE, { latest_red_points: 25 }),
      opening("c", BELLEVUE, { latest_red_points: 10 }),
      opening("d", BELLEVUE),
    ];
    const pins = toPins(rows, { topIds: new Set(["a", "b"]) });
    expect(kinds(pins)).toEqual({ a: "top", b: "top", c: "wary", d: "new" });
  });

  it("numbers top pins 1-3 in topIds order (the card order); other pins have no rank", () => {
    const rows = [opening("a", SEATTLE), opening("b", BELLEVUE), opening("c", SEATTLE), opening("d", BELLEVUE)];
    const pins = toPins(rows, { topIds: new Set(["c", "a", "b"]) });
    const ranks = Object.fromEntries(pins.features.map((f) => [f.properties.id, f.properties.rank]));
    expect(ranks).toEqual({ a: 2, b: 3, c: 1, d: undefined });
  });

  it("labels top pins with the name for the map's text layer; other pins have no label", () => {
    const rows = [opening("a", SEATTLE), opening("b", BELLEVUE, { latest_red_points: 5 })];
    const pins = toPins(rows, { topIds: new Set(["a"]), here: SEATTLE });
    const labels = Object.fromEntries(pins.features.map((f) => [f.properties.id, f.properties.label]));
    expect(labels).toEqual({ a: "Name a", b: undefined, you: undefined });
  });

  it("carries name and why, and puts coordinates in lon, lat order", () => {
    const [pin] = toPins([opening("a", SEATTLE)], { topIds: new Set() }).features;
    expect(pin.type).toBe("Feature");
    expect(pin.geometry).toEqual({ type: "Point", coordinates: [SEATTLE.lon, SEATTLE.lat] });
    expect(pin.properties).toMatchObject({ name: "Name a", why: "Why a" });
  });

  it("leaves out food trucks and rows without coordinates", () => {
    const rows = [
      opening("fixed", SEATTLE),
      opening("truck", SEATTLE, { category: "food_truck" }),
      opening("unmatched", null),
    ];
    const pins = toPins(rows, { topIds: new Set(["truck", "unmatched"]) });
    expect(pins.type).toBe("FeatureCollection");
    expect(pins.features.map((f) => f.properties.id)).toEqual(["fixed"]);
  });

  it("adds a 'you' pin only when a location is given", () => {
    const rows = [opening("a", SEATTLE)];
    expect(toPins(rows, { topIds: new Set() }).features.some((f) => f.properties.kind === "you")).toBe(false);

    const withHere = toPins(rows, { topIds: new Set(), here: BELLEVUE }).features;
    const you = withHere.filter((f) => f.properties.kind === "you");
    expect(you).toHaveLength(1);
    expect(you[0].geometry.coordinates).toEqual([BELLEVUE.lon, BELLEVUE.lat]);
  });
});

describe("boundsOf", () => {
  it("spans every pin as [[west, south], [east, north]]", () => {
    const pins = toPins([opening("a", SEATTLE), opening("b", BELLEVUE)], { topIds: new Set() });
    expect(boundsOf(pins.features)).toEqual([
      [SEATTLE.lon, SEATTLE.lat],
      [BELLEVUE.lon, BELLEVUE.lat],
    ]);
  });

  it("falls back to King County when there are no pins", () => {
    expect(boundsOf([])).toEqual(KING_COUNTY_BOUNDS);
    const [[west, south], [east, north]] = KING_COUNTY_BOUNDS;
    expect(west).toBeLessThan(SEATTLE.lon);
    expect(east).toBeGreaterThan(BELLEVUE.lon);
    expect(south).toBeLessThan(SEATTLE.lat);
    expect(north).toBeGreaterThan(SEATTLE.lat);
  });
});

describe("popupText", () => {
  it("joins name and why with a middle dot", () => {
    expect(popupText({ name: "KOSHARI", why: "First inspected Nov 13" })).toBe("KOSHARI · First inspected Nov 13");
  });

  it("shows just the name when there is no reason", () => {
    expect(popupText({ name: "You are here", why: "" })).toBe("You are here");
  });
});

describe("toPins and Tried it", () => {
  it("pins every fixed-spot opening, so tried places (outside the top 3) stay on the map", () => {
    const rows = [opening("top", SEATTLE), opening("tried", BELLEVUE)];
    // "tried" was dropped from the top 3 by ranking; the map still shows it as a new place.
    expect(kinds(toPins(rows, { topIds: new Set(["top"]) }))).toEqual({ top: "top", tried: "new" });
  });
});

describe("cameraTarget", () => {
  const rows = [opening("a", SEATTLE)];

  it("is nothing without a location, so the map keeps its view", () => {
    expect(cameraTarget(toPins(rows, { topIds: new Set() }), null)).toBeNull();
  });

  it("centres on the visitor at street-ish zoom when the location is new", () => {
    const pins = toPins(rows, { topIds: new Set(), here: BELLEVUE });
    expect(cameraTarget(pins, null)).toEqual({ center: [BELLEVUE.lon, BELLEVUE.lat], zoom: YOU_ZOOM });
    expect(YOU_ZOOM).toBe(12);
  });

  it("does not move again for the same location (e.g. after a Tried it click)", () => {
    const pins = toPins(rows, { topIds: new Set(["a"]), here: BELLEVUE });
    expect(cameraTarget(pins, [BELLEVUE.lon, BELLEVUE.lat])).toBeNull();
  });

  it("moves again when the visitor is found somewhere else", () => {
    const pins = toPins(rows, { topIds: new Set(), here: SEATTLE });
    expect(cameraTarget(pins, [BELLEVUE.lon, BELLEVUE.lat])?.center).toEqual([SEATTLE.lon, SEATTLE.lat]);
  });
});

describe("focusTarget", () => {
  it("centres on a fixed-spot place at street zoom, in lon, lat order", () => {
    expect(focusTarget(opening("a", SEATTLE))).toEqual({ center: [SEATTLE.lon, SEATTLE.lat], zoom: FOCUS_ZOOM });
    expect(FOCUS_ZOOM).toBe(15);
  });

  it("is null for food trucks and places without coordinates", () => {
    expect(focusTarget(opening("t", SEATTLE, { category: "food_truck" }))).toBeNull();
    expect(focusTarget(opening("u", null))).toBeNull();
  });
});

describe("offMapNote", () => {
  it("says why a place has no pin, and is null exactly when focusTarget has a target", () => {
    const rows = [opening("a", SEATTLE), opening("t", SEATTLE, { category: "food_truck" }), opening("u", null)];
    expect(rows.map(offMapNote)).toEqual([null, "no fixed spot", "not on the map"]);
    for (const o of rows) expect(offMapNote(o) === null).toBe(focusTarget(o) !== null);
  });
});

describe("nextFocus", () => {
  it("focuses a clicked name, as a new object so a repeat request flies there again", () => {
    const click = { id: "a", from: "list" as const };
    const next = nextFocus(null, click);
    expect(next).toEqual(click);
    expect(next).not.toBe(click);
  });

  it("toggles off when the already-focused name is clicked again", () => {
    expect(nextFocus({ id: "a", from: "list" }, { id: "a", from: "list" })).toBeNull();
    expect(nextFocus({ id: "a", from: "map" }, { id: "a", from: "list" })).toBeNull();
  });

  it("moves to another place, and a pin click on the focused pin keeps it", () => {
    expect(nextFocus({ id: "a", from: "list" }, { id: "b", from: "list" })).toEqual({ id: "b", from: "list" });
    expect(nextFocus({ id: "a", from: "list" }, { id: "a", from: "map" })).toEqual({ id: "a", from: "map" });
  });

  it("clears on null (Escape, the popup closed, or the map failed)", () => {
    expect(nextFocus({ id: "a", from: "list" }, null)).toBeNull();
  });
});

describe("resolveFocus", () => {
  const rows = [opening("a", SEATTLE), opening("t", SEATTLE, { category: "food_truck" })];

  it("adds the camera target for a place with a pin", () => {
    expect(resolveFocus({ id: "a", from: "list" }, rows)).toEqual({
      id: "a", from: "list", center: [SEATTLE.lon, SEATTLE.lat], zoom: FOCUS_ZOOM,
    });
  });

  it("is null for nothing focused, an unknown id, or a place without a pin", () => {
    expect(resolveFocus(null, rows)).toBeNull();
    expect(resolveFocus({ id: "zzz", from: "list" }, rows)).toBeNull();
    expect(resolveFocus({ id: "t", from: "list" }, rows)).toBeNull();
  });
});
