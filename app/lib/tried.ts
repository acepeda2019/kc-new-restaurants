/**
 * "Tried it" marks (ARCHITECTURE.md §7): browser localStorage only, never sent to or stored
 * on the server except with a question. Storage can be missing or throw (private browsing,
 * blocked cookies, quota), so every access fails soft to what is actually stored, else empty.
 */

export const TRIED_KEY = "kcne_tried";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined; // reading window.localStorage itself can throw when storage is blocked
  }
}

function readRaw(storage: KeyValueStore | undefined): string {
  try {
    return storage?.getItem(TRIED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parse(raw: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id) => typeof id === "string")) : new Set();
  } catch {
    return new Set();
  }
}

/** The restaurant_ids marked "Tried it"; empty when nothing is stored or storage fails. */
export function loadTried(storage: KeyValueStore | undefined = browserStorage()): Set<string> {
  return parse(readRaw(storage));
}

const listeners = new Set<() => void>();

/**
 * Marks `id` tried, or unmarks it if already tried, and returns the stored set. If writing
 * fails the set is returned unchanged, so the page never shows a mark that wasn't saved.
 */
export function toggleTried(id: string, storage: KeyValueStore | undefined = browserStorage()): Set<string> {
  const tried = loadTried(storage);
  const next = new Set(tried);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  try {
    if (!storage) return tried;
    storage.setItem(TRIED_KEY, JSON.stringify([...next]));
    return next;
  } catch {
    return tried;
  } finally {
    listeners.forEach((notify) => notify());
  }
}

/** Removes every "Tried it" mark. Never throws; if storage fails the marks stay as they were. */
/** Removes every mark. Returns false (marks untouched) when there is no storage or it throws. */
export function clearTried(storage: Pick<Storage, "removeItem"> | undefined = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.removeItem(TRIED_KEY);
    return true;
  } catch {
    return false; // leave the marks; the snapshot still shows what is stored
  } finally {
    listeners.forEach((notify) => notify());
  }
}

/** For useSyncExternalStore: calls `onChange` after a toggle here or a change in another tab. */
export function subscribeTried(onChange: () => void): () => void {
  listeners.add(onChange);
  if (typeof window !== "undefined") window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onChange);
  };
}

let cached: { raw: string; ids: Set<string> } | undefined;

/** For useSyncExternalStore: the same Set object until the stored value changes. */
export function triedSnapshot(storage: KeyValueStore | undefined = browserStorage()): Set<string> {
  const raw = readRaw(storage);
  if (cached?.raw !== raw) cached = { raw, ids: parse(raw) };
  return cached.ids;
}

/**
 * Ids to leave out of the top 3: every tried place except the one just marked, which stays
 * on screen (button pressed) so it can be undone in place.
 */
export function hiddenFromTop(tried: Set<string>, justMarked: string | null): Set<string> {
  return new Set([...tried].filter((id) => id !== justMarked));
}

/** After a click on `id`, the place to keep visible: `id` if it is now stored as tried, else none. */
export function nextJustMarked(id: string, triedAfter: Set<string>): string | null {
  return triedAfter.has(id) ? id : null;
}

/** How many listed places are hidden from the top 3 as tried (the just-marked one is still shown). */
export function hiddenCount(openings: { restaurant_id: string }[], tried: Set<string>, justMarked: string | null): number {
  const hidden = hiddenFromTop(tried, justMarked);
  return openings.filter((o) => hidden.has(o.restaurant_id)).length;
}
