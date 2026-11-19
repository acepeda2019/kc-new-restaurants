import { categoryTag, formatDistance, likelyCuisine, placeLabel } from "@/lib/format";
import type { RankedOpening } from "@/lib/rank";

type Item = Pick<
  RankedOpening,
  "restaurant_id" | "name" | "city" | "why" | "category" | "likely_cuisine" | "distanceMi"
>;

type Props = {
  items: Item[];
  /** Ids shown as marked "Tried it" (button pressed; pressing again undoes). */
  tried: Set<string>;
  onToggleTried: (id: string) => void;
};

/** The personal top 3; shows distance only when the caller measured one. */
export function TopThree({ items, tried, onToggleTried }: Props) {
  if (items.length === 0) return <p>Nothing new to show.</p>;
  return (
    <ol className="top-three">
      {items.map((o) => {
        const cuisine = likelyCuisine(o.likely_cuisine);
        const distance = formatDistance(o.distanceMi);
        const tag = categoryTag(o.category);
        return (
          <li key={o.restaurant_id}>
            <h3>{o.name}</h3>
            <p className="where">
              {placeLabel(o.city, o.category)}
              {distance && <> · {distance}</>}
            </p>
            <p>{o.why}</p>
            <p className="tags">
              <span className={tag.isBadge ? "badge" : undefined}>{tag.label}</span>
              {cuisine && <span>{cuisine}</span>}
            </p>
            {/* A toggle keeps one name; aria-pressed (and the tick) carry the state. Press again to undo. */}
            <button
              type="button"
              className="tried"
              aria-pressed={tried.has(o.restaurant_id)}
              onClick={() => onToggleTried(o.restaurant_id)}
            >
              {tried.has(o.restaurant_id) && <span aria-hidden="true">✓ </span>}
              Tried it
            </button>
          </li>
        );
      })}
    </ol>
  );
}
