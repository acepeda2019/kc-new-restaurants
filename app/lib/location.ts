/**
 * The visitor's location (ARCHITECTURE.md §7): browser geolocation, asked only when the
 * visitor clicks, never stored and never sent anywhere (except later with a question).
 */
import type { LatLon } from "@/lib/rank";

/** The browser's own timeout: it starts after permission is granted, so the prompt doesn't count. */
export const LOCATION_TIMEOUT_MS = 8000;
/** Backstop for browsers that never call back at all (e.g. a prompt left open). */
export const SAFETY_TIMEOUT_MS = 30000;

type Geo = Pick<Geolocation, "getCurrentPosition">;

function browserGeo(): Geo | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.geolocation;
}

/** Resolves {lat, lon}, or null on deny, error, either timeout, no geolocation or bad coordinates. Never rejects. */
export function requestLocation(geo: Geo | undefined = browserGeo()): Promise<LatLon | null> {
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: LatLon | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), SAFETY_TIMEOUT_MS);
    try {
      geo.getCurrentPosition(
        ({ coords: { latitude: lat, longitude: lon } }) =>
          finish(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null),
        () => finish(null),
        { timeout: LOCATION_TIMEOUT_MS, maximumAge: 5 * 60 * 1000 },
      );
    } catch {
      finish(null);
    }
  });
}
