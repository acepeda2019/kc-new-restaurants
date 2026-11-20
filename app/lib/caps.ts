/**
 * Daily question caps for /api/ask (ARCHITECTURE.md §7, CLAUDE.md guardrail 1), counted in
 * Redis per Pacific day. Every request is counted before it is checked, so refused ones
 * count too (simplest, and errs toward fewer Claude calls). The visitor counter goes
 * first: a visitor already over their cap is refused without touching the global counter,
 * so one visitor retrying can't use up everyone's questions.
 *
 * Redis errors propagate; the route turns them into 429 (fail closed).
 */

export const GLOBAL_DAILY_CAP = 200;
export const VISITOR_DAILY_CAP = 20;
/** Counters outlive their day by a margin, then Redis drops them. */
const COUNTER_TTL_S = 2 * 24 * 60 * 60;

/** The two Redis commands the caps need; @upstash/redis's Redis satisfies it. */
export type RedisLike = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

/** `left`: questions this visitor has left today, for the bar's "N left today". */
export type CapResult = { ok: true; left: number } | { ok: false; reason: "global" | "visitor" };

/** YYYY-MM-DD in America/Los_Angeles. */
export function pacificDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function increment(redis: RedisLike, key: string): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, COUNTER_TTL_S);
  return count;
}

/** Fails closed: anything but a whole number at or under the cap counts as over it. */
function within(count: unknown, cap: number): boolean {
  return Number.isInteger(count) && (count as number) <= cap;
}

/** Counts one question for `visitorId` today and says whether it is within both caps. */
export async function checkAndCount(redis: RedisLike, visitorId: string, now: Date): Promise<CapResult> {
  const date = pacificDate(now);
  const visitorCount = await increment(redis, `ask:v:${visitorId}:${date}`);
  if (!within(visitorCount, VISITOR_DAILY_CAP)) {
    return { ok: false, reason: "visitor" };
  }
  if (!within(await increment(redis, `ask:g:${date}`), GLOBAL_DAILY_CAP)) {
    return { ok: false, reason: "global" };
  }
  return { ok: true, left: VISITOR_DAILY_CAP - visitorCount };
}
