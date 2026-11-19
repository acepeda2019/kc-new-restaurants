"use client";

/**
 * The openings map (ARCHITECTURE.md §7). Props in, pixels out: pins come from lib/pins.
 * MapLibre is imported inside the effect, so the server render (and the static HTML) is just
 * the empty map layer behind the panels. Any MapLibre or style failure shows a short note
 * instead; the rest of the page never depends on the map. The legend is MapLegend.
 * A `focus` (a place's name was clicked, or its pin) highlights that pin and opens its popup;
 * from the lists it also moves the camera there.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap, Popup } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { PIN_COLORS } from "@/components/MapLegend";
import { boundsOf, cameraTarget, homeView, popupText, type MapFocus, type PinProps, type Pins } from "@/lib/pins";

// OpenFreeMap: free, no key. Override with any MapLibre style URL.
const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark";
const SOURCE_ID = "openings";
const GROUND = "#0B0E13"; // page background; rank numbers and label halos use it
const LIGHT = "#F2F4F7"; // main text colour; rings and labels use it
const FOCUS_LAYER = `${SOURCE_ID}-focus`;
// Faint glow behind top, wary and you pins (the colour at low opacity).
const HALO = { top: "rgba(212,247,90,.18)", wary: "rgba(255,138,61,.18)", you: "rgba(90,169,255,.2)" };

// Panels float over the map from this width (keep in step with the 1100px media query in
// globals.css); below it the map sits above the bottom sheet.
const FLOATING = "(min-width: 1100px)";
const media = (query: string) => window.matchMedia(query).matches;
const reducedMotion = () => media("(prefers-reduced-motion: reduce)");

// Keep pins in the part of the map nothing covers: between the floating panels on wide
// screens, under the header pills otherwise. Read at camera time, so it follows resizes.
function viewPadding() {
  return media(FLOATING)
    ? { top: 330, bottom: 72, left: 48, right: 48 } // the bar and brief sit centred at the top
    : { top: 72, bottom: 24, left: 24, right: 24 };
}

type Props = {
  pins: Pins;
  /** The place to show; `from: "list"` also flies there (a pin click leaves the camera alone). */
  focus: MapFocus | null;
  /** A pin was clicked (its id), or the focused popup was closed (null). */
  onFocus: (id: string | null) => void;
  /** The map could not load; nothing can be shown on it from now on. */
  onUnavailable: () => void;
};

export function OpeningsMap({ pins, focus, onFocus, onUnavailable }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupClass = useRef<typeof Popup | null>(null);
  const focusPopup = useRef<Popup | null>(null);
  const loaded = useRef(false);
  const latestPins = useRef(pins);
  const latestFocus = useRef(focus);
  const latestOnFocus = useRef(onFocus);
  const latestOnUnavailable = useRef(onUnavailable);
  const lastCentered = useRef<[number, number] | null>(null);
  const [failed, setFailed] = useState(false);

  // A new location moves the camera onto the visitor once; nothing else moves it.
  function recenter(map: MapLibreMap) {
    const target = cameraTarget(latestPins.current, lastCentered.current);
    if (!target) return;
    lastCentered.current = target.center;
    map.easeTo({ ...target, padding: viewPadding() });
  }

  // Back to the starting view (SAN-53), closing any popup.
  function resetView() {
    const map = mapRef.current;
    if (!map) return;
    latestOnFocus.current(null);
    const view = homeView(latestPins.current);
    const animate = !reducedMotion();
    // flyTo/easeTo keep their padding on the map, and fitBounds adds its own on top of it,
    // which would squeeze the pins into a corner; start from none.
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    if ("bounds" in view) map.fitBounds(view.bounds, { padding: viewPadding(), maxZoom: 14, animate });
    else map.easeTo({ ...view, padding: viewPadding(), duration: animate ? 600 : 0 });
  }

  // Ring the focused pin and open its popup; from the lists, also fly there (and on phones
  // scroll back up to the map). Needs the layers, so before "load" it waits for setup.
  function showFocus(map: MapLibreMap) {
    const f = latestFocus.current;
    map.setFilter(FOCUS_LAYER, ["==", ["get", "id"], f?.id ?? ""]);
    const old = focusPopup.current;
    focusPopup.current = null; // first, so its "close" below doesn't clear the new focus
    old?.remove();
    const pin = f && latestPins.current.features.find((p) => p.properties.id === f.id);
    if (!f || !pin || !popupClass.current) return;
    if (f.from === "list") {
      const camera = { center: f.center, zoom: f.zoom, padding: viewPadding() };
      if (reducedMotion()) map.jumpTo(camera);
      else map.flyTo(camera);
      if (!media(FLOATING)) window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    }
    // closeOnClick off: a click on another pin must replace this focus, not clear it.
    const popup = new popupClass.current({ closeOnClick: false, focusAfterOpen: false, offset: 18 })
      .setLngLat(f.center)
      .setText(popupText(pin.properties)); // a text node: names and reasons are data, never HTML
    popup.on("close", () => {
      if (focusPopup.current !== popup) return; // replaced, not closed by the visitor
      focusPopup.current = null;
      latestOnFocus.current(null);
    });
    focusPopup.current = popup;
    popup.addTo(map);
  }

  useEffect(() => {
    latestOnFocus.current = onFocus;
    latestOnUnavailable.current = onUnavailable;
  }, [onFocus, onUnavailable]);

  // New top 3 or location: swap the data in place rather than rebuilding the map.
  useEffect(() => {
    latestPins.current = pins;
    const map = mapRef.current;
    if (!map) return; // not built yet: setup reads latestPins
    map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(pins).catch(() => {}); // a failed update keeps the old pins
    recenter(map);
  }, [pins]);

  useEffect(() => {
    latestFocus.current = focus;
    const map = mapRef.current;
    if (map && loaded.current) showFocus(map);
  }, [focus]);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let cancelled = false;
    let styleLoaded = false;
    const fail = () => {
      if (styleLoaded || cancelled) return;
      map?.remove(); // its box is about to be replaced by the note
      mapRef.current = null;
      setFailed(true);
      latestOnUnavailable.current();
    };

    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !box.current) return;
        // The bundler moves MapLibre's code, so tell it where its worker file ended up.
        maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
        popupClass.current = maplibre.Popup;
        map = new maplibre.Map({
          container: box.current,
          style: STYLE_URL,
          bounds: boundsOf(latestPins.current.features),
          fitBoundsOptions: { padding: viewPadding(), maxZoom: 14 },
          attributionControl: { compact: false }, // OpenStreetMap / OpenFreeMap credit stays visible
        });
        mapRef.current = map;
        recenter(map); // the location may have arrived while MapLibre was downloading
        // Before the style loads, an error means no usable map (style or worker failed);
        // after, it is one tile, even during first paint, and the map stays.
        map.on("error", fail);
        map.on("style.load", () => {
          styleLoaded = true;
        });
        map.on("load", () => {
          map!.addSource(SOURCE_ID, { type: "geojson", data: latestPins.current });
          map!.addLayer({
            id: `${SOURCE_ID}-halo`,
            type: "circle",
            source: SOURCE_ID,
            filter: ["!", ["in", ["get", "kind"], ["literal", ["new", "soon"]]]],
            paint: {
              "circle-color": ["match", ["get", "kind"], "top", HALO.top, "you", HALO.you, HALO.wary],
              "circle-radius": ["match", ["get", "kind"], "top", 22, "you", 16, 11],
            },
          });
          map!.addLayer({
            id: SOURCE_ID,
            type: "circle",
            source: SOURCE_ID,
            // The top 3 stand out by more than colour: bigger, numbered, drawn on top.
            layout: { "circle-sort-key": ["match", ["get", "kind"], "top", 3, "you", 2, "wary", 1, 0] },
            paint: {
              "circle-color": [
                "match", ["get", "kind"],
                "top", PIN_COLORS.top, "wary", PIN_COLORS.wary, "you", PIN_COLORS.you,
                "soon", PIN_COLORS.soon, PIN_COLORS.new,
              ],
              // Opening soon pins are hollow rings: not open yet, told apart by shape, not colour.
              "circle-opacity": ["match", ["get", "kind"], "soon", 0, 1],
              "circle-radius": ["match", ["get", "kind"], "top", 14, "you", 7, "wary", 6.5, "soon", 6, 5],
              // Wary pins get a light ring (and are bigger) so they differ from new ones by more
              // than colour; a dark ring would vanish on the dark map.
              "circle-stroke-color": ["match", ["get", "kind"], "wary", LIGHT, "soon", PIN_COLORS.soon, GROUND],
              "circle-stroke-width": ["match", ["get", "kind"], "you", 3, "wary", 2, "top", 2, "soon", 2.5, 1],
            },
          });
          // A light ring around the focused pin; the filter is set by showFocus.
          map!.addLayer({
            id: FOCUS_LAYER,
            type: "circle",
            source: SOURCE_ID,
            filter: ["==", ["get", "id"], ""],
            paint: {
              "circle-opacity": 0,
              "circle-radius": ["match", ["get", "kind"], "top", 19, 11],
              "circle-stroke-color": LIGHT,
              "circle-stroke-width": 3,
            },
          });
          // The card's number (1-3) on each top pin, in the dark ground colour.
          map!.addLayer({
            id: `${SOURCE_ID}-rank`,
            type: "symbol",
            source: SOURCE_ID,
            filter: ["==", ["get", "kind"], "top"],
            layout: {
              "text-field": ["to-string", ["get", "rank"]],
              "text-font": ["Noto Sans Bold"], // a font OpenFreeMap serves glyphs for
              "text-size": 14,
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: { "text-color": GROUND },
          });
          // The name beside each numbered pin, so the top 3 read at a glance.
          map!.addLayer({
            id: `${SOURCE_ID}-label`,
            type: "symbol",
            source: SOURCE_ID,
            filter: ["==", ["get", "kind"], "top"],
            layout: {
              "text-field": ["get", "label"],
              "text-font": ["Noto Sans Bold"],
              "text-size": 13,
              "text-anchor": "left",
              "text-offset": [1.8, 0], // ems: clear of the pin and its focus ring
              "text-allow-overlap": true,
            },
            paint: { "text-color": LIGHT, "text-halo-color": GROUND, "text-halo-width": 2 },
          });
          loaded.current = true;
          showFocus(map!); // a name may have been clicked while the map loaded
        });
        // Hovering a pin names it (mouse only; touch has no hover).
        const hover = new maplibre.Popup({ closeButton: false, closeOnClick: false, className: "pin-hover", offset: 12 });
        map.on("click", SOURCE_ID, (e) => {
          hover.remove(); // the click's own popup replaces it
          const props = e.features?.[0]?.properties as PinProps | undefined;
          if (!props || !map) return;
          if (props.kind === "you") {
            new maplibre.Popup().setLngLat(e.lngLat).setText(popupText(props)).addTo(map);
            return;
          }
          latestOnFocus.current(props.id); // comes back as `focus`, which opens the popup
        });
        map.on("mousemove", SOURCE_ID, (e) => {
          const f = e.features?.[0];
          if (!f || f.geometry.type !== "Point" || !map || !media("(hover: hover) and (pointer: fine)")) return;
          map.getCanvas().style.cursor = "pointer";
          const props = f.properties as PinProps;
          // The focused pin already has its popup open; don't stack a second one on it.
          if (props.id === latestFocus.current?.id) {
            hover.remove();
            return;
          }
          const [lon, lat] = f.geometry.coordinates;
          hover.setLngLat([lon, lat]).setText(props.name);
          if (!hover.isOpen()) hover.addTo(map);
        });
        map.on("mouseleave", SOURCE_ID, () => {
          map!.getCanvas().style.cursor = "";
          hover.remove();
        });
      } catch {
        fail(); // import failed or no WebGL
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="map-layer">
      {failed ? (
        <p className="pill map-unavailable" role="status">
          Map unavailable. The question bar still works.
        </p>
      ) : (
        <>
          <div ref={box} className="map-box" role="region" aria-label="Map of new openings" />
          <button type="button" className="map-reset" onClick={resetView} title="Reset map view">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
            <span className="sr-only">Reset map view</span>
          </button>
        </>
      )}
    </div>
  );
}
