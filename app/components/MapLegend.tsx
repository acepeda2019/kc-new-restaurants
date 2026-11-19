import type { PinKind } from "@/lib/pins";

/** Pin colours, shared by the map layers and this legend so they cannot drift apart. */
export const PIN_COLORS: Record<PinKind, string> = {
  top: "#D4F75A",
  new: "#D5DBE3",
  wary: "#FF8A3D",
  soon: "#C9B6FF", // ring colour; Opening soon pins are hollow (not open yet)
  you: "#5AA9FF",
};

const LABELS: { kind: PinKind; label: string }[] = [
  { kind: "top", label: "Your top 3" },
  { kind: "new", label: "Other new places" },
  { kind: "wary", label: "Red points at latest inspection" },
  { kind: "soon", label: "Opening soon" },
  { kind: "you", label: "You" },
];

/** What the map's pin colours mean. */
export function MapLegend() {
  return (
    <ul className="pill map-legend" aria-label="Map legend">
      {LABELS.map((l) => (
        <li key={l.kind}>
          <span
            className={`swatch ${l.kind}`}
            style={l.kind === "soon" ? { border: `2px solid ${PIN_COLORS.soon}` } : { background: PIN_COLORS[l.kind] }}
            aria-hidden="true"
          />
          {l.label}
        </li>
      ))}
    </ul>
  );
}
