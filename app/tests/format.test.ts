import { describe, expect, it } from "vitest";
import { categoryLabel, formatDistance, formatPlainDate, likelyCuisine, pacificDate } from "@/lib/format";

describe("formatPlainDate", () => {
  it("keeps a YYYY-MM-DD date on its own day", () => {
    expect(formatPlainDate("2026-11-13")).toBe("Nov 13, 2026");
    expect(formatPlainDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(formatPlainDate("2026-12-31")).toBe("Dec 31, 2026");
  });

  it("rejects anything that is not a plain date", () => {
    expect(() => formatPlainDate("2026-11-13T00:00:00Z")).toThrow();
    expect(() => formatPlainDate("2026-13-01")).toThrow();
  });
});

describe("pacificDate", () => {
  it("turns a UTC timestamp into the Pacific calendar date", () => {
    // 00:10 UTC on Nov 19 is still the afternoon of Nov 18 in Seattle.
    expect(pacificDate("2026-11-19T00:10:12+00:00")).toBe("2026-11-18");
    expect(pacificDate("2026-11-19T09:00:00Z")).toBe("2026-11-19");
  });

  it("follows daylight saving time", () => {
    // PDT is UTC-7: 06:30 UTC on Jul 1 is 23:30 on Jun 30.
    expect(pacificDate("2026-07-01T06:30:00Z")).toBe("2026-06-30");
    expect(pacificDate("2026-07-01T07:30:00Z")).toBe("2026-07-01");
  });

  it("throws on a timestamp it cannot read", () => {
    expect(() => pacificDate("not a date")).toThrow();
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

describe("categoryLabel", () => {
  it("names every mart category in plain words", () => {
    expect(categoryLabel("restaurant")).toBe("Restaurant");
    expect(categoryLabel("cafe_bakery_dessert")).toBe("Café, bakery or dessert");
    expect(categoryLabel("food_hall_stall")).toBe("Food hall stall");
    expect(categoryLabel("food_truck")).toBe("Food truck");
  });
});
