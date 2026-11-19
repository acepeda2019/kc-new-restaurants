// Home-screen icon for phones (SAN-54): the lime pin, drawn at build time. Public (see proxy.ts).
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#D4F75A" }}>
        <svg width="112" height="112" viewBox="0 0 24 24" fill="none" stroke="#0B0E13" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" />
          <circle cx="12" cy="11" r="2.2" />
        </svg>
      </div>
    ),
    size,
  );
}
