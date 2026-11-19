import { describe, expect, it, vi } from "vitest";
import { TRIED_KEY, hiddenCount, hiddenFromTop, loadTried, nextJustMarked, toggleTried } from "@/lib/tried";

/** A fresh copy of lib/tried, so its module-level snapshot cache and listeners never leak between tests. */
async function freshTried() {
  vi.resetModules();
  return import("@/lib/tried");
}

/** In-memory stand-in for window.localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
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
  removeItem: () => {
    throw new Error("SecurityError");
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
  it("returns the same Set until the stored value changes", async () => {
    const { toggleTried, triedSnapshot } = await freshTried();
    const storage = memoryStorage({ kcne_tried: '["a"]' });
    const first = triedSnapshot(storage);
    expect(first).toEqual(new Set(["a"]));
    expect(triedSnapshot(storage)).toBe(first);
    toggleTried("b", storage);
    expect(triedSnapshot(storage)).toEqual(new Set(["a", "b"]));
  });

  it("is empty when storage throws", async () => {
    const { triedSnapshot } = await freshTried();
    expect(triedSnapshot(throwing)).toEqual(new Set());
  });

  it("notifies subscribers on toggle until they unsubscribe", async () => {
    const { subscribeTried, toggleTried } = await freshTried();
    const onChange = vi.fn();
    const unsubscribe = subscribeTried(onChange);
    toggleTried("a", memoryStorage());
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    toggleTried("a", memoryStorage());
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("hiddenFromTop and nextJustMarked (the just-marked place stays visible to undo)", () => {
  /** One click on a top-3 card, as PersonalPicks does it. */
  function click(id: string, storage: Parameters<typeof toggleTried>[1]) {
    const tried = toggleTried(id, storage);
    return { tried, justMarked: nextJustMarked(id, tried) };
  }

  it("keeps the place just marked visible", () => {
    const { tried, justMarked } = click("a", memoryStorage());
    expect(justMarked).toBe("a");
    expect(hiddenFromTop(tried, justMarked)).toEqual(new Set());
  });

  it("hides A once B is marked", () => {
    const storage = memoryStorage();
    click("a", storage);
    const { tried, justMarked } = click("b", storage);
    expect(justMarked).toBe("b");
    expect(hiddenFromTop(tried, justMarked)).toEqual(new Set(["a"]));
  });

  it("undoing the just-marked place unmarks it and hides nothing new", () => {
    const storage = memoryStorage({ kcne_tried: '["old"]' });
    click("a", storage);
    const { tried, justMarked } = click("a", storage);
    expect(justMarked).toBeNull();
    expect(hiddenFromTop(tried, justMarked)).toEqual(new Set(["old"]));
  });

  it("a failed write leaves the place unmarked and hides nothing", () => {
    const storage = { ...memoryStorage(), setItem: throwing.setItem };
    const { tried, justMarked } = click("a", storage);
    expect(tried.has("a")).toBe(false);
    expect(justMarked).toBeNull();
    expect(hiddenFromTop(tried, justMarked)).toEqual(new Set());
  });
});

describe("clearTried", () => {
  it("removes every mark and notifies subscribers", async () => {
    const { clearTried, loadTried, subscribeTried } = await freshTried();
    const storage = memoryStorage({ kcne_tried: '["a","b"]', other: "kept" });
    const onChange = vi.fn();
    subscribeTried(onChange);
    clearTried(storage);
    expect(storage.data.has(TRIED_KEY)).toBe(false);
    expect(storage.data.get("other")).toBe("kept");
    expect(loadTried(storage)).toEqual(new Set());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("never throws, and leaves the marks as they were when storage throws", async () => {
    const { clearTried } = await freshTried();
    const storage = { ...memoryStorage({ kcne_tried: '["a"]' }), removeItem: throwing.removeItem };
    expect(() => clearTried(storage)).not.toThrow();
    expect(loadTried(storage)).toEqual(new Set(["a"]));
    expect(() => clearTried(undefined)).not.toThrow();
  });
});

describe("hiddenCount", () => {
  const listed = [{ restaurant_id: "a" }, { restaurant_id: "b" }, { restaurant_id: "c" }];

  it("counts tried places that are on the list and hidden", () => {
    expect(hiddenCount(listed, new Set(["a", "b"]), null)).toBe(2);
  });

  it("does not count the just-marked place, which is still shown", () => {
    expect(hiddenCount(listed, new Set(["a", "b"]), "b")).toBe(1);
    expect(hiddenCount(listed, new Set(["a"]), "a")).toBe(0);
  });

  it("ignores marks for places no longer on the list", () => {
    expect(hiddenCount(listed, new Set(["gone", "a"]), null)).toBe(1);
  });

  it("is zero with nothing tried", () => {
    expect(hiddenCount(listed, new Set(), null)).toBe(0);
  });
});
