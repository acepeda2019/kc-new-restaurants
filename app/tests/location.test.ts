import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCATION_TIMEOUT_MS, SAFETY_TIMEOUT_MS, requestLocation } from "@/lib/location";

type Success = (pos: { coords: { latitude: number; longitude: number } }) => void;
type Failure = (err: { code: number; message: string }) => void;
type Options = { timeout?: number };

/** A fake navigator.geolocation whose getCurrentPosition runs `respond`. */
function fakeGeo(respond: (ok: Success, fail: Failure) => void) {
  return { getCurrentPosition: vi.fn<(ok: Success, fail: Failure, opts?: Options) => void>((ok, fail) => respond(ok, fail)) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("requestLocation", () => {
  it("resolves lat/lon when the browser grants a position", async () => {
    const geo = fakeGeo((ok) => ok({ coords: { latitude: 47.6, longitude: -122.3 } }));
    await expect(requestLocation(geo)).resolves.toEqual({ lat: 47.6, lon: -122.3 });
  });

  it("resolves null when the visitor denies permission", async () => {
    const geo = fakeGeo((_ok, fail) => fail({ code: 1, message: "User denied Geolocation" }));
    await expect(requestLocation(geo)).resolves.toBeNull();
  });

  it("resolves null when the position is unavailable", async () => {
    const geo = fakeGeo((_ok, fail) => fail({ code: 2, message: "Position unavailable" }));
    await expect(requestLocation(geo)).resolves.toBeNull();
  });

  it("asks the browser to time out 8 s after permission is granted", async () => {
    const geo = fakeGeo((ok) => ok({ coords: { latitude: 47.6, longitude: -122.3 } }));
    await requestLocation(geo);
    expect(LOCATION_TIMEOUT_MS).toBe(8000);
    expect(geo.getCurrentPosition.mock.calls[0][2]).toMatchObject({ timeout: LOCATION_TIMEOUT_MS });
  });

  it("resolves null when the browser reports its timeout", async () => {
    const geo = fakeGeo((_ok, fail) => fail({ code: 3, message: "Timeout expired" }));
    await expect(requestLocation(geo)).resolves.toBeNull();
  });

  it("keeps a slow grant: the permission prompt does not count against 8 s", async () => {
    vi.useFakeTimers();
    let grant: Success = () => {};
    const pending = requestLocation(fakeGeo((ok) => (grant = ok)));
    await vi.advanceTimersByTimeAsync(LOCATION_TIMEOUT_MS + 5000);
    grant({ coords: { latitude: 47.6, longitude: -122.3 } });
    await expect(pending).resolves.toEqual({ lat: 47.6, lon: -122.3 });
  });

  it("resolves null after the 30 s safety timer when the browser never answers", async () => {
    vi.useFakeTimers();
    const pending = requestLocation(fakeGeo(() => {}));
    expect(SAFETY_TIMEOUT_MS).toBe(30000);
    await vi.advanceTimersByTimeAsync(SAFETY_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
  });

  it("ignores a late answer after the safety timer", async () => {
    vi.useFakeTimers();
    let late: Success = () => {};
    const pending = requestLocation(fakeGeo((ok) => (late = ok)));
    await vi.advanceTimersByTimeAsync(SAFETY_TIMEOUT_MS);
    late({ coords: { latitude: 47.6, longitude: -122.3 } });
    await expect(pending).resolves.toBeNull();
  });

  it("resolves null when geolocation is unavailable", async () => {
    await expect(requestLocation(undefined)).resolves.toBeNull();
  });

  it("resolves null when getCurrentPosition throws", async () => {
    const geo = fakeGeo(() => {
      throw new Error("blocked by permissions policy");
    });
    await expect(requestLocation(geo)).resolves.toBeNull();
  });

  it("resolves null on non-finite coordinates", async () => {
    const geo = fakeGeo((ok) => ok({ coords: { latitude: NaN, longitude: -122.3 } }));
    await expect(requestLocation(geo)).resolves.toBeNull();
  });
});
