import { describe, expect, it } from "vitest";
import { askRecord, getAskLog, lastDays, LOG_TTL_S, recordAsk, type LogRedis } from "@/lib/askLog";

/** An in-memory Redis with just the log's commands. */
function memoryRedis() {
  const lists = new Map<string, string[]>();
  const hashes = new Map<string, Record<string, number>>();
  const ttl = new Map<string, number>();
  const redis: LogRedis = {
    async rpush(key, ...values) { lists.set(key, [...(lists.get(key) ?? []), ...values]); },
    async expire(key, seconds) { ttl.set(key, seconds); },
    async hincrby(key, field, n) {
      const h = hashes.get(key) ?? {};
      h[field] = (h[field] ?? 0) + n;
      hashes.set(key, h);
    },
    async lrange(key) { return lists.get(key) ?? []; },
    async hgetall(key) { return hashes.get(key) ?? null; },
  };
  return { redis, lists, hashes, ttl };
}

const NOW = new Date("2026-11-26T20:00:00Z"); // noon Pacific
const stats = {
  calls: 2, inputTokens: 6000, outputTokens: 200, cacheReadTokens: 0, latencyMs: [700, 900], stopReason: "end_turn",
  searches: [
    { filters: { city: "Kirkland", first_inspected_since: "2026-11-01", latest_unsatisfactory: false }, count: 0, openingSoonCount: 0 },
    { filters: { city: "Kirkland", first_inspected_since: null, latest_unsatisfactory: false }, count: 19, openingSoonCount: 0 },
  ],
  picksNotSearched: 0,
};

describe("askRecord", () => {
  it("rounds the location to about 1 km and prices the answer", () => {
    const r = askRecord({ now: NOW, visitor: "v1", question: "New in Kirkland?", here: { lat: 47.67891, lon: -122.20543 }, stats, summary: "19.", picks: ["A"] });
    expect(r).toMatchObject({
      at: "2026-11-26T20:00:00.000Z", visitor: "v1", question: "New in Kirkland?", near: { lat: 47.68, lon: -122.21 },
      outcome: "answered", calls: 2, input_tokens: 6000, output_tokens: 200, total_ms: 1600, picks: ["A"],
    });
    expect(r.cost_usd).toBeCloseTo(0.0007);
  });

  it("marks a question with no answer as failed, and stores no location when none was shared", () => {
    expect(askRecord({ now: NOW, visitor: "v1", question: "hi", stats: null, summary: null, picks: [] }))
      .toMatchObject({ outcome: "failed", near: null, calls: 0, cost_usd: 0 });
  });
});

describe("recordAsk and getAskLog", () => {
  it("files records under their Pacific day, keeps them 90 days and sums the day", async () => {
    const m = memoryRedis();
    await recordAsk(m.redis, askRecord({ now: NOW, visitor: "v1", question: "New in Kirkland?", stats, summary: "19.", picks: [] }));
    await recordAsk(m.redis, askRecord({ now: NOW, visitor: "v2", question: "hi", stats: null, summary: null, picks: [] }));
    expect(m.lists.get("ask:log:2026-11-26")).toHaveLength(2);
    expect(m.ttl.get("ask:log:2026-11-26")).toBe(LOG_TTL_S);
    expect(m.hashes.get("ask:stats:2026-11-26")).toMatchObject({ questions: 2, failed: 1, calls: 2, cost_microusd: 700, empty_searches: 1 });

    const [today, yesterday] = await getAskLog(m.redis, 2, NOW);
    expect(today.summary).toMatchObject({
      date: "2026-11-26", questions: 2, failed: 1, visitors: 2, cost_usd: 0.0007, avg_ms: 800, empty_searches: 1,
      filters_used: { city: 2, first_inspected_since: 1 },
    });
    expect(today.records.map((r) => r.question)).toEqual(["New in Kirkland?", "hi"]);
    expect(yesterday.summary).toMatchObject({ date: "2026-11-25", questions: 0, visitors: 0 });
  });

  it("lists Pacific dates newest first", () => {
    expect(lastDays(3, new Date("2026-11-26T05:00:00Z"))).toEqual(["2026-11-25", "2026-11-24", "2026-11-23"]);
  });
});
