/**
 * Display formatting for the home page: pure functions, safe on the server or in the
 * browser. Components call these so they stay free of logic.
 */
import type { Opening } from "@/lib/data";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TIME_ZONE = "America/Los_Angeles";

/**
 * "2026-11-13" → "Nov 13, 2026". Reads the digits directly instead of going through
 * `new Date()`, which would treat the date as UTC midnight and can shift it a day.
 */
export function formatPlainDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const month = m ? Number(m[2]) : 0;
  const day = m ? Number(m[3]) : 0;
  if (!m || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`not a YYYY-MM-DD date: ${isoDate}`);
  }
  return `${MONTHS[month - 1]} ${day}, ${m[1]}`;
}

/** A timestamp (e.g. manifest built_at, ISO UTC) → its Pacific calendar date, "YYYY-MM-DD". */
export function pacificDate(timestamp: string): string {
  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) throw new Error(`not a timestamp: ${timestamp}`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
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

/** The mart's category code in plain words. */
export function categoryLabel(category: Opening["category"]): string {
  return CATEGORY_LABELS[category];
}
