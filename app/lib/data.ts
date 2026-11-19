/**
 * The app's only data access. Reads the JSON written by transform/export.py
 * (openings.json, metrics.json, manifest.json) from app/data/ at build time, or the
 * tracked, labelled sample in app/data/sample/ when no real export is present.
 *
 * Throws (failing `next build`) on a partial export, an unknown manifest schema_version,
 * or a row missing a mart column, so a broken export never ships.
 * Types mirror transform/models/marts/mart_new_openings.sql and mart_metrics.sql.
 *
 * Read only while prerendering static pages, so the fs calls opt out of Turbopack's
 * output tracing (it would otherwise ship the whole project as server code).
 */
import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** manifest.json schema versions this app can read (export.py SCHEMA_VERSION). */
export const KNOWN_SCHEMA_VERSIONS = [1];

export type RedViolation = { date: string; description: string; points: number };

/** One row of mart_new_openings: a restaurant that just opened. Dates are ISO strings. */
export type Opening = {
  restaurant_id: string; // KC business_id
  name: string;
  address: string | null;
  city: string;
  zip5: string;
  latitude: number | null; // null for food trucks and unmatched geocodes
  longitude: number | null;
  geocode_match_status: string | null;
  category: "restaurant" | "cafe_bakery_dessert" | "food_hall_stall" | "food_truck";
  opening_type: "new_opening" | "new_concept";
  replaces_name: string | null; // set exactly when opening_type = new_concept
  likely_cuisine: string | null; // inferred: show as "likely X"
  first_inspection_date: string;
  days_open: number;
  first_inspection_type: string | null;
  first_inspection_result: string | null;
  first_inspection_red_points: number;
  latest_inspection_date: string;
  latest_red_points: number;
  red_violations: RedViolation[]; // up to 5, newest first
  freshness: number;
  safety: number;
  score: number; // 0–100
  rank: number; // 1 = highest score
  why: string;
  source: "claude" | "override";
  confidence: number | null;
  classification_reason: string | null;
};

/** The one row of mart_metrics. */
export type Metrics = {
  built_at: string;
  pulled_on: string;
  opened_last_30_days: number;
  opened_prior_30_days: number;
  opened_last_7_days: number;
  opened_last_180_days: number;
  clean_first_inspection_count: number;
  by_city: { city: string; openings: number }[]; // top 10
  pending_review_count: number;
};

export type Manifest = {
  built_at: string;
  run_date: string;
  run_id: string;
  row_count: number;
  schema_version: number;
};

export type AppData = { openings: Opening[]; metrics: Metrics; manifest: Manifest; isSample: boolean };

const FILES = ["openings.json", "metrics.json", "manifest.json"] as const;

// Every column the export must carry; a missing one means the mart and the app drifted.
const OPENING_KEYS: (keyof Opening)[] = [
  "restaurant_id", "name", "address", "city", "zip5", "latitude", "longitude",
  "geocode_match_status", "category", "opening_type", "replaces_name", "likely_cuisine",
  "first_inspection_date", "days_open", "first_inspection_type", "first_inspection_result",
  "first_inspection_red_points", "latest_inspection_date", "latest_red_points",
  "red_violations", "freshness", "safety", "score", "rank", "why", "source", "confidence",
  "classification_reason",
];
const METRICS_KEYS: (keyof Metrics)[] = [
  "built_at", "pulled_on", "opened_last_30_days", "opened_prior_30_days", "opened_last_7_days",
  "opened_last_180_days", "clean_first_inspection_count", "by_city", "pending_review_count",
];
const MANIFEST_KEYS: (keyof Manifest)[] = ["built_at", "run_date", "run_id", "row_count", "schema_version"];
// Not-null in the mart YAML tests.
const OPENING_NOT_NULL: (keyof Opening)[] = ["restaurant_id", "rank", "why"];

function requireKeys(row: Record<string, unknown>, keys: readonly string[], where: string): void {
  const missing = keys.filter((k) => !(k in row));
  if (missing.length) throw new Error(`${where}: missing column(s) ${missing.join(", ")}`);
}

function readJson(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(/*turbopackIgnore: true*/ path.join(dir, name), "utf8"));
}

/** Load and check the export in dataDir, else its sample/ subfolder. */
export function loadData(dataDir: string = path.join(process.cwd(), "data")): AppData {
  const present = FILES.filter((f) => existsSync(path.join(/*turbopackIgnore: true*/ dataDir, f)));
  if (present.length > 0 && present.length < FILES.length) {
    throw new Error(`${dataDir}: partial export (found ${present.join(", ")}); re-run transform/export.py`);
  }
  const isSample = present.length === 0;
  const dir = isSample ? path.join(dataDir, "sample") : dataDir;

  const manifest = readJson(dir, "manifest.json") as Manifest;
  requireKeys(manifest, MANIFEST_KEYS, "manifest.json");
  if (!KNOWN_SCHEMA_VERSIONS.includes(manifest.schema_version)) {
    throw new Error(`manifest.json schema_version ${manifest.schema_version} is unknown to the app (knows ${KNOWN_SCHEMA_VERSIONS.join(", ")})`);
  }

  const openings = readJson(dir, "openings.json") as Opening[];
  if (!Array.isArray(openings)) throw new Error("openings.json: expected an array");
  openings.forEach((row, i) => {
    requireKeys(row, OPENING_KEYS, `openings.json row ${i}`);
    const nulls = OPENING_NOT_NULL.filter((k) => row[k] === null);
    if (nulls.length) throw new Error(`openings.json row ${i}: null ${nulls.join(", ")}`);
  });
  if (openings.length !== manifest.row_count) {
    throw new Error(`openings.json has ${openings.length} rows, manifest says ${manifest.row_count}`);
  }

  const metrics = readJson(dir, "metrics.json") as Metrics;
  requireKeys(metrics, METRICS_KEYS, "metrics.json");

  return { openings, metrics, manifest, isSample };
}

let cached: AppData | undefined;
function data(): AppData {
  return (cached ??= loadData());
}

export const getOpenings = (): Opening[] => data().openings;
export const getMetrics = (): Metrics => data().metrics;
export const getManifest = (): Manifest => data().manifest;
/** True when the app is showing app/data/sample/: the UI must label it as sample data. */
export const isSampleData = (): boolean => data().isSample;
