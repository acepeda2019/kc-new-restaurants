import type { Opening } from "@/lib/data";
import { offMapNote } from "@/lib/pins";

type Props = {
  place: Pick<Opening, "name" | "category" | "latitude" | "longitude">;
  onShow: () => void;
};

/**
 * A place's name. When it has a pin, the name is a button that shows it on the map; otherwise
 * plain text with a short note saying why it isn't on the map.
 */
export function PlaceName({ place, onShow }: Props) {
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
