import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { loadData } from "@/lib/data";

const DATA_DIR = path.join(__dirname, "..", "data");
const SAMPLE_DIR = path.join(DATA_DIR, "sample");

const tempDirs: string[] = [];
const removeTempDirs = () => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
};

/** A data dir holding only the tracked sample, as on a fresh checkout. */
function sampleOnlyDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "kcne-data-"));
  tempDirs.push(dir);
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

type Row = Record<string, unknown>;

/** Rewrite openings.json in dir. */
function patchOpenings(dir: string, patch: (rows: Row[]) => Row[]): void {
  const file = path.join(dir, "openings.json");
  writeFileSync(file, JSON.stringify(patch(JSON.parse(readFileSync(file, "utf8")))));
}

describe("loadData", () => {
  afterEach(removeTempDirs);

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
    patchOpenings(dir, (rows) => rows.map((r, i) => (i === 0 ? { ...r, why: undefined } : r)));
    expect(() => loadData(dir)).toThrow(/missing column\(s\) why/);
  });

  it.each(["restaurant_id", "rank", "why"])("rejects a null %s (not-null in the mart)", (column) => {
    const dir = realExportDir();
    patchOpenings(dir, (rows) => rows.map((r, i) => (i === 0 ? { ...r, [column]: null } : r)));
    expect(() => loadData(dir)).toThrow(new RegExp(`row 0: null ${column}`));
  });

  it("rejects openings that disagree with the manifest row_count", () => {
    const dir = realExportDir();
    patchOpenings(dir, (rows) => rows.slice(1));
    expect(() => loadData(dir)).toThrow(/manifest says/);
  });
});

describe("sample openings", () => {
  const { openings, metrics } = loadData(sampleOnlyDir());
  afterAll(removeTempDirs);

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
