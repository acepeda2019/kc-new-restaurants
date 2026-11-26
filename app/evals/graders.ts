/**
 * Code graders for the question-bar eval (SAN-67): no model judge. Each check returns true
 * (pass), false (fail) or null (doesn't apply to this case), so pass rates count only the
 * cases a check is about.
 */
import type { FindInput } from "@/lib/search";

/** One fixed question with what a right answer must show. */
export type EvalCase = {
  id: string;
  question: string;
  /** Where the visitor is, for "near me" questions. */
  here?: { lat: number; lon: number };
  expect: {
    /** False for questions that need no places ("what can you do?"); null when either is fine. Default true. */
    search?: boolean | null;
    /** Filter values the final search must use; fields left out may be anything. */
    filters?: Partial<FindInput>;
    /** Whether the summary must state the search's count and a period. Default: when a search is expected. */
    count?: boolean;
    /** Regexes (case-insensitive): the summary must match at least one. */
    mentions?: string[];
    /** Regexes (case-insensitive): the summary and blurbs must match none. */
    never?: string[];
  };
};

/** What one run of a case did, recorded around `answer()`. */
export type Trace = {
  /** Every search Claude asked for, in order, with what it returned. */
  searches: { filters: FindInput; count: number; openingSoonCount: number; ids: string[] }[];
  summary: string;
  /** Claude's picks as it wrote them, before code drops ids the search didn't return. */
  rawPicks: { id: string; blurb: string }[];
};

export const CHECKS = [
  "searched",
  "filters",
  "count",
  "period",
  "picks_from_search",
  "blurb_under_15_words",
  "no_opened_on",
  "no_markdown",
  "mentions",
  "never",
] as const;
export type Check = (typeof CHECKS)[number];
export type Grades = Record<Check, boolean | null>;

const WORDS: Record<string, number> = {
  no: 0, zero: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12,
};

/** Numbers stated in a sentence, digits or small number words ("two new places"). */
export function numbersIn(text: string): number[] {
  const digits = [...text.matchAll(/\b\d+\b/g)].map((m) => Number(m[0]));
  const words = [...text.toLowerCase().matchAll(/\b[a-z]+\b/g)].map((m) => WORDS[m[0]]).filter((n) => n !== undefined);
  return [...digits, ...words];
}

const PERIOD =
  /\b(since|last 6 months|last six months|this (week|month)|(last|past) (week|month)|recently|today)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\d{4}-\d{2}-\d{2}/i;

// A month, a weekday or 11/3; not a street ("opened on 7th Avenue South").
const OPENED_ON_DATE =
  /\bopened on ((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|(mon|tues|wednes|thurs|fri|satur|sun)day|\d{1,2}\/\d{1,2}\b)/i;

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);
const matches = (patterns: string[], text: string) => patterns.some((p) => new RegExp(p, "i").test(text));

/** Grades one run of `c`. */
export function grade(c: EvalCase, t: Trace): Grades {
  const wantSearch = c.expect.search === undefined ? true : c.expect.search;
  const last = t.searches.at(-1);
  const blurbs = t.rawPicks.map((p) => p.blurb);
  const allText = [t.summary, ...blurbs].join("\n");
  const wantCount = (c.expect.count ?? wantSearch !== false) && last !== undefined;
  const searched = new Set(t.searches.flatMap((s) => s.ids));

  return {
    searched: wantSearch === null ? null : wantSearch ? t.searches.length > 0 : t.searches.length === 0,
    filters:
      c.expect.filters && last
        ? Object.entries(c.expect.filters).every(([k, v]) => norm(last.filters[k as keyof FindInput]) === norm(v))
        : c.expect.filters
          ? false
          : null,
    // Either count may be the one asked about (open places, or Opening soon).
    count: wantCount ? numbersIn(t.summary).some((n) => n === last!.count || n === last!.openingSoonCount) : null,
    period: wantCount ? PERIOD.test(t.summary) : null,
    picks_from_search: t.rawPicks.length ? t.rawPicks.every((p) => searched.has(p.id)) : null,
    blurb_under_15_words: blurbs.length ? blurbs.every((b) => b.trim().split(/\s+/).length < 15) : null,
    // "Opened on" a date is the banned claim; "just opened on Western Avenue" is a street.
    no_opened_on: !OPENED_ON_DATE.test(allText),
    no_markdown: !/\*\*|^#+ |`|\]\(/m.test(allText),
    mentions: c.expect.mentions ? matches(c.expect.mentions, t.summary) : null,
    never: c.expect.never ? !matches(c.expect.never, allText) : null,
  };
}

/** Pass rate per check over many graded runs: [passed, applicable]. */
export function passRates(all: Grades[]): Record<Check, [number, number]> {
  const out = {} as Record<Check, [number, number]>;
  for (const check of CHECKS) {
    const applicable = all.map((g) => g[check]).filter((v): v is boolean => v !== null);
    out[check] = [applicable.filter(Boolean).length, applicable.length];
  }
  return out;
}
