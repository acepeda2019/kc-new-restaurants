import { describe, expect, it, vi } from "vitest";
import { TRIED_KEY, loadTried, subscribeTried, toggleTried, triedSnapshot } from "@/lib/tried";

/** In-memory stand-in for window.localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("loadTried", () => {
  it("is empty when nothing is stored", () => {
    expect(loadTried(memoryStorage())).toEqual(new Set());
  });

  it("reads ids stored under kcne_tried", () => {
    expect(TRIED_KEY).toBe("kcne_tried");
    expect(loadTried(memoryStorage({ kcne_tried: '["a","b"]' }))).toEqual(new Set(["a", "b"]));
  });

  it("returns an empty set on corrupt JSON or a non-array", () => {
    expect(loadTried(memoryStorage({ kcne_tried: "{not json" }))).toEqual(new Set());
    expect(loadTried(memoryStorage({ kcne_tried: '{"a":1}' }))).toEqual(new Set());
  });

  it("keeps only string ids", () => {
    expect(loadTried(memoryStorage({ kcne_tried: '["a",1,null]' }))).toEqual(new Set(["a"]));
  });

  it("returns an empty set when storage throws", () => {
    expect(() => loadTried(throwing)).not.toThrow();
    expect(loadTried(throwing)).toEqual(new Set());
  });

  it("returns an empty set when there is no storage (server or blocked)", () => {
    expect(loadTried(undefined)).toEqual(new Set());
  });
});

describe("toggleTried", () => {
  it("adds then removes an id and persists each step", () => {
    const storage = memoryStorage();
    expect(toggleTried("a", storage)).toEqual(new Set(["a"]));
    expect(loadTried(storage)).toEqual(new Set(["a"]));
    expect(toggleTried("a", storage)).toEqual(new Set());
    expect(loadTried(storage)).toEqual(new Set());
  });

  it("leaves other ids alone", () => {
    const storage = memoryStorage({ kcne_tried: '["a"]' });
    expect(toggleTried("b", storage)).toEqual(new Set(["a", "b"]));
  });

  it("returns an empty set when storage throws", () => {
    expect(() => toggleTried("a", throwing)).not.toThrow();
    expect(toggleTried("a", throwing)).toEqual(new Set());
  });

  it("returns what is stored, unchanged, when only writing fails", () => {
    const storage = { ...memoryStorage({ kcne_tried: '["a"]' }), setItem: throwing.setItem };
    expect(toggleTried("b", storage)).toEqual(new Set(["a"]));
  });
});

describe("triedSnapshot and subscribeTried (for useSyncExternalStore)", () => {
  it("returns the same Set until the stored value changes", () => {
    const storage = memoryStorage({ kcne_tried: '["a"]' });
    const first = triedSnapshot(storage);
    expect(first).toEqual(new Set(["a"]));
    expect(triedSnapshot(storage)).toBe(first);
    toggleTried("b", storage);
    expect(triedSnapshot(storage)).toEqual(new Set(["a", "b"]));
  });

  it("is empty when storage throws", () => {
    expect(triedSnapshot(throwing)).toEqual(new Set());
  });

  it("notifies subscribers on toggle until they unsubscribe", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeTried(onChange);
    toggleTried("a", memoryStorage());
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    toggleTried("a", memoryStorage());
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
