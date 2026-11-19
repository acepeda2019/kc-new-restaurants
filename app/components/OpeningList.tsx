import type { Opening } from "@/lib/data";

type Item = Pick<Opening, "restaurant_id" | "name" | "city" | "why">;

/** Compact list of openings, in the order given. */
export function OpeningList({ items }: { items: Item[] }) {
  return (
    <ul className="opening-list">
      {items.map((o) => (
        <li key={o.restaurant_id}>
          <strong>{o.name}</strong> <span className="where">{o.city}</span>
          <br />
          {o.why}
        </li>
      ))}
    </ul>
  );
}
