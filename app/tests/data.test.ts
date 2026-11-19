import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadData } from "@/lib/data";

const DATA_DIR = path.join(__dirname, "..", "data");
const SAMPLE_DIR = path.join(DATA_DIR, "sample");

/** A data dir holding only the tracked sample, as on a fresh checkout. */
function sampleOnlyDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kcne-data-"));
  cpSync(SAMPLE_DIR, path.join(dir, "sample"), { recursive: true });
  return dir;
}

/** A data dir with a "real" export (copied from the sample) next to the sample. */
function realExportDir(manifestPatch: Record<string, unknown> = {}): string {
  const dir = sampleOnlyDir();
  for (const name of ["openings.json", "metrics.json"]) cpSync(path.join(SAMPLE_DIR, name), path.join(dir, name));
  const manifest = JSON.parse(readFileSync(path.join(SAMPLE_DIR, "manifest.json"), "utf8"));
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ ...manifest, ...manifestPatch }));
  return dir;
}

describe("loadData", () => {
  it("falls back to the sample when the real export is absent", () => {
    const data = loadData(sampleOnlyDir());
    expect(data.isSample).toBe(true);
    expect(data.openings.length).toBe(data.manifest.row_count);
  });

  it("uses the real export when present", () => {
    expect(loadData(realExportDir()).isSample).toBe(false);
  });

  it("rejects an unknown manifest schema_version", () => {
    expect(() => loadData(realExportDir({ schema_version: 999 }))).toThrow(/schema_version/);
  });

  it("rejects a partial real export instead of mixing it with the sample", () => {
    const dir = sampleOnlyDir();
    cpSync(path.join(SAMPLE_DIR, "openings.json"), path.join(dir, "openings.json"));
    expect(() => loadData(dir)).toThrow(/partial export/);
  });

  it("rejects an openings row missing a mart column", () => {
    const dir = realExportDir();
    const rows = JSON.parse(readFileSync(path.join(dir, "openings.json"), "utf8"));
    delete rows[0].why;
    writeFileSync(path.join(dir, "openings.json"), JSON.stringify(rows));
    expect(() => loadData(dir)).toThrow(/why/);
  });
});

describe("sample openings", () => {
  const { openings, metrics } = loadData(sampleOnlyDir());

  it("has the mart's not-null and accepted-value guarantees", () => {
    expect(openings.length).toBeGreaterThan(0);
    for (const o of openings) {
      expect(o.restaurant_id).toBeTruthy();
      expect(Number.isInteger(o.rank)).toBe(true);
      expect(o.why).toBeTruthy();
      expect(["restaurant", "cafe_bakery_dessert", "food_hall_stall", "food_truck"]).toContain(o.category);
      expect(["claude", "override"]).toContain(o.source);
      expect(o.opening_type).not.toBe("ownership_transfer");
      expect(o.replaces_name !== null).toBe(o.opening_type === "new_concept");
      expect(o.score).toBeGreaterThanOrEqual(0);
      expect(o.score).toBeLessThanOrEqual(100);
      expect(Array.isArray(o.red_violations)).toBe(true);
    }
  });

  it("is ordered by rank with unique ids", () => {
    expect(openings.map((o) => o.rank)).toEqual(openings.map((_, i) => i + 1));
    expect(new Set(openings.map((o) => o.restaurant_id)).size).toBe(openings.length);
  });

  it("has metrics consistent with the openings", () => {
    expect(metrics.opened_last_180_days).toBe(openings.length);
    expect(typeof metrics.opened_last_30_days).toBe("number");
  });
});
