import { categoryLabel, formatDistance, likelyCuisine } from "@/lib/format";
import type { RankedOpening } from "@/lib/rank";

type Item = Pick<
  RankedOpening,
  "restaurant_id" | "name" | "city" | "why" | "category" | "likely_cuisine" | "distanceMi"
>;

/** The personal top 3; shows distance only when the caller measured one. */
export function TopThree({ items }: { items: Item[] }) {
  if (items.length === 0) return <p>No new openings to show.</p>;
  return (
    <ol className="top-three">
      {items.map((o) => {
        const cuisine = likelyCuisine(o.likely_cuisine);
        const distance = formatDistance(o.distanceMi);
        return (
          <li key={o.restaurant_id}>
            <h3>{o.name}</h3>
            <p className="where">
              {o.city}
              {distance && <> · {distance}</>}
            </p>
            <p>{o.why}</p>
            <p className="tags">
              {o.category === "food_truck" ? (
                <span className="badge">Food truck</span>
              ) : (
                <span>{categoryLabel(o.category)}</span>
              )}
              {cuisine && <span>{cuisine}</span>}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
