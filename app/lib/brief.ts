/**
 * The "Today" brief (ARCHITECTURE.md §7): two or three plain sentences under the question bar
 * about what's new, plus question chips that follow from them. `briefFacts` picks the facts;
 * `todayBrief` words them with a template (free, used in the browser and as the fallback), and
 * `app/lib/aiBrief.ts` can have Claude word the same facts once per daily build. Place names
 * are `PlaceRef` parts, so the page can make them tappable. Pure, safe on the server or in the
 * browser.
 */
import type { Metrics, Opening, OpeningSoon } from "@/lib/data";
import { rankOpeningSoon, type LatLon } from "@/lib/rank";

/** "This month" for the brief's highlights, matching metrics' opened_last_30_days. */
const RECENT_DAYS = 30;
/** Chips shown under the brief. */
export const MAX_CHIPS = 4;

export type PlaceRef = { id: string; name: string };
/** A sentence is text and place names in reading order. */
export type BriefPart = string | PlaceRef;
export type Brief = { sentences: BriefPart[][]; chips: string[] };

/** A place the brief may name: an opening of the last 30 days, or the newest Opening soon. */
export type BriefPlace = PlaceRef & {
  kind: "open" | "soon";
  city: string;
  food_truck: boolean;
  likely_cuisine: string | null;
};

/** What the brief says, before wording: counts and the places worth naming. */
export type BriefFacts = {
  opened_this_week: number;
  opened_this_month: number;
  near?: { count: number; radiusMi: number };
  /** The two best-ranked openings of the last 30 days. */
  highlights: BriefPlace[];
  /** Openings of the last 30 days with red points at their latest inspection. */
  red_points_count: number;
  food_trucks_count: number;
  opening_soon: BriefPlace | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const titleCity = (city: string) => city.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const ref = (p: PlaceRef): PlaceRef => ({ id: p.id, name: p.name });

export function briefFacts(input: {
  openings: Opening[];
  openingSoon: OpeningSoon[];
  metrics: Pick<Metrics, "opened_last_7_days" | "opened_last_30_days">;
  here?: LatLon;
  near?: { count: number; radiusMi: number };
}): BriefFacts {
  const recent = input.openings.filter((o) => o.days_open <= RECENT_DAYS).sort((a, b) => a.rank - b.rank);
  const [soon] = rankOpeningSoon(input.openingSoon, input.here);
  return {
    opened_this_week: input.metrics.opened_last_7_days,
    opened_this_month: input.metrics.opened_last_30_days,
    ...(input.near ? { near: input.near } : {}),
    highlights: recent.slice(0, 2).map((o) => ({
      id: o.restaurant_id,
      name: o.name,
      kind: "open",
      city: titleCity(o.city),
      food_truck: o.category === "food_truck",
      likely_cuisine: o.likely_cuisine,
    })),
    red_points_count: recent.filter((o) => o.latest_red_points > 0).length,
    food_trucks_count: recent.filter((o) => o.category === "food_truck").length,
    opening_soon: soon
      ? {
          id: soon.notice_id,
          name: soon.trade_name,
          kind: "soon",
          city: titleCity(soon.city ?? "King County"),
          food_truck: false,
          likely_cuisine: null,
        }
      : null,
  };
}

/** The question chips: whatever the facts raise, at most MAX_CHIPS. */
export function briefChips(f: BriefFacts): string[] {
  return [
    f.near ? "What's newest near me?" : "What's new near me?",
    f.food_trucks_count ? "Which food trucks are new?" : null,
    f.red_points_count ? "Which had red points?" : null,
    f.opening_soon ? "What's opening soon?" : null,
    "Any new cafés?",
  ]
    .filter((c): c is string => c !== null)
    .slice(0, MAX_CHIPS);
}

/** "KOSHARI brings likely Egyptian food to Seattle" or "KOSHARI opened in Seattle". */
function highlight(p: BriefPlace): BriefPart[] {
  if (p.food_truck) return [ref(p), ` started rolling out of ${p.city}`];
  const cuisine = p.likely_cuisine ? ` brings likely ${p.likely_cuisine} food to ` : " opened in ";
  return [ref(p), `${cuisine}${p.city}`];
}

/** The template wording of `facts`: one to three sentences. */
export function templateSentences(f: BriefFacts): BriefPart[][] {
  const sentences: BriefPart[][] = [
    [
      f.near
        ? `${plural(f.near.count, "new place", "new places")} within ${f.near.radiusMi} mi of you, ${f.opened_this_month} across King County this month.`
        : `${plural(f.opened_this_week, "place", "places")} opened this week and ${f.opened_this_month} this month.`,
    ],
  ];
  const [first, second] = f.highlights;
  if (first) sentences.push([...highlight(first), ...(second ? [", and ", ...highlight(second)] : []), "."]);

  const last: BriefPart[] = [];
  if (f.red_points_count) last.push(`${plural(f.red_points_count, "new place", "new places")} had red points at the latest inspection`);
  if (f.opening_soon) {
    if (last.length) last.push("; ");
    last.push(ref(f.opening_soon), ` applied to open in ${f.opening_soon.city}`);
  }
  if (last.length) sentences.push([...last, "."]);
  return sentences;
}

/** The brief worded by the template, with its chips. */
export function todayBrief(input: Parameters<typeof briefFacts>[0]): Brief {
  const facts = briefFacts(input);
  return { sentences: templateSentences(facts), chips: briefChips(facts) };
}

/** The brief as plain text, e.g. for tests. */
export function briefText(brief: Pick<Brief, "sentences">): string {
  return brief.sentences.map((s) => s.map((p) => (typeof p === "string" ? p : p.name)).join("")).join(" ");
}
