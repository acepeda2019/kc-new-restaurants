/**
 * Display formatting for the home page: pure functions, safe on the server or in the
 * browser. Components call these so they stay free of logic.
 */
import type { Opening, OpeningSoon } from "@/lib/data";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-11-13" → "Nov 13, 2026". Reads the digits directly instead of going through
 * `new Date()`, which would treat the date as UTC midnight and can shift it a day.
 * Throws on anything that is not a real calendar date (e.g. 2026-02-31).
 */
export function formatPlainDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const [year, month, day] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  // Day 0 of the next month is the last day of this one; UTC so the local zone can't interfere.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!m || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error(`not a YYYY-MM-DD date: ${isoDate}`);
  }
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** Inferred cuisine is never stated as fact: "likely Egyptian", or null when unknown. */
export function likelyCuisine(cuisine: string | null): string | null {
  return cuisine ? `likely ${cuisine}` : null;
}

/** 0.34 → "0.3 mi"; under a tenth reads "< 0.1 mi" rather than "0.0 mi". */
export function formatDistance(distanceMi: number | undefined): string | null {
  if (distanceMi === undefined) return null;
  return distanceMi < 0.05 ? "< 0.1 mi" : `${distanceMi.toFixed(1)} mi`;
}

const CATEGORY_LABELS: Record<Opening["category"], string> = {
  restaurant: "Restaurant",
  cafe_bakery_dessert: "Café, bakery or dessert",
  food_hall_stall: "Food hall stall",
  food_truck: "Food truck",
};

/** The mart's category in plain words; food trucks get a badge so they stand out. */
export function categoryTag(category: Opening["category"]): { label: string; isBadge: boolean } {
  return { label: CATEGORY_LABELS[category], isBadge: category === "food_truck" };
}

/** Where to say a place is: a truck's address is only its base, not where it serves. */
export function placeLabel(city: string, category: Opening["category"]): string {
  return category === "food_truck" ? `based in ${city}` : city;
}

/** "2026-11-13" → "Nov 13" (no year: every date on a card is recent). */
function shortDate(isoDate: string): string {
  return formatPlainDate(isoDate).replace(/, \d{4}$/, "");
}

/** One bubble on an answer card. `tone` colours it: good (clean), warn (red points), soon, or plain. */
export type Fact = { label: string; tone: "good" | "warn" | "soon" | "plain" };

/**
 * The facts on an open place's answer card, at most four, from our data (never from Claude):
 * the latest inspection first, then "food truck", likely cuisine, the first inspection's date, and
 * distance. We never know the opening date, only when the county first inspected the place
 * (usually weeks after it opened), so the card says "first inspected" (SAN-59).
 */
export function openingFacts(o: Opening & { distanceMi?: number }): Fact[] {
  // The inspection leads: it's the fact people scan for, and it's never the one cut at four.
  const facts: Fact[] = [latestInspection(o)];
  const cuisine = likelyCuisine(o.likely_cuisine);
  if (o.category === "food_truck") facts.push({ label: "food truck", tone: "plain" });
  if (cuisine) facts.push({ label: cuisine, tone: "plain" });
  // With one visit, the inspection bubble already carries this date.
  if (o.first_inspection_date !== o.latest_inspection_date) {
    facts.push({ label: `first inspected ${shortDate(o.first_inspection_date)}`, tone: "plain" });
  }
  const distance = formatDistance(o.distanceMi);
  if (distance) facts.push({ label: distance, tone: "plain" });
  return facts.slice(0, 4);
}

/**
 * The facts on an Opening soon card: that it applied for a licence and when (not that it will
 * open: some applicants never do), and which licence.
 */
export function openingSoonFacts(s: OpeningSoon & { distanceMi?: number }): Fact[] {
  const facts: Fact[] = [
    { label: `licence applied ${shortDate(s.application_date)}`, tone: "soon" },
    { label: s.licence_label, tone: "plain" },
  ];
  const distance = formatDistance(s.distanceMi);
  if (distance) facts.push({ label: distance, tone: "plain" });
  return facts;
}

/** Street suffixes and directions that stay upper case when an address is title-cased. */
const KEEP_UPPER = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);

/**
 * "27317 MAPLE VALLEY BLACK DIAMOND RD SE, A104" → "27317 Maple Valley Black Diamond Rd SE, A104";
 * "1ST AVE S" → "1st Ave S". Directions stay upper case (even before a comma); ordinals go lower;
 * unit numbers (A104, #G) are left as they are.
 */
function titleAddress(s: string): string {
  return s
    .split(" ")
    .map((w) => {
      const core = w.replace(/[^A-Za-z0-9]/g, "");
      if (KEEP_UPPER.has(core)) return w;
      if (/^\d+(ST|ND|RD|TH)$/.test(core)) return w.toLowerCase();
      if (/\d/.test(w) || w.startsWith("#")) return w; // unit numbers: A104, #G
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Where a place is, to tell apart same-name locations (two Nori Sushis): street and city, or
 * "based in <city>" for a food truck, whose address is only its base. City alone without a street.
 */
export function addressLine(o: Pick<Opening, "address" | "city" | "category">): string {
  const city = titleAddress(o.city);
  if (o.category === "food_truck") return `based in ${city}`;
  return o.address ? `${titleAddress(o.address)}, ${city}` : city;
}

/**
 * The latest inspection the way the county shows it: its verdict, its score (red + blue points)
 * and the date, e.g. "Unsatisfactory · 30 pts · Jun 16". Always the latest visit, never the
 * first, so a place that improved shows it. An educational visit isn't scored.
 */
export function latestInspection(
  o: Pick<Opening, "latest_inspection_result" | "latest_inspection_score" | "latest_inspection_date">,
): Fact {
  const date = shortDate(o.latest_inspection_date);
  if (o.latest_inspection_result === "Complete") return { label: `educational visit (not scored) · ${date}`, tone: "plain" };
  const score = o.latest_inspection_score === null ? "" : ` · ${o.latest_inspection_score} pts`;
  const label = `${o.latest_inspection_result ?? "inspected"}${score} · ${date}`;
  if (o.latest_inspection_result === "Unsatisfactory") return { label, tone: "warn" };
  return { label, tone: o.latest_inspection_score === 0 ? "good" : "plain" };
}
