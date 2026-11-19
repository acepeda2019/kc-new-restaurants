"use client";

import { useState } from "react";
import { formatDistance, placeLabel } from "@/lib/format";
import type { PlaceListItem } from "@/lib/rank";

type Item = Pick<PlaceListItem, "restaurant_id" | "name" | "city" | "category" | "why" | "distanceMi" | "tried">;
type Props = { items: Item[] };

/**
 * Every opening in a collapsed list, ordered by the caller. Rows render only while open, so
 * a long list costs nothing until asked for; closed (the static HTML) it is just the summary.
 */
export function AllPlaces({ items }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <details className="all-places" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>All {items.length} {items.length === 1 ? "place" : "places"}</summary>
      {open && (
        <ul>
          {items.map((o) => {
            const distance = formatDistance(o.distanceMi);
            return (
              <li key={o.restaurant_id}>
                <p>
                  <strong>{o.name}</strong> <span className="where">— {placeLabel(o.city, o.category)}</span>
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
