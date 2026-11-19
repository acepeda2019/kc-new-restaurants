"use client";

/**
 * The openings map (ARCHITECTURE.md §7). Props in, pixels out: pins come from lib/pins.
 * MapLibre is imported inside the effect, so the server render (and the static HTML) is just
 * the fixed-height box and the legend. Any MapLibre or style failure shows a short note
 * instead; the rest of the page never depends on the map.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { boundsOf, popupText, type PinKind, type PinProps, type Pins } from "@/lib/pins";

// OpenFreeMap: free, no key. Override with any MapLibre style URL.
const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";
const SOURCE_ID = "openings";

const LEGEND: { kind: PinKind; color: string; label: string }[] = [
  { kind: "top", color: "#6a1b9a", label: "Your top 3" },
  { kind: "new", color: "#00796b", label: "Other new places" },
  { kind: "wary", color: "#c62828", label: "Red points at latest inspection" },
  { kind: "you", color: "#1a1a1a", label: "You" },
];
const colorOf = (kind: PinKind) => LEGEND.find((l) => l.kind === kind)!.color;

type Props = { pins: Pins };

export function OpeningsMap({ pins }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latestPins = useRef(pins);
  const [failed, setFailed] = useState(false);

  // New top 3 or location: swap the data in place rather than rebuilding the map.
  useEffect(() => {
    latestPins.current = pins;
    const source = mapRef.current?.getSource<GeoJSONSource>(SOURCE_ID);
    source?.setData(pins).catch(() => {}); // a failed update keeps the old pins; nothing to tell the visitor
  }, [pins]);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let cancelled = false;
    let loaded = false;
    const fail = () => {
      if (loaded || cancelled) return;
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
          fitBoundsOptions: { padding: 32, maxZoom: 14 },
          attributionControl: { compact: false }, // OpenStreetMap / OpenFreeMap credit stays visible
        });
        mapRef.current = map;
        // Before "load", an error means no usable map (style or worker failed); after, it is one tile.
        map.on("error", fail);
        map.on("load", () => {
          loaded = true;
          map!.addSource(SOURCE_ID, { type: "geojson", data: latestPins.current });
          map!.addLayer({
            id: SOURCE_ID,
            type: "circle",
            source: SOURCE_ID,
            // The top 3 stand out by more than colour: bigger, thicker white outline, drawn on top.
            layout: { "circle-sort-key": ["match", ["get", "kind"], "top", 3, "you", 2, "wary", 1, 0] },
            paint: {
              "circle-color": [
                "match", ["get", "kind"],
                "top", colorOf("top"), "wary", colorOf("wary"), "you", colorOf("you"),
                colorOf("new"),
              ],
              "circle-radius": ["match", ["get", "kind"], "top", 11, "you", 7, 6],
              "circle-stroke-color": "#fff",
              "circle-stroke-width": ["match", ["get", "kind"], "top", 3, 1.5],
            },
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
    <figure className="openings-map">
      {failed ? (
        <p className="map-unavailable" role="status">
          Map unavailable. The lists below still work.
        </p>
      ) : (
        <div ref={box} className="map-box" role="region" aria-label="Map of new openings" />
      )}
      <figcaption>
        <ul className="map-legend">
          {LEGEND.map((l) => (
            <li key={l.kind}>
              <span className={`swatch ${l.kind}`} style={{ background: l.color }} aria-hidden="true" />
              {l.label}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
