"use client";

/**
 * Browser-only state for the home page: the visitor's location (asked on click, never sent
 * anywhere) and "Tried it" marks (localStorage). Ranking and counting come from lib/rank, pins
 * from lib/pins; Metrics, OpeningsMap and TopThree stay presentational. The first render has no location and nothing
 * tried (the server snapshot), so it matches the static HTML; stored marks apply after hydration.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AnswerPicks, type PickCard } from "@/components/AnswerPicks";
import type { AnswerPick } from "@/lib/ask";
import { openingFacts, openingSoonFacts } from "@/lib/format";
import { AskBar, type LocationStatus } from "@/components/AskBar";
import { HiddenTried } from "@/components/HiddenTried";
import { OpeningsMap } from "@/components/OpeningsMap";
import { PlaceName } from "@/components/PlaceName";
import type { Metrics as MetricsData, Opening, OpeningSoon } from "@/lib/data";
import { askQuestion } from "@/lib/askClient";
import { requestLocation } from "@/lib/location";
import { nextFocus, offMapNote, resolveFocus, toPins, type FocusRequest } from "@/lib/pins";
import { todayBrief, type BriefPart } from "@/lib/brief";
import { NEAR_RADIUS_MI, allPlaces, countNear, rankOpeningSoon, type LatLon } from "@/lib/rank";
import {
  clearTried,
  hiddenCount,
  nextJustMarked,
  subscribeTried,
  toggleTried,
  triedSnapshot,
} from "@/lib/tried";

type Props = { openings: Opening[]; metrics: MetricsData; openingSoon: OpeningSoon[] };

const NOTHING_TRIED = new Set<string>();
const NO_PICKS: AnswerPick[] = [];
const serverSnapshot = () => NOTHING_TRIED;
const browserSnapshot = () => triedSnapshot();

export function PersonalPicks({ openings, metrics, openingSoon }: Props) {
  const [here, setHere] = useState<LatLon | undefined>(undefined);
  const [status, setStatus] = useState<LocationStatus>("idle");
  const tried = useSyncExternalStore(subscribeTried, browserSnapshot, serverSnapshot);
  // The place just marked stays on screen (button pressed) so it can be undone in place.
  const [justMarked, setJustMarked] = useState<string | null>(null);
  // The last answer's picks (null until the first question, when the Today brief shows instead).
  const [answerPicks, setAnswerPicks] = useState<AnswerPick[] | null>(null);
  // The place shown on the map: a name clicked in a list, or a pin clicked on the map.
  const [focused, setFocused] = useState<FocusRequest | null>(null);
  // Once the map has failed there is nothing to show places on, so names stop being buttons.
  const [mapFailed, setMapFailed] = useState(false);

  async function locate() {
    if (status === "asking") return; // aria-disabled (not disabled) keeps focus, so ignore clicks here
    setStatus("asking");
    const found = await requestLocation();
    setHere(found ?? undefined);
    setStatus(found ? "found" : "unavailable");
  }

  function toggle(id: string) {
    setJustMarked(nextJustMarked(id, toggleTried(id)));
  }

  function clear() {
    // Only forget the just-marked place if the marks really were cleared.
    if (clearTried()) setJustMarked(null);
  }

  // Memoised so `pins` below only changes (and the map only updates) when an input changes.
  const near = useMemo(
    () => (here ? { count: countNear(openings, here), radiusMi: NEAR_RADIUS_MI } : undefined),
    [openings, here],
  );
  const brief = useMemo(
    () => todayBrief({ openings, openingSoon, metrics, here, near }),
    [openings, openingSoon, metrics, here, near],
  );
  // Cards and numbered pins: the last answer's picks; none before the first question.
  const picks = answerPicks ?? NO_PICKS;
  const pins = useMemo(
    () => {
      // The cards' places take the numbered pins, in card order.
      return toPins(openings, { topIds: new Set(picks.map((p) => p.id)), here, openingSoon });
    },
    [openings, picks, here, openingSoon],
  );
  const everyPlace = useMemo(() => allPlaces(openings, { here, tried }), [openings, here, tried]);

  const soon = useMemo(() => rankOpeningSoon(openingSoon, here), [openingSoon, here]);
  const focus = useMemo(() => resolveFocus(focused, openings, openingSoon), [focused, openings, openingSoon]);
  const cardById = useMemo(() => {
    const m = new Map<string, PickCard>(everyPlace.map((o) => [o.restaurant_id, { place: o, facts: openingFacts(o) }]));
    for (const s of soon) {
      const place = { name: s.trade_name, category: "restaurant" as const, latitude: s.latitude, longitude: s.longitude };
      m.set(s.notice_id, { place, facts: openingSoonFacts(s) });
    }
    return m;
  }, [everyPlace, soon]);
  const focusedId = focus?.id ?? null;
  const showFromList = (id: string) => setFocused((now) => nextFocus(now, { id, from: "list" }));
  const showFromMap = (id: string | null) => setFocused((now) => nextFocus(now, id ? { id, from: "map" } : null));
  const onShow = mapFailed ? undefined : showFromList;
  /** Text as is; a place name as a button that shows it on the map (plain text without a pin). */
  function briefPart(part: BriefPart, key: number) {
    if (typeof part === "string") return part;
    const card = cardById.get(part.id);
    // No pin (or no map): plain bold, without PlaceName's "no fixed spot" note mid-sentence.
    if (!card || !onShow || offMapNote(card.place)) return <strong key={key}>{part.name}</strong>;
    return (
      <strong key={key}>
        <PlaceName place={card.place} onShow={onShow && (() => onShow(part.id))} />
      </strong>
    );
  }

  function mapUnavailable() {
    setMapFailed(true);
    setFocused(null);
  }

  // Escape clears the focused place (popup and highlight). Listens only while something is
  // focused; Escape typed in a text field is left to the field.
  useEffect(() => {
    if (!focusedId) return;
    function onKey(e: KeyboardEvent) {
      const el = e.target instanceof Element ? e.target : null;
      const typing = el?.closest("input, textarea, select, [contenteditable='true']");
      if (e.key !== "Escape" || e.defaultPrevented || typing) return;
      setFocused(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusedId]);

  // The question bar is the whole interface: brief or answer under it, the map behind it.
  return (
    <>
      <OpeningsMap pins={pins} focus={focus} onFocus={showFromMap} onUnavailable={mapUnavailable} />
      <div className="panels">
        <AskBar
          onAsk={(question) => askQuestion({ question, here, tried })}
          intro={brief.sentences.map((sentence, i) => (
            <p key={i}>{sentence.map((part, j) => briefPart(part, j))}</p>
          ))}
          chips={brief.chips}
          location={{ status, onLocate: locate }}
          onPicks={setAnswerPicks}
        >
          <AnswerPicks
            picks={picks}
            cards={cardById}
            tried={tried}
            onToggleTried={toggle}
            onShow={onShow}
            focusedId={focusedId}
          />
          <HiddenTried count={hiddenCount(openings, tried, justMarked)} onClear={clear} />
        </AskBar>
      </div>
    </>
  );
}
