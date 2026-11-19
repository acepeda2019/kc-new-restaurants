/**
 * The "Today" brief (ARCHITECTURE.md §7): what the answer area shows before anyone asks.
 * Built from the page's data, so it costs no Claude call; same shape as a question-bar answer,
 * so it renders as the same cards and numbered pins. Pure, safe on the server or in the browser.
 */
import type { AnswerPick } from "@/lib/ask";
import type { Metrics, Opening, OpeningSoon } from "@/lib/data";
import { personalTopThree, rankOpeningSoon, type LatLon } from "@/lib/rank";

/** Opening soon cards in the brief, after the top open places. */
export const BRIEF_SOON = 2;

export type Brief = { summary: string; picks: AnswerPick[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line under the card name: only what the fact bubbles can't say. */
function openBlurb(o: Opening): string {
  return o.replaces_name ? `Took over the old ${o.replaces_name} space.` : "";
}

function soonBlurb(s: OpeningSoon): string {
  return s.notice_type === "CHANGE OF LOCATION" ? "Moving here from another location." : "";
}

/**
 * The summary line and up to five picks: the visitor's top 3 open places (nearest-weighted once
 * located, tried places left out), then up to BRIEF_SOON Opening soon places (nearest or newest).
 * With `near` (places within a radius of the visitor) the line leads with that count.
 */
export function todayBrief(input: {
  openings: Opening[];
  openingSoon: OpeningSoon[];
  metrics: Pick<Metrics, "opened_last_7_days" | "opened_last_30_days">;
  tried: Set<string>;
  here?: LatLon;
  near?: { count: number; radiusMi: number };
}): Brief {
  const { metrics, near } = input;
  const open = personalTopThree(input.openings, { here: input.here, tried: input.tried });
  const soon = rankOpeningSoon(input.openingSoon, input.here).slice(0, BRIEF_SOON);

  const lead = near
    ? `${plural(near.count, "new place", "new places")} within ${near.radiusMi} mi of you`
    : `${plural(metrics.opened_last_7_days, "place", "places")} opened this week`;
  const month = `${metrics.opened_last_30_days} this month`;
  const coming = input.openingSoon.length
    ? `, and ${plural(input.openingSoon.length, "more has", "more have")} applied to open`
    : "";
  const summary = `${lead}, ${month}${coming}. ${open.length || soon.length ? "Here's where to start:" : ""}`.trim();

  const picks: AnswerPick[] = [
    ...open.map((o) => ({ id: o.restaurant_id, kind: "open" as const, name: o.name, city: o.city, blurb: openBlurb(o) })),
    ...soon.map((s) => ({ id: s.notice_id, kind: "soon" as const, name: s.trade_name, city: s.city, blurb: soonBlurb(s) })),
  ];
  return { summary: summary.charAt(0).toUpperCase() + summary.slice(1), picks };
}
