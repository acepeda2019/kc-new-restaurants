/**
 * The "Today" brief (ARCHITECTURE.md §7): two or three plain sentences under the question bar
 * about what's new, plus question chips that follow from them. Built from the page's data, so it
 * costs no Claude call. Place names are `PlaceRef` parts, so the page can make them tappable.
 * Pure, safe on the server or in the browser.
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const titleCity = (city: string) => city.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const ref = (id: string, name: string): PlaceRef => ({ id, name });

/** "KOSHARI brings likely Egyptian food to Seattle" or "KOSHARI opened in Seattle". */
function highlight(o: Opening): BriefPart[] {
  if (o.category === "food_truck") return [ref(o.restaurant_id, o.name), ` started rolling out of ${titleCity(o.city)}`];
  const cuisine = o.likely_cuisine ? ` brings likely ${o.likely_cuisine} food to ` : " opened in ";
  return [ref(o.restaurant_id, o.name), `${cuisine}${titleCity(o.city)}`];
}

/**
 * The brief: how many opened this week (or near the visitor, once located) and this month;
 * the two best-ranked recent openings by name; then how many had red points at their latest
 * inspection and the newest Opening soon place. Chips ask about whatever the sentences raise.
 */
export function todayBrief(input: {
  openings: Opening[];
  openingSoon: OpeningSoon[];
  metrics: Pick<Metrics, "opened_last_7_days" | "opened_last_30_days">;
  here?: LatLon;
  near?: { count: number; radiusMi: number };
}): Brief {
  const { metrics, near } = input;
  const recent = input.openings.filter((o) => o.days_open <= RECENT_DAYS).sort((a, b) => a.rank - b.rank);
  const wary = recent.filter((o) => o.latest_red_points > 0);
  const trucks = recent.filter((o) => o.category === "food_truck");
  const [soon] = rankOpeningSoon(input.openingSoon, input.here);

  const sentences: BriefPart[][] = [
    [
      near
        ? `${plural(near.count, "new place", "new places")} within ${near.radiusMi} mi of you, ${metrics.opened_last_30_days} across King County this month.`
        : `${plural(metrics.opened_last_7_days, "place", "places")} opened this week and ${metrics.opened_last_30_days} this month.`,
    ],
  ];
  const [first, second] = recent;
  if (first) sentences.push([...highlight(first), ...(second ? [", and ", ...highlight(second)] : []), "."]);

  const last: BriefPart[] = [];
  if (wary.length) last.push(`${plural(wary.length, "new place", "new places")} had red points at the latest inspection`);
  if (soon) {
    last.push(last.length ? "; " : "", ref(soon.notice_id, soon.trade_name), ` applied to open in ${titleCity(soon.city ?? "King County")}`);
  }
  if (last.length) sentences.push([...last.filter((p) => p !== ""), "."]);

  const chips = [
    near ? "What's newest near me?" : "What's new near me?",
    trucks.length ? "Which food trucks are new?" : null,
    wary.length ? "Which had red points?" : null,
    soon ? "What's opening soon?" : null,
    "Any new cafés?",
  ].filter((c): c is string => c !== null);

  return { sentences, chips: chips.slice(0, MAX_CHIPS) };
}

/** The brief as plain text, e.g. for tests. */
export function briefText(brief: Brief): string {
  return brief.sentences.map((s) => s.map((p) => (typeof p === "string" ? p : p.name)).join("")).join(" ");
}
