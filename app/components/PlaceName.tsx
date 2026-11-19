import type { Opening } from "@/lib/data";
import { offMapNote } from "@/lib/pins";

type Props = {
  place: Pick<Opening, "name" | "category" | "latitude" | "longitude">;
  /** Absent when the map is unavailable: then the name is plain text. */
  onShow?: () => void;
};

/**
 * A place's name. When it has a pin (and the map works), the name is a button that shows it
 * on the map; a place without a pin gets plain text and a short note saying why.
 */
export function PlaceName({ place, onShow }: Props) {
  if (!onShow) return <>{place.name}</>;
  const note = offMapNote(place);
  if (note) {
    return (
      <>
        {place.name} <span className="off-map">{note}</span>
      </>
    );
  }
  return (
    <button type="button" className="place-name" onClick={onShow}>
      <span className="sr-only">Show </span>
      {place.name}
      <span className="sr-only"> on the map</span>
    </button>
  );
}
