import { describe, expect, it } from "vitest";
import { categoryTag, formatDistance, formatPlainDate, likelyCuisine, placeLabel } from "@/lib/format";

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
