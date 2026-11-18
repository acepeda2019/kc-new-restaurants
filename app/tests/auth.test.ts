import { describe, expect, it } from "vitest";
import { safeEqual, signSession, verifySession, SESSION_MAX_AGE_S } from "@/lib/auth";

const secret = "test-secret-not-real";

describe("session tokens", () => {
  it("verifies a token it signed", async () => {
    expect(await verifySession(await signSession(secret), secret)).toBe(true);
  });

  it("rejects a tampered token", async () => {
    const token = await signSession(secret);
    const [payload, sig] = token.split(".");
    const forgedPayload = String(Number(payload) + 1);
    expect(await verifySession(`${forgedPayload}.${sig}`, secret)).toBe(false);
    // Flip the first character: it carries 6 MAC bits (the last one may only carry padding).
    const flipped = (sig.startsWith("A") ? "B" : "A") + sig.slice(1);
    expect(await verifySession(`${payload}.${flipped}`, secret)).toBe(false);
  });

  it("rejects a token signed with a different secret", async () => {
    expect(await verifySession(await signSession("other-secret"), secret)).toBe(false);
  });

  it("rejects missing, empty or malformed tokens", async () => {
    expect(await verifySession(undefined, secret)).toBe(false);
    expect(await verifySession("", secret)).toBe(false);
    expect(await verifySession("not-a-token", secret)).toBe(false);
  });

  it("rejects everything when the secret is empty", async () => {
    expect(await verifySession(await signSession(secret), "")).toBe(false);
  });

  it("expires after 30 days", async () => {
    const issuedAt = new Date("2026-11-01T00:00:00Z");
    const token = await signSession(secret, issuedAt);
    const justBefore = new Date(issuedAt.getTime() + (SESSION_MAX_AGE_S - 1) * 1000);
    const justAfter = new Date(issuedAt.getTime() + (SESSION_MAX_AGE_S + 1) * 1000);
    expect(SESSION_MAX_AGE_S).toBe(30 * 24 * 60 * 60);
    expect(await verifySession(token, secret, justBefore)).toBe(true);
    expect(await verifySession(token, secret, justAfter)).toBe(false);
  });
});

describe("safeEqual (passcode compare)", () => {
  it("is true for equal strings", () => {
    expect(safeEqual("dev-passcode", "dev-passcode")).toBe(true);
  });

  it("is false for different strings of the same length", () => {
    expect(safeEqual("dev-passcode", "dev-passcodf")).toBe(false);
  });

  it("is false for different lengths", () => {
    expect(safeEqual("dev-passcode", "dev-passcode!")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
