import { describe, expect, it } from "vitest";
import type { OpeningSoon } from "@/lib/data";
import { resolveFocus, soonSpot, toPins } from "@/lib/pins";
import { rankOpeningSoon } from "@/lib/rank";

const SOON = (over: Partial<OpeningSoon>): OpeningSoon => ({
  notice_id: "N",
  trade_name: "PLACE",
  notice_type: "NEW LICENSE APPLICATION",
  application_date: "2026-11-04",
  street_address: "1 MAIN ST",
  city: "SEATTLE",
  zip5: "98101",
  latitude: null,
  longitude: null,
  licence_label: "beer/wine restaurant",
  days_since_application: 15,
  why: "Applied for a beer/wine restaurant licence on Nov 4",
  rank: 1,
  ...over,
});

const SEATTLE = { lat: 47.6062, lon: -122.3321 };
const near = SOON({ notice_id: "NEAR", rank: 3, latitude: 47.61, longitude: -122.33 }); // ~0.3 mi
const far = SOON({ notice_id: "FAR", rank: 1, latitude: 47.61, longitude: -122.2 }); // Bellevue, ~6 mi
const unmapped = SOON({ notice_id: "NOPIN", rank: 2 });

describe("rankOpeningSoon", () => {
  it("without a location keeps rank order (newest application first)", () => {
    expect(rankOpeningSoon([near, unmapped, far]).map((s) => s.notice_id)).toEqual(["FAR", "NOPIN", "NEAR"]);
  });

  it("with a location puts the nearest first, with distances, and unmapped places last", () => {
    const ranked = rankOpeningSoon([far, unmapped, near], SEATTLE);
    expect(ranked.map((s) => s.notice_id)).toEqual(["NEAR", "FAR", "NOPIN"]);
    expect(ranked[0].distanceMi).toBeLessThan(1);
    expect(ranked[2].distanceMi).toBeUndefined();
  });
});

describe("Opening soon pins", () => {
  it("adds a soon pin for each place with coordinates and none for the rest", () => {
    const pins = toPins([], { topIds: new Set(), openingSoon: [near, unmapped] });
    expect(pins.features.map((f) => [f.properties.id, f.properties.kind])).toEqual([["NEAR", "soon"]]);
    expect(pins.features[0].properties.detail).toMatch(/licence on/);
  });

  it("soonSpot is null until geocoded", () => {
    expect(soonSpot(unmapped)).toBeNull();
    expect(soonSpot(near)).toEqual({ lat: 47.61, lon: -122.33 });
  });

  it("a soon place can be focused like an opening; an unmapped one can't", () => {
    expect(resolveFocus({ id: "NEAR", from: "list" }, [], [near])).toMatchObject({ center: [-122.33, 47.61] });
    expect(resolveFocus({ id: "NOPIN", from: "list" }, [], [unmapped])).toBeNull();
  });
});
