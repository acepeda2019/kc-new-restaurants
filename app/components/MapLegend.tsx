import type { PinKind } from "@/lib/pins";

/** Pin colours, shared by the map layers and this legend so they cannot drift apart. */
export const PIN_COLORS: Record<PinKind, string> = {
  top: "#D4F75A",
  new: "#D5DBE3",
  wary: "#FF8A3D",
  you: "#5AA9FF",
};

const LABELS: { kind: PinKind; label: string }[] = [
  { kind: "top", label: "Your top 3" },
  { kind: "new", label: "Other new places" },
  { kind: "wary", label: "Red points at latest inspection" },
  { kind: "you", label: "You" },
];

/** What the map's pin colours mean. */
export function MapLegend() {
  return (
    <ul className="pill map-legend" aria-label="Map legend">
      {LABELS.map((l) => (
        <li key={l.kind}>
          <span className={`swatch ${l.kind}`} style={{ background: PIN_COLORS[l.kind] }} aria-hidden="true" />
          {l.label}
        </li>
      ))}
    </ul>
  );
}
