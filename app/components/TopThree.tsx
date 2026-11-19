import { PlaceName } from "@/components/PlaceName";
import { categoryTag, formatDistance, likelyCuisine, placeLabel } from "@/lib/format";
import type { RankedOpening } from "@/lib/rank";

type Item = Pick<
  RankedOpening,
  "restaurant_id" | "name" | "city" | "why" | "category" | "likely_cuisine" | "distanceMi" | "latitude" | "longitude"
>;

type Props = {
  items: Item[];
  /** Ids shown as marked "Tried it" (button pressed; pressing again undoes). */
  tried: Set<string>;
  onToggleTried: (id: string) => void;
  /** Show this place on the map (its name was clicked); absent when the map is unavailable. */
  onShow?: (id: string) => void;
  /** The place shown on the map, highlighted here too. */
  focusedId: string | null;
};

/** The personal top 3, numbered as on the map; shows distance only when the caller measured one. */
export function TopThree({ items, tried, onToggleTried, onShow, focusedId }: Props) {
  if (items.length === 0) return <p>Nothing new to show.</p>;
  return (
    <ol className="top-three">
      {items.map((o, i) => {
        const cuisine = likelyCuisine(o.likely_cuisine);
        const distance = formatDistance(o.distanceMi);
        const tag = categoryTag(o.category);
        return (
          <li key={o.restaurant_id} className={o.restaurant_id === focusedId ? "focused" : undefined}>
            <span className="rank" aria-hidden="true">{i + 1}</span>
            <div className="pick">
              <div className="pick-head">
                <h3>
                  <PlaceName place={o} onShow={onShow && (() => onShow(o.restaurant_id))} />
                </h3>
                {distance && <span className="distance">{distance}</span>}
              </div>
              <p className="where">{placeLabel(o.city, o.category)}</p>
              <p className="why">{o.why}</p>
              <p className="tags">
                <span className={tag.isBadge ? "badge" : undefined}>{tag.label}</span>
                {cuisine && <span>{cuisine}</span>}
              </p>
            </div>
            {/* A toggle keeps one name; aria-pressed (and the filled tick) carry the state. Press again to undo. */}
            <button
              type="button"
              className="tried"
              title="Tried it"
              aria-pressed={tried.has(o.restaurant_id)}
              onClick={() => onToggleTried(o.restaurant_id)}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span className="tried-label" aria-hidden="true">Tried</span>
              <span className="sr-only">Tried it</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
