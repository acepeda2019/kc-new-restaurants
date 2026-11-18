// Passcode-gate session helpers. Web Crypto only (no node:crypto) so this runs in any
// Next.js runtime: proxy, route handlers and tests.

export const SESSION_COOKIE = "kcne_session";
export const VISITOR_COOKIE = "kcne_visitor";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signs a session token `<expiresAtUnixSeconds>.<hmac>` valid for 30 days from `now`. */
export async function signSession(secret: string, now: Date = new Date()): Promise<string> {
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expiresAt = String(Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE_S);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(expiresAt));
  return `${expiresAt}.${toBase64Url(sig)}`;
}

/** True only for an unexpired token signed with `secret`. Never throws; any doubt is false. */
export async function verifySession(
  token: string | undefined,
  secret: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!token || !secret) return false;
  const [expiresAt, sigText, ...rest] = token.split(".");
  if (rest.length > 0 || !/^\d{1,12}$/.test(expiresAt ?? "") || !sigText) return false;
  const sig = fromBase64Url(sigText);
  if (!sig) return false;
  try {
    // subtle.verify compares the MAC in constant time.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      sig,
      encoder.encode(expiresAt),
    );
    return valid && Number(expiresAt) > now.getTime() / 1000;
  } catch {
    return false;
  }
}

/** Constant-time string compare for the passcode (time depends on length only). */
export function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}
