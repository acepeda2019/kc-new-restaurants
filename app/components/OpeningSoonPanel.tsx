import { PlaceName } from "@/components/PlaceName";
import type { OpeningSoon } from "@/lib/data";
import { formatDistance } from "@/lib/format";

type Item = OpeningSoon & { distanceMi?: number };
type Props = {
  items: Item[];
  /** Show this place on the map (its name was clicked); absent when the map is unavailable. */
  onShow?: (id: string) => void;
  focusedId: string | null;
};

const SHOWN = 5;

function Row({ s, onShow, focusedId }: { s: Item } & Omit<Props, "items">) {
  const distance = formatDistance(s.distanceMi);
  // PlaceName expects an opening's shape; an Opening soon place is never a food truck.
  const place = { name: s.trade_name, category: "restaurant" as const, latitude: s.latitude, longitude: s.longitude };
  return (
    <li className={s.notice_id === focusedId ? "focused" : undefined}>
      <p>
        <strong>
          <PlaceName place={place} onShow={onShow && (() => onShow(s.notice_id))} />
        </strong>{" "}
        <span className="where">— {s.city ?? "King County"}</span>
        {distance && <span className="where"> · {distance}</span>}
      </p>
      <p className="why">{s.why}</p>
    </li>
  );
}

/**
 * Places that applied for a restaurant liquor licence and haven't had their first health
 * inspection yet, in the caller's order. The first few show; the rest are one tap away.
 */
export function OpeningSoonPanel({ items, onShow, focusedId }: Props) {
  if (items.length === 0) return null;
  const rest = items.slice(SHOWN);
  return (
    <section aria-labelledby="opening-soon" className="panel soon">
      <h2 id="opening-soon">Opening soon</h2>
      <p className="soon-source">From liquor licence applications, so places without alcohol won&apos;t show here.</p>
      <ul className="soon-list">
        {items.slice(0, SHOWN).map((s) => (
          <Row key={s.notice_id} s={s} onShow={onShow} focusedId={focusedId} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details className="all-places">
          <summary>{rest.length} more</summary>
          <ul className="soon-list">
            {rest.map((s) => (
              <Row key={s.notice_id} s={s} onShow={onShow} focusedId={focusedId} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
