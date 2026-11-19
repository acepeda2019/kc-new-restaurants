import { describe, expect, it } from "vitest";
import { MAX_CHIPS, briefText, todayBrief } from "@/lib/brief";
import type { Opening, OpeningSoon } from "@/lib/data";

const opening = (id: string, rank: number, over: Partial<Opening> = {}) =>
  ({ restaurant_id: id, name: id, city: "SEATTLE", category: "restaurant", likely_cuisine: null, days_open: 5,
    latest_red_points: 0, rank, ...over }) as Opening;
const soon = (id: string, rank: number, over: Partial<OpeningSoon> = {}) =>
  ({ notice_id: id, trade_name: id, city: "KIRKLAND", latitude: null, longitude: null, rank, ...over }) as OpeningSoon;
const metrics = { opened_last_7_days: 4, opened_last_30_days: 10 };

describe("todayBrief", () => {
  const OPEN = [
    opening("KOSHARI", 1, { likely_cuisine: "Egyptian" }),
    opening("CRAZY TACO", 2, { category: "food_truck", city: "BUCKLEY" }),
    opening("RISKY", 3, { latest_red_points: 15 }),
    opening("OLD", 0, { days_open: 120 }), // best rank, but not this month
  ];

  it("says what's new in three plain sentences, naming places by reference", () => {
    const b = todayBrief({ openings: OPEN, openingSoon: [soon("67 PIZZA", 1)], metrics });
    expect(briefText(b)).toBe(
      "4 places opened this week and 10 this month. " +
        "KOSHARI brings likely Egyptian food to Seattle, and CRAZY TACO started rolling out of Buckley. " +
        "1 new place had red points at the latest inspection; 67 PIZZA applied to open in Kirkland.",
    );
    const refs = b.sentences.flat().filter((p) => typeof p !== "string");
    expect(refs).toEqual([
      { id: "KOSHARI", name: "KOSHARI" },
      { id: "CRAZY TACO", name: "CRAZY TACO" },
      { id: "67 PIZZA", name: "67 PIZZA" },
    ]);
  });

  it("offers chips about what the sentences raise, at most MAX_CHIPS", () => {
    const b = todayBrief({ openings: OPEN, openingSoon: [soon("67 PIZZA", 1)], metrics });
    expect(b.chips).toEqual(["What's new near me?", "Which food trucks are new?", "Which had red points?", "What's opening soon?"]);
    expect(b.chips.length).toBeLessThanOrEqual(MAX_CHIPS);
  });

  it("leads with nearby places once located and drops chips with nothing behind them", () => {
    const b = todayBrief({
      openings: [opening("KOSHARI", 1)], openingSoon: [], metrics,
      here: { lat: 47.6, lon: -122.3 }, near: { count: 2, radiusMi: 2 },
    });
    expect(briefText(b)).toBe("2 new places within 2 mi of you, 10 across King County this month. KOSHARI opened in Seattle.");
    expect(b.chips).toEqual(["What's newest near me?", "Any new cafés?"]);
  });

  it("keeps to one sentence when nothing opened this month", () => {
    const b = todayBrief({ openings: [], openingSoon: [], metrics: { opened_last_7_days: 0, opened_last_30_days: 0 } });
    expect(briefText(b)).toBe("0 places opened this week and 0 this month.");
  });
});
