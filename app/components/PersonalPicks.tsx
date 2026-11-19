"use client";

/**
 * Browser-only state for the home page: the visitor's location (asked on click, never sent
 * anywhere) and "Tried it" marks (localStorage). Ranking and counting come from lib/rank, pins
 * from lib/pins; Metrics, OpeningsMap and TopThree stay presentational. The first render has no location and nothing
 * tried (the server snapshot), so it matches the static HTML; stored marks apply after hydration.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AllPlaces } from "@/components/AllPlaces";
import { AnswerPicks, type PickCard } from "@/components/AnswerPicks";
import type { AnswerPick } from "@/lib/ask";
import { openingFacts, openingSoonFacts } from "@/lib/format";
import { AskBar } from "@/components/AskBar";
import { FoodTrucks } from "@/components/FoodTrucks";
import { HiddenTried } from "@/components/HiddenTried";
import { Metrics } from "@/components/Metrics";
import { OpeningSoonPanel } from "@/components/OpeningSoonPanel";
import { OpeningsMap } from "@/components/OpeningsMap";
import { TopThree } from "@/components/TopThree";
import type { Metrics as MetricsData, Opening, OpeningSoon } from "@/lib/data";
import { askQuestion } from "@/lib/askClient";
import { requestLocation } from "@/lib/location";
import { nextFocus, resolveFocus, toPins, trucksOf, type FocusRequest } from "@/lib/pins";
import { NEAR_RADIUS_MI, allPlaces, countNear, personalTopThree, rankOpeningSoon, type LatLon } from "@/lib/rank";
import {
  clearTried,
  hiddenCount,
  hiddenFromTop,
  nextJustMarked,
  subscribeTried,
  toggleTried,
  triedSnapshot,
} from "@/lib/tried";

type Props = { openings: Opening[]; metrics: MetricsData; openingSoon: OpeningSoon[] };
type LocationStatus = "idle" | "asking" | "found" | "unavailable";

const NOTHING_TRIED = new Set<string>();
const serverSnapshot = () => NOTHING_TRIED;
const browserSnapshot = () => triedSnapshot();

export function PersonalPicks({ openings, metrics, openingSoon }: Props) {
  const [here, setHere] = useState<LatLon | undefined>(undefined);
  const [status, setStatus] = useState<LocationStatus>("idle");
  const tried = useSyncExternalStore(subscribeTried, browserSnapshot, serverSnapshot);
  // The place just marked stays on screen (button pressed) so it can be undone in place.
  const [justMarked, setJustMarked] = useState<string | null>(null);
  // The last answer's picks: shown as cards and numbered on the map.
  const [picks, setPicks] = useState<AnswerPick[]>([]);
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
  const top = useMemo(
    () => personalTopThree(openings, { here, tried: hiddenFromTop(tried, justMarked) }),
    [openings, here, tried, justMarked],
  );
  const near = here ? { count: countNear(openings, here), radiusMi: NEAR_RADIUS_MI } : undefined;
  const pins = useMemo(
    () => {
      // An answer's picks take over the numbered pins (in card order); otherwise the top 3.
      const ids = picks.length ? picks.map((p) => p.id) : top.map((o) => o.restaurant_id);
      return toPins(openings, { topIds: new Set(ids), here, openingSoon });
    },
    [openings, top, picks, here, openingSoon],
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

  // DOM order is the phone order (question bar, stats, top 3, lists); on wide screens CSS places them around the map.
  return (
    <>
      <OpeningsMap pins={pins} focus={focus} onFocus={showFromMap} onUnavailable={mapUnavailable} />
      <div className="panels">
        <AskBar onAsk={(question) => askQuestion({ question, here, tried })} onPicks={setPicks}>
          <AnswerPicks
            picks={picks}
            cards={cardById}
            tried={tried}
            onToggleTried={toggle}
            onShow={onShow}
            focusedId={focusedId}
          />
        </AskBar>
        <Metrics metrics={metrics} near={near} />

        <section aria-labelledby="top-three" className="panel picks">
          <div className="panel-head">
            <h2 id="top-three">Your top 3 to try</h2>
            <button type="button" className="secondary" onClick={locate} aria-disabled={status === "asking"}>
              {status === "asking" ? "Finding you…" : "Use my location"}
            </button>
          </div>
          <p role="status" className="locate-status">
            {status === "unavailable" && "Location unavailable — showing default order"}
            {status === "found" && "Ranked by score and distance from you"}
          </p>
          <TopThree items={top} tried={tried} onToggleTried={toggle} onShow={onShow} focusedId={focusedId} />
          <HiddenTried count={hiddenCount(openings, tried, justMarked)} onClear={clear} />
        </section>

        <OpeningSoonPanel items={soon} onShow={onShow} focusedId={focusedId} />

        <section aria-labelledby="map-heading" className="panel places">
          <h2 id="map-heading">All places</h2>
          <FoodTrucks trucks={trucksOf(openings)} />
          <AllPlaces items={everyPlace} onShow={onShow} focusedId={focusedId} />
        </section>
      </div>
    </>
  );
}
