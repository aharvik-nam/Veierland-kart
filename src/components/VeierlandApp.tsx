import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { loadAllPOIs } from '../data/veierland';
import { loadTurkartGeoJSON } from '../lib/geodata';
import boundaryData from '../data/veierland_boundary.json';
import natureCacheData from '../data/nature_cache.json';
import assessmentCacheData from '../data/assessment_cache.json';
import 'leaflet.markercluster';
import { POI, SNLData, LokalhistorieData, MuseumPhoto, WikimediaImage, WikipediaData } from '../lib/types';
import { fetchSNL, fetchLokalhistorie, fetchDigitalMuseum, fetchWikimediaImages, fetchWikipediaSpecies, fetchArtsdatabankenAssessment } from '../lib/api';

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

// ─── Category configs ─────────────────────────────────────────────────────────

interface CatCfg {
  no: string;
  en: string;
  color: string;
  icon: string;
}

const CAT_CFG: Record<string, CatCfg> = {
  bad:        { no: 'Badeplasser',   en: 'Beaches',      color: '#2f9e8f', icon: 'bade'   },
  ferge:      { no: 'Brygge',        en: 'Quays',        color: '#3d6ea5', icon: 'ferge'  },
  havn:       { no: 'Havn',          en: 'Harbour',      color: '#3d6ea5', icon: 'anker'  },
  kultur:     { no: 'Kulturminner',  en: 'Heritage',     color: '#b5673e', icon: 'kultur' },
  hvalfangst: { no: 'Hvalfangst',   en: 'Whaling',      color: '#7b5ea7', icon: 'utsikt' },
  info:       { no: 'Fasiliteter',   en: 'Facilities',   color: '#6b7a86', icon: 'wc'     },
  mat:        { no: 'Servering',     en: 'Food & drink', color: '#e0823c', icon: 'mat'    },
  friluft:    { no: 'Friluft',       en: 'Outdoor',      color: '#5f9438', icon: 'tur'    },
  arkeologi:  { no: 'Arkeologi',     en: 'Archaeology',  color: '#b5673e', icon: 'kultur' },
  stedsnavn:  { no: 'Stedsnavn',     en: 'Place names',  color: '#7c876f', icon: 'wc'     },
};

const PRAKTISK_CATS = ['bad', 'ferge', 'havn', 'mat', 'friluft', 'kultur', 'info'];
const HISTORISK_CATS = ['arkeologi'];

function getCat(k: string): CatCfg {
  return CAT_CFG[k] ?? { no: k, en: k, color: '#7c876f', icon: 'wc' };
}

// ─── Icon SVG paths ───────────────────────────────────────────────────────────

const ICONS: Record<string, string> = {
  bade:   '<path d="M-6,-2 q3,-3 6,0 q3,3 6,0"/><path d="M-6,3 q3,-3 6,0 q3,3 6,0"/>',
  tur:    '<path d="M-5,6 C-8,1 -1,2 0,-2 C1,-6 7,-5 4,-9"/>',
  utsikt: '<path d="M-7,0 C-4,-4.5 4,-4.5 7,0 C4,4.5 -4,4.5 -7,0 Z"/><circle cx="0" cy="0" r="1.7" fill="#fff" stroke="none"/>',
  ferge:  '<path d="M-7,2 L7,2 L5,6 L-5,6 Z"/><path d="M0,2 L0,-6"/><path d="M0,-6 L5,-3 L0,-1" fill="#fff"/>',
  anker:  '<circle cx="0" cy="-5" r="2.2" fill="none"/><path d="M0,-2.8 L0,6"/><path d="M-5,0 H5"/><path d="M-5,6 C-8,6 -8,3 -5,3"/><path d="M5,6 C8,6 8,3 5,3"/>',
  mat:    '<path d="M-5,-3 L5,-3 L4,3 a2.4,2.4 0 0 1-2.4,2.4L-1.6,2.4a2.4,2.4 0 0 1-2.4,-2.4Z"/><path d="M5,-2 a2.6,2.6 0 0 1 0,4.4"/><path d="M-1,-7 v2.4"/>',
  kultur: '<path d="M-7,-3 L0,-8 L7,-3"/><path d="M-5,-3 v8"/><path d="M0,-3 v8"/><path d="M5,-3 v8"/><path d="M-7,5 H7"/>',
  telt:   '<path d="M0,-7 L7.5,6 L-7.5,6 Z"/><path d="M0,-7 L0,6"/><path d="M0,6 L-2.5,6"/>',
  wc:     '<circle cx="0" cy="0" r="6.5"/><path d="M0,-2.6 v0.2"/><path d="M0,0 v3.2"/>',
  blad:   '<path d="M0,8 Q-8,-1 0,-9 Q8,-1 0,8Z"/><path d="M0,-9 Q-2,0 0,8"/>',
  all:    '<rect x="-7" y="-7" width="5.5" height="5.5" rx="1.2"/><rect x="1.5" y="-7" width="5.5" height="5.5" rx="1.2"/><rect x="-7" y="1.5" width="5.5" height="5.5" rx="1.2"/><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2"/>',
  fugl:        '<path d="M-9,3 C-5,-5 5,-5 9,3 C5,0 1,0 0,-2 C-1,0 -5,0 -9,3Z"/><path d="M0,-2 L0,7"/><path d="M-2,7 L2,7"/>',
  plante:      '<path d="M0,9 C-7,5 -7,-2 0,-9 C7,-2 7,5 0,9Z"/><path d="M0,-9 L0,9"/>',
  pattedyr:    '<circle cx="-3.5" cy="-5.5" r="2.5"/><circle cx="3.5" cy="-5.5" r="2.5"/><path d="M-6,0 C-7,-4 -4,-6 0,-4 C4,-6 7,-4 6,0 C5,5 3,8 0,8 C-3,8 -5,5 -6,0Z"/>',
  sopp:        '<path d="M-8,-1 Q-8,-9 0,-9 Q8,-9 8,-1 Z"/><path d="M0,-1 L0,8"/><path d="M-3,8 L3,8"/>',
  sommerfugl:  '<path d="M0,1 C-2,-1 -9,0 -8,-5 C-7,-9 -2,-7 0,1Z"/><path d="M0,1 C2,-1 9,0 8,-5 C7,-9 2,-7 0,1Z"/><path d="M0,1 C-1,2 -5,5 -3,8 C-1,9 0,5 0,1Z"/><path d="M0,1 C1,2 5,5 3,8 C1,9 0,5 0,1Z"/>',
  rodliste:    '<path d="M0,-9 L8.5,7 L-8.5,7 Z"/><path d="M0,-2 L0,2"/><circle cx="0" cy="5" r="1.5" fill="currentColor" stroke="none"/>',
  fremmed:     '<circle cx="0" cy="1" r="7"/><path d="M0,-10 L0,-6"/><path d="M-3,-8 L0,-6 L3,-8"/>',
};

// ─── Nature (Artsdatabanken) ──────────────────────────────────────────────────

// GBIF backbone taxon keys for Veierland groups
const NATURE_GROUPS = {
  Fugler:        { no: 'Fugler',        en: 'Birds',        color: '#3b7fc4', taxonKey: 212, icon: 'fugl'       },
  Karplanter:    { no: 'Karplanter',    en: 'Plants',       color: '#4a8a2a', taxonKey: 6,   icon: 'plante'     },
  Pattedyr:      { no: 'Pattedyr',      en: 'Mammals',      color: '#8b5c2a', taxonKey: 359, icon: 'pattedyr'   },
  Sommerfugler:  { no: 'Sommerfugler',  en: 'Butterflies',  color: '#b84fa0', taxonKey: 797, icon: 'sommerfugl' },
  Sopper:        { no: 'Sopper',        en: 'Fungi',        color: '#c07a3a', taxonKey: 5,   icon: 'sopp'       },
} as const;
type NatureGroup = keyof typeof NATURE_GROUPS;
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

interface NatureObs {
  scientificName: string;
  popularName: string;
  photoUrl: string;
  photoAttribution: string;
  group: NatureGroup;
  lat: number;
  lng: number;
  date: string;
  obsCount: number;
  gbifKey: number;
  family?: string;
  familyKey?: number;
  redListCategory?: string;
  alienCategory?: string;
}

// WGS84 polygon tracing Veierland's coastline (from veierland_boundary.json)
const GBIF_POLYGON = encodeURIComponent(
  'POLYGON((' +
  [...(boundaryData as any).coordinates[0]].reverse().map((c: number[]) => `${c[0]} ${c[1]}`).join(',') +
  '))'
);

async function fetchNatureGroup(group: NatureGroup): Promise<{ group: NatureGroup; obs: unknown[] }> {
  try {
    const allResults: unknown[] = [];
    const limit = 300;
    let offset = 0;
    while (true) {
      const url = `https://api.gbif.org/v1/occurrence/search?geometry=${GBIF_POLYGON}&taxonKey=${NATURE_GROUPS[group].taxonKey}&limit=${limit}&offset=${offset}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allResults.push(...(data.results ?? []));
      if (data.endOfRecords) break;
      offset += limit;
      if (offset > 9000) break; // safety cap: 30 pages per group
    }
    return { group, obs: allResults };
  } catch {
    return { group, obs: [] };
  }
}

interface INatResult { norwegianName: string; photoUrl: string; photoAttribution: string; }

async function fetchINaturalistTaxon(scientificName: string): Promise<INatResult> {
  const empty: INatResult = { norwegianName: '', photoUrl: '', photoAttribution: '' };
  try {
    const res = await fetch(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&locale=nb&per_page=5`
    );
    if (!res.ok) return empty;
    const data = await res.json();
    const genus = scientificName.split(' ')[0].toLowerCase();
    const taxon = (data.results as any[]).find(t =>
      t.name.toLowerCase().startsWith(genus)
    );
    if (!taxon) return empty;
    return {
      norwegianName: taxon.preferred_common_name ?? '',
      photoUrl: taxon.default_photo?.medium_url ?? '',
      photoAttribution: taxon.default_photo?.attribution ?? '',
    };
  } catch {
    return empty;
  }
}

async function enrichWithINaturalist(obs: NatureObs[]): Promise<NatureObs[]> {
  const uniqueNames = [...new Set(obs.map(o => o.scientificName))];
  const results = await Promise.all(uniqueNames.map(n => fetchINaturalistTaxon(n)));
  const map = new Map(uniqueNames.map((n, i) => [n, results[i]]));
  return obs.map(o => {
    const r = map.get(o.scientificName)!;
    return { ...o, popularName: r.norwegianName || o.popularName, photoUrl: r.photoUrl, photoAttribution: r.photoAttribution };
  });
}

const _assessmentCache = (assessmentCacheData as { assessments: Record<string, { redListCategory?: string; alienCategory?: string }> }).assessments;

async function enrichWithAssessments(obs: NatureObs[]): Promise<NatureObs[]> {
  const uniqueNames = [...new Set(obs.map(o => o.scientificName))];
  const amap = new Map<string, { redListCategory?: string; alienCategory?: string }>();

  // Use pre-built cache for known species (instant)
  const cacheMisses = uniqueNames.filter(n => {
    const cached = _assessmentCache[n];
    if (cached !== undefined) { amap.set(n, cached); return false; }
    return true;
  });

  // Live API only for species not in cache (rare — new observations)
  if (cacheMisses.length > 0) {
    const BATCH = 20;
    for (let i = 0; i < cacheMisses.length; i += BATCH) {
      const batch = cacheMisses.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(n => fetchArtsdatabankenAssessment(n)));
      batch.forEach((n, j) => amap.set(n, results[j]));
    }
  }

  return obs.map(o => ({ ...o, ...(amap.get(o.scientificName) ?? {}) }));
}

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

function processNatureData(rawGroups: { group: NatureGroup; obs: unknown[] }[]): NatureObs[] {
  const countMap = new Map<number, number>();
  const latestMap = new Map<number, { raw: Record<string, unknown>; group: NatureGroup; date: string }>();

  for (const { group, obs } of rawGroups) {
    for (const o of obs as Record<string, unknown>[]) {
      const key = o.speciesKey as number;
      if (!key || !o.decimalLatitude || !o.species) continue;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
      const date = String(o.eventDate ?? '');
      const existing = latestMap.get(key);
      if (!existing || date > existing.date) latestMap.set(key, { raw: o, group, date });
    }
  }

  const result: NatureObs[] = [];
  for (const [key, { raw, group, date }] of latestMap) {
    result.push({
      scientificName: String(raw.species ?? ''),
      popularName: '',
      photoUrl: '',
      photoAttribution: '',
      group,
      lat: raw.decimalLatitude as number,
      lng: raw.decimalLongitude as number,
      date,
      obsCount: countMap.get(key) ?? 1,
      gbifKey: key,
      family: String(raw.family ?? ''),
      familyKey: raw.familyKey as number | undefined,
    });
  }

  return result.sort((a, b) => b.obsCount - a.obsCount || a.scientificName.localeCompare(b.scientificName));
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

const MAP_CENTER: [number, number] = [59.183, 10.430];
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
  const [mode, setMode] = useState<'places' | 'trails' | 'nature'>('places');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [view, setView] = useState<'browse' | 'detail'>('browse');
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  const [selectedTrail, setSelectedTrail] = useState<Trail | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [currentLayer, setCurrentLayer] = useState<string>(() => {
    try { return localStorage.getItem('vl-layer') || 'soleng'; } catch { return 'soleng'; }
  });
  const [showLayerPop, setShowLayerPop] = useState(false);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [trailPath, setTrailPath] = useState<[number, number][] | null>(null);
  const [heartAnim, setHeartAnim] = useState(false);

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
  const sheetRef = useRef<HTMLDivElement>(null);
  const fitDoneRef = useRef(false);

  // Derive category list from actual POI data
  const allCats = useMemo(
    () => Array.from(new Set(allPOIs.map(p => p.kategori))).filter(k => CAT_CFG[k]),
    [allPOIs]
  );

  // Filtered POIs
  const filteredPOIs = useMemo(() => {
    return allPOIs.filter(p => {
      if (activeCats.size > 0 && !activeCats.has(p.kategori)) return false;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        if (!(p.navn + ' ' + p.beskrivelse).toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [allPOIs, activeCats, searchQ]);

  const groupedPOIs = useMemo(() => {
    const catOrder = Object.keys(CAT_CFG);
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
      .then(r => { if (alive) { setSpeciesWiki(r); setSpeciesWikiLoading(false); } });
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
  }, []);

  // Fit map bounds once both map and POIs are ready (runs once)
  useEffect(() => {
    if (!mapReady || !mapRef.current || allPOIs.length === 0 || fitDoneRef.current) return;
    fitDoneRef.current = true;
    const coords = allPOIs.map(p => p.coordinates as [number, number]);
    mapRef.current.fitBounds(L.latLngBounds(coords).pad(0.08), { animate: false });
    setMapZoom(mapRef.current.getZoom());
  }, [mapReady, allPOIs]);

  const onMapReady = useCallback((m: L.Map) => { mapRef.current = m; setMapReady(true); }, []);
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
    if (mode === 'nature') return;

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
    filteredPOIs.forEach(poi => {
      const cat = getCat(poi.kategori);
      const sel = selectedPOI?.id === poi.id && view === 'detail';
      const icon = L.divIcon({ className: '', iconSize: [sz, sz], iconAnchor: [half, half], html: makeIconHtml(cat.icon, sel, sz) });
      L.marker(poi.coordinates as [number, number], { icon }).on('click', () => selectPOI(poi)).addTo(cg);
    });

    map.addLayer(cg);
    clusterRef.current = cg;

    return () => { if (map) map.removeLayer(cg); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mode, filteredPOIs, selectedPOI?.id, view, mapZoom]);

  useEffect(() => {
    if (mode !== 'nature' || natureFetched) return;

    // 1. Load pre-baked static cache instantly for fast initial display
    const staticCache = natureCacheData as { generatedAt: string; obs: NatureObs[] };
    setNatureObs(staticCache.obs);
    setNatureFetched(true);

    // 2. Fetch ALL observations from GBIF and replace cache with full individual obs
    const cacheMap = new Map(staticCache.obs.map(o => [o.gbifKey, o]));
    const groups = Object.keys(NATURE_GROUPS) as NatureGroup[];
    Promise.all(groups.map(fetchNatureGroup)).then(rawGroups => {
      const allObs = processNatureData(rawGroups);
      if (allObs.length === 0) return;

      // Re-use cached popularName/photo for known species — avoids re-fetching iNaturalist for all
      const preEnriched = allObs.map(obs => {
        const cached = cacheMap.get(obs.gbifKey);
        return cached
          ? { ...obs, popularName: cached.popularName, photoUrl: cached.photoUrl, photoAttribution: cached.photoAttribution }
          : obs;
      });

      // Run iNaturalist (new species only) and assessments (all) in parallel
      const newObs = preEnriched.filter(o => !cacheMap.has(o.gbifKey));
      return Promise.all([
        newObs.length > 0 ? enrichWithINaturalist(newObs) : Promise.resolve<NatureObs[]>([]),
        enrichWithAssessments(preEnriched),
      ]).then(([enrichedNew, assessedAll]) => {
        const inatMap = new Map(enrichedNew.map(o => [o.gbifKey, o]));
        const assessMap = new Map(assessedAll.map(o => [o.gbifKey, o]));
        const finalObs = preEnriched.map(o => {
          const assessed = assessMap.get(o.gbifKey) ?? o;
          const inat = inatMap.get(o.gbifKey);
          return inat ? { ...assessed, popularName: inat.popularName, photoUrl: inat.photoUrl, photoAttribution: inat.photoAttribution } : assessed;
        });
        setNatureObs(finalObs);
        loadNorwegianFamilyNames(finalObs, setFamilyNorMap);
      });
    });
  }, [mode, natureFetched]);

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
    flyToAboveSheet(poi.coordinates, 15);
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

  function locate() {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const p: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserPos(p);
        mapRef.current?.flyTo(p, 15, { duration: 0.7 });
      },
      err => console.error('Geolocation error', err),
      { enableHighAccuracy: true }
    );
  }

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
  const SHEET_OPEN_H = Math.min(window.innerHeight * 0.74, 700);
  const sheetCurrentH = sheetOpen ? SHEET_OPEN_H : SHEET_PEEK_H;
  const railBottom = sheetCurrentH + 16;

  // Text strings
  const T = lang === 'no' ? {
    search: 'Søk på Veierland', all: 'Alle', explore: 'Utforsk Veierland',
    places: 'Steder', trails: 'Turer', nature: 'Natur', back: 'Tilbake',
    directions: 'Veibeskrivelse', length: 'Lengde', duration: 'Tid', diff: 'Vanskelighet',
    layers: 'Kartlag', nohit: 'Ingen treff', easy: 'Lett', showRoute: 'Vis rute',
    natObs: (n: number) => `${n} ${n === 1 ? 'art' : 'arter'} observert`,
    np: (n: number) => `${n} ${n === 1 ? 'sted' : 'steder'}`,
    nt: (n: number) => `${n} ${n === 1 ? 'tur' : 'turer'}`,
  } : {
    search: 'Search Veierland', all: 'All', explore: 'Explore Veierland',
    places: 'Places', trails: 'Trails', nature: 'Nature', back: 'Back',
    directions: 'Directions', length: 'Length', duration: 'Time', diff: 'Difficulty',
    layers: 'Map layer', nohit: 'No matches', easy: 'Easy', showRoute: 'Show route',
    natObs: (n: number) => `${n} ${n === 1 ? 'species' : 'species'} observed`,
    np: (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`,
    nt: (n: number) => `${n} ${n === 1 ? 'trail' : 'trails'}`,
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
        {natureLoading ? (
          <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <div className="vl-spinner" />
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
              {lang === 'no' ? 'Henter naturdata…' : 'Loading nature data…'}
            </p>
          </div>
        ) : (
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
        )}

        {(Object.keys(NATURE_GROUPS) as NatureGroup[]).map(g => {
          const cfg = NATURE_GROUPS[g];
          const families = groupedNatureObs.get(g)!;
          const total = [...families.values()].reduce((s, arr) => s + arr.length, 0);
          if (total === 0) return null;
          const grpOpen = expandedGroups.has(g);
          return (
            <div key={g} className="vl-nat-grp">
              <div className="vl-grp-hdr" onClick={() => toggleExpandedGroup(g)}>
                <span className="vl-grp-ico" dangerouslySetInnerHTML={{ __html: coloredSvg(cfg.icon, cfg.color) }} />
                <span className="vl-grp-lbl">{lang === 'no' ? cfg.no : cfg.en}</span>
                <span className="vl-grp-cnt">{total}</span>
                <span className={`vl-chev${grpOpen ? ' open' : ''}`}><ChevSvg /></span>
              </div>
              {grpOpen && [...families.entries()]
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
          );
        })}

        {!natureLoading && (
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Kilde: GBIF (CC BY 4.0)
          </p>
        )}
      </>
    );
  }

  // ── Render: browse ──────────────────────────────────────────────────────────

  function renderBrowse() {
    return (
      <>
        <h2 className="vl-title">{T.explore}</h2>
        {mode === 'nature' ? renderNature() : mode === 'places' ? (
          <>
            <div className="vl-count">{filteredPOIs.length ? T.np(filteredPOIs.length) : T.nohit}</div>
            {groupedPOIs.map(([catKey, pois]) => {
              const cat = getCat(catKey);
              const isOpen = expandedPlaceCats.has(catKey);
              return (
                <div key={catKey} className="vl-nat-grp">
                  <div className="vl-grp-hdr" onClick={() => toggleExpandedPlaceCat(catKey)}>
                    <span className="vl-grp-ico" dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                    <span className="vl-grp-lbl">{lang === 'no' ? cat.no : cat.en}</span>
                    <span className="vl-grp-cnt">{pois.length}</span>
                    <span className={`vl-chev${isOpen ? ' open' : ''}`}><ChevSvg /></span>
                  </div>
                  {isOpen && pois.map(poi => (
                    <div key={poi.id} className="vl-sp-row" onClick={() => selectPOI(poi)}>
                      <div className="vl-sp-main">
                        <span className="vl-sp-name">{poi.navn}</span>
                        {poi.beskrivelse && (
                          <span className="vl-sp-sci">
                            {poi.beskrivelse.length > 55 ? poi.beskrivelse.slice(0, 55) + '…' : poi.beskrivelse}
                          </span>
                        )}
                      </div>
                      <span className="vl-chev"><ChevSvg /></span>
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        ) : (
          <>
            <div className="vl-count">{T.nt(trails.length)}</div>
            {trails.map(tr => (
              <div key={tr.id} className="vl-card" onClick={() => selectTrail(tr)}>
                <div className="vl-ic" dangerouslySetInnerHTML={{ __html: iconSvg('tur') }} />
                <div className="tx">
                  <h4>{lang === 'no' ? tr.name : tr.en}</h4>
                  <p>{tr.km} · {tr.time} · {lang === 'no' ? tr.diff : T.easy}</p>
                </div>
                <span className="chev"><ChevSvg /></span>
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
        <div><span className="vl-catpill">{lang === 'no' ? cat.no : cat.en}</span></div>
        <div className="vl-h2">{poi.navn}</div>
        <p className="vl-desc">{poi.beskrivelse}</p>

        {poi.bilde && (
          <div className="vl-poi-static-img">
            <img src={poi.bilde} alt={poi.navn} />
            {poi.bilde_lisens && <span className="vl-photo-credit">{poi.bilde_lisens}</span>}
          </div>
        )}

        {wikimediaImages.length > 0 && (
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

        {lokalData && (
          <div className="vl-api-section">
            <p className="vl-api-label">Lokalhistoriewiki</p>
            {lokalData.bilde && (
              <img src={lokalData.bilde} alt={lokalData.tittel} className="vl-api-img" />
            )}
            <p className="vl-api-text">{lokalData.tekst}</p>
            <a href={lokalData.url} target="_blank" rel="noreferrer" className="vl-api-link">
              Les mer på Lokalhistoriewiki.no ↗
            </a>
          </div>
        )}

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
        {userPos && (
          <Marker position={userPos} icon={USER_ICON} interactive={false} />
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

      {/* Top overlay: mode pills + chips + searchbar */}
      <div className={`vl-top${searchOpen ? ' searching' : ''}`}>
        <div className="vl-modes">
          <div className="vl-modepills">
            <button className={`vl-modepill${mode === 'places' ? ' on' : ''}`} onClick={() => { setMode('places'); setCurrentLayer('soleng'); setSelectedNature(null); }}>{T.places}</button>
            <button className={`vl-modepill${mode === 'trails' ? ' on' : ''}`} onClick={() => { setMode('trails'); setCurrentLayer('friluft'); setSelectedNature(null); }}>{T.trails}</button>
            <button className={`vl-modepill${mode === 'nature' ? ' on' : ''}`} onClick={() => { setMode('nature'); setCurrentLayer('flyfoto'); setSelectedNature(null); }}>{T.nature}</button>
          </div>
          <div className="vl-lang">
            <button className={lang === 'no' ? 'on' : ''} onClick={() => setLang('no')}>NO</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
          </div>
        </div>
        {mode === 'places' && (
          <div className="vl-chips">
            <div className={`vl-chip${activeCats.size === 0 ? ' on' : ''}`} onClick={() => setActiveCats(new Set())}>
              <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('all') }} />
              <span className="cl">{T.all}</span>
            </div>
            {(() => {
              const praktiskOn = PRAKTISK_CATS.some(k => activeCats.has(k));
              const historiskOn = HISTORISK_CATS.some(k => activeCats.has(k));
              return (
                <>
                  <div className={`vl-chip${praktiskOn ? ' on' : ''}`} onClick={() => toggleGroup(PRAKTISK_CATS)}>
                    <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('wc') }} />
                    <span className="cl">{lang === 'no' ? 'Praktisk' : 'Practical'}</span>
                  </div>
                  <div className={`vl-chip${historiskOn ? ' on' : ''}`} onClick={() => toggleGroup(HISTORISK_CATS)}>
                    <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('kultur') }} />
                    <span className="cl">{lang === 'no' ? 'Historisk' : 'Historic'}</span>
                  </div>
                </>
              );
            })()}
            {allCats.filter(k => ![...PRAKTISK_CATS, ...HISTORISK_CATS].includes(k)).map(k => {
              const cat = getCat(k);
              const on = activeCats.has(k);
              return (
                <div key={k} className={`vl-chip${on ? ' on' : ''}`} onClick={() => toggleCat(k)}>
                  <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                  <span className="cl">{lang === 'no' ? cat.no : cat.en}</span>
                </div>
              );
            })}
          </div>
        )}
        {mode === 'nature' && (
          <div className="vl-chips">
            <div className={`vl-chip${!natureFilter ? ' on' : ''}`} onClick={() => setNatureFilter(null)}>
              <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('all') }} />
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
        <div className="vl-searchbar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>
          </svg>
          <input
            type="text"
            placeholder={T.search}
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            autoComplete="off"
            autoFocus={searchOpen}
          />
          <button className="vl-search-close" onClick={() => { setSearchOpen(false); setSearchQ(''); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
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
      </div>

      {/* Right rail */}
      <div className="vl-rail" style={{ bottom: railBottom }}>
        <button className="vl-rbtn" aria-label={T.search} onClick={() => { setSearchOpen(true); setShowLayerPop(false); }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>
          </svg>
        </button>
        <button
          className="vl-rbtn layers"
          aria-label={T.layers}
          onClick={e => { e.stopPropagation(); setShowLayerPop(v => !v); }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>
          </svg>
        </button>
        <button className="vl-rbtn" aria-label="Min posisjon" onClick={locate}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3.4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>
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
        <div className="vl-body">
          {view === 'browse' && renderBrowse()}
          {view === 'detail' && selectedPOI && renderPOIDetail(selectedPOI)}
          {view === 'detail' && selectedTrail && renderTrailDetail(selectedTrail)}
        </div>
      </div>
    </div>
  );
}
