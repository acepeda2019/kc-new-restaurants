"use client";

/**
 * The openings map (ARCHITECTURE.md §7). Props in, pixels out: pins come from lib/pins.
 * MapLibre is imported inside the effect, so the server render (and the static HTML) is just
 * the empty map layer behind the panels. Any MapLibre or style failure shows a short note
 * instead; the rest of the page never depends on the map. The legend is MapLegend.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { PIN_COLORS } from "@/components/MapLegend";
import { boundsOf, cameraTarget, popupText, type PinProps, type Pins } from "@/lib/pins";

// OpenFreeMap: free, no key. Override with any MapLibre style URL.
const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark";
const SOURCE_ID = "openings";
const GROUND = "#0B0E13"; // page background; dark rings and rank numbers use it
// Faint glow behind top, wary and you pins (the colour at low opacity).
const HALO = { top: "rgba(212,247,90,.18)", wary: "rgba(255,138,61,.18)", you: "rgba(90,169,255,.2)" };

// Keep pins clear of the floating panels: on wide screens they cover the left and right edges.
function fitPadding() {
  return window.innerWidth >= 1100
    ? { top: 96, bottom: 72, left: 440, right: 280 }
    : { top: 72, bottom: 24, left: 24, right: 24 };
}

type Props = { pins: Pins };

export function OpeningsMap({ pins }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latestPins = useRef(pins);
  const lastCentered = useRef<[number, number] | null>(null);
  const [failed, setFailed] = useState(false);

  // A new location moves the camera onto the visitor once; nothing else moves it.
  function recenter(map: MapLibreMap) {
    const target = cameraTarget(latestPins.current, lastCentered.current);
    if (!target) return;
    lastCentered.current = target.center;
    map.easeTo(target);
  }

  // New top 3 or location: swap the data in place rather than rebuilding the map.
  useEffect(() => {
    latestPins.current = pins;
    const map = mapRef.current;
    if (!map) return; // not built yet: setup reads latestPins
    map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(pins).catch(() => {}); // a failed update keeps the old pins
    recenter(map);
  }, [pins]);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let cancelled = false;
    let styleLoaded = false;
    const fail = () => {
      if (styleLoaded || cancelled) return;
      map?.remove(); // its box is about to be replaced by the note
      mapRef.current = null;
      setFailed(true);
    };

    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !box.current) return;
        // The bundler moves MapLibre's code, so tell it where its worker file ended up.
        maplibre.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
        map = new maplibre.Map({
          container: box.current,
          style: STYLE_URL,
          bounds: boundsOf(latestPins.current.features),
          fitBoundsOptions: { padding: fitPadding(), maxZoom: 14 },
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
            filter: ["!=", ["get", "kind"], "new"],
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
                PIN_COLORS.new,
              ],
              "circle-radius": ["match", ["get", "kind"], "top", 14, "you", 7, "wary", 6.5, 5],
              // Wary pins keep a thick dark ring so they differ by more than colour too.
              "circle-stroke-color": GROUND,
              "circle-stroke-width": ["match", ["get", "kind"], "you", 3, "wary", 2.5, "top", 2, 1],
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
        });
        map.on("click", SOURCE_ID, (e) => {
          const props = e.features?.[0]?.properties as PinProps | undefined;
          if (!props || !map) return;
          // setText writes a text node: names and reasons are data, never HTML.
          new maplibre.Popup().setLngLat(e.lngLat).setText(popupText(props)).addTo(map);
        });
        map.on("mouseenter", SOURCE_ID, () => (map!.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", SOURCE_ID, () => (map!.getCanvas().style.cursor = ""));
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
          Map unavailable. The lists still work.
        </p>
      ) : (
        <div ref={box} className="map-box" role="region" aria-label="Map of new openings" />
      )}
    </div>
  );
}
