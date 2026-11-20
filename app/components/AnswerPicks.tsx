import { PlaceName } from "@/components/PlaceName";
import type { AnswerPick } from "@/lib/ask";
import type { Opening } from "@/lib/data";
import { COUNTY_LOOKUP_URL, type Fact } from "@/lib/format";

/** Where a picked place is, for its name button (food trucks and ungeocoded places get a note instead). */
export type PickPlace = Pick<Opening, "name" | "category" | "latitude" | "longitude">;
/** What a card shows besides Claude's blurb, all from our data: where it is (street and city) and facts. */
export type PickCard = { place: PickPlace; where: string; facts: Fact[] };

type Props = {
  picks: AnswerPick[];
  /** Pick id → where it is and its fact bubbles; built by the caller from openings and Opening soon. */
  cards: ReadonlyMap<string, PickCard>;
  tried: ReadonlySet<string>;
  onToggleTried: (id: string) => void;
  /** Absent when the map is unavailable. */
  onShow?: (id: string) => void;
  focusedId: string | null;
};

/**
 * The question bar's answer as cards: one per pick, best first, numbered like their map pins.
 * Facts are bubbles from our data; Claude's blurb says why it fits the question. Tapping a name
 * shows the place on the map; open places can be marked "Tried".
 */
export function AnswerPicks({ picks, cards, tried, onToggleTried, onShow, focusedId }: Props) {
  if (picks.length === 0) return null;
  return (
    <ol className="top-three answer-picks">
      {picks.map((p, i) => {
        const card = cards.get(p.id);
        const place = card?.place;
        return (
          <li key={p.id} className={p.id === focusedId ? "focused" : undefined}>
            <span className="rank" aria-hidden="true">{i + 1}</span>
            <div className="pick">
              {/* "Tried" sits right beside the name on every screen size. */}
              <div className="answer-head">
                <h3>{place ? <PlaceName place={place} onShow={onShow && (() => onShow(p.id))} /> : p.name}</h3>
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
              </div>
              <p className="where">{card?.where ?? p.city ?? "King County"}</p>
              {card && card.facts.length > 0 && (
                <ul className="facts" aria-label="Facts">
                  {card.facts.map((f) => (
                    <li key={f.label} className={`fact ${f.tone}`}>{f.label}</li>
                  ))}
                </ul>
              )}
              <p className="why">{p.blurb}</p>
              {p.kind === "open" && (
                <p className="county-link">
                  <a href={COUNTY_LOOKUP_URL} target="_blank" rel="noopener noreferrer">
                    County inspection record ↗
                  </a>
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
