import { describe, expect, it } from "vitest";
import type { Opening, OpeningSoon } from "@/lib/data";
import {
  addressLine, categoryTag, formatDistance, formatPlainDate, latestInspection, likelyCuisine, openingFacts, openingSoonFacts,
  placeLabel,
} from "@/lib/format";

describe("formatPlainDate", () => {
  it("keeps a YYYY-MM-DD date on its own day", () => {
    expect(formatPlainDate("2026-11-13")).toBe("Nov 13, 2026");
    expect(formatPlainDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatPlainDate("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("accepts Feb 29 only in a leap year", () => {
    expect(formatPlainDate("2028-02-29")).toBe("Feb 29, 2028");
    expect(() => formatPlainDate("2026-02-29")).toThrow();
  });

  it("rejects anything that is not a real plain date", () => {
    expect(() => formatPlainDate("2026-11-13T00:00:00Z")).toThrow();
    expect(() => formatPlainDate("2026-13-01")).toThrow();
    expect(() => formatPlainDate("2026-02-31")).toThrow();
    expect(() => formatPlainDate("2026-04-31")).toThrow();
    expect(() => formatPlainDate("2026-11-00")).toThrow();
  });
});

describe("likelyCuisine", () => {
  it("labels an inferred cuisine as likely", () => {
    expect(likelyCuisine("Egyptian")).toBe("likely Egyptian");
  });

  it("returns null when no cuisine was inferred", () => {
    expect(likelyCuisine(null)).toBeNull();
    expect(likelyCuisine("")).toBeNull();
  });
});

describe("formatDistance", () => {
  it("rounds to a tenth of a mile", () => {
    expect(formatDistance(0.34)).toBe("0.3 mi");
    expect(formatDistance(2.06)).toBe("2.1 mi");
    expect(formatDistance(12)).toBe("12.0 mi");
  });

  it("never shows a nearby place as zero miles", () => {
    expect(formatDistance(0.02)).toBe("< 0.1 mi");
  });

  it("returns null without a distance", () => {
    expect(formatDistance(undefined)).toBeNull();
  });
});

describe("categoryTag", () => {
  it("names fixed-location categories in plain words, as plain tags", () => {
    expect(categoryTag("restaurant")).toEqual({ label: "Restaurant", isBadge: false });
    expect(categoryTag("cafe_bakery_dessert")).toEqual({ label: "Café, bakery or dessert", isBadge: false });
    expect(categoryTag("food_hall_stall")).toEqual({ label: "Food hall stall", isBadge: false });
  });

  it("marks food trucks with a badge", () => {
    expect(categoryTag("food_truck")).toEqual({ label: "Food truck", isBadge: true });
  });
});

describe("placeLabel", () => {
  it("shows the city for a fixed location", () => {
    expect(placeLabel("SEATTLE", "restaurant")).toBe("SEATTLE");
  });

  it("says a truck is only based in its city", () => {
    expect(placeLabel("WOODINVILLE", "food_truck")).toBe("based in WOODINVILLE");
  });
});

describe("answer-card facts", () => {
  const base = {
    category: "restaurant", likely_cuisine: "Egyptian", first_inspection_date: "2026-11-13",
    first_inspection_type: "Routine Inspection/Field Review", first_inspection_red_points: 0,
    latest_inspection_date: "2026-11-13", latest_red_points: 0,
    latest_inspection_result: "Satisfactory", latest_inspection_score: 0,
  } as Opening;
  const labels = (o: Partial<Opening> & { distanceMi?: number }) => openingFacts({ ...base, ...o }).map((f) => f.label);

  it("leads with the latest inspection the county's way, then cuisine and distance", () => {
    expect(openingFacts({ ...base, distanceMi: 3.94 })).toEqual([
      { label: "Satisfactory · 0 pts · Nov 13", tone: "good" },
      { label: "likely Egyptian", tone: "plain" },
      { label: "3.9 mi", tone: "plain" },
    ]);
  });

  it("says 'first inspected', never 'opened', and only when a later visit holds the date (SAN-59)", () => {
    const later = labels({ latest_inspection_date: "2026-11-18" });
    expect(later).toContain("first inspected Nov 13");
    expect(later.join(" ")).not.toMatch(/opened/);
    expect(labels({}).join(" ")).not.toMatch(/first inspected|opened/); // one visit: the inspection bubble has the date
  });

  it("shows the county's score and verdict, not red points (Nori Sushi, Maple Valley: 30, not 25)", () => {
    const f = latestInspection({ latest_inspection_result: "Unsatisfactory", latest_inspection_score: 30, latest_inspection_date: "2026-06-16" });
    expect(f).toEqual({ label: "Unsatisfactory · 30 pts · Jun 16", tone: "warn" });
  });

  it("shows a later clean inspection, never falling back to a bad first one (SAN-60)", () => {
    const improved = labels({
      first_inspection_red_points: 25, first_inspection_score: 30,
      latest_inspection_date: "2026-10-01", latest_red_points: 0,
      latest_inspection_result: "Satisfactory", latest_inspection_score: 0,
    });
    expect(improved).toContain("Satisfactory · 0 pts · Oct 1");
    expect(improved.join(" ")).not.toMatch(/25|30/);
  });

  it("never scores an educational latest visit", () => {
    expect(latestInspection({ latest_inspection_result: "Complete", latest_inspection_score: 0, latest_inspection_date: "2026-06-10" }))
      .toEqual({ label: "educational visit (not scored) · Jun 10", tone: "plain" });
  });

  it("keeps a satisfactory visit with some points neutral", () => {
    expect(latestInspection({ latest_inspection_result: "Satisfactory", latest_inspection_score: 5, latest_inspection_date: "2026-06-10" }).tone)
      .toBe("plain");
  });

  it("labels food trucks and keeps at most four bubbles, never dropping the inspection", () => {
    const truck = labels({ category: "food_truck", distanceMi: 1 });
    expect(truck[0]).toBe("Satisfactory · 0 pts · Nov 13");
    expect(truck[1]).toBe("food truck");
    expect(truck).toHaveLength(4);
  });

  it("tells same-name places apart by street and city; trucks by their base", () => {
    expect(addressLine({ address: "27317 MAPLE VALLEY BLACK DIAMOND RD SE, A104", city: "MAPLE VALLEY", category: "restaurant" }))
      .toBe("27317 Maple Valley Black Diamond Rd SE, A104, Maple Valley");
    expect(addressLine({ address: "32911 1ST AVE S, #G", city: "FEDERAL WAY", category: "restaurant" }))
      .toBe("32911 1st Ave S, #G, Federal Way");
    expect(addressLine({ address: null, city: "SEATTLE", category: "restaurant" })).toBe("Seattle");
    expect(addressLine({ address: "1 BASE ST", city: "BUCKLEY", category: "food_truck" })).toBe("based in Buckley");
  });

  it("says an Opening soon place applied for a licence, not that it will open", () => {
    const s = { application_date: "2026-11-04", licence_label: "full-bar restaurant" } as OpeningSoon;
    expect(openingSoonFacts(s)).toEqual([
      { label: "licence applied Nov 4", tone: "soon" },
      { label: "full-bar restaurant", tone: "plain" },
    ]);
  });
});
