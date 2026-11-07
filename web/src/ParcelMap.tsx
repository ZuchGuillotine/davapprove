import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Json } from "./types";
export default function ParcelMap({
  parcel,
  envelope,
  sample,
}: {
  parcel: Json;
  envelope?: Json;
  sample: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!host.current || sample) return;
    let map: maplibregl.Map | undefined;
    try {
      const raw = parcel.geometry;
      const geometry = raw?.type === "Feature" ? raw.geometry : raw;
      map = new maplibregl.Map({
        container: host.current,
        style: {
          version: 8,
          sources: sample
            ? {}
            : {
                osm: {
                  type: "raster",
                  tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                  tileSize: 256,
                  attribution:
                    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                },
              },
          layers: [
            {
              id: "base",
              type: "background",
              paint: { "background-color": "#e7ece4" },
            },
            ...(sample
              ? []
              : [
                  {
                    id: "osm",
                    type: "raster" as const,
                    source: "osm",
                    paint: {
                      "raster-opacity": 0.65,
                      "raster-saturation": -0.75,
                    },
                  },
                ]),
          ],
        },
        center: [-122.646, 47.748],
        zoom: 14,
        attributionControl: { compact: true },
      });
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );
      map.on("error", () => setError(true));
      map.on("load", () => {
        if (!map || !geometry) return;
        const feature = { type: "Feature" as const, properties: {}, geometry };
        map.addSource("parcel", { type: "geojson", data: feature as any });
        map.addLayer({
          id: "parcel-fill",
          type: "fill",
          source: "parcel",
          paint: { "fill-color": "#4c8973", "fill-opacity": 0.16 },
        });
        map.addLayer({
          id: "parcel-line",
          type: "line",
          source: "parcel",
          paint: {
            "line-color": "#286653",
            "line-width": 3,
            "line-dasharray": [3, 2],
          },
        });
        const coordinates: number[][] = [];
        function walk(a: any) {
          if (Array.isArray(a) && typeof a[0] === "number") coordinates.push(a);
          else if (Array.isArray(a)) a.forEach(walk);
        }
        walk(geometry.coordinates);
        if (coordinates.length) {
          const b = new maplibregl.LngLatBounds();
          coordinates.forEach((c) => b.extend([c[0], c[1]]));
          map.fitBounds(b, { padding: 65, maxZoom: 18, duration: 0 });
        }
        if (envelope?.geometry) {
          map.addSource("envelope", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: envelope.geometry,
            } as any,
          });
          map.addLayer({
            id: "envelope-fill",
            type: "fill",
            source: "envelope",
            paint: { "fill-color": "#dda95b", "fill-opacity": 0.35 },
          });
        }
      });
    } catch {
      setError(true);
    }
    return () => map?.remove();
  }, [parcel.geometry, envelope?.geometry, sample]);
  return (
    <div className="map-wrap">
      <div className="map" ref={host} aria-label="Parcel boundary map" />
      {(sample || error) && (
        <GeometryFallback parcel={parcel} envelope={envelope} />
      )}
      <div className="map-caption">
        <i />
        {sample
          ? "Illustrative parcel boundary"
          : "Public GIS boundary · approximate"}
      </div>
      {error && (
        <div className="map-error">
          Basemap unavailable · showing parcel geometry without a basemap.
        </div>
      )}
      <div className="map-north">N ↑</div>
    </div>
  );
}

function GeometryFallback({
  parcel,
  envelope,
}: {
  parcel: Json;
  envelope?: Json;
}) {
  const geometry =
    parcel.geometry?.type === "Feature"
      ? parcel.geometry.geometry
      : parcel.geometry;
  const coordinates: number[][] = [];
  function walk(a: any) {
    if (Array.isArray(a) && typeof a[0] === "number") coordinates.push(a);
    else if (Array.isArray(a)) a.forEach(walk);
  }
  walk(geometry?.coordinates);
  if (!coordinates.length)
    return (
      <div className="geometry-fallback empty">
        <p>No parcel geometry available.</p>
      </div>
    );
  const xs = coordinates.map((c) => c[0]),
    ys = coordinates.map((c) => c[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const factor = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const width = (maxX - minX) * factor || 1,
    height = maxY - minY || 1;
  const scale = Math.min(460 / width, 220 / height);
  const project = (p: number[]) => [
    300 + ((p[0] - minX) * factor - width / 2) * scale,
    155 - (p[1] - minY - height / 2) * scale,
  ];
  const path = (g: any) => {
    const polygons =
      g?.type === "MultiPolygon"
        ? g.coordinates
        : g?.type === "Polygon"
          ? [g.coordinates]
          : [];
    return polygons
      .flatMap((poly: number[][][]) =>
        poly.map(
          (ring) =>
            ring
              .map((c, i) => (i ? "L" : "M") + project(c).join(","))
              .join(" ") + " Z",
        ),
      )
      .join(" ");
  };
  return (
    <svg
      className="geometry-fallback"
      viewBox="0 0 600 310"
      role="img"
      aria-label="Parcel geometry schematic without basemap"
    >
      <defs>
        <pattern
          id="site-grid"
          width="25"
          height="25"
          patternUnits="userSpaceOnUse"
        >
          <path d="M25 0H0V25" fill="none" stroke="#d5dece" strokeWidth=".6" />
        </pattern>
      </defs>
      <rect width="600" height="310" fill="#e9eee2" />
      <rect width="600" height="310" fill="url(#site-grid)" />
      <path
        d={path(geometry)}
        fill="#a5bea073"
        stroke="#57825a"
        strokeWidth="2"
        strokeDasharray="7 4"
        fillRule="evenodd"
      />
      {envelope?.geometry && (
        <path
          d={path(envelope.geometry)}
          fill="#deb86a88"
          stroke="#ad924e"
          strokeWidth="1.5"
          fillRule="evenodd"
        />
      )}
      <text
        x="300"
        y="150"
        textAnchor="middle"
        fill="#6f8964"
        fontSize="10"
        letterSpacing="2"
      >
        PARCEL BOUNDARY
      </text>
      <text x="300" y="170" textAnchor="middle" fill="#8b9e7f" fontSize="8">
        Screening geometry · not a survey
      </text>
    </svg>
  );
}
