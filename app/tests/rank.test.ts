import { describe, expect, it } from "vitest";
import type { Opening } from "@/lib/data";
import { allPlaces, countNear, haversineMi } from "@/lib/rank";

const SEATTLE = { lat: 47.6062, lon: -122.3321 };
const BELLEVUE = { lat: 47.6101, lon: -122.2015 };

// Only the fields ranking reads matter; the rest are filled to satisfy the type.
function opening(id: string, rank: number, score: number, at?: { lat: number; lon: number }, category: Opening["category"] = "restaurant"): Opening {
  return {
    restaurant_id: id, name: id, address: "1 Main St", city: "SEATTLE", zip5: "98101",
    latitude: at?.lat ?? null, longitude: at?.lon ?? null, geocode_match_status: at ? "Match" : null,
    category, opening_type: "new_opening", replaces_name: null, likely_cuisine: null,
    first_inspection_date: "2026-11-01", days_open: 16, first_inspection_type: "Routine Inspection/Field Review",
    first_inspection_result: "Satisfactory", first_inspection_red_points: 0,
    latest_inspection_date: "2026-11-01", latest_red_points: 0, red_violations: [],
    freshness: 0.7, safety: 1, score, rank, why: "First inspected Nov 1; clean first inspection",
    source: "claude", confidence: 0.9, classification_reason: "test",
  };
}

const ids = (rows: { restaurant_id: string }[]) => rows.map((r) => r.restaurant_id);

describe("haversineMi", () => {
  it("measures Seattle to Bellevue at about 6.1 miles", () => {
    const d = haversineMi(SEATTLE, BELLEVUE);
    expect(d).toBeGreaterThan(6.0);
    expect(d).toBeLessThan(6.2);
  });

  it("is zero for the same point", () => {
    expect(haversineMi(SEATTLE, SEATTLE)).toBe(0);
  });
});

describe("countNear", () => {
  const near = { lat: 47.6076, lon: -122.3321 }; // ~0.1 mi from SEATTLE

  it("counts mappable places within 2 miles by default", () => {
    const rows = [opening("a", 1, 90, SEATTLE), opening("b", 2, 80, near), opening("far", 3, 70, BELLEVUE)];
    expect(countNear(rows, SEATTLE)).toBe(2);
  });

  it("never counts food trucks or rows without coordinates", () => {
    const rows = [opening("truck", 1, 90, SEATTLE, "food_truck"), opening("unmapped", 2, 80)];
    expect(countNear(rows, SEATTLE)).toBe(0);
  });

  it("takes a custom radius, inclusive at the edge", () => {
    const rows = [opening("far", 1, 90, BELLEVUE)];
    expect(countNear(rows, SEATTLE, 6)).toBe(0);
    expect(countNear(rows, SEATTLE, haversineMi(SEATTLE, BELLEVUE))).toBe(1);
  });

  it("is zero for no openings", () => {
    expect(countNear([], SEATTLE)).toBe(0);
  });
});

describe("allPlaces", () => {
  const nearSeattle = { lat: 47.61, lon: -122.33 };
  const rows = [
    opening("far", 1, 90, BELLEVUE),
    opening("truck", 2, 85, SEATTLE, "food_truck"),
    opening("close", 3, 80, nearSeattle),
    opening("unmapped", 4, 75),
    opening("closest", 5, 70, SEATTLE),
  ];

  it("lists every opening, trucks and unmapped included, in rank order without a location", () => {
    const all = allPlaces(rows, { tried: new Set() });
    expect(ids(all)).toEqual(["far", "truck", "close", "unmapped", "closest"]);
    expect(all.every((o) => o.distanceMi === undefined)).toBe(true);
  });

  it("with a location, puts fixed spots nearest first with distances, then trucks and unmapped in rank order", () => {
    const all = allPlaces(rows, { here: SEATTLE, tried: new Set() });
    expect(ids(all)).toEqual(["closest", "close", "far", "truck", "unmapped"]);
    expect(all[0].distanceMi).toBe(0);
    expect(all[2].distanceMi).toBeGreaterThan(6);
    expect(all.find((o) => o.restaurant_id === "truck")?.distanceMi).toBeUndefined();
  });

  it("keeps tried places and flags them", () => {
    const all = allPlaces(rows, { tried: new Set(["close", "truck"]) });
    expect(all).toHaveLength(rows.length);
    expect(Object.fromEntries(all.map((o) => [o.restaurant_id, o.tried]))).toEqual({
      far: false, truck: true, close: true, unmapped: false, closest: false,
    });
  });

  it("is empty for no openings", () => {
    expect(allPlaces([], { here: SEATTLE, tried: new Set() })).toEqual([]);
  });
});
