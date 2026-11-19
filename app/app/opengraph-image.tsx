// The picture shown when the link is shared (SAN-54), drawn at build time. It is public (see
// proxy.ts), so it must stay generic: the brand only, never restaurant data.
import { ImageResponse } from "next/og";

export const alt = "King County New Eats: what just opened near you";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const LIME = "#D4F75A";
const GROUND = "#0B0E13";

/** Decorative pins scattered like the app's map: lime picks, orange red points, grey, lavender rings. */
const PINS = [
  { x: 760, y: 150, r: 16, fill: LIME },
  { x: 900, y: 250, r: 9, fill: "#E6EAF0" },
  { x: 1010, y: 140, r: 9, fill: "#E6EAF0" },
  { x: 840, y: 360, r: 12, fill: "#FF8A3D" },
  { x: 1060, y: 330, r: 9, fill: "#E6EAF0" },
  { x: 960, y: 470, r: 16, fill: LIME },
  { x: 720, y: 470, r: 9, fill: "#E6EAF0" },
  { x: 1100, y: 520, r: 12, ring: "#C9B6FF" },
  { x: 640, y: 300, r: 12, ring: "#C9B6FF" },
];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: GROUND, position: "relative" }}>
        {/* Faint street grid, like the dark map. */}
        {Array.from({ length: 11 }, (_, i) => (
          <div key={`v${i}`} style={{ position: "absolute", left: 560 + i * 60, top: 0, width: 1, height: 630, background: "#1A202A" }} />
        ))}
        {Array.from({ length: 11 }, (_, i) => (
          <div key={`h${i}`} style={{ position: "absolute", left: 560, top: i * 60, width: 640, height: 1, background: "#1A202A" }} />
        ))}
        {PINS.map((p, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: p.x - p.r,
              top: p.y - p.r,
              width: p.r * 2,
              height: p.r * 2,
              borderRadius: p.r,
              background: p.fill ?? "transparent",
              border: p.ring ? `4px solid ${p.ring}` : `3px solid ${GROUND}`,
            }}
          />
        ))}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 72px", width: 640 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 88,
              height: 88,
              borderRadius: 44,
              background: LIME,
              marginBottom: 36,
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={GROUND} strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" />
              <circle cx="12" cy="11" r="2.2" />
            </svg>
          </div>
          <div style={{ fontSize: 68, fontWeight: 700, color: "#F2F4F7", lineHeight: 1.05, letterSpacing: -2 }}>
            King County New Eats
          </div>
          <div style={{ fontSize: 34, color: "#C9D0DA", marginTop: 24, lineHeight: 1.3 }}>
            What just opened near you. Ask, and the map shows you.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
