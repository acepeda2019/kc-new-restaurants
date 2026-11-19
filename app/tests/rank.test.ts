import { describe, expect, it } from "vitest";
import type { Opening } from "@/lib/data";
import { haversineMi, personalTopThree } from "@/lib/rank";

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

describe("personalTopThree", () => {
  it("drops places marked tried", () => {
    const rows = [opening("a", 1, 90), opening("b", 2, 80), opening("c", 3, 70), opening("d", 4, 60)];
    expect(ids(personalTopThree(rows, { tried: new Set(["a"]) }))).toEqual(["b", "c", "d"]);
  });

  it("uses rank order without a location and attaches no distance", () => {
    const rows = [opening("c", 3, 70), opening("a", 1, 90), opening("d", 4, 60), opening("b", 2, 80)];
    const top = personalTopThree(rows, { tried: new Set() });
    expect(ids(top)).toEqual(["a", "b", "c"]);
    expect(top.every((r) => r.distanceMi === undefined)).toBe(true);
  });

  it("prefers the closer of two equal scores when location is known", () => {
    const far = opening("far", 1, 80, BELLEVUE);
    const near = opening("near", 2, 80, { lat: 47.607, lon: -122.333 });
    const top = personalTopThree([far, near], { here: SEATTLE, tried: new Set() });
    expect(ids(top)).toEqual(["near", "far"]);
    expect(top[0].distanceMi).toBeLessThan(0.2);
    expect(top[1].distanceMi).toBeCloseTo(haversineMi(SEATTLE, BELLEVUE), 5);
  });

  it("drops places marked tried when location is known", () => {
    const rows = [opening("a", 1, 90, SEATTLE), opening("b", 2, 80, SEATTLE), opening("c", 3, 70, BELLEVUE)];
    expect(ids(personalTopThree(rows, { here: SEATTLE, tried: new Set(["a"]) }))).toEqual(["b", "c"]);
  });

  it("lets distance beat a higher score: 90 at ~6 mi loses to 50 at ~0.1 mi", () => {
    const far = opening("far", 1, 90, BELLEVUE); // 90 − 10 × 6.09 ≈ 29
    const near = opening("near", 2, 50, { lat: 47.6076, lon: -122.3321 }); // 50 − 10 × 0.1 ≈ 49
    const top = personalTopThree([far, near], { here: SEATTLE, tried: new Set() });
    expect(ids(top)).toEqual(["near", "far"]);
    expect(top[0].distanceMi).toBeCloseTo(0.1, 1);
  });

  it("puts trucks and unmapped rows after mappable ones when location is known", () => {
    const truck = opening("truck", 1, 99, SEATTLE, "food_truck");
    const unmapped = opening("unmapped", 2, 98);
    const mapped = opening("mapped", 3, 10, BELLEVUE);
    const top = personalTopThree([truck, unmapped, mapped], { here: SEATTLE, tried: new Set() });
    expect(ids(top)).toEqual(["mapped", "truck", "unmapped"]);
    expect(top[1].distanceMi).toBeUndefined();
    expect(top[2].distanceMi).toBeUndefined();
  });

  it("returns what is left when fewer than three remain", () => {
    const rows = [opening("a", 1, 90), opening("b", 2, 80)];
    expect(ids(personalTopThree(rows, { tried: new Set(["b"]) }))).toEqual(["a"]);
    expect(personalTopThree([], { tried: new Set() })).toEqual([]);
  });
});
