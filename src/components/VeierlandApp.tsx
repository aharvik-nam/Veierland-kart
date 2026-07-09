import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, Marker, Polyline, GeoJSON, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { loadAllPOIs } from '../data/veierland';
import { loadTurkartGeoJSON } from '../lib/geodata';
import boundaryData from '../data/veierland_boundary.json';
import 'leaflet.markercluster';
import { POI, SNLData, LokalhistorieData, MuseumPhoto, WikimediaImage, WikipediaData } from '../lib/types';
import { fetchSNL, fetchLokalhistorie, fetchDigitalMuseum, fetchWikimediaImages, fetchWikipediaSpecies } from '../lib/api';
import { loadCatCfg, DEFAULT_CAT_CFG, CatCfgMap } from '../lib/catcfg';
import { NATURE_GROUPS, NatureGroup, NatureObs, GBIF_POLYGON, STATIC_NATURE_CACHE, loadNatureObs, applyAssessments } from '../lib/naturedata';
import { loadFarmData, DEFAULT_FARM_DATA, Farm } from '../lib/farmdata';
import { loadTimelineSections, DEFAULT_TIMELINE_SECTIONS, TimelineSection } from '../lib/timelinedata';
import { ICONS } from '../lib/icons';
import floodData from '../data/sea_level_flood.geojson';
import { fetchFerryDepartures, fetchQuaySailings, nearestQuay, FerryBoard, FERRY_QUAYS, fmtDepTime, minsUntil } from '../lib/ferrydata';
import {
  hasDomGrid, sunPosition, sunlitAt, shelterAt,
  makeSunShadowOverlay, makeShelterOverlay, makeEffectiveTempOverlay,
  fetchWeatherNow, fetchSeaTemp, WeatherNow, windDirLabel, weatherIconKind, WeatherIconKind,
  windColor, ORKAN_MS, effectiveTemp, effectiveTempColor,
  rankBeaches, dailyRecommendation, BeachConditionScore,
} from '../lib/conditions';
import losmassData from '../data/losmasser.geojson';
import berggrunData from '../data/berggrunn.geojson';
import { networkWalkDistanceM, networkWalkRoute } from '../lib/routing';

// ─── Layer configs ────────────────────────────────────────────────────────────

interface LayerCfg {
  label: { no: string; en: string };
  sw: string;
  url: string;
  opts: Record<string, unknown>;
  filter: string;
  wms?: boolean;
  wmsLayers?: string;
}

const LAYERS: Record<string, LayerCfg> = {
  soleng: {
    label: { no: 'Lyst', en: 'Light' },
    sw: 'linear-gradient(135deg,#f3f4f1,#e3e5df)',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    opts: { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap · © CARTO' },
    filter: 'none',
  },
  friluft: {
    label: { no: 'Friluft', en: 'Outdoor' },
    sw: 'repeating-linear-gradient(125deg,#e0ebc8,#e0ebc8 4px,#cfe0af 4px,#cfe0af 8px)',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
    opts: { maxZoom: 18, attribution: '© Kartverket' },
    filter: 'saturate(1.05) brightness(1.01)',
  },
  flyfoto: {
    label: { no: 'Flyfoto', en: 'Satellite' },
    sw: 'linear-gradient(135deg,#39563d,#73824f)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 18, attribution: '© Esri · Maxar' },
    filter: 'none',
  },
  historisk: {
    label: { no: 'Historisk', en: 'Historic' },
    sw: 'linear-gradient(135deg,#e8dfc8,#c8b89a)',
    url: 'https://wms.geonorge.no/skwms1/wms.historiskekart',
    wms: true,
    wmsLayers: 'historiskekart',
    opts: { maxZoom: 16, attribution: '© Kartverket' },
    filter: 'sepia(.4) contrast(1.1) brightness(1.05)',
  },
};
const LAYER_ORDER = ['soleng', 'friluft', 'flyfoto', 'historisk'] as const;

interface GeoLayerCfg {
  label: { no: string; en: string };
  sw: string;
  noDataMsg: { no: string; en: string };
}
const GEO_LAYERS: Record<string, GeoLayerCfg> = {
  losmasse: {
    label: { no: 'Løsmasser', en: 'Surface deposits' },
    sw: 'linear-gradient(135deg,#c8a05a,#a8c870)',
    noDataMsg: { no: 'Kjør generate_geology.py', en: 'Run generate_geology.py' },
  },
  berggrunn: {
    label: { no: 'Berggrunn', en: 'Bedrock' },
    sw: 'linear-gradient(135deg,#9a6aaa,#6a8aaa)',
    noDataMsg: { no: 'Kjør generate_geology.py', en: 'Run generate_geology.py' },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GEO_DATA: Record<string, any> = {
  losmasse: losmassData,
  berggrunn: berggrunData,
};

// NGU source colors that conflict with the blue sea-level flood overlay → remapped to
// visually distinct equivalents while preserving geological meaning.
const GEO_COLOR_REMAP: Record<string, string> = {
  '#4a90d9': '#c8a050',  // Marin strandavsetning: blue→sandy gold (same hue as flood overlay)
  '#b0b0b0': '#a8b0a0',  // Bart fjell: neutral gray→cool greenish gray
};

function geoStyle(feature?: { properties?: { color?: string } }): L.PathOptions {
  const src = feature?.properties?.color ?? '#cccccc';
  return {
    fillColor: GEO_COLOR_REMAP[src] ?? src,
    fillOpacity: 0.62,
    color: '#222',
    weight: 1.5,
    opacity: 0.75,
  };
}


function geoOnEach(feature: { properties?: { type_no?: string; label?: string } }, layer: L.Layer) {
  const name = feature?.properties?.label ?? feature?.properties?.type_no;
  if (name) (layer as L.Path).bindTooltip(name, { sticky: true, className: 'vl-geo-tip' });
}

// ─── Category configs ─────────────────────────────────────────────────────────

// CatCfg types live in src/lib/catcfg.ts; CAT_CFG is loaded dynamically from Firestore

// ICONS are imported from src/lib/icons.ts

// ─── Nature (Artsdatabanken) ──────────────────────────────────────────────────

const RED_LIST_CATS = /^(NT|VU|EN|CR|RE|DD)$/;

// Severity order for sorting highlights: most threatened first
const RL_RANK: Record<string, number> = { CR: 0, RE: 1, EN: 2, VU: 3, NT: 4, DD: 5 };

const RL_LABEL: Record<string, string> = {
  NT: 'Nær truet (NT)', VU: 'Sårbar (VU)', EN: 'Sterkt truet (EN)',
  CR: 'Kritisk truet (CR)', RE: 'Regionalt utdødd (RE)', DD: 'Datamangel (DD)',
};
const RL_DESC: Record<string, string> = {
  NT: 'Arten er nær å oppfylle kriteriene for en truet kategori, og kan bli sårbar dersom negative faktorer fortsetter.',
  VU: 'Arten har høy risiko for å dø ut fra Norge i nær fremtid dersom påvirkningsfaktorene ikke reduseres.',
  EN: 'Arten har svært høy risiko for å dø ut fra Norge og er strengt truet av negative påvirkninger.',
  CR: 'Arten er kritisk truet og har ekstremt høy risiko for å dø ut fra Norge i nær fremtid.',
  RE: 'Arten er trolig utdødd som reproduserende bestand i Norge.',
  DD: 'Det finnes ikke nok data til å vurdere artens risiko for utdøing i Norge.',
};

// ─── History types ────────────────────────────────────────────────────────────

// TimelineSection is imported from ../lib/timelinedata


// Pre-index flood features by threshold so lookup is O(1), not O(n) per render
// Pre-index flood features by threshold so lookup is O(1), not O(n) per render
const FLOOD_BY_THRESHOLD = new Map<number, object>(
  (floodData as any).features?.map((f: any) => [f.properties.threshold_m, f]) ?? []
);

// Derived from the GeoJSON data — automatically picks up new thresholds when the file is regenerated
const FLOOD_THRESHOLDS: number[] = [...FLOOD_BY_THRESHOLD.keys()].sort((a, b) => a - b);

// Returns the largest available threshold ≤ m (or null if none)
function nearestFloodThreshold(m: number): number | null {
  const below = FLOOD_THRESHOLDS.filter(t => t <= m);
  return below.length > 0 ? below[below.length - 1] : null;
}

// Long-range sea level curve for Gårder slider (UIB, NGU, Kartverket sources)
const GARDER_TIMELINE = [
  { year: -12000, label: '12 000 f.Kr.', sea_level_m: 50 },
  { year: -11000, label: '11 000 f.Kr.', sea_level_m: 45 },
  { year: -10000, label: '10 000 f.Kr.', sea_level_m: 40 },
  { year:  -9000, label:  '9 000 f.Kr.', sea_level_m: 35 },
  { year:  -8000, label:  '8 000 f.Kr.', sea_level_m: 30 },
  { year:  -7000, label:  '7 000 f.Kr.', sea_level_m: 22 },
  { year:  -6000, label:  '6 000 f.Kr.', sea_level_m: 15 },
  { year:  -5000, label:  '5 000 f.Kr.', sea_level_m: 12 },
  { year:  -4000, label:  '4 000 f.Kr.', sea_level_m: 10 },
  { year:  -3000, label:  '3 000 f.Kr.', sea_level_m:  8 },
  { year:  -2000, label:  '2 000 f.Kr.', sea_level_m:  5 },
  { year:  -1000, label:  '1 000 f.Kr.', sea_level_m:  3.5 },
  { year:      0, label:       'År 0',   sea_level_m:  3 },
  { year:   1000, label: '1 000 e.Kr.', sea_level_m:  2 },
  { year:   2000, label: '2 000 e.Kr.', sea_level_m:  0 },
  { year:   2026, label:      'I dag',  sea_level_m:  0 },
] as const;

// Historical sea level (metres above today) per era, based on Vestfold land-uplift data

function markerSize(zoom: number): number {
  return Math.round(Math.max(14, Math.min(34, 14 + (zoom - 11) * 5)));
}

function makeIconHtml(icon: string, color: string, selected: boolean, sz: number): string {
  const svgSz = Math.round(sz * 0.59);
  const svg = `<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="${svgSz}" height="${svgSz}">${ICONS[icon] ?? ICONS.wc}</svg>`;
  return `<div class="vl-pin${selected ? ' sel' : ''}" style="--pc:${color};width:${sz}px;height:${sz}px">${svg}</div>`;
}

// Bigger pin with the place name shown directly beneath it, for activity-mode
// map views (e.g. "Bade") where tapping to see a name isn't realistic for
// young or elderly users. Kept separate from makeIconHtml so the hot default
// per-marker render path (called for every POI, every render) stays untouched.
function makeLabeledIconHtml(icon: string, color: string, selected: boolean, sz: number, label: string): string {
  const svgSz = Math.round(sz * 0.55);
  const svg = `<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="${svgSz}" height="${svgSz}">${ICONS[icon] ?? ICONS.wc}</svg>`;
  return `<div class="vl-pin-labeled-wrap"><div class="vl-pin vl-pin-lg${selected ? ' sel' : ''}" style="--pc:${color};width:${sz}px;height:${sz}px">${svg}</div><div class="vl-pin-label">${label}</div></div>`;
}

// Place names (stedsnavn): a plain text label with no icon circle, kept
// visually lighter than real POI pins since it's a map annotation, not a
// tappable place. Only rendered once zoomed in — see STEDSNAVN_MIN_ZOOM.
const STEDSNAVN_MIN_ZOOM = 15;
function makeStedsnavnHtml(name: string, selected: boolean): string {
  return `<div class="vl-stedsnavn${selected ? ' sel' : ''}">${name}</div>`;
}

function iconSvg(icon: string): string {
  return `<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">${ICONS[icon] ?? ICONS.wc}</svg>`;
}

function obsRingClass(obs: NatureObs): string {
  if (obs.redListCategory && RED_LIST_CATS.test(obs.redListCategory)) return ' ring-rl';
  if (obs.alienCategory) return ' ring-al';
  return '';
}

function makeNatureIconHtml(color: string, iconKey: string, selected: boolean, sz: number, dimmed = false, ring = ''): string {
  const svgSz = Math.round(sz * 0.56);
  const svg = `<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="${svgSz}" height="${svgSz}">${ICONS[iconKey] ?? ICONS.blad}</svg>`;
  return `<div class="vl-nat-pin${selected ? ' sel' : ''}${dimmed ? ' dimmed' : ''}${ring}" style="--gc:${color};width:${sz}px;height:${sz}px">${svg}</div>`;
}

// ─── Geo helpers ─────────────────────────────────────────────────────────────

// Minimum distance in meters from point P to a polyline (flat-earth, accurate for short distances)
function pointToPolylineDistM(p: [number, number], poly: [number, number][]): number {
  const R = 6371000 * Math.PI / 180;
  let minDist = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ay, ax] = poly[i], [by, bx] = poly[i + 1];
    const cosLat = Math.cos(((ay + by) / 2) * Math.PI / 180);
    const axm = ax * R * cosLat, aym = ay * R;
    const bxm = bx * R * cosLat, bym = by * R;
    const pxm = p[1] * R * cosLat, pym = p[0] * R;
    const dx = bxm - axm, dy = bym - aym;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pxm - axm) * dx + (pym - aym) * dy) / len2));
    const dist = Math.sqrt((pxm - axm - t * dx) ** 2 + (pym - aym - t * dy) ** 2);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

const TRAIL_CAT_GROUPS: Record<'alle' | 'historie' | 'natur' | 'mat' | 'kultur', { no: string; en: string; cats: string[] | null }> = {
  alle:     { no: 'Alle',        en: 'All',          cats: null },
  historie: { no: 'Historie',    en: 'History',      cats: ['arkeologi', 'hvalfangst'] },
  natur:    { no: 'Natur',       en: 'Nature',       cats: null }, // uses natureObs (GBIF), not POI categories
  mat:      { no: 'Mat & Drikke',en: 'Food & Drink', cats: ['mat'] },
  kultur:   { no: 'Kultur',      en: 'Culture',      cats: ['kultur', 'info', 'ferge', 'havn'] },
};

// ─── Trail data ───────────────────────────────────────────────────────────────

interface TrailMode {
  mode: 'gaa' | 'lop' | 'sykkel';
  tid: string;
}

interface Trail {
  id: string;
  name: string;
  en: string;
  km: string;
  time: string;
  diff: string;
  climb?: string;
  profile?: [number, number][];
  minEl?: number;
  maxEl?: number;
  modes?: TrailMode[];
  no: string;
  enT: string;
  path: [number, number][];
}

function trailsFromGeoJSON(geo: any): Trail[] {
  return (geo as any).features.map((f: any) => ({
    id: f.properties.id,
    name: f.properties.navn,
    en: f.properties.en,
    km: f.properties.km,
    time: f.properties.tid,
    diff: f.properties.vanskelighet,
    climb: f.properties.stigning,
    profile: f.properties.hoydeprofil,
    minEl: f.properties.minHoyde,
    maxEl: f.properties.maxHoyde,
    modes: f.properties.transportmodi,
    no: f.properties.no,
    enT: f.properties.enT,
    path: f.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]),
  }));
}

// ─── Map sub-components ───────────────────────────────────────────────────────

function MapSetup({ onReady, onMapClick, onZoom }: { onReady: (m: L.Map) => void; onMapClick: () => void; onZoom: (z: number) => void }) {
  const map = useMap();
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  useEffect(() => {
    onReady(map);
    const handleClick = () => onMapClickRef.current();
    map.on('click', handleClick);
    const zoomHandler = () => onZoom(map.getZoom());
    map.on('zoomend', zoomHandler);
    return () => { map.off('click', handleClick); map.off('zoomend', zoomHandler); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, onReady, onZoom]);
  return null;
}

function TileController({ layer }: { layer: string }) {
  const map = useMap();
  const tileRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const cfg = LAYERS[layer];
    if (!cfg) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const tile = cfg.wms
      ? L.tileLayer.wms(cfg.url, { layers: cfg.wmsLayers ?? '', format: 'image/png', transparent: false, ...cfg.opts, zIndex: 0 } as L.WMSOptions)
      : L.tileLayer(cfg.url, { ...cfg.opts, zIndex: 0 } as L.TileLayerOptions);
    tile.addTo(map);
    tileRef.current = tile;
    const tp = document.querySelector('.leaflet-tile-pane') as HTMLElement | null;
    if (tp) tp.style.filter = cfg.filter;
    return () => {
      if (tileRef.current) { map.removeLayer(tileRef.current); tileRef.current = null; }
    };
  }, [layer, map]);

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


// ─── SVG icon components ──────────────────────────────────────────────────────

// Small gradient bar used in the sun/wind legend, with a marker at the
// current value's position (0..1) along the scale.
function GradientBar({ stops, posT }: { stops: { r: number; g: number; b: number }[]; posT: number }) {
  const css = stops.map((c, i) => `rgb(${c.r},${c.g},${c.b}) ${(i / (stops.length - 1)) * 100}%`).join(', ');
  const pct = Math.min(1, Math.max(0, posT)) * 100;
  return (
    <div style={{ position: 'relative', height: 10, marginTop: 8, marginBottom: 2 }}>
      <div style={{ height: 8, borderRadius: 999, background: `linear-gradient(to right, ${css})` }} />
      <div style={{
        position: 'absolute', top: -3, left: `${pct}%`, transform: 'translateX(-50%)',
        width: 4, height: 14, borderRadius: 2, background: 'var(--ink)',
        boxShadow: '0 0 0 1.5px #fff',
      }} />
    </div>
  );
}
// Elevation-vs-distance chart for a trail, from the DTM-sampled profile
// (see scripts/generate_running_routes.mjs). [metresFromStart, elevationM][].
function ElevationChart({ profile, minEl, maxEl }: { profile: [number, number][]; minEl: number; maxEl: number }) {
  if (profile.length < 2) return null;
  const W = 300, H = 70, PAD_Y = 8;
  const totalM = profile[profile.length - 1][0];
  const span = Math.max(1, maxEl - minEl);
  const x = (m: number) => (m / totalM) * W;
  const y = (el: number) => PAD_Y + (1 - (el - minEl) / span) * (H - PAD_Y * 2);

  const linePts = profile.map(([m, el]) => `${x(m).toFixed(1)},${y(el).toFixed(1)}`).join(' ');
  const areaPts = `0,${H} ${linePts} ${W},${H}`;

  return (
    <div style={{ margin: '2px 0 14px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
        <polygon points={areaPts} fill="var(--accent)" opacity={0.14} />
        <polyline points={linePts} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
        <span>{Math.round(minEl)} moh</span>
        <span>{(totalM / 1000).toFixed(1)} km</span>
        <span>{Math.round(maxEl)} moh</span>
      </div>
    </div>
  );
}
// Compact sky-condition glyph for the top bar — one of a handful of icon
// buckets (see weatherIconKind()), not the ~50 distinct MET Yr symbols.
function WeatherIcon({ kind, size = 19 }: { kind: WeatherIconKind; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const cloud = <path d="M6 15h11a3.5 3.5 0 0 0 .4-7A6 6 0 0 0 6 10.5A3.5 3.5 0 0 0 6 15z" />;
  switch (kind) {
    case 'clear':
      return <svg {...p}><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" /></svg>;
    case 'partly':
      return <svg {...p}><circle cx="8" cy="8" r="3" /><path d="M8 2.5v1.3M3.3 8h1.3M4.5 5l1 1M11.5 5l-1 1" /><path d="M8.5 17h9a3.2 3.2 0 0 0 .3-6.4A5 5 0 0 0 8.7 13" /></svg>;
    case 'cloudy':
      return <svg {...p}>{cloud}</svg>;
    case 'fog':
      return <svg {...p}>{cloud}<path d="M4 19h16M6 21.5h12" /></svg>;
    case 'rain':
      return <svg {...p}>{cloud}<path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3" /></svg>;
    case 'sleet':
      return <svg {...p}>{cloud}<path d="M8 18l-1 3M16 18l-1 3M12 18v1.5M11 21l2 1.5M13 21l-2 1.5" /></svg>;
    case 'snow':
      return <svg {...p}>{cloud}<path d="M8 18v3.5M6.7 19.2l2.6 1.6M9.3 19.2l-2.6 1.6M16 18v3.5M14.7 19.2l2.6 1.6M17.3 19.2l-2.6 1.6" /></svg>;
    case 'thunder':
      return <svg {...p}>{cloud}<path d="M12.5 15l-2.5 4.5h2.5l-1 4 3.5-5h-2.5l1-3.5z" fill="currentColor" stroke="none" /></svg>;
  }
}

// Circular countdown to the next ferry departure, for the glass top bar.
// Fill fraction is relative to an arbitrary 60-minute reference window (the
// app has no "typical gap between sailings" constant to anchor to) — the
// ring simply fills up as the departure gets closer, capped at 60 min out.
function FerryRing({ minsUntil, size = 62 }: { minsUntil: number | null; size?: number }) {
  const REF_MIN = 60;
  const r = (size - 5) / 2;
  const circumference = 2 * Math.PI * r;
  const frac = minsUntil === null ? 0 : 1 - Math.min(Math.max(minsUntil, 0), REF_MIN) / REF_MIN;
  const dash = `${circumference * frac} ${circumference}`;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={5} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={5}
          strokeLinecap="round" strokeDasharray={dash}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1, color: 'var(--ink)' }}>
          {minsUntil === null ? '–' : Math.max(0, minsUntil)}
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.04em' }}>MIN</span>
      </div>
    </div>
  );
}
function ChevSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6"/>
    </svg>
  );
}
function BackSvg() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6l-6 6 6 6"/>
    </svg>
  );
}
function HeartSvg() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20s-7-4.4-7-9.5A3.5 3.5 0 0 1 12 7a3.5 3.5 0 0 1 7 3.5C19 15.6 12 20 12 20z"/>
    </svg>
  );
}
function RouteSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="5" r="2.4"/>
      <path d="M8 18h6a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h2"/>
    </svg>
  );
}
function CheckSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L19 7"/>
    </svg>
  );
}
function UpChevSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 14l6-6 6 6"/>
    </svg>
  );
}

// ─── Tab bar icons ─────────────────────────────────────────────────────────────

function MapTabSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4L3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z"/><path d="M9 4v14M15 6v14"/>
    </svg>
  );
}
function PlacesTabSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-6.5-4.9-6.5-10.2A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.8C18.5 16.1 12 21 12 21z"/><circle cx="12" cy="10.6" r="2.3"/>
    </svg>
  );
}
function TrailsTabSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 21c-4-6 4-7 5-11 .8-3.2 5.5-2.8 3.5-7"/><circle cx="17" cy="3" r="1.4"/>
    </svg>
  );
}
function NatureTabSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21Q4 13 12 3q8 10 0 18z"/><path d="M12 3q-2 9 0 18"/>
    </svg>
  );
}
function HistoryTabSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// ≥900px uses the sidebar layout (see index.css) — no mini-card, sheet always visible
function isDesktopView(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches;
}

// Hide <img> elements whose remote source fails instead of showing a broken-image icon
function hideBrokenImg(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none';
}

const MAP_CENTER: [number, number] = [59.1506, 10.3521];
const MAP_ZOOM = 13;
const MAP_MIN_ZOOM = 13; // don't let people scroll/pinch out further than this
// Padded out from the DOM/DTM terrain grid bbox (scripts/generate_dom_grid.py):
// Leaflet auto-raises the effective minimum zoom so maxBounds always covers the
// viewport, so a box padded only to the island itself would force a much higher
// zoom than MAP_ZOOM on wide screens. The extra margin keeps that floor at 13
// while still stopping people from panning far away from the island.
const MAP_MAX_BOUNDS = L.latLngBounds([59.12, 10.31], [59.21, 10.40]).pad(0.6);

const USER_ICON = L.divIcon({
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: '<div class="vl-me"></div>',
});

export function VeierlandApp() {
  const [lang, setLang] = useState<'no' | 'en'>('no');
  const [allPOIs, setAllPOIs] = useState<POI[]>([]);
  const [trails, setTrails] = useState<Trail[]>([]);
  const [activeCats, setActiveCats] = useState<Set<string>>(new Set());
  const [expandedPlaceCats, setExpandedPlaceCats] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'places' | 'trails' | 'nature' | 'history'>('places');
  const [tab, setTab] = useState<'map' | 'places' | 'trails' | 'nature' | 'history' | 'saved'>('map');
  const [searchQ, setSearchQ] = useState('');
  const [view, setView] = useState<'browse' | 'detail'>('browse');
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  const [selectedTrail, setSelectedTrail] = useState<Trail | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [autoSheetH, setAutoSheetH] = useState<number | null>(null);
  // Drag-to-resize on the sheet's grab handle: sheetPeeked is the settled
  // "pulled down, only the top sliver showing" state; dragH is the live
  // height while a finger/mouse is actively dragging (overrides everything
  // else until released, when it snaps to peeked or fully open).
  const [sheetPeeked, setSheetPeeked] = useState(false);
  const [dragH, setDragH] = useState<number | null>(null);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const dragStartRef = useRef<{ y: number; h: number; moved: boolean; cur: number | null } | null>(null);
  // New-map-screen dock ("Hva vil du i dag?") state — deliberately separate
  // from sheetOpen/view/tab, which stay reserved for the POI/trail detail
  // sheet and the menu-driven browse lists, so the dock's own open/expand
  // state doesn't fight with those.
  const [activityTile, setActivityTile] = useState<'bade' | 'spise' | null>(null);
  const [dockExpanded, setDockExpanded] = useState(false);
  const [currentLayer, setCurrentLayer] = useState<string>(() => {
    try { return localStorage.getItem('vl-layer') || 'soleng'; } catch { return 'soleng'; }
  });
  const [geoLayer, setGeoLayer] = useState<string | null>(null);
  const [showLayerPop, setShowLayerPop] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showCondPop, setShowCondPop] = useState(false);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [userAccuracy, setUserAccuracy] = useState<number>(0);
  const [locating, setLocating] = useState(false);
  const [offIsland, setOffIsland] = useState(false);
  const [nearbyPoi, setNearbyPoi] = useState<POI | null>(null);
  const watchRef = useRef<number | null>(null);
  const notifiedPoisRef = useRef<Set<string>>(new Set());
  const offIslandShownRef = useRef(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => {
    try { return new Set<string>(JSON.parse(localStorage.getItem('vl-saved') || '[]')); }
    catch { return new Set<string>(); }
  });
  const [trailPath, setTrailPath] = useState<[number, number][] | null>(null);
  const [walkRoutePath, setWalkRoutePath] = useState<[number, number][] | null>(null);
  const [trailPoiFilter, setTrailPoiFilter] = useState<'along' | 'all'>('along');
  const [trailCatFilter, setTrailCatFilter] = useState<'alle' | 'historie' | 'natur' | 'mat' | 'kultur'>('alle');
  const [heartAnim, setHeartAnim] = useState(false);
  const [lesmerExpanded, setLesmerExpanded] = useState(false);
  const [lesmerEraExpanded, setLesmerEraExpanded] = useState(false);
  const [lokalExpanded, setLokalExpanded] = useState(false);

  // History state
  const [historyView, setHistoryView] = useState<'tidslinje' | 'garder'>('tidslinje');
  const [garderTimeIdx, setGarderTimeIdx] = useState(GARDER_TIMELINE.length - 1); // start at I dag
  const [selectedEra, setSelectedEra] = useState<TimelineSection | null>(null);
  const [selectedFarm, setSelectedFarm] = useState<Farm | null>(null);
  const [eraNavIdx, setEraNavIdx] = useState(0);
  const [timelineSections, setTimelineSections] = useState<TimelineSection[]>(DEFAULT_TIMELINE_SECTIONS);
  const [seaLevelM, setSeaLevelM] = useState(DEFAULT_TIMELINE_SECTIONS[0]?.sea_level_m ?? 0); // metres above today's sea level (0–15)
  const [seaLevelLabel, setSeaLevelLabel] = useState<string | null>(null); // era name shown as label
  const [seaLevelA, setSeaLevelA] = useState(DEFAULT_TIMELINE_SECTIONS[0]?.sea_level_m ?? 0);
  const [seaLevelB, setSeaLevelB] = useState(DEFAULT_TIMELINE_SECTIONS[0]?.sea_level_m ?? 0);

  // Nature state
  const [natureObs, setNatureObs] = useState<NatureObs[]>([]);
  const [natureLoading, setNatureLoading] = useState(false);
  const [natureFetched, setNatureFetched] = useState(false);
  const [natureFilter, setNatureFilter] = useState<NatureGroup | null>(null);
  // Curated list: highlights (red-listed/alien) + most-observed, paged
  const [natureHlN, setNatureHlN] = useState(10);
  const [natureTopN, setNatureTopN] = useState(15);
  const filteredNatureObs = natureFilter
    ? natureObs.filter(o => o.group === natureFilter)
    : natureObs;
  const isHighlight = (o: NatureObs) =>
    RED_LIST_CATS.test(o.redListCategory ?? '') || !!o.alienCategory;
  const natureHighlights = useMemo(
    () => filteredNatureObs.filter(isHighlight).sort((a, b) => {
      const rank = (o: NatureObs) => RL_RANK[o.redListCategory ?? ''] ?? 10;
      return rank(a) - rank(b) || b.obsCount - a.obsCount;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [natureObs, natureFilter]);
  const natureCommon = useMemo(
    () => filteredNatureObs.filter(o => !isHighlight(o)).sort((a, b) => b.obsCount - a.obsCount),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [natureObs, natureFilter]);
  // The map mirrors exactly what the list shows — not all 500 species
  const natureVisible = useMemo(
    () => [...natureHighlights.slice(0, natureHlN), ...natureCommon.slice(0, natureTopN)],
    [natureHighlights, natureCommon, natureHlN, natureTopN]);
  const [selectedNatureObs, setSelectedNatureObs] = useState<NatureObs[]>([]);
  const [speciesObsLoading, setSpeciesObsLoading] = useState(false);
  const [selectedNature, setSelectedNature] = useState<NatureObs | null>(null);
  const [speciesWiki, setSpeciesWiki] = useState<WikipediaData | null>(null);
  const [speciesWikiLoading, setSpeciesWikiLoading] = useState(false);

  // API state for detail view
  const [apiLoading, setApiLoading] = useState(false);
  const [snlData, setSnlData] = useState<SNLData | null>(null);
  const [lokalData, setLokalData] = useState<LokalhistorieData | null>(null);
  const [dimuData, setDimuData] = useState<MuseumPhoto[]>([]);
  const [wikimediaImages, setWikimediaImages] = useState<WikimediaImage[]>([]);

  const [mapZoom, setMapZoom] = useState<number>(MAP_ZOOM);

  // Ferry departures, read from the Veierland-Ferge repo's timetable.
  // null = couldn't load -> pill still links to the ferry app.
  const [ferryBoard, setFerryBoard] = useState<FerryBoard | null>(null);
  const [showFerryPop, setShowFerryPop] = useState(false);
  const ferryFetchedAt = useRef(0);
  const loadFerry = useCallback(() => {
    fetchFerryDepartures().then(b => {
      setFerryBoard(b);
      ferryFetchedAt.current = Date.now();
    });
  }, []);
  useEffect(() => { loadFerry(); }, [loadFerry]);
  const toggleFerryPop = () => {
    setShowFerryPop(v => {
      const next = !v;
      // Refresh quietly if the data is over a minute old when opening
      if (next && Date.now() - ferryFetchedAt.current > 60_000) loadFerry();
      // Fetch weather for ferry display
      if (next && !weatherNow) {
        fetchWeatherNow().then(w => { if (w) setWeatherNow(w); });
        fetchSeaTemp().then(t => { if (t !== null) setSeaTemp(t); });
      }
      return next;
    });
  };
  const ferrySailings = ferryBoard?.sailings ?? [];
  const ferryTomorrow = ferryBoard?.tomorrow ?? false;
  const nextFromIsland = ferrySailings.find(d => d.fromIsland);

  // Departure board for a selected ferry-quay POI. Only POIs in the "Brygge"
  // (ferge) category get one — then we resolve *which* physical quay by
  // proximity. Gating on category avoids showing ferry times on nearby
  // beaches/cafés just because they sit close to a quay.
  // undefined = loading, null = couldn't load.
  const isQuayPOI = !!selectedPOI && (selectedPOI.kategorier ?? [selectedPOI.kategori]).includes('ferge');
  const selectedQuay = isQuayPOI && selectedPOI
    ? nearestQuay(selectedPOI.coordinates[0], selectedPOI.coordinates[1])
    : null;
  const [quayBoard, setQuayBoard] = useState<FerryBoard | null | undefined>(undefined);
  useEffect(() => {
    setQuayBoard(undefined);
    if (!selectedQuay) return;
    let alive = true;
    fetchQuaySailings(selectedQuay.key, 3).then(b => { if (alive) setQuayBoard(b); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQuay?.key]);

  // Conditions: sun-shadow / wind-shelter / effective-temp overlays (needs the DOM grid) and
  // current weather + sea temperature from MET (for the beach card)
  const [condLayer, setCondLayer] = useState<'sun' | 'wind' | 'effectiveTemp' | null>(null);
  const [weatherNow, setWeatherNow] = useState<WeatherNow | null>(null);
  const [seaTemp, setSeaTemp] = useState<number | null>(null);
  const [tempRange, setTempRange] = useState<[number, number] | null>(null);
  const condOverlayRef = useRef<L.ImageOverlay | null>(null);
  const isBeachPOI = !!selectedPOI && (selectedPOI.kategorier ?? [selectedPOI.kategori]).includes('bad');

  // Weather is needed unconditionally now (the glass top bar's one-liner),
  // not just for the beach card — fetch once on mount; fetchWeatherNow/
  // fetchSeaTemp already cache for 30 min so this doesn't add extra load.
  useEffect(() => {
    let alive = true;
    fetchWeatherNow().then(w => { if (alive && w) setWeatherNow(w); });
    fetchSeaTemp().then(t => { if (alive && t !== null) setSeaTemp(t); });
    return () => { alive = false; };
  }, []);


  const mapRef = useRef<L.Map | null>(null);
  const seaActivePaneRef = useRef<'a' | 'b'>('a');
  const crossfadeReadyRef = useRef(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fitDoneRef = useRef(false);

  // Dynamic category config (loaded from Firestore, falls back to defaults)
  const [catCfg, setCatCfg] = useState<CatCfgMap>(DEFAULT_CAT_CFG);

  // Farm data (loaded from Firestore, falls back to veierland_history.json values)
  const [farmData, setFarmData] = useState<Farm[]>(DEFAULT_FARM_DATA);

  const getCat = useCallback((k: string) =>
    catCfg[k] ?? { no: k, en: k, color: '#7c876f', icon: 'wc', group: '' as const, showInFilter: false },
  [catCfg]);

  // Map of groupName → [cat keys], in order of first appearance in catCfg
  const catGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const [key, entry] of Object.entries(catCfg)) {
      if (entry.group) {
        if (!groups.has(entry.group)) groups.set(entry.group, []);
        groups.get(entry.group)!.push(key);
      }
    }
    return groups;
  }, [catCfg]);

  // Derive visible farms and coordinate map from Firestore-backed farmData
  const visibleFarms = useMemo(() => farmData.filter(f => f.visible !== false), [farmData]);
  const farmCoords = useMemo(
    () => Object.fromEntries(farmData.map(f => [f.name, f.coordinates])) as Record<string, [number, number]>,
    [farmData]
  );

  // POIs highlighted on the map for the current timeline era
  const eraHighlightPOIs = useMemo(() => {
    if (mode !== 'history' || historyView !== 'tidslinje') return [];
    const era = timelineSections[eraNavIdx];
    if (!era?.poi_ids?.length) return [];
    const idSet = new Set(era.poi_ids);
    return allPOIs.filter(p => idSet.has(p.id) || idSet.has(p.navn));
  }, [mode, historyView, eraNavIdx, timelineSections, allPOIs]);

  // Derive category list from actual POI data, filtered by showInFilter
  const allCats = useMemo(
    () => Array.from(new Set(allPOIs.flatMap(p => p.kategorier ?? [p.kategori]))).filter(k => catCfg[k]?.showInFilter),
    [allPOIs, catCfg]
  );

  // Filtered POIs
  const filteredPOIs = useMemo(() => {
    return allPOIs.filter(p => {
      if (activeCats.size > 0 && !(p.kategorier ?? [p.kategori]).some(k => activeCats.has(k))) return false;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        if (!(p.navn + ' ' + p.beskrivelse).toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allPOIs, activeCats, searchQ]);

  // Ranks every beach by current sun + wind shelter, for the dock's "Bade"
  // list and daily-recommendation line. Memoized since sunlitAt/shelterAt
  // do real terrain-horizon raycasting, not free to recompute every render.
  const beachRanking = useMemo<BeachConditionScore[]>(() => {
    if (!hasDomGrid) return [];
    const beaches = allPOIs.filter(p => (p.kategorier ?? [p.kategori]).includes('bad'));
    return rankBeaches(beaches, weatherNow?.windFromDeg ?? null, new Date());
  }, [allPOIs, weatherNow]);

  const recoText = useMemo(
    () => dailyRecommendation(beachRanking, seaTemp, lang),
    [beachRanking, seaTemp, lang]
  );

  const groupedPOIs = useMemo(() => {
    const catOrder = Object.keys(catCfg);
    const map = new Map<string, POI[]>();
    for (const poi of filteredPOIs) {
      if (!map.has(poi.kategori)) map.set(poi.kategori, []);
      map.get(poi.kategori)!.push(poi);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const ai = catOrder.indexOf(a); const bi = catOrder.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [filteredPOIs, catCfg]);

  // Fetch Wikipedia when a nature obs is selected
  useEffect(() => {
    if (!selectedNature) { setSpeciesWiki(null); return; }
    let alive = true;
    setSpeciesWiki(null);
    setSpeciesWikiLoading(true);
    fetchWikipediaSpecies(selectedNature.scientificName, selectedNature.popularName, lang)
      .then(r => { if (alive) { setSpeciesWiki(r); setSpeciesWikiLoading(false); } })
      .catch(() => { if (alive) setSpeciesWikiLoading(false); });
    return () => { alive = false; };
  }, [selectedNature, lang]);

  // Close layer popup on document click
  useEffect(() => {
    const handle = () => { setShowLayerPop(false); setShowFerryPop(false); setShowMenu(false); setShowCondPop(false); };
    document.addEventListener('click', handle);
    return () => document.removeEventListener('click', handle);
  }, []);

  // Fetch API data for selected POI
  useEffect(() => {
    if (!selectedPOI) return;
    setLesmerExpanded(false);
    setLokalExpanded(false);
    setSnlData(null); setLokalData(null); setDimuData([]); setWikimediaImages([]);
    let alive = true;
    setApiLoading(true);
    const tasks: Promise<void>[] = [];
    if (selectedPOI.snl_søkeord) {
      tasks.push(fetchSNL(selectedPOI.snl_søkeord).then(r => { if (alive) setSnlData(r); }));
    }
    if (selectedPOI.lokalhistoriewiki) {
      tasks.push(fetchLokalhistorie(selectedPOI.lokalhistoriewiki).then(r => { if (alive) setLokalData(r); }));
    }
    if (selectedPOI.dimu_søk) {
      tasks.push(fetchDigitalMuseum(selectedPOI.dimu_søk, selectedPOI.dimu_eier).then(r => { if (alive) setDimuData(r); }));
    }
    tasks.push(
      fetchWikimediaImages(selectedPOI.coordinates[0], selectedPOI.coordinates[1], 50).then(r => { if (alive) setWikimediaImages(r); })
    );
    Promise.all(tasks).then(() => { if (alive) setApiLoading(false); });
    return () => { alive = false; };
  }, [selectedPOI]);

  const [mapReady, setMapReady] = useState(false);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;
    const clear = () => {
      if (condOverlayRef.current) { map.removeLayer(condOverlayRef.current); condOverlayRef.current = null; }
    };
    clear();
    if (!condLayer || !hasDomGrid) return;
    (async () => {
      let img: { dataUrl: string; bounds: [[number, number], [number, number]]; tempRange?: [number, number] } | null = null;
      if (condLayer === 'sun') {
        img = makeSunShadowOverlay(new Date());
      } else if (condLayer === 'wind') {
        const w = weatherNow ?? await fetchWeatherNow();
        if (w) {
          if (!weatherNow) setWeatherNow(w);
          img = makeShelterOverlay(w.windFromDeg, w.windSpeed);
        }
      } else if (condLayer === 'effectiveTemp') {
        const w = weatherNow ?? await fetchWeatherNow();
        if (w) {
          if (!weatherNow) setWeatherNow(w);
          img = makeEffectiveTempOverlay(w.airTemp, w.windSpeed, w.windFromDeg, w.humidity);
        }
      }
      if (cancelled) return;
      if (!img) { setCondLayer(null); return; }
      setTempRange(img.tempRange ?? null);
      clear();
      condOverlayRef.current = L.imageOverlay(img.dataUrl, img.bounds, { opacity: 0.8, interactive: false }).addTo(map);
    })();
    return () => { cancelled = true; clear(); };
  // weatherNow is read once at activation; re-running on its change would flicker
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condLayer, mapReady]);

  // Load POIs and trails from Firestore (or local JSON fallback)
  useEffect(() => {
    loadAllPOIs().then(setAllPOIs);
    loadTurkartGeoJSON().then(geo => setTrails(trailsFromGeoJSON(geo)));
    loadCatCfg().then(setCatCfg);
    loadFarmData().then(setFarmData);
    loadTimelineSections().then(sections => {
      setTimelineSections(sections);
      const lvl = sections[0]?.sea_level_m ?? 0;
      setSeaLevelM(lvl);
      setSeaLevelA(lvl);
      setSeaLevelB(lvl);
    });
  }, []);

  // Crossfade: after React renders the new level into the inactive pane, swap opacities
  useEffect(() => {
    if (!crossfadeReadyRef.current) return;
    crossfadeReadyRef.current = false;
    const paneA = mapRef.current?.getPane('sealevel-a');
    const paneB = mapRef.current?.getPane('sealevel-b');
    if (!paneA || !paneB) return;
    if (seaActivePaneRef.current === 'b') {
      paneA.style.opacity = '0';
      paneB.style.opacity = '1';
    } else {
      paneA.style.opacity = '1';
      paneB.style.opacity = '0';
    }
  }, [seaLevelA, seaLevelB]);

  // Fit map bounds once both map and POIs are ready (runs once)
  useEffect(() => {
    if (!mapReady || !mapRef.current || allPOIs.length === 0 || fitDoneRef.current) return;
    fitDoneRef.current = true;
    const coords = allPOIs.map(p => p.coordinates as [number, number]);
    mapRef.current.fitBounds(L.latLngBounds(coords).pad(0.08), { animate: false, maxZoom: MAP_ZOOM });
    setMapZoom(mapRef.current.getZoom());
  }, [mapReady, allPOIs]);

  const onMapReady = useCallback((m: L.Map) => {
    mapRef.current = m;
    if (!m.getPane('sealevel-a')) {
      const paneA = m.createPane('sealevel-a');
      paneA.style.zIndex = '400';
      paneA.style.transition = 'opacity 500ms ease-in-out';
    }
    if (!m.getPane('sealevel-b')) {
      const paneB = m.createPane('sealevel-b');
      paneB.style.zIndex = '401';
      paneB.style.transition = 'opacity 500ms ease-in-out';
      paneB.style.opacity = '0';
    }
    setMapReady(true);
  }, []);
  const onMapClick = useCallback(() => {
    setShowLayerPop(false);
    setShowFerryPop(false);
    if (selectedNature) { setSelectedNature(null); setSelectedNatureObs([]); }
    // Tapping empty map while a mini-card is showing dismisses it
    if (tab === 'map' && !sheetOpen && (selectedPOI || selectedTrail)) {
      setSelectedPOI(null);
      setSelectedTrail(null);
      setTrailPath(null);
    }
  }, [selectedNature, tab, sheetOpen, selectedPOI, selectedTrail]);
  const onZoom = useCallback((z: number) => setMapZoom(z), []);

  // Cluster group — rebuild whenever filtered POIs, zoom, or selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Remove existing group
    if (clusterRef.current) { map.removeLayer(clusterRef.current); clusterRef.current = null; }
    if (mode === 'nature' || mode === 'history') return;

    const cg = L.markerClusterGroup({
      maxClusterRadius: 60,
      disableClusteringAtZoom: 15,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (cluster) => {
        const n = cluster.getChildCount();
        const sz = n < 10 ? 32 : n < 50 ? 38 : 44;
        return L.divIcon({
          className: '',
          iconSize: [sz, sz],
          iconAnchor: [sz / 2, sz / 2],
          html: `<div class="vl-cluster" style="width:${sz}px;height:${sz}px;font-size:${sz < 38 ? 13 : 15}px">${n}</div>`,
        });
      },
    });

    const sz = markerSize(mapZoom);
    const dimByTrail = mode === 'trails' && view === 'detail' && !!selectedTrail && trailPoiFilter === 'along';

    filteredPOIs.forEach(poi => {
      const cat = getCat(poi.kategori);
      const sel = selectedPOI?.id === poi.id;

      // Place names (stedsnavn) are map annotations, not real POIs — they'd
      // clutter the overview at full-island zoom, so they only render once
      // the user has zoomed in enough for individual names to be useful
      // (unless a search is actively matching one, which is explicit intent).
      if (poi.kategori === 'stedsnavn' && mapZoom < STEDSNAVN_MIN_ZOOM && !searchQ) return;

      const faded = dimByTrail && !!poi.coordinates &&
        pointToPolylineDistM(poi.coordinates as [number, number], selectedTrail!.path) > 20;
      let html: string, pinSz: number;
      if (poi.kategori === 'stedsnavn') {
        // Lightweight text-only label — no icon circle, so it reads as a
        // map annotation rather than a tappable place, and doesn't compete
        // visually with real POI pins even when both are visible.
        html = makeStedsnavnHtml(poi.navn, sel);
        pinSz = 22;
      } else if (activityTile) {
        // Activity-mode map view: bigger pins with the name always visible —
        // tapping to find out what something is isn't realistic for young
        // or elderly users on a crowded island map.
        pinSz = sel ? 50 : 44;
        html = makeLabeledIconHtml(cat.icon, cat.color, sel, pinSz, poi.navn);
      } else {
        pinSz = sz;
        html = faded
          ? `<div style="opacity:0.3">${makeIconHtml(cat.icon, cat.color, sel, sz)}</div>`
          : makeIconHtml(cat.icon, cat.color, sel, sz);
      }
      const half = Math.round(pinSz / 2);
      const icon = L.divIcon({ className: '', iconSize: [pinSz, pinSz], iconAnchor: [half, half], html });
      L.marker(poi.coordinates as [number, number], { icon, zIndexOffset: sel ? 1000 : 0 }).on('click', () => selectPOI(poi)).addTo(cg);
    });

    map.addLayer(cg);
    clusterRef.current = cg;

    return () => { if (map) map.removeLayer(cg); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mode, filteredPOIs, selectedPOI?.id, view, mapZoom, selectedTrail, trailPoiFilter, tab, activityTile, searchQ]);

  useEffect(() => {
    if ((mode !== 'nature' && !(mode === 'trails' && trailCatFilter === 'natur')) || natureFetched) return;

    // Show static bundle immediately for fast first render
    setNatureObs(applyAssessments(STATIC_NATURE_CACHE.obs));
    setNatureFetched(true);

    // Load fresher data from Firebase in background (instant on repeat visits via Firestore offline cache)
    setNatureLoading(true);
    loadNatureObs().then(obs => {
      if (obs) setNatureObs(applyAssessments(obs));
    }).finally(() => setNatureLoading(false));
  }, [mode, natureFetched, trailCatFilter]);

  // Fly to a coordinate but shift the center up so the marker is visible above the sheet
  function flyToAboveSheet(coordinates: [number, number], zoom: number) {
    const map = mapRef.current;
    if (!map) return;
    const expandedH = Math.min(window.innerHeight * 0.55, 680);
    const offsetPx = expandedH / 2;
    const targetPoint = map.project(L.latLng(coordinates), zoom).add(L.point(0, offsetPx));
    map.flyTo(map.unproject(targetPoint, zoom), zoom, { duration: 0.7 });
  }

  async function selectNatureSpecies(obs: NatureObs) {
    setSelectedNature(obs);
    setSelectedNatureObs([obs]);
    setSheetOpen(true);
    setSpeciesObsLoading(true);
    try {
      const url = `https://api.gbif.org/v1/occurrence/search?geometry=${GBIF_POLYGON}&speciesKey=${obs.gbifKey}&limit=300`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const fetched: NatureObs[] = (data.results as Record<string, unknown>[])
          .filter(o => o.decimalLatitude && o.decimalLongitude)
          .map(o => ({ ...obs, lat: o.decimalLatitude as number, lng: o.decimalLongitude as number, date: String(o.eventDate ?? '') }));
        const allObs = fetched.length > 0 ? fetched : [obs];
        if (fetched.length > 0) setSelectedNatureObs(fetched);
        const map = mapRef.current;
        if (map) {
          if (allObs.length === 1) {
            flyToAboveSheet([allObs[0].lat, allObs[0].lng], Math.max(map.getZoom(), 14));
          } else {
            const bounds = L.latLngBounds(allObs.map(o => [o.lat, o.lng] as [number, number]));
            const sheetH = Math.min(window.innerHeight * 0.55, 680);
            map.fitBounds(bounds.pad(0.25), { paddingBottomRight: [0, sheetH], animate: true });
          }
        }
      } else {
        flyToAboveSheet([obs.lat, obs.lng], Math.max(mapRef.current?.getZoom() ?? 13, 14));
      }
    } catch {
      flyToAboveSheet([obs.lat, obs.lng], Math.max(mapRef.current?.getZoom() ?? 13, 14));
    }
    setSpeciesObsLoading(false);
  }

  // Actions
  function selectPOI(poi: POI) {
    setSelectedPOI(poi);
    setSelectedTrail(null);
    setTrailPath(null);
    // On the Kart tab with nothing else open, show a compact mini-card instead
    // of pushing straight into the full sheet — keeps the map in view.
    // Desktop has no mini-card (the sidebar is always visible), so open detail there.
    const showMini = tab === 'map' && !isDesktopView();
    if (showMini) {
      // Nudge the pin slightly above centre so the mini-card doesn't cover it
      const map = mapRef.current;
      if (map) {
        const z = Math.max(map.getZoom(), 15);
        const target = map.project(L.latLng(poi.coordinates), z).add(L.point(0, 60));
        map.flyTo(map.unproject(target, z), z, { duration: 0.7 });
      }
    } else {
      flyToAboveSheet(poi.coordinates, Math.max(mapRef.current?.getZoom() ?? 15, 15));
    }
    setView(showMini ? 'browse' : 'detail');
    setSheetOpen(!showMini);
  }

  // "Show on map" from a list row: collapse everything down to the mini-card so
  // the map (and the pin we just flew to) is actually visible. On desktop the
  // sidebar stays put, so just fly the map.
  function showOnMap(poi: POI) {
    setSelectedPOI(poi);
    setSelectedTrail(null);
    setTrailPath(null);
    if (isDesktopView()) {
      mapRef.current?.flyTo(poi.coordinates, Math.max(mapRef.current?.getZoom() ?? 15, 15), { duration: 0.7 });
      return;
    }
    setView('browse');
    setTab('map');
    setSheetOpen(false);
    const map = mapRef.current;
    if (map) {
      const z = Math.max(map.getZoom(), 15);
      const target = map.project(L.latLng(poi.coordinates), z).add(L.point(0, 60));
      map.flyTo(map.unproject(target, z), z, { duration: 0.7 });
    }
  }

  function selectTrail(trail: Trail) {
    setSelectedTrail(trail);
    setSelectedPOI(null);
    setView('detail');
    setSheetOpen(true);
    setTrailPath(trail.path);
    const bounds = L.latLngBounds(trail.path);
    mapRef.current?.fitBounds(bounds.pad(0.35), { paddingBottomRight: [0, 260] });
  }

  function goBack() {
    setView('browse');
    if (tab === 'map' && !isDesktopView()) {
      // Came from expanding a mini-card — collapse back to it, keep the
      // selection (POI or trail; a trail also keeps its route on the map).
      setSheetOpen(false);
    } else {
      // Came from a tab list (or the desktop sidebar) — return to it.
      setSelectedPOI(null);
      setSelectedTrail(null);
      setTrailPath(null);
    }
  }

  function selectTab(t: 'map' | 'places' | 'trails' | 'nature' | 'history' | 'saved') {
    // Re-tapping Kart with nothing open re-centres the island (replaces the
    // old "home" rail button)
    if (t === 'map' && tab === 'map' && !sheetOpen) {
      mapRef.current?.flyTo(MAP_CENTER, MAP_ZOOM, { duration: 0.7 });
    }
    setShowLayerPop(false);
    setSelectedPOI(null);
    setSelectedTrail(null);
    setSelectedNature(null);
    setSelectedNatureObs([]);
    setTrailPath(null);
    setView('browse');
    setTab(t);
    // Each tab browses its own mode (Kart/Lagret browse places). Only touch
    // the map layer when the mode actually changes, so a manually chosen
    // layer survives plain tab-hopping.
    const wantMode = t === 'trails' ? 'trails' : t === 'nature' ? 'nature' : t === 'history' ? 'history' : 'places';
    if (mode !== wantMode) {
      setMode(wantMode);
      setCurrentLayer(wantMode === 'trails' || wantMode === 'history' ? 'friluft' : wantMode === 'nature' ? 'flyfoto' : 'soleng');
      setSelectedEra(null);
      setSelectedFarm(null);
      // Clear the crossfade panes so a stale flood overlay from a previous
      // history session doesn't reappear (the panes render from A/B, not M).
      setSeaLevelM(0);
      setSeaLevelA(0);
      setSeaLevelB(0);
    }
    if (t === 'nature') { setNatureHlN(10); setNatureTopN(15); }
    setSheetOpen(t !== 'map');
  }

  // The dock's 4 activity tiles are the new entry points for "what do you
  // want today" on the map screen. Bade/Spise filter the map to that POI
  // category (the dock swaps to a compact summary + expandable list — see
  // the dock JSX). Gå tur/Historie route straight to the existing, richer
  // Turer/Historie tabs instead of a lesser POI-filtered view — those
  // features are already built and better than anything a quick filter
  // could offer, so this reuses them wholesale rather than duplicating.
  function applyActivityTile(tile: 'bade' | 'gatur' | 'historie' | 'spise') {
    if (tile === 'gatur') { selectTab('trails'); return; }
    if (tile === 'historie') { selectTab('history'); return; }
    setActivityTile(tile);
    setDockExpanded(false);
    setActiveCats(new Set([tile === 'bade' ? 'bad' : 'mat']));
    setSelectedPOI(null);
    setSelectedTrail(null);
    setView('browse');
    setSheetOpen(false);
    setTab('map');
    if (mode !== 'places') setMode('places');
  }

  function exitActivityTile() {
    setActivityTile(null);
    setDockExpanded(false);
    setActiveCats(new Set());
  }

  function closeSheet() {
    setSheetOpen(false);
    setView('browse');
    setSelectedPOI(null);
    setSelectedTrail(null);
    setSelectedNature(null);
    setSelectedNatureObs([]);
    setTrailPath(null);
    setTab('map');
    // Return the map to place pins if something else (trails/nature/history)
    // was being browsed — but leave a manually chosen layer alone otherwise.
    if (mode !== 'places') {
      setMode('places');
      setCurrentLayer('soleng');
    }
  }

  function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Walking estimate: from the user's position when tracking, otherwise from
  // Vestgården quay (where visitors arrive). 5 km/h. Uses the real path/road
  // network (src/data/road_network.json, see scripts/generate_road_network.mjs)
  // when both ends are close enough to a known path; a 30% path factor on the
  // straight-line distance is the fallback for points the network can't
  // reach (or if the data is missing), rounded to 5-minute steps.
  const WALK_BASIS_QUAY = FERRY_QUAYS[0]; // Vestgården
  function walkMins(coords: [number, number]): number {
    const from = userPos ?? [WALK_BASIS_QUAY.lat, WALK_BASIS_QUAY.lng];
    const networkM = networkWalkDistanceM(from, coords);
    const mins = networkM !== null
      ? (networkM / 1000) * 12
      : (distanceM(from[0], from[1], coords[0], coords[1]) / 1000) * 1.3 * 12;
    return Math.max(5, Math.round(mins / 5) * 5);
  }
  function walkShort(coords: [number, number]): string {
    return `~${walkMins(coords)} min`;
  }
  function walkLong(coords: [number, number]): string {
    const suffix = userPos
      ? (lang === 'no' ? 'å gå herfra' : 'walk from here')
      : (lang === 'no' ? `å gå fra ${WALK_BASIS_QUAY.name}` : `walk from ${WALK_BASIS_QUAY.name}`);
    return `${walkShort(coords)} ${suffix}`;
  }

  // Draw the walking route to whichever POI is currently open, from the
  // user's live position when tracking or from Vestgården quay otherwise —
  // recomputed whenever either changes, so it follows along as you walk.
  useEffect(() => {
    if (!selectedPOI || view !== 'detail') { setWalkRoutePath(null); return; }
    const from = userPos ?? [WALK_BASIS_QUAY.lat, WALK_BASIS_QUAY.lng];
    const route = networkWalkRoute(from, selectedPOI.coordinates);
    setWalkRoutePath(route?.path ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPOI, view, userPos]);

  function pointInPolygon(lat: number, lng: number): boolean {
    const poly = (boundaryData as unknown as { coordinates: [number, number][][] }).coordinates[0];
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]; // GeoJSON is [lng, lat]
      const [xj, yj] = poly[j];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }

  function locate() {
    // Toggle off: stop watching
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      setUserPos(null);
      setLocating(false);
      setNearbyPoi(null);
      return;
    }

    setLocating(true);
    setOffIsland(false);
    notifiedPoisRef.current = new Set();
    offIslandShownRef.current = false;

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const handlePos = (pos: GeolocationPosition, flyTo = false) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = pos.coords.accuracy;
      if (pointInPolygon(lat, lng)) {
        const p: [number, number] = [lat, lng];
        setUserPos(p);
        setUserAccuracy(acc);
        setOffIsland(false);
        offIslandShownRef.current = false;
        if (flyTo) mapRef.current?.flyTo(p, 16, { duration: 0.7 });
      } else {
        setUserPos(null);
        // Show the toast once per off-island episode, not on every GPS update
        if (!offIslandShownRef.current) {
          offIslandShownRef.current = true;
          setOffIsland(true);
          setTimeout(() => setOffIsland(false), 4000);
        }
      }
    };

    const handleErr = (err: GeolocationPositionError) => {
      console.error('Geolocation error', err);
      // Permission denied or unavailable: stop tracking so the button doesn't stay stuck on
      if (err.code === err.PERMISSION_DENIED) {
        if (watchRef.current !== null) {
          navigator.geolocation.clearWatch(watchRef.current);
          watchRef.current = null;
        }
        setLocating(false);
        setUserPos(null);
      }
    };

    // Immediate one-shot for fast first fix + fly
    navigator.geolocation.getCurrentPosition(
      pos => handlePos(pos, true),
      handleErr,
      { enableHighAccuracy: true, timeout: 10000 }
    );

    // Continuous watch for live updates
    watchRef.current = navigator.geolocation.watchPosition(
      pos => handlePos(pos, false),
      handleErr,
      { enableHighAccuracy: true }
    );
  }

  // Cleanup watch on unmount
  useEffect(() => {
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    };
  }, []);

  // Proximity notifications when tracking
  const NEARBY_M = 80;
  useEffect(() => {
    if (!userPos || !locating || allPOIs.length === 0) return;
    const [lat, lng] = userPos;
    let closest: POI | null = null;
    let closestDist = Infinity;

    for (const poi of allPOIs) {
      const [pLat, pLng] = poi.coordinates;
      const d = distanceM(lat, lng, pLat, pLng);
      if (d <= NEARBY_M && d < closestDist) {
        closestDist = d;
        closest = poi;
      }
    }

    if (closest && !notifiedPoisRef.current.has(closest.id)) {
      notifiedPoisRef.current.add(closest.id);
      setNearbyPoi(closest);
      const closestId = closest.id;
      setTimeout(() => setNearbyPoi(p => p?.id === closestId ? null : p), 6000);

      if ('Notification' in window && Notification.permission === 'granted') {
        const title = closest.navn;
        const body = closest.beskrivelse
          ? closest.beskrivelse.slice(0, 100) + (closest.beskrivelse.length > 100 ? '…' : '')
          : `${Math.round(closestDist)}m unna`;
        const poiRef = closest;
        try {
          // new Notification() throws on Android Chrome (requires a service worker there);
          // the in-app banner above covers that case
          const notif = new Notification(title, { body, tag: closest.id });
          notif.onclick = () => { window.focus(); selectPOI(poiRef); };
        } catch { /* in-app banner is the fallback */ }
      }
    } else if (!closest) {
      setNearbyPoi(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPos, locating, allPOIs]);

  function toggleGroup(cats: string[]) {
    setActiveCats(prev => {
      const next = new Set(prev);
      const anyOn = cats.some(k => next.has(k));
      if (anyOn) cats.forEach(k => next.delete(k));
      else cats.forEach(k => next.add(k));
      return next;
    });
  }

  function toggleCat(k: string) {
    setActiveCats(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function toggleExpandedPlaceCat(k: string) {
    setExpandedPlaceCats(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  function toggleSaved(id: string) {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem('vl-saved', JSON.stringify([...next])); } catch { /* private mode etc. */ }
      return next;
    });
  }

  // Browse lists are capped lower than detail so the map always stays in view
  // (interactions like the sea-level slider have a visible effect). Natur is
  // capped lower still — its content is about the map.
  const SHEET_MAX_H = Math.min(window.innerHeight * (
    view === 'detail' || selectedNature ? 0.82 : tab === 'nature' ? 0.45 : 0.62
  ), 720);
  const TAB_BAR_H = 62; // keep in sync with --tab-h in index.css
  const MINI_CARD_H = 68;
  const SHEET_PEEK_H = 110; // grab handle + a sliver of the header, map stays mostly visible

  // After content renders, shrink sheet to fit actual content (avoids excess white space)
  useEffect(() => {
    if (!sheetOpen) { setAutoSheetH(null); return; }
    // Fresh content (a new selection, or the sheet just opened) always
    // starts fully open, not stuck peeked from whatever was shown before.
    setSheetPeeked(false);
    setDragH(null);
    const frame = requestAnimationFrame(() => {
      if (bodyRef.current) {
        const grabH = 30;
        const contentH = bodyRef.current.scrollHeight + grabH;
        setAutoSheetH(Math.min(contentH, SHEET_MAX_H));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [sheetOpen, view, selectedPOI, selectedTrail, selectedNature, selectedEra, selectedFarm, historyView, tab]);

  const SHEET_OPEN_H = autoSheetH ?? SHEET_MAX_H;
  const sheetCurrentH = sheetOpen
    ? (dragH ?? (sheetPeeked ? SHEET_PEEK_H : SHEET_OPEN_H))
    : SHEET_MAX_H;

  // Drag-to-resize on the grab handle — follows the finger/mouse 1:1 while
  // active, then snaps to peeked or fully open on release. A tap (near-zero
  // movement) toggles peeked/open instead; a tap while already peeked closes
  // the sheet entirely, so the handle still offers a full "back to map" path.
  //
  // Move/up listeners are on `document`, not the small grab handle itself —
  // relying only on element-scoped pointer events (even with
  // setPointerCapture) drops the drag the moment a fast finger movement
  // exits that ~40px-tall strip, which is the normal case for a real drag.
  function onGrabPointerDown(e: React.PointerEvent) {
    if (!sheetOpen) return;
    dragStartRef.current = { y: e.clientY, h: dragH ?? (sheetPeeked ? SHEET_PEEK_H : SHEET_OPEN_H), moved: false, cur: null };
    setIsDraggingSheet(true);
  }
  useEffect(() => {
    if (!isDraggingSheet) return;
    const handleMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dy = e.clientY - start.y;
      if (Math.abs(dy) > 4) start.moved = true;
      const newH = Math.min(SHEET_OPEN_H, Math.max(SHEET_PEEK_H, start.h - dy));
      start.cur = newH;
      setDragH(newH);
    };
    const handleUp = () => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      setIsDraggingSheet(false);
      if (!start) return;
      if (!start.moved) {
        // Plain tap: peek -> close, open -> peek.
        if (sheetPeeked) { closeSheet(); return; }
        setSheetPeeked(true);
        setDragH(null);
        return;
      }
      const settled = start.cur ?? start.h;
      const mid = (SHEET_PEEK_H + SHEET_OPEN_H) / 2;
      setSheetPeeked(settled < mid);
      setDragH(null);
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingSheet]);
  // Kart tab, nothing open: a selected POI shows as a compact mini-card above the tab bar
  // instead of pushing the full sheet up over the map.
  const showMiniCard = tab === 'map' && !sheetOpen && view === 'browse' && !!(selectedPOI || selectedTrail);
  // Offsets are measured within .vl-map-area, which already ends at the tab bar
  const railBottom = sheetOpen
    ? sheetCurrentH + 16
    : showMiniCard
      ? MINI_CARD_H + 28
      // Resting state (dock closed, nothing selected): sit well above the
      // dock instead of hugging it, so the cluster reads as map controls
      // rather than part of the dock.
      : Math.max(TAB_BAR_H + 14, window.innerHeight * 0.32);

  // Text strings
  const T = lang === 'no' ? {
    search: 'Søk på Veierland', all: 'Alle', explore: 'Utforsk Veierland',
    map: 'Kart', saved: 'Lagret',
    places: 'Steder', trails: 'Turer', nature: 'Natur', history: 'Historie', back: 'Tilbake',
    directions: 'Veibeskrivelse', length: 'Lengde', duration: 'Tid', diff: 'Vanskelighet', climb: 'Stigning',
    layers: 'Kartlag', nohit: 'Ingen treff', easy: 'Lett', showRoute: 'Vis rute',
    natObs: (n: number) => `${n} ${n === 1 ? 'art' : 'arter'} observert`,
    np: (n: number) => `${n} ${n === 1 ? 'sted' : 'steder'}`,
    nt: (n: number) => `${n} ${n === 1 ? 'tur' : 'turer'}`,
    tidslinje: 'Tidslinje', garder: 'Gårder',
    kontekst: 'Norsk kontekst', anekdoter: 'Historier',
  } : {
    search: 'Search Veierland', all: 'All', explore: 'Explore Veierland',
    map: 'Map', saved: 'Saved',
    places: 'Places', trails: 'Trails', nature: 'Nature', history: 'History', back: 'Back',
    directions: 'Directions', length: 'Length', duration: 'Time', diff: 'Difficulty', climb: 'Climb',
    layers: 'Map layer', nohit: 'No matches', easy: 'Easy', showRoute: 'Show route',
    natObs: (n: number) => `${n} ${n === 1 ? 'species' : 'species'} observed`,
    np: (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`,
    nt: (n: number) => `${n} ${n === 1 ? 'trail' : 'trails'}`,
    tidslinje: 'Timeline', garder: 'Farms',
    kontekst: 'Norwegian context', anekdoter: 'Stories',
  };

  // ── Render: nature ──────────────────────────────────────────────────────────

  function renderNature() {
    if (selectedNature) {
      const cfg = NATURE_GROUPS[selectedNature.group];
      const dateStr = selectedNature.date.slice(0, 10).replace(/-/g, '.');
      return (
        <>
          <button className="vl-back" onClick={() => { setSelectedNature(null); setSelectedNatureObs([]); }}><BackSvg />{T.back}</button>
          <div><span className="vl-catpill">{lang === 'no' ? cfg.no : cfg.en}</span></div>
          <div className="vl-h2">{selectedNature.popularName || selectedNature.scientificName}</div>
          {selectedNature.popularName && (
            <div className="vl-sub" style={{ marginBottom: 14 }}><em>{selectedNature.scientificName}</em></div>
          )}
          <div className="vl-trailmeta">
            <div className="vl-tm">
              <div className="k">{lang === 'no' ? 'Observasjoner' : 'Observations'}</div>
              <div className="v">{selectedNature.obsCount}</div>
            </div>
            <div className="vl-tm">
              <div className="k">{lang === 'no' ? 'Sist sett' : 'Last seen'}</div>
              <div className="v" style={{ fontSize: 14 }}>{dateStr}</div>
            </div>
          </div>
          {selectedNature.photoUrl && (
            <div style={{ marginBottom: 14 }}>
              <img src={selectedNature.photoUrl} alt={selectedNature.popularName || selectedNature.scientificName} className="vl-api-img" onError={hideBrokenImg} />
              {selectedNature.photoAttribution && (
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}
                  dangerouslySetInnerHTML={{ __html: selectedNature.photoAttribution }} />
              )}
            </div>
          )}

          {selectedNature.redListCategory && RED_LIST_CATS.test(selectedNature.redListCategory) && (
            <div className="vl-assess-box vl-rl-box">
              <div><span className="vl-rlbadge">{selectedNature.redListCategory}</span> <strong>{RL_LABEL[selectedNature.redListCategory]}</strong></div>
              <p>{RL_DESC[selectedNature.redListCategory]}</p>
              <a href="https://artsdatabanken.no/rodliste" target="_blank" rel="noreferrer">Norsk rødliste ↗</a>
            </div>
          )}
          {selectedNature.alienCategory && (
            <div className="vl-assess-box vl-al-box">
              <div><span className="vl-albadge">FA</span> <strong>Fremmedart i Norge</strong></div>
              <p>Arten er registrert som fremmed art i Norge og kan ha negativ effekt på hjemlige arter og naturmiljøer.</p>
              <a href="https://artsdatabanken.no/fremmedartslista" target="_blank" rel="noreferrer">Fremmedartslista ↗</a>
            </div>
          )}

          {speciesWikiLoading && (
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 0' }}>
              {lang === 'no' ? 'Henter artsinformasjon…' : 'Loading species info…'}
            </p>
          )}

          {speciesWiki && (
            <div className="vl-api-section">
              {!selectedNature.photoUrl && speciesWiki.imageUrl && (
                <img src={speciesWiki.imageUrl} alt={speciesWiki.title} className="vl-api-img" onError={hideBrokenImg} />
              )}
              <p className="vl-api-text">{speciesWiki.extract}</p>
              <a href={speciesWiki.pageUrl} target="_blank" rel="noreferrer" className="vl-api-link">
                {lang === 'no' ? 'Les mer på Wikipedia ↗' : 'Read more on Wikipedia ↗'}
              </a>
            </div>
          )}

          <a
            href={`https://www.gbif.org/species/${selectedNature.gbifKey}`}
            target="_blank" rel="noreferrer" className="vl-btn pri"
            style={{ textDecoration: 'none', marginBottom: 10 }}
          >
            Se art på GBIF ↗
          </a>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
            Kilde: GBIF (CC BY 4.0) · Wikipedia (CC BY-SA)
          </p>
        </>
      );
    }

    const natRow = (obs: NatureObs) => {
      const cfg = NATURE_GROUPS[obs.group];
      return (
        <div key={obs.gbifKey} className="vl-sp-row flat" onClick={() => selectNatureSpecies(obs)}>
          <span className="vl-sp-ico" style={{ background: `${cfg.color}1a`, color: cfg.color }}
            dangerouslySetInnerHTML={{ __html: iconSvg(cfg.icon) }} />
          <div className="vl-sp-main">
            <span className="vl-sp-name">{obs.popularName || obs.scientificName}</span>
            <span className="vl-sp-sci">{obs.popularName ? obs.scientificName : (lang === 'no' ? cfg.no : cfg.en)}</span>
          </div>
          <div className="vl-sp-right">
            {obs.redListCategory && RED_LIST_CATS.test(obs.redListCategory) && (
              <span className="vl-rlbadge" title={RL_LABEL[obs.redListCategory]}>{obs.redListCategory}</span>
            )}
            {obs.alienCategory && <span className="vl-albadge" title="Fremmedart">FA</span>}
            <span className="vl-sp-cnt">{obs.obsCount}</span>
            <span className="vl-chev"><ChevSvg /></span>
          </div>
        </div>
      );
    };

    return (
      <>
        <div className="vl-chips vl-panel-chips">
          <div className={`vl-chip lbl${!natureFilter ? ' on' : ''}`}
            onClick={() => { setNatureFilter(null); setNatureHlN(10); setNatureTopN(15); }} title={T.all}>
            <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('all') }} />
            <span className="cl">{T.all}</span>
          </div>
          {(Object.entries(NATURE_GROUPS) as [NatureGroup, typeof NATURE_GROUPS[NatureGroup]][]).map(([g, cfg]) => {
            const count = natureObs.filter(o => o.group === g).length;
            if (count === 0) return null;
            const label = `${lang === 'no' ? cfg.no : cfg.en} ${count}`;
            return (
              <div key={g} className={`vl-chip${natureFilter === g ? ' on' : ''}`}
                onClick={() => { setNatureFilter(natureFilter === g ? null : g); setNatureHlN(10); setNatureTopN(15); }} title={label}>
                <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg(cfg.icon) }} />
                <span className="cl">{label}</span>
              </div>
            );
          })}
        </div>
        {natureLoading && (
          <p className="vl-loading-blink" style={{ fontSize: 13, margin: '8px 0' }}>
            {lang === 'no' ? 'Henter siste observasjoner fra Artsdatabanken…' : 'Fetching latest observations from Artsdatabanken…'}
          </p>
        )}

        {natureHighlights.length > 0 && (
          <>
            <div className="vl-nat-sec">{lang === 'no' ? 'Høydepunkter' : 'Highlights'}</div>
            <p className="vl-nat-sec-sub">
              {lang === 'no' ? 'Rødlistede og fremmede arter observert på øya' : 'Red-listed and alien species observed on the island'}
            </p>
            {natureHighlights.slice(0, natureHlN).map(natRow)}
            {natureHighlights.length > natureHlN && (
              <button className="vl-showmore" onClick={() => setNatureHlN(n => n + 20)}>
                {lang === 'no' ? 'Vis flere' : 'Show more'} ({natureHighlights.length - natureHlN})
              </button>
            )}
          </>
        )}

        <div className="vl-nat-sec">{lang === 'no' ? 'Mest observert' : 'Most observed'}</div>
        {natureCommon.slice(0, natureTopN).map(natRow)}
        {natureCommon.length > natureTopN && (
          <button className="vl-showmore" onClick={() => setNatureTopN(n => n + 20)}>
            {lang === 'no' ? 'Vis flere' : 'Show more'} ({natureCommon.length - natureTopN})
          </button>
        )}

        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
          {T.natObs(filteredNatureObs.length)} · Kilde: GBIF (CC BY 4.0)
        </p>
      </>
    );
  }

  // ── Render: history ─────────────────────────────────────────────────────────

  function renderHistory() {
    const viewToggle = (
      <div className="vl-chips" style={{ marginBottom: 14 }}>
        <div className={`vl-chip${historyView === 'tidslinje' ? ' on' : ''}`}
          onClick={() => { setHistoryView('tidslinje'); setSelectedEra(null); setSelectedFarm(null); }}>
          <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('kart') }} />
          <span className="cl">{T.tidslinje}</span>
        </div>
        <div className={`vl-chip${historyView === 'garder' ? ' on' : ''}`}
          onClick={() => { setHistoryView('garder'); setSelectedEra(null); setSelectedFarm(null); }}>
          <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('hus') }} />
          <span className="cl">{T.garder}</span>
        </div>
      </div>
    );

    const nearestThresh = nearestFloodThreshold(seaLevelM);
    const seaSlider = (
      <div className="vl-sealevel" style={{ marginBottom: 14 }}>
        <div className="vl-sl-title">{lang === 'no' ? 'Historisk havnivå' : 'Historical sea level'}</div>
        <div className="vl-sl-label">
          {seaLevelLabel ?? (seaLevelM === 0 ? (lang === 'no' ? 'I dag' : 'Today') : `+${seaLevelM}m`)}
          {historyView === 'garder' && seaLevelM > 0 && (() => {
            const era = timelineSections.reduce((best, s) =>
              Math.abs(s.sea_level_m - seaLevelM) < Math.abs(best.sea_level_m - seaLevelM) ? s : best
            );
            return era ? <span style={{ display: 'block', fontSize: 11, fontWeight: 400, opacity: 0.65, marginTop: 2 }}>{era.period}</span> : null;
          })()}
        </div>
        <input type="range" min={0} max={15} step={1}
          value={seaLevelM} onChange={e => {
            const v = Number(e.target.value);
            setSeaLevelM(v); setSeaLevelLabel(null);
            if (seaActivePaneRef.current === 'a') setSeaLevelA(v); else setSeaLevelB(v);
          }}
          className="vl-sl-range" list="sea-level-ticks" />
        <datalist id="sea-level-ticks">
          {[0, 5, 10, 15].map(v => <option key={v} value={v} />)}
        </datalist>
        <div className="vl-sl-ticks">
          {([{ v: 0, l: lang === 'no' ? 'I dag' : 'Today' }, { v: 5, l: '+5m' }, { v: 10, l: '+10m' }, { v: 15, l: '+15m' }]).map(({ v, l }) => (
            <span key={v} style={{ left: `${(v / 15) * 100}%` }}>{l}</span>
          ))}
        </div>
        {seaLevelM > 0 && (
          <div className="vl-sl-desc">
            {nearestThresh !== null && nearestThresh !== seaLevelM
              ? (lang === 'no' ? `Overlay: ${nearestThresh}m-kontur. ` : `Overlay: ${nearestThresh}m contour. `)
              : ''}
            {lang === 'no'
              ? 'Blå overlay viser hva som var under vann.'
              : 'Blue overlay shows what was underwater.'}
          </div>
        )}
      </div>
    );

    if (selectedEra) {
      return (
        <>
          <button className="vl-back" onClick={() => { setSelectedEra(null); setSeaLevelLabel(null); }}><BackSvg />{T.back}</button>
          <div><span className="vl-catpill">{selectedEra.period}</span></div>
          <div className="vl-h2">{lang === 'no' ? selectedEra.title.no : selectedEra.title.en}</div>
          <div className="vl-sub" style={{ marginBottom: 12 }}>{selectedEra.era}</div>
          {selectedEra.image && (
            <div className="vl-era-img">
              <img src={selectedEra.image} alt={selectedEra.image_caption || selectedEra.era} onError={hideBrokenImg} />
              {selectedEra.image_caption && (
                <span className="vl-era-img-caption">{selectedEra.image_caption}</span>
              )}
            </div>
          )}
          <p className="vl-desc" style={{ whiteSpace: 'pre-line' }}>
            {lang === 'no' ? selectedEra.body.no : selectedEra.body.en}
          </p>
          {selectedEra.anekdoter.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{T.anekdoter}</div>
              {selectedEra.anekdoter.map((a, i) => (
                <div key={i} style={{
                  borderLeft: '3px solid var(--accent)',
                  paddingLeft: 12,
                  marginBottom: 10,
                  fontSize: 13,
                  color: 'var(--fg)',
                  fontStyle: 'italic',
                }}>
                  {a}
                </div>
              ))}
            </div>
          )}
          {selectedEra.kontekst_norge && (
            <div style={{
              background: 'var(--surface2,#f3f4f1)',
              borderRadius: 10,
              padding: '10px 14px',
              marginTop: 14,
              fontSize: 13,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{T.kontekst}</div>
              <p style={{ margin: 0, color: 'var(--fg)' }}>{selectedEra.kontekst_norge}</p>
            </div>
          )}
        </>
      );
    }

    if (selectedFarm) {
      return (
        <>
          <button className="vl-back" onClick={() => setSelectedFarm(null)}><BackSvg />{T.back}</button>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="vl-catpill">Gnr. {selectedFarm.gnr}</span>
            {selectedFarm.koordinat_sikkerhet && selectedFarm.koordinat_sikkerhet !== 'sikker' && (
              <span className="vl-catpill" style={{ background: selectedFarm.koordinat_sikkerhet === 'usikker' ? 'color-mix(in srgb, #e53e3e 12%, var(--card))' : 'color-mix(in srgb, var(--accent) 10%, var(--card))', color: selectedFarm.koordinat_sikkerhet === 'usikker' ? '#e53e3e' : 'var(--accent)', border: '1px solid currentColor' }}>
                📍 {selectedFarm.koordinat_sikkerhet === 'usikker' ? 'Usikker plassering' : 'Antatt plassering'}
              </span>
            )}
          </div>
          <div className="vl-h2">{selectedFarm.name}</div>
          {selectedFarm.norron_name && (
            <div className="vl-sub" style={{ marginBottom: 4 }}>
              <em>{selectedFarm.norron_name}</em> — {selectedFarm.meaning}
            </div>
          )}
          <div className="vl-sub" style={{ marginBottom: 12, fontSize: 12 }}>{selectedFarm.location}</div>
          <p className="vl-desc">{selectedFarm.history}</p>
          {selectedFarm.archaeology && (
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {lang === 'no' ? 'Arkeologi' : 'Archaeology'}
              </div>
              <p style={{ margin: 0, fontSize: 13 }}>{selectedFarm.archaeology}</p>
            </div>
          )}
          {selectedFarm.key_people.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {lang === 'no' ? 'Kjente personer' : 'Notable people'}
              </div>
              {selectedFarm.key_people.map((p, i) => (
                <div key={i} style={{ marginBottom: 8, fontSize: 13 }}>
                  <strong>{p.name}</strong> <span style={{ color: 'var(--muted)' }}>· {p.role} · {p.period}</span>
                  {p.note && <div style={{ color: 'var(--fg)', marginTop: 2 }}>{p.note}</div>}
                </div>
              ))}
            </div>
          )}
          {selectedFarm.ships_built.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {lang === 'no' ? 'Skuter bygget' : 'Ships built'}
              </div>
              {selectedFarm.ships_built.map((s, i) => (
                <div key={i} style={{ marginBottom: 6, fontSize: 13 }}>
                  <strong>{s.name}</strong> <span style={{ color: 'var(--muted)' }}>({s.type}, {s.year})</span>
                  {s.details && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{s.details}</div>}
                </div>
              ))}
            </div>
          )}
          {selectedFarm.anekdoter.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{T.anekdoter}</div>
              {selectedFarm.anekdoter.map((a, i) => (
                <div key={i} style={{
                  borderLeft: '3px solid var(--accent)',
                  paddingLeft: 12,
                  marginBottom: 10,
                  fontSize: 13,
                  color: 'var(--fg)',
                  fontStyle: 'italic',
                }}>
                  {a}
                </div>
              ))}
            </div>
          )}
          {selectedFarm.sources.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
              {lang === 'no' ? 'Kilder' : 'Sources'}: {selectedFarm.sources.join(' · ')}
            </p>
          )}
        </>
      );
    }

    if (historyView === 'tidslinje') {
      const era = timelineSections[eraNavIdx] ?? timelineSections[0];
      const n = timelineSections.length;
      const goEra = (idx: number) => {
        const i = Math.max(0, Math.min(n - 1, idx));
        const newLevel = timelineSections[i].sea_level_m;
        setEraNavIdx(i);
        setSeaLevelM(newLevel);
        setSeaLevelLabel(timelineSections[i].era);
        setLesmerEraExpanded(false);
        // Load new level into the inactive pane, then crossfade
        const next = seaActivePaneRef.current === 'a' ? 'b' : 'a';
        seaActivePaneRef.current = next;
        crossfadeReadyRef.current = true;
        if (next === 'b') setSeaLevelB(newLevel);
        else setSeaLevelA(newLevel);
      };
      return (
        <>
          {viewToggle}

          {/* ← → era navigator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <button onClick={() => goEra(eraNavIdx - 1)} disabled={eraNavIdx === 0}
              style={{ width: 46, height: 46, borderRadius: 14, background: 'var(--accent)', color: '#fff', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', opacity: eraNavIdx === 0 ? 0.38 : 1, flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.02em' }}>
                {eraNavIdx + 1} {lang === 'no' ? 'av' : 'of'} {n}
              </span>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                {timelineSections.map((_, i) => (
                  <div key={i} onClick={() => goEra(i)} style={{
                    width: i === eraNavIdx ? 18 : 8, height: 8, borderRadius: 99,
                    background: i === eraNavIdx ? 'var(--accent)' : '#D7D3C7',
                    cursor: 'pointer', transition: 'all .2s',
                  }} />
                ))}
              </div>
            </div>
            <button onClick={() => goEra(eraNavIdx + 1)} disabled={eraNavIdx === n - 1}
              style={{ width: 46, height: 46, borderRadius: 14, background: 'var(--accent)', color: '#fff', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', opacity: eraNavIdx === n - 1 ? 0.38 : 1, flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>

          {/* Era content card */}
          <div style={{ background: 'color-mix(in srgb, var(--accent) 8%, var(--card))', border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)', borderRadius: 16, padding: '16px 18px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{era.period}</div>
              {era.sea_level_m > 0 && (
                <div
                  title={lang === 'no' ? `Havet stod ca. ${era.sea_level_m} meter høyere enn i dag. Det blå overlayet viser hva som var under vann.` : `Sea level was ~${era.sea_level_m}m higher than today. The blue overlay shows what was underwater.`}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--accent)', fontWeight: 700, flexShrink: 0, cursor: 'help' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 12h2a2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1 2 2h2"/><path d="M2 18h2a2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1 2 2h2"/></svg>
                  {lang === 'no' ? `+${era.sea_level_m}m hav` : `+${era.sea_level_m}m sea`}
                </div>
              )}
            </div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 24, fontWeight: 500, lineHeight: 1.15, marginBottom: 6, color: 'var(--ink)' }}>{era.era}</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10, color: 'var(--ink2, var(--muted))' }}>{lang === 'no' ? era.title.no : era.title.en}</div>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0, color: 'var(--ink)' }}>
              {lang === 'no' ? era.body.no : era.body.en}
            </p>
            {(lang === 'no' ? era.body_lang?.no : era.body_lang?.en) && !lesmerEraExpanded && (
              <button
                onClick={() => setLesmerEraExpanded(true)}
                style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4, font: 'inherit' }}
              >
                Les mer
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,5 7,9 11,5"/></svg>
              </button>
            )}
            {(lang === 'no' ? era.body_lang?.no : era.body_lang?.en) && lesmerEraExpanded && (
              <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 10, marginBottom: 0, color: 'var(--ink)' }}>
                {lang === 'no' ? era.body_lang!.no : era.body_lang!.en}
              </p>
            )}
          </div>

          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            {lang === 'no' ? 'Kilde: Veierland Velforening, Nøtterøy Historielag m.fl.' : 'Source: Veierland Velforening, Nøtterøy Historielag et al.'}
          </p>
        </>
      );
    }

    // Gårder view
    const garderPoint = GARDER_TIMELINE[garderTimeIdx];
    const garderFloodLevel = garderPoint.sea_level_m;

    const garderTimeSlider = (
      <div className="vl-sealevel" style={{ marginBottom: 14 }}>
        <div className="vl-sl-title">{lang === 'no' ? 'Historisk havnivå' : 'Historical sea level'}</div>
        <div className="vl-sl-label">
          {garderPoint.label}
          {garderPoint.sea_level_m > 0
            ? <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--accent)', marginTop: 1 }}>
                +{garderPoint.sea_level_m}m hav
              </span>
            : <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--muted)', marginTop: 1 }}>
                {lang === 'no' ? 'Dagens nivå' : 'Current level'}
              </span>
          }
        </div>
        <input type="range" min={0} max={GARDER_TIMELINE.length - 1} step={1}
          value={garderTimeIdx}
          onChange={e => {
            const i = Number(e.target.value);
            setGarderTimeIdx(i);
            const lvl = GARDER_TIMELINE[i].sea_level_m;
            setSeaLevelM(lvl); setSeaLevelLabel(null);
            if (seaActivePaneRef.current === 'a') setSeaLevelA(lvl); else setSeaLevelB(lvl);
          }}
          className="vl-sl-range" />
        <div className="vl-sl-ticks">
          {([0, 6, 12, 15] as const).map(i => (
            <span key={i} style={{ left: `${(i / (GARDER_TIMELINE.length - 1)) * 100}%` }}>
              {i === 15 ? (lang === 'no' ? 'I dag' : 'Today') : GARDER_TIMELINE[i].label}
            </span>
          ))}
        </div>
        {garderFloodLevel > 0 && (
          <div className="vl-sl-desc">
            {lang === 'no' ? 'Blå overlay viser hva som var under vann.' : 'Blue overlay shows what was underwater.'}
          </div>
        )}
      </div>
    );

    return (
      <>
        {viewToggle}
        {garderTimeSlider}
        {visibleFarms.map((farm, i) => {
          const coords = farmCoords[farm.name];
          return (
            <div key={i} className="vl-poi-card">
              <div className="vl-poi-zone" onClick={() => {
                if (coords) mapRef.current?.setView(coords, Math.max(mapZoom, 14));
              }}>
                <div className="vl-poi-ico"
                  style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}
                  dangerouslySetInnerHTML={{ __html: iconSvg('hus') }} />
                <div className="vl-poi-body">
                  <h4>{farm.name}</h4>
                  <p>{farm.norron_name ? `${farm.norron_name} · ` : ''}{farm.location}</p>
                </div>
              </div>
              <div className="vl-poi-sep" />
              <div className="vl-poi-arr" onClick={() => {
                setSelectedFarm(farm);
                setSheetOpen(true);
                if (coords) mapRef.current?.setView(coords, Math.max(mapZoom, 14));
              }}>
                <ChevSvg />
              </div>
            </div>
          );
        })}
      </>
    );
  }

  // ── Render: browse ──────────────────────────────────────────────────────────

  function renderBrowse() {
    return (
      <>
        {/* Filter chips — icon-only, expand to a labeled pill when active */}
        {mode === 'places' && (
          <div className="vl-chips vl-panel-chips">
            <div className={`vl-chip lbl${activeCats.size === 0 ? ' on' : ''}`} onClick={() => setActiveCats(new Set())} title={T.all}>
              <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('all') }} />
              <span className="cl">{T.all}</span>
            </div>
            {[...catGroups.entries()].map(([groupName, groupCats]) => {
              const on = groupCats.some(k => activeCats.has(k));
              const groupColor = (catCfg as Record<string, {color?: string}>)[groupCats[0]]?.color ?? 'var(--muted)';
              return (
                /* Group chips keep their label — the borrowed first-category icon
                   alone reads as the wrong thing (a wave for "Praktisk") */
                <div key={groupName} className={`vl-chip lbl${on ? ' on' : ''}`}
                  style={{ '--chip-color': groupColor } as React.CSSProperties}
                  onClick={() => toggleGroup(groupCats)} title={groupName}>
                  <span className="cl">{groupName}</span>
                </div>
              );
            })}
            {allCats.filter(k => !(catCfg as Record<string, {group?: string}>)[k]?.group).map(k => {
              const cat = getCat(k);
              const on = activeCats.has(k);
              return (
                <div key={k} className={`vl-chip${on ? ' on' : ''}`}
                  style={{ '--chip-color': cat.color } as React.CSSProperties}
                  onClick={() => toggleCat(k)} title={lang === 'no' ? cat.no : cat.en}>
                  <span className="ci" style={{ color: on ? undefined : cat.color }} dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                  <span className="cl">{lang === 'no' ? cat.no : cat.en}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Search (places mode only) */}
        {mode === 'places' && (
          <div className="vl-panel-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>
            </svg>
            <input
              type="search"
              placeholder={T.search}
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              autoComplete="off"
            />
            {searchQ && (
              <button className="vl-search-close" onClick={() => setSearchQ('')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
        )}

        {mode === 'places' ? (
          <>
            {/* Place-name lookups (66 of ~98 entries) would drown the real count */}
            <div className="vl-count">{(() => {
              const sn = filteredPOIs.filter(p => p.kategori === 'stedsnavn').length;
              const main = filteredPOIs.length - sn;
              if (!filteredPOIs.length) return T.nohit;
              return T.np(main) + (sn ? ` · ${sn} ${lang === 'no' ? 'stedsnavn' : 'place names'}` : '');
            })()}</div>
            {filteredPOIs.length === 0 && (searchQ || activeCats.size > 0) && (
              <div className="vl-empty">
                <p>{lang === 'no' ? 'Ingen steder passer søket ditt.' : 'No places match your search.'}</p>
                <button className="vl-empty-clear" onClick={() => { setSearchQ(''); setActiveCats(new Set()); }}>
                  {lang === 'no' ? 'Nullstill søk' : 'Clear search'}
                </button>
              </div>
            )}
            {groupedPOIs.map(([catKey, pois]) => {
              const cat = getCat(catKey);
              // Auto-expand while searching/filtering — a filtered list of
              // closed accordions shows nothing
              const isOpen = expandedPlaceCats.has(catKey) || !!searchQ || activeCats.size > 0;
              return (
                <div key={catKey} className={`vl-nat-grp${isOpen ? ' open' : ''}`}>
                  <div className="vl-grp-hdr" onClick={() => toggleExpandedPlaceCat(catKey)}>
                    <span className="vl-grp-ico" style={{ color: isOpen ? cat.color : undefined }} dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                    <span className="vl-grp-lbl" style={{ color: isOpen ? cat.color : undefined }}>{lang === 'no' ? cat.no : cat.en}</span>
                    <span className="vl-grp-cnt">{pois.length}</span>
                    <span className={`vl-chev${isOpen ? ' open' : ''}`}><ChevSvg /></span>
                  </div>
                  {isOpen && (
                    <div className="vl-grp-children">
                      {pois.map(poi => (
                        <div key={poi.id} className="vl-poi-card">
                          <div className="vl-poi-zone"
                            onClick={() => showOnMap(poi)}>
                            <div className="vl-poi-ico"
                              style={{ background: `${cat.color}1a`, color: cat.color }}
                              dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                            <div className="vl-poi-body">
                              <h4>{poi.navn}</h4>
                              <p>{walkShort(poi.coordinates)}{poi.beskrivelse ? ` · ${poi.beskrivelse}` : ''}</p>
                            </div>
                          </div>
                          <div className="vl-poi-sep" />
                          <div className="vl-poi-arr" onClick={() => selectPOI(poi)}>
                            <ChevSvg />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <>
            <div className="vl-count">{T.nt(trails.length)}</div>
            {trails.length === 0 && (
              <div style={{ textAlign: 'center', padding: '28px 16px 8px', color: 'var(--muted)', fontSize: 14, lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 6px' }}>
                  {lang === 'no' ? 'Ingen turer er registrert ennå.' : 'No trails registered yet.'}
                </p>
                <p style={{ margin: 0, fontSize: 13 }}>
                  {lang === 'no' ? 'Kjenner du til en tur? Ta kontakt og bidra til kartet.' : 'Know a trail? Contact us and contribute to the map.'}
                </p>
              </div>
            )}
            {trails.map(tr => (
              <div key={tr.id} className="vl-poi-card">
                <div className="vl-poi-zone" onClick={() => selectTrail(tr)}>
                  <div className="vl-poi-ico"
                    style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
                    dangerouslySetInnerHTML={{ __html: iconSvg('tur') }} />
                  <div className="vl-poi-body">
                    <h4>{lang === 'no' ? tr.name : tr.en}</h4>
                    <p>{tr.km} · {tr.time} · {lang === 'no' ? tr.diff : T.easy}</p>
                  </div>
                </div>
                <div className="vl-poi-sep" />
                <div className="vl-poi-arr" onClick={() => selectTrail(tr)}>
                  <ChevSvg />
                </div>
              </div>
            ))}
          </>
        )}
      </>
    );
  }

  // ── Render: Lagret (saved) ──────────────────────────────────────────────────

  function renderSaved() {
    const savedPOIs = allPOIs.filter(p => savedIds.has(p.id));
    const savedTrails = trails.filter(tr => savedIds.has(tr.id));
    const total = savedPOIs.length + savedTrails.length;
    if (total === 0) {
      return (
        <div className="vl-empty">
          <div style={{ opacity: 0.5, marginBottom: 8, display: 'flex', justifyContent: 'center' }}><HeartSvg /></div>
          <p>{lang === 'no' ? 'Ingenting lagret ennå. Trykk på hjertet på et sted eller en tur.' : 'Nothing saved yet. Tap the heart on a place or trail.'}</p>
        </div>
      );
    }
    return (
      <>
        <div className="vl-count">{total}</div>
        {savedPOIs.map(poi => {
          const cat = getCat(poi.kategori);
          return (
            <div key={poi.id} className="vl-poi-card">
              <div className="vl-poi-zone" onClick={() => showOnMap(poi)}>
                <div className="vl-poi-ico" style={{ background: `${cat.color}1a`, color: cat.color }}
                  dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                <div className="vl-poi-body">
                  <h4>{poi.navn}</h4>
                  <p>{walkShort(poi.coordinates)}{poi.beskrivelse ? ` · ${poi.beskrivelse}` : ''}</p>
                </div>
              </div>
              <div className="vl-poi-sep" />
              <div className="vl-poi-arr" onClick={() => selectPOI(poi)}>
                <ChevSvg />
              </div>
            </div>
          );
        })}
        {savedTrails.map(tr => (
          <div key={tr.id} className="vl-poi-card">
            <div className="vl-poi-zone" onClick={() => selectTrail(tr)}>
              <div className="vl-poi-ico" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
                dangerouslySetInnerHTML={{ __html: iconSvg('tur') }} />
              <div className="vl-poi-body">
                <h4>{lang === 'no' ? tr.name : tr.en}</h4>
                <p>{tr.km} · {tr.time} · {lang === 'no' ? tr.diff : T.easy}</p>
              </div>
            </div>
            <div className="vl-poi-sep" />
            <div className="vl-poi-arr" onClick={() => selectTrail(tr)}>
              <ChevSvg />
            </div>
          </div>
        ))}
      </>
    );
  }

  // ── Render: POI detail ──────────────────────────────────────────────────────

  function renderPOIDetail(poi: POI) {
    const cat = getCat(poi.kategori);
    const saved = savedIds.has(poi.id);
    // Opened straight from a map tap (not from a list): dragging the sheet
    // down to peek (or tapping again to close) already gets back to the
    // map, so a dedicated button here would be redundant. Opened from a
    // list (Steder etc. via the menu), "back" is real navigation — it
    // returns to that list — which the peek gesture can't replicate.
    const backRedundant = tab === 'map' && !isDesktopView();
    return (
      <>
        {!backRedundant && <button className="vl-back" onClick={goBack}><BackSvg />{T.back}</button>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(poi.kategorier ?? [poi.kategori]).map(k => {
            const c = getCat(k);
            return (
              <span key={k} className="vl-catpill" style={{
                background: `${c.color}1a`,
                color: c.color,
                borderColor: `${c.color}44`,
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, display: 'inline-block', marginRight: 5, verticalAlign: 'middle', flexShrink: 0 }} />
                {lang === 'no' ? c.no : c.en}
              </span>
            );
          })}
        </div>
        <div className="vl-h2">{poi.navn}</div>
        <div className="vl-walkline">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="13" cy="4" r="1.7"/><path d="M11 8l3 2 1 4M11 8l-2 4-2 5M14 14l-1 6M9 12l-3 3"/></svg>
          {walkLong(poi.coordinates)}
        </div>
        {isBeachPOI && (() => {
          const sun = hasDomGrid ? sunlitAt(poi.coordinates[0], poi.coordinates[1], new Date()) : null;
          const lee = hasDomGrid && weatherNow ? shelterAt(poi.coordinates[0], poi.coordinates[1], weatherNow.windFromDeg) : null;
          const leeLabel = lee === null ? null
            : lee > 0.6 ? (lang === 'no' ? 'God le' : 'Sheltered')
            : lee > 0.25 ? (lang === 'no' ? 'Litt le' : 'Some shelter')
            : (lang === 'no' ? 'Vindutsatt' : 'Windy');
          return (
            <div className="vl-beachcond">
              {seaTemp !== null && (
                <div className="bc">
                  <span className="k">{lang === 'no' ? 'Badetemp' : 'Sea temp'}</span>
                  <span className="v">{seaTemp.toFixed(1)}°</span>
                </div>
              )}
              {sun !== null && (
                <div className="bc">
                  <span className="k">{lang === 'no' ? 'Sol nå' : 'Sun now'}</span>
                  <span className="v">{sun ? (lang === 'no' ? '☀︎ Sol' : '☀︎ Sunny') : (lang === 'no' ? '☁ Skygge' : '☁ Shade')}</span>
                </div>
              )}
              {leeLabel && (
                <div className="bc">
                  <span className="k">{lang === 'no' ? 'Vind' : 'Wind'}</span>
                  <span className="v">{leeLabel}{weatherNow ? ` · ${windDirLabel(weatherNow.windFromDeg, lang)} ${Math.round(weatherNow.windSpeed)} m/s` : ''}</span>
                </div>
              )}
              {seaTemp === null && sun === null && !leeLabel && (
                <p className="vl-fempty" style={{ margin: 0 }}>{lang === 'no' ? 'Henter forhold…' : 'Loading conditions…'}</p>
              )}
            </div>
          );
        })()}
        {selectedQuay && (
          <div className="vl-quayferry">
            <h5>
              <span className="fi" dangerouslySetInnerHTML={{ __html: iconSvg('ferge') }} />
              {(lang === 'no' ? 'Neste avganger herfra' : 'Next departures from here')
                + (quayBoard && quayBoard.tomorrow ? (lang === 'no' ? ' · i morgen' : ' · tomorrow') : '')}
            </h5>
            {quayBoard === undefined && (
              <p className="vl-fempty">{lang === 'no' ? 'Henter rutetider…' : 'Loading timetable…'}</p>
            )}
            {quayBoard === null && (
              <p className="vl-fempty">{lang === 'no' ? 'Fikk ikke hentet rutetidene akkurat nå.' : 'Could not load the timetable right now.'}</p>
            )}
            {quayBoard && quayBoard.sailings.length === 0 && (
              <p className="vl-fempty">{lang === 'no' ? 'Ingen flere avganger.' : 'No more departures.'}</p>
            )}
            {quayBoard && quayBoard.sailings.map((sl, i) => (
              <div key={i} className="vl-fdep">
                <div className="hd">
                  <b>{fmtDepTime(sl.time)}</b>
                  <span className="fq">→ {sl.calls.map(c => `${c.name} ${fmtDepTime(c.time)}`).join(' · ')}</span>
                  {!quayBoard.tomorrow && <span className="in">{minsUntil(sl.time)} min</span>}
                </div>
              </div>
            ))}
            <a className="vl-flink" href="https://jutoya.veierland.org/" target="_blank" rel="noreferrer">
              {lang === 'no' ? 'Full ruteplan og reiseplanlegger ↗' : 'Full timetable & planner ↗'}
            </a>
          </div>
        )}
        <p className="vl-desc">{poi.beskrivelse}</p>
        {poi.beskrivelse_lang && !lesmerExpanded && (
          <button
            onClick={() => setLesmerExpanded(true)}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', fontWeight: 600, fontSize: 14, cursor: 'pointer', marginTop: -8, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 4 }}
          >
            Les mer
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        )}
        {poi.beskrivelse_lang && lesmerExpanded && (
          <p className="vl-desc" style={{ marginTop: -8 }}>{poi.beskrivelse_lang}</p>
        )}

        {poi.bilde && (
          <div className="vl-poi-static-img">
            <img src={poi.bilde} alt={poi.navn} onError={hideBrokenImg} />
            {poi.bilde_lisens && <span className="vl-photo-credit">{poi.bilde_lisens}</span>}
          </div>
        )}

        {wikimediaImages.length === 1 && (
          <a href={wikimediaImages[0].pageUrl} target="_blank" rel="noreferrer" className="vl-poi-static-img" style={{ display: 'block', textDecoration: 'none' }}>
            <img src={wikimediaImages[0].thumbUrl} alt={wikimediaImages[0].title} style={{ width: '100%', height: 220, objectFit: 'cover', borderRadius: 10, display: 'block' }} onError={hideBrokenImg} />
            {wikimediaImages[0].author && (
              <span className="vl-photo-credit">{wikimediaImages[0].license} · {wikimediaImages[0].author}</span>
            )}
          </a>
        )}
        {wikimediaImages.length > 1 && (
          <div className="vl-photo-strip-wrap">
            <div className="vl-photo-strip">
              {wikimediaImages.map((img, i) => (
                <a key={i} href={img.pageUrl} target="_blank" rel="noreferrer" className="vl-photo-thumb">
                  <img src={img.thumbUrl} alt={img.title} onError={hideBrokenImg} />
                  {img.author && (
                    <span className="vl-photo-credit">{img.license} · {img.author}</span>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {poi.datering && (
          <p className="vl-extra-meta"><strong>Datering:</strong> {poi.datering}</p>
        )}
        {poi.vernestatus && (
          <p className="vl-extra-meta"><strong>Vernestatus:</strong> {poi.vernestatus}</p>
        )}

        <div className="vl-actions">
          <button
            className={`vl-btn sec${saved ? ' on' : ''}${heartAnim ? ' heart-pop' : ''}`}
            onClick={() => { toggleSaved(poi.id); setHeartAnim(true); setTimeout(() => setHeartAnim(false), 350); }}
            style={{ flex: '0 0 auto' }}
            aria-label={saved ? 'Fjern fra favoritter' : 'Lagre som favoritt'}
          >
            <HeartSvg />
          </button>
          {poi.nettside && (
            <a href={poi.nettside} target="_blank" rel="noreferrer" className="vl-btn pri">
              Nettside ↗
            </a>
          )}
          {poi.askeladden_url && (
            <a href={poi.askeladden_url} target="_blank" rel="noreferrer" className="vl-btn pri">
              <RouteSvg /> Askeladden ↗
            </a>
          )}
        </div>

        {apiLoading && (
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 0' }}>Henter data…</p>
        )}

        {lokalData && (() => {
          const MAX = 320;
          const isTruncatable = !lokalExpanded && lokalData.tekst.length > MAX;
          const cutAt = lokalData.tekst.lastIndexOf(' ', MAX);
          const displayText = isTruncatable
            ? lokalData.tekst.slice(0, cutAt > 0 ? cutAt : MAX) + '…'
            : lokalData.tekst;
          return (
            <div className="vl-api-section">
              <p className="vl-api-label">Lokalhistoriewiki</p>
              {lokalData.bilde && (
                <img src={lokalData.bilde} alt={lokalData.tittel} className="vl-api-img" onError={hideBrokenImg} />
              )}
              <p className="vl-api-text">{displayText}</p>
              {isTruncatable && (
                <button onClick={() => setLokalExpanded(true)}
                  style={{ background: 'none', border: 'none', padding: '0 0 6px', cursor: 'pointer', color: 'var(--accent)', fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 4, font: 'inherit' }}>
                  Les mer
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3,5 7,9 11,5"/></svg>
                </button>
              )}
              <a href={lokalData.url} target="_blank" rel="noreferrer" className="vl-api-link">
                Les mer på Lokalhistoriewiki.no ↗
              </a>
            </div>
          );
        })()}

        {snlData && !lokalData && (
          <div className="vl-api-section">
            <p className="vl-api-label">Store norske leksikon</p>
            <p className="vl-api-text">{snlData.ingress}</p>
            <a href={snlData.url} target="_blank" rel="noreferrer" className="vl-api-link">
              Les mer på SNL.no ↗
            </a>
          </div>
        )}

        {dimuData.length > 0 && (
          <div className="vl-api-section">
            <p className="vl-api-label">Historiske bilder</p>
            {dimuData.map(img => (
              <div key={img.id} style={{ marginBottom: 12 }}>
                {img.bilde600 && (
                  <img src={img.bilde600} alt={img.tittel} className="vl-api-img" onError={hideBrokenImg} />
                )}
                <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 2px' }}>
                  {img.tittel}{img.fraTid ? ` (${img.fraTid})` : ''}
                </p>
                <a href={img.objektUrl} target="_blank" rel="noreferrer" className="vl-api-link">
                  Foto: DigitaltMuseum ↗
                </a>
              </div>
            ))}
          </div>
        )}

        {!apiLoading && !lokalData && !snlData && dimuData.length === 0
          && (poi.snl_søkeord || poi.lokalhistoriewiki || poi.dimu_søk) && (
          <p className="vl-api-empty">
            {lang === 'no' ? 'Ingen tilleggsinformasjon tilgjengelig.' : 'No additional information available.'}
          </p>
        )}
      </>
    );
  }

  // ── Render: trail detail ────────────────────────────────────────────────────

  const MODE_ICON: Record<string, string> = { gaa: 'gaatur', lop: 'lopetur', sykkel: 'sykkel' };
  const MODE_LABEL_NO: Record<string, string> = { gaa: 'Gåtur', lop: 'Løping', sykkel: 'Sykling' };
  const MODE_LABEL_EN: Record<string, string> = { gaa: 'Walking', lop: 'Running', sykkel: 'Cycling' };

  function renderTrailDetail(trail: Trail) {
    const cat = getCat('friluft');
    const saved = savedIds.has(trail.id);
    // See renderPOIDetail's identical check: redundant once opened from a
    // map tap, since drag-to-peek/close already gets back to the map.
    const backRedundant = tab === 'map' && !isDesktopView();
    return (
      <>
        {!backRedundant && <button className="vl-back" onClick={goBack}><BackSvg />{T.back}</button>}
        <div><span className="vl-catpill">{lang === 'no' ? 'Tursti' : 'Trail'}</span></div>
        <div className="vl-h2">{lang === 'no' ? trail.name : trail.en}</div>
        <div className="vl-sub">{lang === 'no' ? trail.en : trail.name}</div>
        <div className="vl-trailmeta">
          <div className="vl-tm">
            <div className="k">{T.length}</div>
            <div className="v">{trail.km}</div>
          </div>
          <div className="vl-tm">
            <div className="k">{T.duration}</div>
            <div className="v">{trail.time}</div>
          </div>
          <div className="vl-tm">
            <div className="k">{T.diff}</div>
            <div className="v">{lang === 'no' ? trail.diff : T.easy}</div>
          </div>
          {trail.climb && (
            <div className="vl-tm">
              <div className="k">{T.climb}</div>
              <div className="v">{trail.climb}</div>
            </div>
          )}
        </div>
        {trail.modes && trail.modes.length > 0 && (
          <div className="vl-trailmodes">
            {trail.modes.map(m => (
              <div key={m.mode} className="vl-tmode" title={lang === 'no' ? MODE_LABEL_NO[m.mode] : MODE_LABEL_EN[m.mode]}>
                <span className="ic" dangerouslySetInnerHTML={{ __html: iconSvg(MODE_ICON[m.mode]) }} />
                <span className="tid">{m.tid}</span>
              </div>
            ))}
          </div>
        )}
        {trail.profile && trail.minEl !== undefined && trail.maxEl !== undefined && (
          <ElevationChart profile={trail.profile} minEl={trail.minEl} maxEl={trail.maxEl} />
        )}
        <p className="vl-desc">{lang === 'no' ? trail.no : trail.enT}</p>
        <div className="vl-actions">
          <button
            className={`vl-btn sec${saved ? ' on' : ''}`}
            onClick={() => toggleSaved(trail.id)}
            style={{ flex: '0 0 auto' }}
          >
            <HeartSvg />
          </button>
          <button
            className="vl-btn pri"
            onClick={() => {
              setTrailPath(trail.path);
              const bounds = L.latLngBounds(trail.path);
              if (isDesktopView()) {
                mapRef.current?.fitBounds(bounds.pad(0.35), { paddingBottomRight: [0, 40] });
                return;
              }
              // Collapse to the map so the route is actually visible; the trail
              // lives on as a mini-card that reopens this detail view.
              setView('browse');
              setTab('map');
              setSheetOpen(false);
              mapRef.current?.fitBounds(bounds.pad(0.2), { paddingTopLeft: [20, 90], paddingBottomRight: [20, 110] });
            }}
          >
            <RouteSvg /> {T.showRoute}
          </button>
        </div>

        {/* POI filter + list */}
        {(() => {
          // Along/All toggle
          const toggleRow = (
            <div style={{ display: 'flex', gap: 6, margin: '18px 0 10px' }}>
              {(['along', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setTrailPoiFilter(f)}
                  style={{
                    flex: 1, padding: '7px 0', borderRadius: 20, border: '1.5px solid',
                    borderColor: trailPoiFilter === f ? 'var(--accent)' : 'var(--border)',
                    background: trailPoiFilter === f ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                    color: trailPoiFilter === f ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: trailPoiFilter === f ? 600 : 400, fontSize: 13, cursor: 'pointer',
                  }}
                >
                  {f === 'along' ? (lang === 'no' ? 'Langs ruta' : 'Along route') : (lang === 'no' ? 'Alle steder' : 'All places')}
                </button>
              ))}
            </div>
          );

          // Category chips
          const chipRow = (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {(Object.keys(TRAIL_CAT_GROUPS) as (keyof typeof TRAIL_CAT_GROUPS)[]).map(key => {
                const grp = TRAIL_CAT_GROUPS[key];
                const on = trailCatFilter === key;
                return (
                  <button key={key} onClick={() => setTrailCatFilter(key)} style={{
                    padding: '4px 12px', borderRadius: 20, border: '1.5px solid',
                    borderColor: on ? 'var(--accent)' : 'var(--border)',
                    background: on ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                    color: on ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: on ? 600 : 400, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>
                    {lang === 'no' ? grp.no : grp.en}
                  </button>
                );
              })}
            </div>
          );

          // ── Natur: show GBIF species observations along trail ──────────────────
          if (trailCatFilter === 'natur') {
            if (natureLoading && natureObs.length === 0) {
              return <>{toggleRow}{chipRow}<p style={{ fontSize: 13, color: 'var(--muted)' }}>Henter naturdata…</p></>;
            }
            // Filter observations by proximity
            const nearbyObs = natureObs.filter(obs =>
              trailPoiFilter === 'all' || pointToPolylineDistM([obs.lat, obs.lng], trail.path) <= 20
            );
            // Deduplicate per species, count nearby obs per species
            const speciesMap = new Map<number, { obs: NatureObs; count: number }>();
            for (const obs of nearbyObs) {
              const entry = speciesMap.get(obs.gbifKey);
              if (entry) entry.count++;
              else speciesMap.set(obs.gbifKey, { obs, count: 1 });
            }
            const species = [...speciesMap.values()].sort((a, b) => b.count - a.count);
            return (
              <>
                {toggleRow}{chipRow}
                {natureLoading && <p style={{ fontSize: 12, color: 'var(--muted)', margin: '-4px 0 8px' }}>Oppdaterer…</p>}
                {species.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 8px' }}>
                    {lang === 'no' ? 'Ingen naturobservasjoner langs ruta.' : 'No nature observations along this route.'}
                  </p>
                ) : (
                  species.map(({ obs, count }) => {
                    const grp = NATURE_GROUPS[obs.group];
                    return (
                      <div key={obs.gbifKey} className="vl-poi-card">
                        <div className="vl-poi-zone" onClick={() => {
                          selectNatureSpecies(obs);
                          setMode('nature');
                        }}>
                          <div className="vl-poi-ico" style={{ background: `${grp.color}1a`, color: grp.color }}
                            dangerouslySetInnerHTML={{ __html: iconSvg(grp.icon) }} />
                          <div className="vl-poi-body">
                            <h4>{obs.popularName || obs.scientificName}</h4>
                            <p style={{ fontStyle: obs.popularName ? 'normal' : 'italic' }}>
                              {obs.popularName ? obs.scientificName : (lang === 'no' ? grp.no : grp.en)}
                              {' · '}{count} obs.
                            </p>
                          </div>
                        </div>
                        <div className="vl-poi-sep" />
                        <div className="vl-poi-arr" onClick={() => { selectNatureSpecies(obs); setMode('nature'); }}>
                          <ChevSvg />
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            );
          }

          // ── Regular POI categories ─────────────────────────────────────────────
          const catKeys = TRAIL_CAT_GROUPS[trailCatFilter].cats;
          const nearbyPOIs = allPOIs.filter(p => {
            if (!p.coordinates) return false;
            if (trailPoiFilter === 'along' && pointToPolylineDistM(p.coordinates as [number, number], trail.path) > 20) return false;
            if (catKeys && !catKeys.includes(p.kategori)) return false;
            return true;
          });
          return (
            <>
              {toggleRow}{chipRow}
              {nearbyPOIs.length === 0 ? (
                <div style={{ margin: '4px 0 12px' }}>
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>
                    {trailPoiFilter === 'along'
                      ? (lang === 'no' ? 'Ingen steder i denne kategorien langs ruta.' : 'No places in this category along the route.')
                      : (lang === 'no' ? 'Ingen steder å vise.' : 'No places to show.')}
                  </p>
                  {trailPoiFilter === 'along' && (
                    <button
                      onClick={() => setTrailPoiFilter('all')}
                      style={{ fontSize: 13, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600 }}
                    >
                      {lang === 'no' ? 'Vis alle steder →' : 'Show all places →'}
                    </button>
                  )}
                </div>
              ) : (
                nearbyPOIs.map(poi => {
                  const cat = getCat(poi.kategori);
                  return (
                    <div key={poi.id} className="vl-poi-card">
                      <div className="vl-poi-zone" onClick={() => showOnMap(poi)}>
                        <div className="vl-poi-ico"
                          style={{ background: `${cat.color}1a`, color: cat.color }}
                          dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                        <div className="vl-poi-body">
                          <h4>{poi.navn}</h4>
                          {poi.beskrivelse && <p>{poi.beskrivelse}</p>}
                        </div>
                      </div>
                      <div className="vl-poi-sep" />
                      <div className="vl-poi-arr" onClick={() => selectPOI(poi)}>
                        <ChevSvg />
                      </div>
                    </div>
                  );
                })
              )}
            </>
          );
        })()}
      </>
    );
  }


  // ── Render ──────────────────────────────────────────────────────────────────

  // How much space to reserve at the bottom of the map for the dock (mobile
  // only — desktop overrides --dock-h to `auto` via CSS). The dock's own
  // rendered height differs by state (tile grid vs. compact summary), and a
  // mismatch here leaves a blank gap between the map and the dock, so this
  // tracks the dock's actual collapsed height rather than a single constant.
  // The expanded list is intentionally NOT accounted for here — it overlays
  // on top of the already-rendered map instead of resizing it, to avoid
  // needing a Leaflet invalidateSize() pass on every expand/collapse.
  const dockShown = tab === 'map' && !sheetOpen && !selectedPOI && !selectedTrail;
  const dockReservedH = dockShown ? (activityTile ? 84 : 176) : 12;

  return (
    <div className="vl-app">
      {/* Map area */}
      <div className="vl-map-area" style={{ '--dock-h': `${dockReservedH}px` } as React.CSSProperties}>
      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
        minZoom={MAP_MIN_ZOOM}
        maxBounds={MAP_MAX_BOUNDS}
        maxBoundsViscosity={1.0}
        zoomControl={false}
        attributionControl
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <MapSetup onReady={onMapReady} onMapClick={onMapClick} onZoom={onZoom} />
        <TileController layer={currentLayer} />
        {geoLayer && GEO_DATA[geoLayer]?.features?.length > 0 && (
          <GeoJSON
            key={geoLayer}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data={GEO_DATA[geoLayer] as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            style={geoStyle as any}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onEachFeature={geoOnEach as any}
          />
        )}
        {mode === 'history' && allPOIs.filter(p => catCfg[p.kategori]?.showInHistory).map(poi => {
          const cat = getCat(poi.kategori);
          const [lat, lng] = poi.coordinates ?? [0, 0];
          if (!lat || !lng) return null;
          const icon = L.divIcon({
            className: '',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
            html: `<div style="width:30px;height:30px;border-radius:50%;background:${cat.color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;"><svg viewBox="-12 -12 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[cat.icon] ?? ''}</svg></div>`,
          });
          return (
            <Marker key={poi.id} position={[lat, lng]} icon={icon}
              zIndexOffset={selectedPOI?.id === poi.id ? 1000 : 0}
              eventHandlers={{ click: () => { setSelectedPOI(poi); setView('detail'); setSheetOpen(true); } }} />
          );
        })}
        {mode === 'nature' && !selectedNature && natureVisible.map(obs => {
          const cfg = NATURE_GROUPS[obs.group];
          const sz = Math.max(18, Math.min(28, 18 + (mapZoom - 13) * 3));
          const icon = L.divIcon({
            className: '',
            iconSize: [sz, sz],
            iconAnchor: [sz / 2, sz / 2],
            html: makeNatureIconHtml(cfg.color, cfg.icon, false, sz, false, obsRingClass(obs)),
          });
          return (
            <Marker key={`n-${obs.gbifKey}`} position={[obs.lat, obs.lng]} icon={icon}
              eventHandlers={{ click: () => selectNatureSpecies(obs) }} />
          );
        })}
        {mode === 'nature' && selectedNature && natureVisible.filter(o => o.gbifKey !== selectedNature.gbifKey).map(obs => {
          const cfg = NATURE_GROUPS[obs.group];
          const sz = 14;
          const icon = L.divIcon({
            className: '',
            iconSize: [sz, sz],
            iconAnchor: [sz / 2, sz / 2],
            html: makeNatureIconHtml(cfg.color, cfg.icon, false, sz, true),
          });
          return (
            <Marker key={`n-${obs.gbifKey}`} position={[obs.lat, obs.lng]} icon={icon}
              eventHandlers={{ click: () => selectNatureSpecies(obs) }} />
          );
        })}
        {mode === 'nature' && selectedNature && selectedNatureObs.map((obs, i) => {
          const cfg = NATURE_GROUPS[obs.group];
          const sz = Math.max(20, Math.min(30, 20 + (mapZoom - 13) * 3));
          const icon = L.divIcon({
            className: '',
            iconSize: [sz, sz],
            iconAnchor: [sz / 2, sz / 2],
            html: makeNatureIconHtml(cfg.color, cfg.icon, true, sz, false, obsRingClass(selectedNature)),
          });
          return (
            <Marker key={`sel-${i}`} position={[obs.lat, obs.lng]} icon={icon}
              eventHandlers={{ click: () => {} }} />
          );
        })}
        {mode === 'history' && [
          { level: seaLevelA, pane: 'sealevel-a' },
          { level: seaLevelB, pane: 'sealevel-b' },
        ].map(({ level, pane }) => {
          if (level <= 0) return null;
          const thresh = nearestFloodThreshold(level);
          if (thresh === null) return null;
          const feat = FLOOD_BY_THRESHOLD.get(thresh);
          if (!feat) return null;
          return (
            <GeoJSON
              key={`${pane}-${thresh}`}
              data={feat as any}
              pane={pane}
              style={{ color: '#1a6fa8', fillColor: '#3a9de0', fillOpacity: 0.42, weight: 1.5, opacity: 0.7 }}
            />
          );
        })}
        {mode === 'history' && historyView === 'garder' && visibleFarms.map(farm => {
          const coords = farmCoords[farm.name];
          if (!coords) return null;
          const isSelected = selectedFarm?.name === farm.name;
          const icon = L.divIcon({
            className: '',
            iconSize: [34, 34],
            iconAnchor: [17, 17],
            html: `<div style="width:34px;height:34px;border-radius:50%;background:${isSelected ? '#7c4a1e' : '#c07a3a'};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;cursor:pointer;">${ICONS['hus'] ? `<svg viewBox="-12 -12 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS['hus']}</svg>` : ''}</div>`,
          });
          return (
            <Marker key={farm.name} position={coords} icon={icon}
              zIndexOffset={selectedFarm?.name === farm.name ? 1000 : 0}
              eventHandlers={{ click: () => { setSelectedFarm(farm); setSheetOpen(true); } }} />
          );
        })}
        {eraHighlightPOIs.map(poi => {
          const catIcon = catCfg[poi.kategori]?.icon ?? 'info';
          const icon = L.divIcon({
            className: '',
            iconSize: [38, 38],
            iconAnchor: [19, 19],
            html: `<div style="width:38px;height:38px;border-radius:50%;background:#d97706;border:3px solid #fff;box-shadow:0 2px 12px rgba(217,119,6,.45),0 0 0 4px rgba(217,119,6,.18);display:flex;align-items:center;justify-content:center;"><svg viewBox="-10 -10 20 20" width="18" height="18" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[catIcon] ?? ICONS['info']}</svg></div>`,
          });
          return (
            <Marker
              key={`era-poi-${poi.id}`}
              position={poi.coordinates}
              icon={icon}
              eventHandlers={{ click: () => { setSelectedPOI(poi); flyToAboveSheet(poi.coordinates, Math.max(mapRef.current?.getZoom() ?? 15, 15)); } }}
            />
          );
        })}
        {userPos && (
          <>
            {userAccuracy > 0 && userAccuracy < 200 && (
              <Circle
                center={userPos}
                radius={userAccuracy}
                pathOptions={{ color: '#4a9fd4', fillColor: '#4a9fd4', fillOpacity: 0.12, weight: 1.5, opacity: 0.5 }}
                interactive={false}
              />
            )}
            <Marker position={userPos} icon={USER_ICON} interactive={false} />
          </>
        )}
        {trailPath && (
          <>
            <Polyline
              positions={trailPath}
              pathOptions={{ color: '#fff', weight: 7, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }}
            />
            <Polyline
              positions={trailPath}
              pathOptions={{ color: '#4a7c64', weight: 3.6, opacity: 1, lineCap: 'round', lineJoin: 'round' }}
            />
          </>
        )}
        {walkRoutePath && (
          <>
            <Polyline
              positions={walkRoutePath}
              pathOptions={{ color: '#fff', weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
              interactive={false}
            />
            <Polyline
              positions={walkRoutePath}
              pathOptions={{ color: '#2d6cdf', weight: 3.2, opacity: 0.9, lineCap: 'round', lineJoin: 'round', dashArray: '1,10' }}
              interactive={false}
            />
          </>
        )}
      </MapContainer>

      {/* Off-island toast */}
      {offIsland && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--ink)', color: '#fff', borderRadius: 12,
          padding: '10px 18px', fontSize: 13, fontWeight: 600,
          zIndex: 1100, whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,.25)',
          pointerEvents: 'none',
        }}>
          {lang === 'no' ? 'Du er ikke på Veierland' : 'You are not on Veierland'}
        </div>
      )}

      {/* Nearby POI banner */}
      {nearbyPoi && !offIsland && (
        <button
          onClick={() => { selectPOI(nearbyPoi); setNearbyPoi(null); }}
          style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--card)', border: '1.5px solid var(--line)', borderRadius: 14,
            padding: '10px 16px', zIndex: 1100, boxShadow: '0 4px 20px rgba(28,38,30,.18)',
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            maxWidth: 280, textAlign: 'left', font: 'inherit',
          }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
            display: 'grid', placeItems: 'center', color: 'var(--accent)',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 700, marginBottom: 1 }}>
              {lang === 'no' ? 'I nærheten' : 'Nearby'}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.2 }}>
              {nearbyPoi.navn}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 18, flexShrink: 0 }}>›</div>
        </button>
      )}

      {/* Glass top bar: menu, place name + compact weather icons, ferry countdown ring.
          NO/EN moved into the menu — low-frequency, didn't need a permanent spot here. */}
      <div className="vl-topbar2">
        <button className="vl-menubtn" onClick={e => { e.stopPropagation(); setShowMenu(m => !m); }}
          aria-label={lang === 'no' ? 'Meny' : 'Menu'} title={lang === 'no' ? 'Meny' : 'Menu'}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <div className="vl-topbar2-info">
          <div className="vl-topbar2-title">Veierland</div>
          <div className="vl-topbar2-weather">
            {weatherNow ? (
              <>
                <span className="wico"><WeatherIcon kind={weatherIconKind(weatherNow.symbolCode)} /></span>
                <span className="wval">{Math.round(weatherNow.airTemp)}°</span>
                <span className="wsep">·</span>
                <span className="wico"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 16h8a2 2 0 1 1-2 2"/></svg></span>
                <span className="wval">{Math.round(weatherNow.windSpeed)} m/s</span>
              </>
            ) : (lang === 'no' ? 'Henter vær…' : 'Loading weather…')}
          </div>
        </div>
        <button className={`vl-ferryring-btn${showFerryPop ? ' on' : ''}`}
          onClick={e => { e.stopPropagation(); toggleFerryPop(); }}
          title={lang === 'no' ? 'Fergetider' : 'Ferry times'}>
          <FerryRing minsUntil={nextFromIsland ? minsUntil(nextFromIsland.time) : null} />
          <div className="vl-ferryring-text">
            <div className="lbl">{lang === 'no' ? 'Ferge' : 'Ferry'} {nextFromIsland ? fmtDepTime(nextFromIsland.time) : '–'}</div>
            <div className="from">
              {nextFromIsland
                ? `${lang === 'no' ? 'fra' : 'from'} ${nextFromIsland.fromName}${ferryTomorrow ? (lang === 'no' ? ' · i morgen' : ' · tomorrow') : ''} →`
                : (lang === 'no' ? 'Fergetider' : 'Ferry times')}
            </div>
          </div>
        </button>
      </div>

      {/* Menu: reaches Steder/Turer/Natur/Historie/Lagret now that the tab
          bar is gone — wired straight to the existing selectTab(), so this
          adds a new entry point without any new list/browse logic. */}
      {showMenu && (
        <div className="vl-menu" onClick={e => e.stopPropagation()}>
          <button className="vl-menu-item" onClick={() => { setShowMenu(false); exitActivityTile(); selectTab('places'); }}>
            <PlacesTabSvg /><span>{T.places}</span>
          </button>
          <button className="vl-menu-item" onClick={() => { setShowMenu(false); exitActivityTile(); selectTab('trails'); }}>
            <TrailsTabSvg /><span>{T.trails}</span>
          </button>
          <button className="vl-menu-item" onClick={() => { setShowMenu(false); exitActivityTile(); selectTab('nature'); }}>
            <NatureTabSvg /><span>{T.nature}</span>
          </button>
          <button className="vl-menu-item" onClick={() => { setShowMenu(false); exitActivityTile(); selectTab('history'); }}>
            <HistoryTabSvg /><span>{T.history}</span>
          </button>
          <button className="vl-menu-item" onClick={() => { setShowMenu(false); exitActivityTile(); selectTab('saved'); }}>
            <HeartSvg /><span>{T.saved}</span>
            {savedIds.size > 0 && <span className="vl-menu-badge">{savedIds.size}</span>}
          </button>
          <div className="vl-menu-divider" />
          <div className="vl-menu-lang">
            <button className={lang === 'no' ? 'on' : ''} onClick={() => setLang('no')}>Norsk</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
          </div>
          <a className="vl-menu-privacy" href="/personvern" target="_blank" rel="noreferrer">
            {lang === 'no' ? 'Personvernerklæring' : 'Privacy policy'}
          </a>
        </div>
      )}

      {/* Ferry board — full-screen (see plan Phase 5 for its full visual redesign;
          this is just promoted from an anchored popup so the top bar's ferry
          ring always has somewhere real to go) */}
      {showFerryPop && (
        <div className="vl-ferrypop vl-ferrypop-full" onClick={e => e.stopPropagation()}>
          <button className="vl-ferrypop-close" onClick={() => setShowFerryPop(false)} aria-label={lang === 'no' ? 'Lukk' : 'Close'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
          {/* Weather info header */}
          {(weatherNow || seaTemp !== null) && (
            <div className="vl-ferry-weather">
              <div className="vl-fw-item">
                <span className="vl-fw-label">{lang === 'no' ? 'Luft' : 'Air'}</span>
                <span className="vl-fw-val">{Math.round(weatherNow?.airTemp ?? 0)}°</span>
              </div>
              <div className="vl-fw-item">
                <span className="vl-fw-label">{lang === 'no' ? 'Vann' : 'Sea'}</span>
                <span className="vl-fw-val">{seaTemp !== null ? Math.round(seaTemp) + '°' : '—'}</span>
              </div>
              <div className="vl-fw-item">
                <span className="vl-fw-label">{lang === 'no' ? 'Vind' : 'Wind'}</span>
                <span className="vl-fw-val">{Math.round(weatherNow?.windSpeed ?? 0)} m/s</span>
              </div>
            </div>
          )}
          {ferrySailings.length > 0 ? (
            <>
              <h5>{(lang === 'no' ? 'Fra Veierland' : 'From Veierland') + (ferryTomorrow ? (lang === 'no' ? ' · i morgen' : ' · tomorrow') : '')}</h5>
              {ferrySailings.filter(d => d.fromIsland).map((d, i) => (
                <div key={`i${i}`} className={`vl-fdep${i === 0 && !ferryTomorrow ? ' next' : ''}`}>
                  <div className="hd">
                    <b>{fmtDepTime(d.time)}</b>
                    <span className="fq">{lang === 'no' ? 'fra' : 'from'} {d.fromName}</span>
                    {!ferryTomorrow && (
                      i === 0
                        ? <span className="in pill">{lang === 'no' ? 'om' : 'in'} {minsUntil(d.time)} min</span>
                        : <span className="in">{minsUntil(d.time)} min</span>
                    )}
                  </div>
                  <div className="ds">
                    → {d.calls.map(c => `${c.name} ${fmtDepTime(c.time)}`).join(' · ')}
                  </div>
                </div>
              ))}
              <h5 style={{ marginTop: 10 }}>{(lang === 'no' ? 'Til Veierland' : 'To Veierland') + (ferryTomorrow ? (lang === 'no' ? ' · i morgen' : ' · tomorrow') : '')}</h5>
              {ferrySailings.filter(d => !d.fromIsland).map((d, i) => (
                <div key={`m${i}`} className={`vl-fdep${i === 0 && !ferryTomorrow ? ' next' : ''}`}>
                  <div className="hd">
                    <b>{fmtDepTime(d.time)}</b>
                    <span className="fq">{lang === 'no' ? 'fra' : 'from'} {d.fromName}</span>
                    {!ferryTomorrow && (
                      i === 0
                        ? <span className="in pill">{lang === 'no' ? 'om' : 'in'} {minsUntil(d.time)} min</span>
                        : <span className="in">{minsUntil(d.time)} min</span>
                    )}
                  </div>
                  <div className="ds">
                    → {d.calls.map(c => `${c.name} ${fmtDepTime(c.time)}`).join(' · ')}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <p className="vl-fempty">
              {ferryBoard === null
                ? (lang === 'no' ? 'Fikk ikke hentet rutetidene akkurat nå.' : 'Could not load the timetable right now.')
                : (lang === 'no' ? 'Ingen flere avganger i dag.' : 'No more departures today.')}
            </p>
          )}
          <a className="vl-flink" href="https://jutoya.veierland.org/" target="_blank" rel="noreferrer">
            {lang === 'no' ? 'Full ruteplan og reiseplanlegger ↗' : 'Full timetable & planner ↗'}
          </a>
          <p className="vl-fsrc">{lang === 'no' ? 'Rutetider fra jutoya.veierland.org' : 'Timetable from jutoya.veierland.org'}</p>
        </div>
      )}

      {/* Layer popup */}
      <div
        className={`vl-pop${showLayerPop ? '' : ' hidden'}`}
        style={{ bottom: railBottom }}
        onClick={e => e.stopPropagation()}
      >
        <h5>{T.layers}</h5>
        {LAYER_ORDER.map(k => {
          const cfg = LAYERS[k];
          const on = currentLayer === k;
          return (
            <div
              key={k}
              className={`vl-opt${on ? ' on' : ''}`}
              onClick={() => { setCurrentLayer(k); setShowLayerPop(false); try { localStorage.setItem('vl-layer', k); } catch {} }}
            >
              <span className="sw" style={{ background: cfg.sw }} />
              <span className="nm">{lang === 'no' ? cfg.label.no : cfg.label.en}</span>
              <span className="chk">{on && <CheckSvg />}</span>
            </div>
          );
        })}
        <div className="vl-pop-sep" />
        <p className="vl-pop-sub">{lang === 'no' ? 'Geologi (NGU)' : 'Geology (NGU)'}</p>
        {Object.entries(GEO_LAYERS).map(([k, cfg]) => {
          const on = geoLayer === k;
          const hasData = GEO_DATA[k]?.features?.length > 0;
          return (
            <div key={k} className={`vl-opt${on ? ' on' : ''}${!hasData ? ' vl-opt-dim' : ''}`}
              title={!hasData ? (lang === 'no' ? cfg.noDataMsg.no : cfg.noDataMsg.en) : undefined}
              onClick={() => { if (hasData) { setGeoLayer(on ? null : k); setShowLayerPop(false); } }}
            >
              <span className="sw" style={{ background: cfg.sw }} />
              <span className="nm">{lang === 'no' ? cfg.label.no : cfg.label.en}</span>
              <span className="chk">{on ? <CheckSvg /> : (!hasData && <span style={{fontSize:10,color:'var(--muted)'}}>↓</span>)}</span>
            </div>
          );
        })}
      </div>

      {/* Right rail */}
      <div className="vl-rail" style={{ bottom: railBottom }}>
        <button
          className="vl-rbtn layers"
          aria-label={T.layers}
          title={lang === 'no' ? 'Kartlag og geologi' : 'Map layers and geology'}
          onClick={e => { e.stopPropagation(); setShowLayerPop(v => !v); }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>
          </svg>
          <span className="rl">{lang === 'no' ? 'Kartlag' : 'Layers'}</span>
        </button>
        <button
          className={`vl-rbtn${locating ? ' active' : ''}`}
          aria-label="Min posisjon"
          title={lang === 'no' ? (locating ? 'Stopp sporing' : 'Min posisjon') : (locating ? 'Stop tracking' : 'My location')}
          onClick={locate}
          style={locating ? { background: 'var(--accent)', color: '#fff' } : undefined}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3.4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>
          </svg>
          <span className="rl">{lang === 'no' ? 'Posisjon' : 'Locate'}</span>
        </button>
        {hasDomGrid && (
          <div style={{ position: 'relative' }}>
            <button
              className={`vl-rbtn${condLayer ? ' active' : ''}`}
              aria-label={lang === 'no' ? 'Forhold nå (sol, vind, temperatur)' : 'Conditions now (sun, wind, temperature)'}
              title={lang === 'no' ? 'Forhold nå' : 'Conditions now'}
              onClick={e => { e.stopPropagation(); setShowCondPop(v => !v); }}
              style={condLayer ? { background: 'var(--accent)', color: '#fff' } : undefined}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8"/></svg>
              <span className="rl">{lang === 'no' ? 'Forhold' : 'Conditions'}</span>
            </button>
            {showCondPop && (
              <div className="vl-condpop-menu" onClick={e => e.stopPropagation()}>
                <button className={condLayer === 'sun' ? 'on' : ''}
                  onClick={() => { setCondLayer(c => c === 'sun' ? null : 'sun'); setShowCondPop(false); }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8"/></svg>
                  <span>{lang === 'no' ? 'Sol og skygge' : 'Sun and shade'}</span>
                </button>
                <button className={condLayer === 'wind' ? 'on' : ''}
                  onClick={() => { setCondLayer(c => c === 'wind' ? null : 'wind'); setShowCondPop(false); }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 16h8a2 2 0 1 1-2 2"/></svg>
                  <span>{lang === 'no' ? 'Vind og le' : 'Wind and shelter'}</span>
                </button>
                <button className={condLayer === 'effectiveTemp' ? 'on' : ''}
                  onClick={() => { setCondLayer(c => c === 'effectiveTemp' ? null : 'effectiveTemp'); setShowCondPop(false); }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v16M9 20h6a2 2 0 0 0 2-2v-2H7v2a2 2 0 0 0 2 2z"/><path d="M10 8h4" strokeWidth="2.5"/></svg>
                  <span>{lang === 'no' ? 'Effektiv temperatur' : 'Effective temperature'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend for the active conditions overlay */}
      {condLayer && hasDomGrid && (
        <div className="vl-condlegend" onClick={e => e.stopPropagation()}>
          {condLayer === 'sun' ? (() => {
            const sun = sunPosition(new Date(), 59.155, 10.351);
            return (
              <>
                <b>{lang === 'no' ? 'Sol og skygge nå' : 'Sun & shade now'}</b>
                {sun.elevation > 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none"
                      style={{ transform: `rotate(${sun.azimuth}deg)`, flexShrink: 0, color: '#f5b120' }}>
                      <path d="M12 2 L12 20 M12 2 L6 9 M12 2 L18 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{Math.round(sun.elevation)}°</span>
                  </div>
                ) : (
                  <span>{lang === 'no' ? 'Sola er under horisonten.' : 'Sun is below the horizon.'}</span>
                )}
              </>
            );
          })() : condLayer === 'wind' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {weatherNow && (
                  // windFromDeg is meteorological convention (direction the wind
                  // blows FROM); the arrow itself should point where it's blowing
                  // TO, hence the +180.
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none"
                    style={{ transform: `rotate(${weatherNow.windFromDeg + 180}deg)`, flexShrink: 0 }}>
                    <path d="M12 2 L12 20 M12 2 L6 9 M12 2 L18 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <div>
                  <b>{lang === 'no' ? 'Vindeksponering nå' : 'Wind exposure now'}</b>
                  <br />
                  <span>{weatherNow
                    ? (lang === 'no'
                        ? `Vind fra ${windDirLabel(weatherNow.windFromDeg, 'no')} ${Math.round(weatherNow.windSpeed)} m/s.`
                        : `Wind from ${windDirLabel(weatherNow.windFromDeg, 'en')} ${Math.round(weatherNow.windSpeed)} m/s.`)
                    : (lang === 'no' ? 'Henter vind…' : 'Loading wind…')}</span>
                </div>
              </div>
              {weatherNow && (() => {
                const windStops = [0, ORKAN_MS / 4, ORKAN_MS / 2, ORKAN_MS * 3 / 4, ORKAN_MS].map(s => windColor(s));
                const windT = Math.min(1, weatherNow.windSpeed / ORKAN_MS);
                return (
                  <>
                    <GradientBar stops={windStops} posT={windT} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
                      <span>{lang === 'no' ? 'Stille' : 'Calm'}</span><span>{lang === 'no' ? 'Orkan' : 'Hurricane'}</span>
                    </div>
                  </>
                );
              })()}
            </>
          ) : (
            <>
              <b>{lang === 'no' ? 'Effektiv temperatur nå' : 'Effective temperature now'}</b>
              {weatherNow ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
                      {Math.round(effectiveTemp(weatherNow.airTemp, weatherNow.windSpeed, weatherNow.humidity))}°C
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {lang === 'no' ? `(luft: ${Math.round(weatherNow.airTemp)}°C)` : `(air: ${Math.round(weatherNow.airTemp)}°C)`}
                    </span>
                  </div>
                  {(() => {
                    // The overlay's colour scale is stretched to the actual spread of
                    // effective temperature across the island right now (see
                    // makeEffectiveTempOverlay), so the legend mirrors that same range
                    // instead of a fixed -20..40°C — otherwise a 1-2°C wind effect would
                    // never register as a visible position on a 60°-wide bar.
                    const [MIN_T, MAX_T] = tempRange ?? [-20, 40];
                    const tempStops = [MIN_T, MIN_T + (MAX_T - MIN_T) / 4, (MIN_T + MAX_T) / 2, MAX_T - (MAX_T - MIN_T) / 4, MAX_T]
                      .map(t => effectiveTempColor(t, MIN_T, MAX_T));
                    const effTemp = effectiveTemp(weatherNow.airTemp, weatherNow.windSpeed, weatherNow.humidity);
                    const tempT = Math.min(1, Math.max(0, (effTemp - MIN_T) / (MAX_T - MIN_T)));
                    return (
                      <>
                        <GradientBar stops={tempStops} posT={tempT} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
                          <span>{Math.round(MIN_T)}°C</span><span>{Math.round(MAX_T)}°C</span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <span>{lang === 'no' ? 'Henter temperatur…' : 'Loading temperature…'}</span>
              )}
            </>
          )}
        </div>
      )}

      {/* Compact mini-card: shown for a map-tapped POI when nothing else is open */}
      {showMiniCard && selectedPOI && (() => {
        const cat = getCat(selectedPOI.kategori);
        const saved = savedIds.has(selectedPOI.id);
        return (
          <div className="vl-minicard" onClick={() => { setView('detail'); setSheetOpen(true); }}>
            <div className="vl-ic" style={{ background: `${cat.color}1a`, color: cat.color }}
              dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
            <div className="tx">
              <h4>{selectedPOI.navn}</h4>
              <p>
                {selectedQuay && quayBoard && quayBoard.sailings.length > 0
                  ? `${lang === 'no' ? 'Neste ferge' : 'Next ferry'} ${fmtDepTime(quayBoard.sailings[0].time)}${quayBoard.tomorrow ? (lang === 'no' ? ' i morgen' : ' tomorrow') : ''} · ${walkLong(selectedPOI.coordinates)}`
                  : `${lang === 'no' ? cat.no : cat.en} · ${walkLong(selectedPOI.coordinates)}`}
              </p>
            </div>
            <div className="acts">
              <button className={`ab${saved ? ' on' : ''}`} aria-label={saved ? (lang === 'no' ? 'Fjern fra lagret' : 'Remove saved') : (lang === 'no' ? 'Lagre' : 'Save')}
                onClick={e => { e.stopPropagation(); toggleSaved(selectedPOI.id); }}>
                <HeartSvg />
              </button>
              <button className="ab pri" aria-label={lang === 'no' ? 'Mer' : 'More'}
                onClick={e => { e.stopPropagation(); setView('detail'); setSheetOpen(true); }}>
                <UpChevSvg />
              </button>
            </div>
          </div>
        );
      })()}
      {showMiniCard && !selectedPOI && selectedTrail && (() => {
        const saved = savedIds.has(selectedTrail.id);
        return (
          <div className="vl-minicard" onClick={() => { setView('detail'); setSheetOpen(true); }}>
            <div className="vl-ic" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
              dangerouslySetInnerHTML={{ __html: iconSvg('tur') }} />
            <div className="tx">
              <h4>{lang === 'no' ? selectedTrail.name : selectedTrail.en}</h4>
              <p>{selectedTrail.km} · {selectedTrail.time} · {lang === 'no' ? selectedTrail.diff : T.easy}</p>
            </div>
            <div className="acts">
              <button className={`ab${saved ? ' on' : ''}`} aria-label={saved ? (lang === 'no' ? 'Fjern fra lagret' : 'Remove saved') : (lang === 'no' ? 'Lagre' : 'Save')}
                onClick={e => { e.stopPropagation(); toggleSaved(selectedTrail.id); }}>
                <HeartSvg />
              </button>
              <button className="ab pri" aria-label={lang === 'no' ? 'Mer' : 'More'}
                onClick={e => { e.stopPropagation(); setView('detail'); setSheetOpen(true); }}>
                <UpChevSvg />
              </button>
            </div>
          </div>
        );
      })()}
      </div>{/* end vl-map-area */}

      {/* Bottom dock (mobile): activity tiles by default, or a compact
          summary + expandable list once a tile is active. Replaces the old
          fixed tab bar — Steder/Turer/Natur/Historie/Lagret move to a menu
          (Phase 6 of the redesign); this only shows while browsing the map
          with nothing selected (the mini-card takes over once a POI/trail
          is tapped, and this is hidden on desktop via CSS). */}
      {tab === 'map' && !sheetOpen && !selectedPOI && !selectedTrail && (
        <div className={`vl-dock${dockExpanded ? ' expanded' : ''}`}>
          <div className="vl-dock-grab" onClick={() => setDockExpanded(e => !e)}><div className="bar" /></div>
          {!activityTile ? (
            <>
              <div className="vl-dock-title">{lang === 'no' ? 'Hva vil du i dag?' : 'What do you want today?'}</div>
              <div className="vl-dock-tiles">
                <button className="vl-dock-tile" style={{ color: catCfg.bad?.color ?? '#2f9e8f' } as React.CSSProperties} onClick={() => applyActivityTile('bade')}>
                  <span dangerouslySetInnerHTML={{ __html: iconSvg('bade') }} />
                  <span className="lbl">{lang === 'no' ? 'Bade' : 'Swim'}</span>
                </button>
                <button className="vl-dock-tile" style={{ color: catCfg.friluft?.color ?? '#5f9438' } as React.CSSProperties} onClick={() => applyActivityTile('gatur')}>
                  <span dangerouslySetInnerHTML={{ __html: iconSvg('tur') }} />
                  <span className="lbl">{lang === 'no' ? 'Gå tur' : 'Walk'}</span>
                </button>
                <button className="vl-dock-tile" style={{ color: catCfg.kultur?.color ?? '#b5673e' } as React.CSSProperties} onClick={() => applyActivityTile('historie')}>
                  <span dangerouslySetInnerHTML={{ __html: iconSvg('kultur') }} />
                  <span className="lbl">{lang === 'no' ? 'Historie' : 'History'}</span>
                </button>
                <button className="vl-dock-tile" style={{ color: catCfg.mat?.color ?? '#e0823c' } as React.CSSProperties} onClick={() => applyActivityTile('spise')}>
                  <span dangerouslySetInnerHTML={{ __html: iconSvg('mat') }} />
                  <span className="lbl">{lang === 'no' ? 'Spise' : 'Eat'}</span>
                </button>
              </div>
              {recoText && (
                <div className="vl-dock-reco" onClick={() => applyActivityTile('bade')}>
                  <span className="em">☀️</span>
                  <div style={{ flex: 1 }}><b>{recoText}</b></div>
                  <ChevSvg />
                </div>
              )}
            </>
          ) : (
            <div className="vl-dock-summary">
              <button className="back" onClick={exitActivityTile} aria-label={lang === 'no' ? 'Tilbake' : 'Back'}><BackSvg /></button>
              <div className="txt">
                {lang === 'no'
                  ? `${filteredPOIs.length} ${activityTile === 'bade' ? 'badeplasser' : 'spisesteder'}`
                  : `${filteredPOIs.length} ${activityTile === 'bade' ? 'beaches' : 'places to eat'}`}
              </div>
              <button className="showlist" onClick={() => setDockExpanded(e => !e)}>
                {dockExpanded ? (lang === 'no' ? 'Skjul' : 'Hide') : (lang === 'no' ? 'Vis liste' : 'Show list')}
              </button>
            </div>
          )}
          {activityTile === 'bade' && dockExpanded && (
            <div className="vl-dock-list">
              {beachRanking.map((b, i) => (
                <div key={b.poi.id} className={`vl-dock-row beach${i === 0 ? ' best' : ''}`}
                  onClick={() => { const poi = allPOIs.find(p => p.id === b.poi.id); if (poi) showOnMap(poi); setDockExpanded(false); }}>
                  <div className="temp">
                    <span className="v">{seaTemp !== null ? Math.round(seaTemp) + '°' : '—'}</span>
                    <span className="k">{lang === 'no' ? 'I VANNET' : 'IN WATER'}</span>
                  </div>
                  <div className="mid">
                    <div className="nm">{b.poi.navn}</div>
                    <div className="chips">
                      {b.sunlit && <span className="chip sun">☀️ {lang === 'no' ? 'Sol' : 'Sun'}</span>}
                      {(b.shelter ?? 0) > 0.5 && <span className="chip lee">🍃 {lang === 'no' ? 'God le' : 'Sheltered'}</span>}
                      <span className="chip walk">{walkShort(b.poi.coordinates)}</span>
                    </div>
                  </div>
                  <ChevSvg />
                </div>
              ))}
              {beachRanking.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '8px 0' }}>
                  {lang === 'no' ? 'Ingen badeplasser funnet.' : 'No beaches found.'}
                </p>
              )}
            </div>
          )}
          {activityTile === 'spise' && dockExpanded && (
            <div className="vl-dock-list">
              {filteredPOIs.map(poi => (
                <div key={poi.id} className="vl-dock-row" onClick={() => { showOnMap(poi); setDockExpanded(false); }}>
                  <div className="nm">{poi.navn}</div>
                  <div className="sub">{walkShort(poi.coordinates)}</div>
                </div>
              ))}
              {filteredPOIs.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '8px 0' }}>
                  {lang === 'no' ? 'Ingen steder funnet.' : 'No places found.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sheet / Desktop sidebar */}
      <div
        ref={sheetRef}
        className={`vl-sheet${sheetOpen ? '' : ' closed'}`}
        style={{ height: sheetCurrentH + 'px', transition: isDraggingSheet ? 'none' : undefined }}
        onClick={() => setShowLayerPop(false)}
      >
        {/* Same tab bar, repositioned to the top of the sidebar on desktop */}
        <nav className="vl-tabbar vl-tabbar-desktop">
          <button className={`vl-tabbtn${tab === 'map' ? ' on' : ''}`} onClick={() => selectTab('map')}>
            <MapTabSvg /><span>{T.map}</span>
          </button>
          <button className={`vl-tabbtn${tab === 'places' ? ' on' : ''}`} onClick={() => selectTab('places')}>
            <PlacesTabSvg /><span>{T.places}</span>
          </button>
          <button className={`vl-tabbtn${tab === 'trails' ? ' on' : ''}`} onClick={() => selectTab('trails')}>
            <TrailsTabSvg /><span>{T.trails}</span>
          </button>
          <button className={`vl-tabbtn${tab === 'nature' ? ' on' : ''}`} onClick={() => selectTab('nature')}>
            <NatureTabSvg /><span>{T.nature}</span>
          </button>
          <button className={`vl-tabbtn${tab === 'history' ? ' on' : ''}`} onClick={() => selectTab('history')}>
            <HistoryTabSvg /><span>{T.history}</span>
          </button>
          <button className={`vl-tabbtn${tab === 'saved' ? ' on' : ''}`} onClick={() => selectTab('saved')}>
            <HeartSvg /><span>{T.saved}</span>
            {savedIds.size > 0 && <span className="vl-tabbadge">{savedIds.size}</span>}
          </button>
        </nav>
        <div className="vl-grab" onPointerDown={onGrabPointerDown}>
          <div className="bar" />
        </div>
        <div className="vl-body" ref={bodyRef}>
          {view === 'browse' && tab === 'nature' && renderNature()}
          {view === 'browse' && tab === 'history' && renderHistory()}
          {view === 'browse' && tab === 'saved' && renderSaved()}
          {view === 'browse' && (tab === 'map' || tab === 'places' || tab === 'trails') && renderBrowse()}
          {view === 'detail' && selectedPOI && renderPOIDetail(selectedPOI)}
          {view === 'detail' && selectedTrail && renderTrailDetail(selectedTrail)}
        </div>
      </div>
    </div>
  );
}
