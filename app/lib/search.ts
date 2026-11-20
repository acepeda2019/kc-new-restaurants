/**
 * The question bar's search tool (SAN-58): code does the filtering and counting over **every**
 * place, so a count is exact and the same each time; Claude only turns the question into these
 * filters and phrases the result. Pure, server-side, unit-tested.
 */
import type { Opening, OpeningSoon } from "@/lib/data";
import { haversineMi, type LatLon } from "@/lib/rank";

/** Places returned to Claude per search: enough to pick 5 cards from, small enough to stay cheap. */
export const MAX_TOOL_PLACES = 20;

export const CATEGORIES = ["restaurant", "cafe_bakery_dessert", "food_hall_stall", "food_truck"] as const;

/** Claude's filters. Every field is present (strict tool schema); null means "any". */
export type FindInput = {
  name: string | null;
  city: string | null;
  cuisine: string | null;
  category: (typeof CATEGORIES)[number] | null;
  /** YYYY-MM-DD: first inspected on or after this date (for Opening soon: applied on or after). */
  first_inspected_since: string | null;
  include_opening_soon: boolean;
};

type Row = Record<string, unknown>;

export type FindResult = {
  /** Exact number of open places matching every filter. */
  count: number;
  /** Up to MAX_TOOL_PLACES of them: nearest first once the visitor is located, else newest first. */
  places: Row[];
  /** Exact number of matching Opening soon places (0 unless include_opening_soon). */
  opening_soon_count: number;
  opening_soon: Row[];
  /** When `city` matched nothing: the cities that do have places, so Claude can correct a misspelling. */
  known_cities?: string[];
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const has = (value: string | null | undefined, wanted: string | null) => !wanted || norm(value).includes(norm(wanted));
const sameCity = (value: string | null | undefined, wanted: string | null) => !wanted || norm(value) === norm(wanted);

/**
 * Filters all openings (and, if asked, all Opening soon places) and counts them. `toRow` shapes
 * each place for Claude (the same fields as the DATA block). Tried places are counted but
 * flagged, so "how many" stays true while answers can still skip them.
 */
export function findOpenings(
  input: FindInput,
  data: {
    openings: Opening[];
    openingSoon: OpeningSoon[];
    here?: LatLon;
    tried: Set<string>;
    toRow: (o: Opening & { distanceMi?: number }) => Row;
  },
): FindResult {
  const { openings, openingSoon, here, tried } = data;
  const since = input.first_inspected_since;

  const open = openings
    .filter(
      (o) =>
        has(o.name, input.name) &&
        sameCity(o.city, input.city) &&
        has(o.likely_cuisine, input.cuisine) &&
        (!input.category || o.category === input.category) &&
        (!since || o.first_inspection_date >= since),
    )
    .map((o): Opening & { distanceMi?: number } => {
      const fixed = here && o.category !== "food_truck" && o.latitude !== null && o.longitude !== null;
      return fixed ? { ...o, distanceMi: haversineMi(here, { lat: o.latitude!, lon: o.longitude! }) } : { ...o };
    })
    .sort((a, b) =>
      here
        ? (a.distanceMi ?? Infinity) - (b.distanceMi ?? Infinity) || a.rank - b.rank
        : b.first_inspection_date.localeCompare(a.first_inspection_date) || a.rank - b.rank,
    );

  const soon = input.include_opening_soon
    ? openingSoon.filter(
        (s) => has(s.trade_name, input.name) && sameCity(s.city, input.city) && (!since || s.application_date >= since),
      )
    : [];

  const result: FindResult = {
    count: open.length,
    places: open.slice(0, MAX_TOOL_PLACES).map((o) => ({ ...data.toRow(o), tried: tried.has(o.restaurant_id) })),
    opening_soon_count: soon.length,
    opening_soon: soon.slice(0, MAX_TOOL_PLACES).map((s) => ({
      id: s.notice_id,
      name: s.trade_name,
      city: s.city,
      applied_on: s.application_date,
      licence: s.licence_label,
    })),
  };
  if (input.city && open.length === 0 && soon.length === 0) {
    result.known_cities = [...new Set(openings.map((o) => o.city))].sort();
  }
  return result;
}
