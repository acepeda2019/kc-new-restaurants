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
 * likely cuisine (or "food truck"), when it opened, the inspection result, and distance.
 * Inspection wording follows mart_new_openings: an educational first visit is not scored; a
 * later inspection with red points outranks a clean first one.
 */
export function openingFacts(o: Opening & { distanceMi?: number }): Fact[] {
  const facts: Fact[] = [];
  const cuisine = likelyCuisine(o.likely_cuisine);
  if (o.category === "food_truck") facts.push({ label: "food truck", tone: "plain" });
  if (cuisine) facts.push({ label: cuisine, tone: "plain" });
  facts.push({ label: `opened ${shortDate(o.first_inspection_date)}`, tone: "plain" });
  if (o.latest_red_points > 0 && o.latest_inspection_date !== o.first_inspection_date) {
    facts.push({ label: `${o.latest_red_points} red points (${shortDate(o.latest_inspection_date)})`, tone: "warn" });
  } else if (o.first_inspection_type === "Educational Inspection") {
    facts.push({ label: "first visit: educational", tone: "plain" });
  } else if (o.first_inspection_red_points === 0) {
    facts.push({ label: "clean first inspection", tone: "good" });
  } else {
    facts.push({ label: `${o.first_inspection_red_points} red points`, tone: "warn" });
  }
  const distance = formatDistance(o.distanceMi);
  if (distance) facts.push({ label: distance, tone: "plain" });
  return facts.slice(0, 4);
}

/** The facts on an Opening soon card: that it isn't open yet, when it applied, the licence. */
export function openingSoonFacts(s: OpeningSoon & { distanceMi?: number }): Fact[] {
  const facts: Fact[] = [
    { label: "opening soon", tone: "soon" },
    { label: `applied ${shortDate(s.application_date)}`, tone: "plain" },
    { label: s.licence_label, tone: "plain" },
  ];
  const distance = formatDistance(s.distanceMi);
  if (distance) facts.push({ label: distance, tone: "plain" });
  return facts;
}
