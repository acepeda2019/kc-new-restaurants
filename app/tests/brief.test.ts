import { describe, expect, it } from "vitest";
import { BRIEF_SOON, todayBrief } from "@/lib/brief";
import type { Opening, OpeningSoon } from "@/lib/data";

const opening = (id: string, rank: number, over: Partial<Opening> = {}) =>
  ({ restaurant_id: id, name: `Place ${id}`, city: "SEATTLE", category: "restaurant", latitude: 47.6, longitude: -122.3,
    rank, score: 100 - rank, replaces_name: null, ...over }) as Opening;
const soon = (id: string, rank: number, over: Partial<OpeningSoon> = {}) =>
  ({ notice_id: id, trade_name: `Soon ${id}`, city: "KENT", notice_type: "NEW LICENSE APPLICATION",
    latitude: null, longitude: null, rank, ...over }) as OpeningSoon;

const metrics = { opened_last_7_days: 4, opened_last_30_days: 10 };
const OPEN = [opening("A", 1), opening("B", 2), opening("C", 3), opening("D", 4)];
const SOON = [soon("S1", 1), soon("S2", 2), soon("S3", 3)];

describe("todayBrief", () => {
  it("leads with this week, then picks the top 3 open places and the newest Opening soon", () => {
    const b = todayBrief({ openings: OPEN, openingSoon: SOON, metrics, tried: new Set() });
    expect(b.summary).toBe("4 places opened this week, 10 this month, and 3 more have applied to open. Here's where to start:");
    expect(b.picks.map((p) => p.id)).toEqual(["A", "B", "C", "S1", "S2"]);
    expect(b.picks.filter((p) => p.kind === "soon")).toHaveLength(BRIEF_SOON);
  });

  it("skips tried places and leads with nearby places once located", () => {
    const b = todayBrief({
      openings: OPEN, openingSoon: [], metrics, tried: new Set(["A"]),
      here: { lat: 47.6, lon: -122.3 }, near: { count: 1, radiusMi: 2 },
    });
    expect(b.summary).toBe("1 new place within 2 mi of you, 10 this month. Here's where to start:");
    expect(b.picks.map((p) => p.id)).toEqual(["B", "C", "D"]);
  });

  it("only adds a blurb the fact bubbles can't say", () => {
    const b = todayBrief({
      openings: [opening("A", 1, { replaces_name: "CANNOLO" }), opening("B", 2)],
      openingSoon: [soon("S1", 1, { notice_type: "CHANGE OF LOCATION" })], metrics, tried: new Set(),
    });
    expect(b.picks.map((p) => p.blurb)).toEqual(["Took over the old CANNOLO space.", "", "Moving here from another location."]);
  });

  it("says so plainly when there is nothing to show", () => {
    const b = todayBrief({ openings: [], openingSoon: [], metrics: { opened_last_7_days: 0, opened_last_30_days: 0 }, tried: new Set() });
    expect(b).toEqual({ summary: "0 places opened this week, 0 this month.", picks: [] });
  });
});
