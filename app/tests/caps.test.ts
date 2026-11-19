import { describe, expect, it } from "vitest";
import { checkAndCount, GLOBAL_DAILY_CAP, VISITOR_DAILY_CAP, type RedisLike } from "@/lib/caps";

function fakeRedis() {
  const counts = new Map<string, number>();
  const expires: [string, number][] = [];
  const redis: RedisLike = {
    async incr(key) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n;
    },
    async expire(key, seconds) {
      expires.push([key, seconds]);
      return 1;
    },
  };
  return { redis, counts, expires };
}

const NOW = new Date("2026-11-17T20:00:00Z"); // 12:00 Pacific, 2026-11-17

describe("checkAndCount", () => {
  it("uses the caps ARCHITECTURE.md §7 states", () => {
    expect(GLOBAL_DAILY_CAP).toBe(200);
    expect(VISITOR_DAILY_CAP).toBe(20);
  });

  it("allows the 200th question of the day and refuses the 201st as global", async () => {
    const { redis } = fakeRedis();
    for (let i = 1; i < 200; i++) await checkAndCount(redis, `v${i}`, NOW);
    expect(await checkAndCount(redis, "v200", NOW)).toEqual({ ok: true });
    expect(await checkAndCount(redis, "v201", NOW)).toEqual({ ok: false, reason: "global" });
  });

  it("allows a visitor's 20th question and refuses the 21st as visitor", async () => {
    const { redis } = fakeRedis();
    for (let i = 1; i < 20; i++) await checkAndCount(redis, "amy", NOW);
    expect(await checkAndCount(redis, "amy", NOW)).toEqual({ ok: true });
    expect(await checkAndCount(redis, "amy", NOW)).toEqual({ ok: false, reason: "visitor" });
    expect(await checkAndCount(redis, "bo", NOW)).toEqual({ ok: true });
  });

  it("counts refused questions too, but a visitor over their cap does not use up the global cap", async () => {
    const { redis, counts } = fakeRedis();
    for (let i = 0; i < 25; i++) await checkAndCount(redis, "amy", NOW);
    expect(counts.get("ask:v:amy:2026-11-17")).toBe(25);
    expect(counts.get("ask:g:2026-11-17")).toBe(20);
  });

  it("keys counters by the America/Los_Angeles date", async () => {
    const { redis, counts } = fakeRedis();
    await checkAndCount(redis, "amy", new Date("2026-11-17T06:00:00Z")); // 22:00 Pacific on the 16th
    expect([...counts.keys()].sort()).toEqual(["ask:g:2026-11-16", "ask:v:amy:2026-11-16"]);
  });

  it("sets a 2-day expiry only on a counter's first increment", async () => {
    const { redis, expires } = fakeRedis();
    await checkAndCount(redis, "amy", NOW);
    await checkAndCount(redis, "amy", NOW);
    expect(expires.sort()).toEqual([
      ["ask:g:2026-11-17", 172800],
      ["ask:v:amy:2026-11-17", 172800],
    ]);
  });

  it("rejects when Redis fails, so the route can fail closed", async () => {
    const redis: RedisLike = {
      incr: () => Promise.reject(new Error("connection refused")),
      expire: () => Promise.resolve(1),
    };
    await expect(checkAndCount(redis, "amy", NOW)).rejects.toThrow("connection refused");
  });
});
