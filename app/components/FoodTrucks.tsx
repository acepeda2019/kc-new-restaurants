import type { Opening } from "@/lib/data";
import { placeLabel } from "@/lib/format";

type Props = { trucks: Pick<Opening, "restaurant_id" | "name" | "city" | "category">[] };

/** Trucks have no fixed spot to pin, so they are listed under the map by base city. Nothing when there are none. */
export function FoodTrucks({ trucks }: Props) {
  if (trucks.length === 0) return null;
  return (
    <section aria-labelledby="food-trucks" className="food-trucks">
      <h3 id="food-trucks">Food trucks (no fixed spot)</h3>
      <ul>
        {trucks.map((t) => (
          <li key={t.restaurant_id}>
            {t.name} <span className="where">· {placeLabel(t.city, t.category)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
