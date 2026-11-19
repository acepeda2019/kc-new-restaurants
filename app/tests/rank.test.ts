import { describe, expect, it } from "vitest";
import type { Opening } from "@/lib/data";
import { allPlaces, countNear, haversineMi, personalTopThree } from "@/lib/rank";
import { requestLocation } from "@/lib/location";

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

describe("personalTopThree after a location is denied", () => {
  it("treats here = undefined (denied) the same as no location", async () => {
    const here = (await requestLocation({ getCurrentPosition: (_ok, fail) => fail?.({ code: 1 } as GeolocationPositionError) })) ?? undefined;
    const rows = [opening("b", 2, 80, BELLEVUE), opening("a", 1, 90, SEATTLE), opening("t", 3, 70, undefined, "food_truck")];
    const denied = personalTopThree(rows, { here, tried: new Set() });
    expect(denied).toEqual(personalTopThree(rows, { tried: new Set() }));
    expect(ids(denied)).toEqual(["a", "b", "t"]);
    expect(denied.every((r) => r.distanceMi === undefined)).toBe(true);
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
