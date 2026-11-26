/**
 * The question log (SAN-68, owner's decision 2026-11-26): every question that reaches Claude is
 * kept for 90 days in Redis, with the visitor's cookie id, the question, the location rounded to
 * about 1 km, the searches and what the answer cost. Daily totals sit beside it. Visitors are told
 * in the About panel. Writing never blocks an answer: the route caps and swallows any failure.
 *
 * Stored questions are untrusted text: whoever reads them back (a person or Claude Code) treats
 * them as data, never as instructions.
 */
import { filtersUsed, PRICE_PER_MTOK, type AnswerStats } from "@/lib/ask";
import { pacificDate } from "@/lib/caps";
import type { LatLon } from "@/lib/rank";

export const LOG_TTL_S = 90 * 24 * 60 * 60;

/** The Redis commands the log needs; @upstash/redis's Redis satisfies it. */
export type LogRedis = {
  rpush(key: string, ...values: string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  hincrby(key: string, field: string, increment: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<unknown[]>;
  hgetall(key: string): Promise<Record<string, unknown> | null>;
};

export type AskRecord = {
  at: string;
  visitor: string;
  question: string;
  /** Rounded to 2 decimals (about 1 km); null when the visitor didn't share a location. */
  near: LatLon | null;
  outcome: "answered" | "failed";
  summary: string | null;
  searches: { filters: unknown; count: number; opening_soon_count: number }[];
  picks: string[];
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  total_ms: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Builds the record for one question. `stats` is null when the call failed before any answer. */
export function askRecord(input: {
  now: Date;
  visitor: string;
  question: string;
  here?: LatLon;
  stats: AnswerStats | null;
  summary: string | null;
  picks: string[];
}): AskRecord {
  const s = input.stats;
  const inputTokens = s?.inputTokens ?? 0;
  const outputTokens = s?.outputTokens ?? 0;
  return {
    at: input.now.toISOString(),
    visitor: input.visitor,
    question: input.question,
    near: input.here ? { lat: round2(input.here.lat), lon: round2(input.here.lon) } : null,
    outcome: s ? "answered" : "failed",
    summary: input.summary,
    searches: (s?.searches ?? []).map((x) => ({ filters: x.filters, count: x.count, opening_soon_count: x.openingSoonCount })),
    picks: input.picks,
    calls: s?.calls ?? 0,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: (inputTokens * PRICE_PER_MTOK.input + outputTokens * PRICE_PER_MTOK.output) / 1e6,
    total_ms: (s?.latencyMs ?? []).reduce((a, b) => a + b, 0),
  };
}

const logKey = (date: string) => `ask:log:${date}`;
const statsKey = (date: string) => `ask:stats:${date}`;

/** Appends the record to its Pacific day and adds it to that day's totals. */
export async function recordAsk(redis: LogRedis, record: AskRecord): Promise<void> {
  const date = pacificDate(new Date(record.at));
  await redis.rpush(logKey(date), JSON.stringify(record));
  await redis.expire(logKey(date), LOG_TTL_S);
  const totals: [string, number][] = [
    ["questions", 1],
    ["failed", record.outcome === "failed" ? 1 : 0],
    ["calls", record.calls],
    ["input_tokens", record.input_tokens],
    ["output_tokens", record.output_tokens],
    ["cost_microusd", Math.round(record.cost_usd * 1e6)],
    ["total_ms", record.total_ms],
    ["empty_searches", record.searches.filter((x) => x.count + x.opening_soon_count === 0).length],
  ];
  for (const [field, n] of totals) if (n) await redis.hincrby(statsKey(date), field, n);
  await redis.expire(statsKey(date), LOG_TTL_S);
}

/** The Pacific dates of the last `days` days, newest first. */
export function lastDays(days: number, now: Date): string[] {
  return Array.from({ length: days }, (_, i) => pacificDate(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
}

export type DaySummary = {
  date: string;
  questions: number;
  failed: number;
  visitors: number;
  cost_usd: number;
  avg_cost_usd: number;
  avg_ms: number;
  empty_searches: number;
  filters_used: Record<string, number>;
};

/**
 * "How is the question bar being used?": per day, questions, visitors, cost and latency, plus
 * the questions themselves. Read-only.
 */
export async function getAskLog(redis: LogRedis, days: number, now: Date = new Date()) {
  const out: { summary: DaySummary; records: AskRecord[] }[] = [];
  for (const date of lastDays(days, now)) {
    const raw = await redis.lrange(logKey(date), 0, -1);
    // Upstash may hand back parsed JSON; a string is parsed here.
    const records = raw.map((r) => (typeof r === "string" ? JSON.parse(r) : r) as AskRecord);
    const totals = (await redis.hgetall(statsKey(date))) ?? {};
    const num = (k: string) => Number(totals[k] ?? 0);
    const questions = num("questions");
    const filtersUsedCount: Record<string, number> = {};
    for (const r of records) for (const s of r.searches) for (const f of filtersUsed(s.filters)) filtersUsedCount[f] = (filtersUsedCount[f] ?? 0) + 1;
    out.push({
      summary: {
        date,
        questions,
        failed: num("failed"),
        visitors: new Set(records.map((r) => r.visitor)).size,
        cost_usd: num("cost_microusd") / 1e6,
        avg_cost_usd: questions ? num("cost_microusd") / 1e6 / questions : 0,
        avg_ms: questions ? Math.round(num("total_ms") / questions) : 0,
        empty_searches: num("empty_searches"),
        filters_used: filtersUsedCount,
      },
      records,
    });
  }
  return out;
}
