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
import { NATURE_GROUPS, NatureGroup, NatureObs, GBIF_POLYGON, STATIC_NATURE_CACHE, loadNatureObs } from '../lib/naturedata';
import { loadFarmData, DEFAULT_FARM_DATA, Farm } from '../lib/farmdata';
import { loadTimelineSections, DEFAULT_TIMELINE_SECTIONS, TimelineSection } from '../lib/timelinedata';
import { ICONS } from '../lib/icons';
import floodData from '../data/sea_level_flood.geojson';
import losmassData from '../data/losmasser.geojson';
import berggrunData from '../data/berggrunn.geojson';

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

async function loadNorwegianFamilyNames(
  obs: NatureObs[],
  setMap: (m: Record<string, string>) => void
) {
  try {
    const cached = localStorage.getItem('vl-family-nor');
    if (cached) { setMap(JSON.parse(cached)); return; }
  } catch {}

  const familyMap = new Map<number, string>();
  for (const o of obs) {
    if (o.familyKey && o.family && !familyMap.has(o.familyKey)) {
      familyMap.set(o.familyKey, o.family);
    }
  }
  if (familyMap.size === 0) return;

  const result: Record<string, string> = {};
  const BATCH = 20;
  const entries = [...familyMap.entries()];
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    await Promise.all(batch.map(async ([key, latin]) => {
      try {
        const res = await fetch(`https://api.gbif.org/v1/species/${key}/vernacularNames?limit=100`);
        if (!res.ok) return;
        const d = await res.json();
        const nor = (d.results as any[]).find((v: any) =>
          v.language === 'nob' || v.language === 'nor' || v.language === 'nno'
        );
        if (nor) result[latin] = nor.vernacularName;
      } catch {}
    }));
  }

  setMap(result);
  try { localStorage.setItem('vl-family-nor', JSON.stringify(result)); } catch {}
}

function markerSize(zoom: number): number {
  return Math.round(Math.max(14, Math.min(34, 14 + (zoom - 11) * 5)));
}

function makeIconHtml(icon: string, selected: boolean, sz: number): string {
  const svgSz = Math.round(sz * 0.59);
  const svg = `<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="${svgSz}" height="${svgSz}">${ICONS[icon] ?? ICONS.wc}</svg>`;
  return `<div class="vl-pin${selected ? ' sel' : ''}" style="width:${sz}px;height:${sz}px">${svg}</div>`;
}

function iconSvg(icon: string): string {
  return `<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">${ICONS[icon] ?? ICONS.wc}</svg>`;
}

function coloredSvg(icon: string, color: string): string {
  return `<svg viewBox="-12 -12 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] ?? ICONS.wc}</svg>`;
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

const TRAIL_CAT_GROUPS = {
  alle:     { no: 'Alle',        en: 'All',          cats: null as null | string[] },
  historie: { no: 'Historie',    en: 'History',      cats: ['arkeologi', 'hvalfangst'] },
  natur:    { no: 'Natur',       en: 'Nature',       cats: null }, // uses natureObs (GBIF), not POI categories
  mat:      { no: 'Mat & Drikke',en: 'Food & Drink', cats: ['mat'] },
  kultur:   { no: 'Kultur',      en: 'Culture',      cats: ['kultur', 'info', 'ferge', 'havn'] },
} as const;

// ─── Trail data ───────────────────────────────────────────────────────────────

interface Trail {
  id: string;
  name: string;
  en: string;
  km: string;
  time: string;
  diff: string;
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


// ─── Main component ───────────────────────────────────────────────────────────

const MAP_CENTER: [number, number] = [59.1506, 10.3521];
const MAP_ZOOM = 13;

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
  const [searchQ, setSearchQ] = useState('');
  const [view, setView] = useState<'browse' | 'detail'>('browse');
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  const [selectedTrail, setSelectedTrail] = useState<Trail | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [autoSheetH, setAutoSheetH] = useState<number | null>(null);
  const [currentLayer, setCurrentLayer] = useState<string>(() => {
    try { return localStorage.getItem('vl-layer') || 'soleng'; } catch { return 'soleng'; }
  });
  const [geoLayer, setGeoLayer] = useState<string | null>(null);
  const [showLayerPop, setShowLayerPop] = useState(false);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [userAccuracy, setUserAccuracy] = useState<number>(0);
  const [locating, setLocating] = useState(false);
  const [offIsland, setOffIsland] = useState(false);
  const [nearbyPoi, setNearbyPoi] = useState<POI | null>(null);
  const watchRef = useRef<number | null>(null);
  const notifiedPoisRef = useRef<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [trailPath, setTrailPath] = useState<[number, number][] | null>(null);
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
  const [redListFilter, setRedListFilter] = useState(false);
  const [alienFilter, setAlienFilter] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<NatureGroup>>(new Set());
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const [showNorFamilies, setShowNorFamilies] = useState(true);
  const [familyNorMap, setFamilyNorMap] = useState<Record<string, string>>({});
  const filteredNatureObs = natureObs.filter(o => {
    if (natureFilter && o.group !== natureFilter) return false;
    if (redListFilter && !RED_LIST_CATS.test(o.redListCategory ?? '')) return false;
    if (alienFilter && !o.alienCategory) return false;
    return true;
  });
  const groupedNatureObs = useMemo(() => {
    const result = new Map<NatureGroup, Map<string, NatureObs[]>>();
    for (const g of Object.keys(NATURE_GROUPS) as NatureGroup[]) result.set(g, new Map());
    for (const obs of filteredNatureObs) {
      const families = result.get(obs.group)!;
      const fam = obs.family || '—';
      if (!families.has(fam)) families.set(fam, []);
      families.get(fam)!.push(obs);
    }
    return result;
  // filteredNatureObs identity changes on every render, so depend on the source state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natureObs, natureFilter, redListFilter, alienFilter]);
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
  }, [filteredPOIs]);

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
    const handle = () => setShowLayerPop(false);
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
    mapRef.current.fitBounds(L.latLngBounds(coords).pad(0.08), { animate: false });
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
    if (selectedNature) { setSelectedNature(null); setSelectedNatureObs([]); }
  }, [selectedNature]);
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
    const half = Math.round(sz / 2);
    const dimByTrail = mode === 'trails' && view === 'detail' && !!selectedTrail && trailPoiFilter === 'along';

    filteredPOIs.forEach(poi => {
      const cat = getCat(poi.kategori);
      const sel = selectedPOI?.id === poi.id;
      const faded = dimByTrail && !!poi.coordinates &&
        pointToPolylineDistM(poi.coordinates as [number, number], selectedTrail!.path) > 20;
      const html = faded
        ? `<div style="opacity:0.3">${makeIconHtml(cat.icon, sel, sz)}</div>`
        : makeIconHtml(cat.icon, sel, sz);
      const icon = L.divIcon({ className: '', iconSize: [sz, sz], iconAnchor: [half, half], html });
      L.marker(poi.coordinates as [number, number], { icon, zIndexOffset: sel ? 1000 : 0 }).on('click', () => selectPOI(poi)).addTo(cg);
    });

    map.addLayer(cg);
    clusterRef.current = cg;

    return () => { if (map) map.removeLayer(cg); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mode, filteredPOIs, selectedPOI?.id, view, mapZoom, selectedTrail, trailPoiFilter]);

  useEffect(() => {
    if ((mode !== 'nature' && !(mode === 'trails' && trailCatFilter === 'natur')) || natureFetched) return;

    // Show static bundle immediately for fast first render
    setNatureObs(STATIC_NATURE_CACHE.obs);
    setNatureFetched(true);

    // Load fresher data from Firebase in background (instant on repeat visits via Firestore offline cache)
    setNatureLoading(true);
    loadNatureObs().then(obs => {
      if (obs) {
        setNatureObs(obs);
        loadNorwegianFamilyNames(obs, setFamilyNorMap);
      }
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
    setView('detail');
    setSheetOpen(true);
    flyToAboveSheet(poi.coordinates, Math.max(mapRef.current?.getZoom() ?? 15, 15));
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
    setSelectedPOI(null);
    setSelectedTrail(null);
    setTrailPath(null);
    setSheetOpen(false);
  }

  function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

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
        if (flyTo) mapRef.current?.flyTo(p, 16, { duration: 0.7 });
      } else {
        setUserPos(null);
        setOffIsland(true);
        setTimeout(() => setOffIsland(false), 4000);
      }
    };

    // Immediate one-shot for fast first fix + fly
    navigator.geolocation.getCurrentPosition(
      pos => handlePos(pos, true),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );

    // Continuous watch for live updates
    watchRef.current = navigator.geolocation.watchPosition(
      pos => handlePos(pos, false),
      err => console.error('Geolocation error', err),
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
      setTimeout(() => setNearbyPoi(p => p?.id === closest!.id ? null : p), 6000);

      if ('Notification' in window && Notification.permission === 'granted') {
        const title = closest.navn;
        const body = closest.beskrivelse
          ? closest.beskrivelse.slice(0, 100) + (closest.beskrivelse.length > 100 ? '…' : '')
          : `${Math.round(closestDist)}m unna`;
        const notif = new Notification(title, { body, tag: closest.id, icon: '/vite.svg' });
        const poiRef = closest;
        notif.onclick = () => { window.focus(); setSelectedPOI(poiRef); };
      }
    } else if (!closest) {
      setNearbyPoi(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPos]);

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

  function toggleExpandedGroup(g: NatureGroup) {
    setExpandedGroups(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });
  }

  function toggleExpandedFam(key: string) {
    setExpandedFamilies(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function toggleSaved(id: string) {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const SHEET_PEEK_H = 184;
  const SHEET_MAX_H = Math.min(window.innerHeight * 0.82, 720);

  // After content renders, shrink sheet to fit actual content (avoids excess white space)
  useEffect(() => {
    if (!sheetOpen) { setAutoSheetH(null); return; }
    const frame = requestAnimationFrame(() => {
      if (bodyRef.current) {
        const grabH = 30;
        const contentH = bodyRef.current.scrollHeight + grabH;
        setAutoSheetH(Math.min(contentH, SHEET_MAX_H));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [sheetOpen, view, selectedPOI, selectedTrail, selectedNature, selectedEra, selectedFarm, historyView]);

  const SHEET_OPEN_H = autoSheetH ?? SHEET_MAX_H;
  const sheetCurrentH = sheetOpen ? SHEET_OPEN_H : SHEET_PEEK_H;
  const railBottom = sheetCurrentH + 16;

  // Text strings
  const T = lang === 'no' ? {
    search: 'Søk på Veierland', all: 'Alle', explore: 'Utforsk Veierland',
    places: 'Steder', trails: 'Turer', nature: 'Natur', history: 'Historie', back: 'Tilbake',
    directions: 'Veibeskrivelse', length: 'Lengde', duration: 'Tid', diff: 'Vanskelighet',
    layers: 'Kartlag', nohit: 'Ingen treff', easy: 'Lett', showRoute: 'Vis rute',
    natObs: (n: number) => `${n} ${n === 1 ? 'art' : 'arter'} observert`,
    np: (n: number) => `${n} ${n === 1 ? 'sted' : 'steder'}`,
    nt: (n: number) => `${n} ${n === 1 ? 'tur' : 'turer'}`,
    tidslinje: 'Tidslinje', garder: 'Gårder',
    kontekst: 'Norsk kontekst', anekdoter: 'Historier',
  } : {
    search: 'Search Veierland', all: 'All', explore: 'Explore Veierland',
    places: 'Places', trails: 'Trails', nature: 'Nature', history: 'History', back: 'Back',
    directions: 'Directions', length: 'Length', duration: 'Time', diff: 'Difficulty',
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
              <img src={selectedNature.photoUrl} alt={selectedNature.popularName || selectedNature.scientificName} className="vl-api-img" />
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
                <img src={speciesWiki.imageUrl} alt={speciesWiki.title} className="vl-api-img" />
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

    return (
      <>
        {natureLoading && (
          <p className="vl-loading-blink" style={{ fontSize: 13, margin: '0 0 8px' }}>
            {lang === 'no' ? 'Henter siste observasjoner fra Artsdatabanken…' : 'Fetching latest observations from Artsdatabanken…'}
          </p>
        )}
        <div className="vl-nat-toprow">
          <div className="vl-count">{T.natObs(filteredNatureObs.length)}</div>
          <div className="vl-lang vl-fam-lang">
            <button className={showNorFamilies ? 'on' : ''} onClick={() => setShowNorFamilies(true)}>
              {lang === 'no' ? 'Norsk' : 'Norwegian'}
            </button>
            <button className={!showNorFamilies ? 'on' : ''} onClick={() => setShowNorFamilies(false)}>
              Latin
            </button>
          </div>
        </div>

        {(Object.keys(NATURE_GROUPS) as NatureGroup[]).map(g => {
          const cfg = NATURE_GROUPS[g];
          const families = groupedNatureObs.get(g)!;
          const total = [...families.values()].reduce((s, arr) => s + arr.length, 0);
          if (total === 0) return null;
          const grpOpen = expandedGroups.has(g);
          return (
            <div key={g} className={`vl-nat-grp${grpOpen ? ' open' : ''}`}>
              <div className="vl-grp-hdr" onClick={() => toggleExpandedGroup(g)}>
                <span className="vl-grp-ico" dangerouslySetInnerHTML={{ __html: coloredSvg(cfg.icon, cfg.color) }} />
                <span className="vl-grp-lbl" style={{ color: grpOpen ? cfg.color : undefined }}>{lang === 'no' ? cfg.no : cfg.en}</span>
                <span className="vl-grp-cnt">{total}</span>
                <span className={`vl-chev${grpOpen ? ' open' : ''}`}><ChevSvg /></span>
              </div>
              {grpOpen && (
                <div className="vl-grp-children">
                  {[...families.entries()]
                    .sort(([a], [b]) => a === '—' ? 1 : b === '—' ? -1 : a.localeCompare(b))
                    .map(([fam, species]) => {
                      const famKey = `${g}::${fam}`;
                      const famOpen = expandedFamilies.has(famKey);
                      const rlCount = species.filter(o => RED_LIST_CATS.test(o.redListCategory ?? '')).length;
                      const alCount = species.filter(o => o.alienCategory).length;
                      return (
                        <div key={famKey} className="vl-nat-fam">
                          <div className="vl-fam-hdr" onClick={() => toggleExpandedFam(famKey)}>
                            <span className="vl-fam-lbl">
                              {fam === '—' ? '—' : showNorFamilies ? (familyNorMap[fam] ?? fam) : fam}
                            </span>
                            <div className="vl-fam-right">
                              {rlCount > 0 && <span className="vl-rlbadge">{rlCount}</span>}
                              {alCount > 0 && <span className="vl-albadge">{alCount}</span>}
                              <span className="vl-fam-cnt">{species.length}</span>
                              <span className={`vl-chev${famOpen ? ' open' : ''}`}><ChevSvg /></span>
                            </div>
                          </div>
                          {famOpen && [...species].sort((a, b) => b.obsCount - a.obsCount).map(obs => (
                            <div key={obs.gbifKey} className="vl-sp-row" onClick={() => selectNatureSpecies(obs)}>
                              <div className="vl-sp-main">
                                <span className="vl-sp-name">{obs.popularName || obs.scientificName}</span>
                                {obs.popularName && <span className="vl-sp-sci">{obs.scientificName}</span>}
                              </div>
                              <div className="vl-sp-right">
                                {obs.redListCategory && RED_LIST_CATS.test(obs.redListCategory) && (
                                  <span className="vl-rlbadge">{obs.redListCategory}</span>
                                )}
                                {obs.alienCategory && <span className="vl-albadge">FA</span>}
                                <span className="vl-sp-cnt">{obs.obsCount}</span>
                                <span className="vl-chev"><ChevSvg /></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}

        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
          Kilde: GBIF (CC BY 4.0)
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
              <img src={selectedEra.image} alt={selectedEra.image_caption || selectedEra.era} />
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
                {eraNavIdx + 1} av {n}
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
        {/* Mode pills */}
        <div className="vl-modepills vl-panel-modes">
          <button className={`vl-modepill${mode === 'places' ? ' on' : ''}`} onClick={() => { setMode('places'); setCurrentLayer('soleng'); setSelectedNature(null); setSelectedEra(null); setSelectedFarm(null); setSeaLevelM(0); }}>{T.places}</button>
          <button className={`vl-modepill${mode === 'trails' ? ' on' : ''}`} onClick={() => { setMode('trails'); setCurrentLayer('friluft'); setSelectedNature(null); setSelectedEra(null); setSelectedFarm(null); setSeaLevelM(0); }}>{T.trails}</button>
          <button className={`vl-modepill${mode === 'nature' ? ' on' : ''}`} onClick={() => { setMode('nature'); setCurrentLayer('flyfoto'); setSelectedNature(null); setSelectedEra(null); setSelectedFarm(null); setSeaLevelM(0); }}>{T.nature}</button>
          <button className={`vl-modepill${mode === 'history' ? ' on' : ''}`} onClick={() => { setMode('history'); setCurrentLayer('friluft'); setSelectedNature(null); setSelectedEra(null); setSelectedFarm(null); }}>{T.history}</button>
        </div>

        {/* Filter chips */}
        {mode === 'places' && (
          <div className="vl-chips vl-panel-chips">
            <div className={`vl-chip${activeCats.size === 0 ? ' on' : ''}`} onClick={() => setActiveCats(new Set())}>
              <span className="cl">{T.all}</span>
            </div>
            {[...catGroups.entries()].map(([groupName, groupCats]) => {
              const on = groupCats.some(k => activeCats.has(k));
              const groupIcon = (catCfg as Record<string, {icon?: string}>)[groupCats[0]]?.icon ?? 'pin';
              const groupColor = (catCfg as Record<string, {color?: string}>)[groupCats[0]]?.color ?? 'var(--muted)';
              return (
                <div key={groupName} className={`vl-chip${on ? ' on' : ''}`}
                  style={{ '--chip-color': groupColor } as React.CSSProperties}
                  onClick={() => toggleGroup(groupCats)}>
                  <span className="ci" style={{ color: on ? undefined : groupColor }} dangerouslySetInnerHTML={{ __html: iconSvg(groupIcon) }} />
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
                  onClick={() => toggleCat(k)}>
                  <span className="ci" style={{ color: on ? undefined : cat.color }} dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                  <span className="cl">{lang === 'no' ? cat.no : cat.en}</span>
                </div>
              );
            })}
          </div>
        )}
        {mode === 'nature' && (
          <div className="vl-chips vl-panel-chips">
            <div className={`vl-chip${!natureFilter ? ' on' : ''}`} onClick={() => setNatureFilter(null)}>
              <span className="cl">{T.all}</span>
            </div>
            {(Object.entries(NATURE_GROUPS) as [NatureGroup, typeof NATURE_GROUPS[NatureGroup]][]).map(([g, cfg]) => {
              const count = natureObs.filter(o => o.group === g).length;
              if (count === 0) return null;
              return (
                <div key={g} className={`vl-chip${natureFilter === g ? ' on' : ''}`} onClick={() => setNatureFilter(natureFilter === g ? null : g)}>
                  <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg(cfg.icon) }} />
                  <span className="cl">{lang === 'no' ? cfg.no : cfg.en} {count}</span>
                </div>
              );
            })}
            {natureObs.some(o => RED_LIST_CATS.test(o.redListCategory ?? '')) && (
              <div className={`vl-chip vl-chip-rl${redListFilter ? ' on' : ''}`} onClick={() => setRedListFilter(f => !f)}>
                <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('rodliste') }} />
                <span className="cl">{lang === 'no' ? 'Rødlista' : 'Red list'} {natureObs.filter(o => RED_LIST_CATS.test(o.redListCategory ?? '')).length}</span>
              </div>
            )}
            {natureObs.some(o => o.alienCategory) && (
              <div className={`vl-chip vl-chip-al${alienFilter ? ' on' : ''}`} onClick={() => setAlienFilter(f => !f)}>
                <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('fremmed') }} />
                <span className="cl">{lang === 'no' ? 'Fremmedarter' : 'Alien species'} {natureObs.filter(o => o.alienCategory).length}</span>
              </div>
            )}
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

        {mode === 'history' ? renderHistory() : mode === 'nature' ? renderNature() : mode === 'places' ? (
          <>
            <div className="vl-count">{filteredPOIs.length ? T.np(filteredPOIs.length) : T.nohit}</div>
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
              const isOpen = expandedPlaceCats.has(catKey);
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
                            onClick={() => { setSelectedPOI(poi); flyToAboveSheet(poi.coordinates, Math.max(mapRef.current?.getZoom() ?? 15, 15)); }}>
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

  // ── Render: POI detail ──────────────────────────────────────────────────────

  function renderPOIDetail(poi: POI) {
    const cat = getCat(poi.kategori);
    const saved = savedIds.has(poi.id);
    return (
      <>
        <button className="vl-back" onClick={goBack}><BackSvg />{T.back}</button>
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
            <img src={poi.bilde} alt={poi.navn} />
            {poi.bilde_lisens && <span className="vl-photo-credit">{poi.bilde_lisens}</span>}
          </div>
        )}

        {wikimediaImages.length === 1 && (
          <a href={wikimediaImages[0].pageUrl} target="_blank" rel="noreferrer" className="vl-poi-static-img" style={{ display: 'block', textDecoration: 'none' }}>
            <img src={wikimediaImages[0].thumbUrl} alt={wikimediaImages[0].title} style={{ width: '100%', height: 220, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
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
                  <img src={img.thumbUrl} alt={img.title} />
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
          const displayText = isTruncatable
            ? lokalData.tekst.slice(0, lokalData.tekst.lastIndexOf(' ', MAX) || MAX) + '…'
            : lokalData.tekst;
          return (
            <div className="vl-api-section">
              <p className="vl-api-label">Lokalhistoriewiki</p>
              {lokalData.bilde && (
                <img src={lokalData.bilde} alt={lokalData.tittel} className="vl-api-img" />
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
                  <img src={img.bilde600} alt={img.tittel} className="vl-api-img" />
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

  function renderTrailDetail(trail: Trail) {
    const cat = getCat('friluft');
    const saved = savedIds.has(trail.id);
    return (
      <>
        <button className="vl-back" onClick={goBack}><BackSvg />{T.back}</button>
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
        </div>
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
              mapRef.current?.fitBounds(bounds.pad(0.35), { paddingBottomRight: [0, 260] });
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
                      <div className="vl-poi-zone" onClick={() => {
                        setSelectedPOI(poi);
                        flyToAboveSheet(poi.coordinates, Math.max(mapRef.current?.getZoom() ?? 15, 15));
                      }}>
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

  return (
    <div className="vl-app">
      {/* Map area */}
      <div className="vl-map-area">
      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
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
        {mode === 'nature' && !selectedNature && filteredNatureObs.map(obs => {
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
        {mode === 'nature' && selectedNature && filteredNatureObs.filter(o => o.gbifKey !== selectedNature.gbifKey).map(obs => {
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
          onClick={() => { setSelectedPOI(nearbyPoi); setNearbyPoi(null); }}
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

      {/* Top overlay: lang toggle */}
      <div className="vl-top">
        <div className="vl-lang">
          <button className={lang === 'no' ? 'on' : ''} onClick={() => setLang('no')}>NO</button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} title="Some content is only available in Norwegian">EN</button>
        </div>
      </div>

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
        </button>
        <button className="vl-rbtn" aria-label={lang === 'no' ? 'Tilbake til Veierland' : 'Back to island'} title={lang === 'no' ? 'Tilbake til Veierland' : 'Back to island'}
          onClick={() => mapRef.current?.flyTo(MAP_CENTER, MAP_ZOOM, { duration: 0.7 })}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9,22 9,12 15,12 15,22"/>
          </svg>
        </button>
      </div>
      </div>{/* end vl-map-area */}

      {/* Sheet / Desktop sidebar */}
      <div
        ref={sheetRef}
        className="vl-sheet"
        style={{ height: sheetCurrentH + 'px' }}
        onClick={() => setShowLayerPop(false)}
      >
        <div className="vl-grab" onClick={() => setSheetOpen(o => !o)}>
          <div className="bar" />
        </div>
        <div className="vl-body" ref={bodyRef}>
          {view === 'browse' && renderBrowse()}
          {view === 'detail' && selectedPOI && renderPOIDetail(selectedPOI)}
          {view === 'detail' && selectedTrail && renderTrailDetail(selectedTrail)}
        </div>
      </div>
    </div>
  );
}
