import { describe, expect, it } from "vitest";
import type { Opening } from "@/lib/data";
import { KING_COUNTY_BOUNDS, boundsOf, popupText, toPins, trucksOf } from "@/lib/pins";

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

describe("trucksOf", () => {
  it("lists only the food trucks, in the given order", () => {
    const rows = [
      opening("t2", null, { category: "food_truck" }),
      opening("fixed", SEATTLE),
      opening("t1", null, { category: "food_truck" }),
    ];
    expect(trucksOf(rows).map((o) => o.restaurant_id)).toEqual(["t2", "t1"]);
  });

  it("is empty when there are no trucks", () => {
    expect(trucksOf([opening("fixed", SEATTLE)])).toEqual([]);
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
