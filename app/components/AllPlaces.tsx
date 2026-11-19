"use client";

import { useState } from "react";
import { PlaceName } from "@/components/PlaceName";
import { formatDistance, placeLabel } from "@/lib/format";
import type { PlaceListItem } from "@/lib/rank";

type Item = Pick<
  PlaceListItem,
  "restaurant_id" | "name" | "city" | "category" | "why" | "distanceMi" | "tried" | "latitude" | "longitude"
>;
type Props = {
  items: Item[];
  /** Show this place on the map (its name was clicked). */
  onShow: (id: string) => void;
  /** The place shown on the map, highlighted here too. */
  focusedId: string | null;
};

/**
 * Every opening in a collapsed list, ordered by the caller. Rows render only while open, so
 * a long list costs nothing until asked for; closed (the static HTML) it is just the summary.
 */
export function AllPlaces({ items, onShow, focusedId }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <details className="all-places" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>All {items.length} {items.length === 1 ? "place" : "places"}</summary>
      {open && (
        <ul>
          {items.map((o) => {
            const distance = formatDistance(o.distanceMi);
            return (
              <li key={o.restaurant_id} className={o.restaurant_id === focusedId ? "focused" : undefined}>
                <p>
                  <strong>
                    <PlaceName place={o} onShow={() => onShow(o.restaurant_id)} />
                  </strong>{" "}
                  <span className="where">— {placeLabel(o.city, o.category)}</span>
                  {distance && <span className="where"> · {distance}</span>}
                  {o.tried && <>{" "}<span className="tried-tag">tried</span></>}
                </p>
                <p className="why">{o.why}</p>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
