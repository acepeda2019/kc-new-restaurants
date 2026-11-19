import { PlaceName } from "@/components/PlaceName";
import type { AnswerPick } from "@/lib/ask";
import type { Opening } from "@/lib/data";

/** Where a picked place is, for its name button (food trucks and ungeocoded places get a note instead). */
export type PickPlace = Pick<Opening, "name" | "category" | "latitude" | "longitude">;

type Props = {
  picks: AnswerPick[];
  /** Pick id → where it is; built by the caller from openings and Opening soon. */
  places: ReadonlyMap<string, PickPlace>;
  tried: ReadonlySet<string>;
  onToggleTried: (id: string) => void;
  /** Absent when the map is unavailable. */
  onShow?: (id: string) => void;
  focusedId: string | null;
};

/**
 * The question bar's answer as cards: one per pick, best first, numbered like their map pins.
 * Tapping a name shows the place on the map; open places can be marked "Tried".
 */
export function AnswerPicks({ picks, places, tried, onToggleTried, onShow, focusedId }: Props) {
  if (picks.length === 0) return null;
  return (
    <ol className="top-three answer-picks">
      {picks.map((p, i) => {
        const place = places.get(p.id);
        return (
          <li key={p.id} className={p.id === focusedId ? "focused" : undefined}>
            <span className="rank" aria-hidden="true">{i + 1}</span>
            <div className="pick">
              <h3>{place ? <PlaceName place={place} onShow={onShow && (() => onShow(p.id))} /> : p.name}</h3>
              <p className="where">
                {p.city ?? "King County"}
                {p.kind === "soon" && <span className="badge soon-badge">Opening soon</span>}
              </p>
              <p className="why">{p.blurb}</p>
            </div>
            {p.kind === "open" && (
              <button
                type="button"
                className="tried"
                title="Tried it"
                aria-pressed={tried.has(p.id)}
                onClick={() => onToggleTried(p.id)}
              >
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                <span className="tried-label" aria-hidden="true">Tried</span>
                <span className="sr-only">Tried it</span>
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
