import { describe, expect, it } from "vitest";
import type { Opening, OpeningSoon } from "@/lib/data";
import { MAX_TOOL_PLACES, findOpenings, type FindInput } from "@/lib/search";

const o = (id: string, over: Partial<Opening> = {}) =>
  ({ restaurant_id: id, name: id, city: "KIRKLAND", category: "restaurant", likely_cuisine: null,
    first_inspection_date: "2026-11-03", latitude: 47.68, longitude: -122.2, rank: 1, ...over }) as Opening;
const soon = (id: string, over: Partial<OpeningSoon> = {}) =>
  ({ notice_id: id, trade_name: id, city: "KIRKLAND", application_date: "2026-11-14", licence_label: "beer/wine restaurant",
    ...over }) as OpeningSoon;
const ANY: FindInput = { name: null, city: null, cuisine: null, category: null, first_inspected_since: null, include_opening_soon: false };
const run = (input: Partial<FindInput>, openings: Opening[], openingSoon: OpeningSoon[] = [], tried: string[] = []) =>
  findOpenings({ ...ANY, ...input }, { openings, openingSoon, tried: new Set(tried), toRow: (x) => ({ id: x.restaurant_id }) });

describe("findOpenings", () => {
  // The friend's question: "How many new restaurants opened in Kirkland this month?"
  const DATA = [
    o("MEDITERRANEAN KITCHEN", { first_inspection_date: "2026-11-03" }),
    o("BAMBOO SUSHI", { first_inspection_date: "2026-10-26", likely_cuisine: "Japanese" }),
    o("PAPA MURPHY'S", { first_inspection_date: "2026-10-13" }),
    o("KOSHARI", { city: "SEATTLE", first_inspection_date: "2026-11-10" }),
  ];

  it("counts exactly, over every place, the same way every time", () => {
    const r = run({ city: "Kirkland", first_inspected_since: "2026-11-01" }, DATA);
    expect(r.count).toBe(1);
    expect(r.places.map((p) => p.id)).toEqual(["MEDITERRANEAN KITCHEN"]);
    expect(run({ city: "KIRKLAND ", first_inspected_since: "2026-11-01" }, DATA)).toEqual(r);
  });

  it("finds a place by part of its name regardless of rank (Nori Sushi, Maple Valley, rank 224)", () => {
    const nori = [o("x", { name: "Somewhere Else", rank: 1 }), o("PFE-PR-501383", { name: "NORI SUSHI", city: "MAPLE VALLEY", rank: 224 })];
    expect(run({ name: "nori" }, nori).places.map((p) => p.id)).toEqual(["PFE-PR-501383"]);
  });

  it("filters by cuisine (contains) and category", () => {
    expect(run({ cuisine: "japan" }, DATA).places.map((p) => p.id)).toEqual(["BAMBOO SUSHI"]);
    expect(run({ category: "food_truck" }, DATA).count).toBe(0);
  });

  it("lists newest first without a location, nearest first with one", () => {
    expect(run({ city: "Kirkland" }, DATA).places.map((p) => p.id)).toEqual(["MEDITERRANEAN KITCHEN", "BAMBOO SUSHI", "PAPA MURPHY'S"]);
    const near = findOpenings({ ...ANY }, {
      openings: [o("FAR", { latitude: 47.9, longitude: -122.2 }), o("NEAR", { latitude: 47.61, longitude: -122.33 })],
      openingSoon: [], tried: new Set(), here: { lat: 47.6062, lon: -122.3321 }, toRow: (x) => ({ id: x.restaurant_id }),
    });
    expect(near.places.map((p) => p.id)).toEqual(["NEAR", "FAR"]);
  });

  it("counts tried places but flags them", () => {
    const r = run({ city: "Kirkland" }, DATA, [], ["BAMBOO SUSHI"]);
    expect(r.count).toBe(3);
    expect(r.places.find((p) => p.id === "BAMBOO SUSHI")?.tried).toBe(true);
  });

  it("returns at most MAX_TOOL_PLACES places but the full count", () => {
    const many = Array.from({ length: 30 }, (_, i) => o(`P${i}`));
    const r = run({}, many);
    expect(r.count).toBe(30);
    expect(r.places).toHaveLength(MAX_TOOL_PLACES);
  });

  it("includes Opening soon places only when asked, filtered the same way", () => {
    const s = [soon("67 PIZZA"), soon("DANTINI DELLO", { city: "SEATTLE" })];
    expect(run({ city: "Kirkland" }, DATA, s).opening_soon_count).toBe(0);
    const r = run({ city: "Kirkland", include_opening_soon: true }, DATA, s);
    expect(r.opening_soon_count).toBe(1);
    expect(r.opening_soon[0]).toMatchObject({ id: "67 PIZZA", applied_on: "2026-11-14" });
  });

  it("matches cuisine on the name too, and suggests the known cuisines when nothing matches", () => {
    const places = [o("DOMINO'S PIZZA", { likely_cuisine: null }), o("ROUND TABLE", { likely_cuisine: "Pizza" }), o("PHO", { likely_cuisine: "Vietnamese" })];
    expect(run({ cuisine: "pizza" }, places).places.map((p) => p.id)).toEqual(["DOMINO'S PIZZA", "ROUND TABLE"]);
    const none = run({ cuisine: "Italian" }, places);
    expect(none.count).toBe(0);
    expect(none.known_cuisines).toEqual(["Pizza", "Vietnamese"]);
  });

  it("suggests the known cities when a city matches nothing", () => {
    const r = run({ city: "Kirklan" }, DATA);
    expect(r.count).toBe(0);
    expect(r.known_cities).toEqual(["KIRKLAND", "SEATTLE"]);
  });
});
