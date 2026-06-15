import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { ALL_POIS } from '../data/veierland';
import { POI, SNLData, LokalhistorieData, MuseumPhoto } from '../lib/types';
import { fetchSNL, fetchLokalhistorie, fetchDigitalMuseum } from '../lib/api';

// ─── Layer configs ────────────────────────────────────────────────────────────

interface LayerCfg {
  label: { no: string; en: string };
  sw: string;
  url: string;
  opts: Record<string, unknown>;
  filter: string;
}

const LAYERS: Record<string, LayerCfg> = {
  soleng: {
    label: { no: 'Kart', en: 'Map' },
    sw: 'linear-gradient(135deg,#cfe7e1,#d6e5a6)',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    opts: { subdomains: 'abcd', maxZoom: 19, attribution: '© OpenStreetMap · © CARTO' },
    filter: 'saturate(1.75) hue-rotate(6deg) brightness(1.01) contrast(1.04) sepia(.10)',
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
};
const LAYER_ORDER = ['soleng', 'friluft', 'flyfoto'] as const;

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
  havn:       { no: 'Havn',          en: 'Harbour',      color: '#3d6ea5', icon: 'ferge'  },
  kultur:     { no: 'Kulturminner',  en: 'Heritage',     color: '#b5673e', icon: 'kultur' },
  hvalfangst: { no: 'Hvalfangst',   en: 'Whaling',      color: '#7b5ea7', icon: 'utsikt' },
  info:       { no: 'Fasiliteter',   en: 'Facilities',   color: '#6b7a86', icon: 'wc'     },
  mat:        { no: 'Servering',     en: 'Food & drink', color: '#e0823c', icon: 'mat'    },
  friluft:    { no: 'Friluft',       en: 'Outdoor',      color: '#5f9438', icon: 'tur'    },
  arkeologi:  { no: 'Arkeologi',     en: 'Archaeology',  color: '#b5673e', icon: 'kultur' },
  stedsnavn:  { no: 'Stedsnavn',     en: 'Place names',  color: '#7c876f', icon: 'wc'     },
};

function getCat(k: string): CatCfg {
  return CAT_CFG[k] ?? { no: k, en: k, color: '#7c876f', icon: 'wc' };
}

// ─── Icon SVG paths ───────────────────────────────────────────────────────────

const ICONS: Record<string, string> = {
  bade:   '<path d="M-6,-2 q3,-3 6,0 q3,3 6,0"/><path d="M-6,3 q3,-3 6,0 q3,3 6,0"/>',
  tur:    '<path d="M-5,6 C-8,1 -1,2 0,-2 C1,-6 7,-5 4,-9"/>',
  utsikt: '<path d="M-7,0 C-4,-4.5 4,-4.5 7,0 C4,4.5 -4,4.5 -7,0 Z"/><circle cx="0" cy="0" r="1.7" fill="#fff" stroke="none"/>',
  ferge:  '<path d="M-7,2 L7,2 L5,6 L-5,6 Z"/><path d="M0,2 L0,-6"/><path d="M0,-6 L5,-3 L0,-1" fill="#fff"/>',
  mat:    '<path d="M-5,-3 L5,-3 L4,3 a2.4,2.4 0 0 1-2.4,2.4L-1.6,2.4a2.4,2.4 0 0 1-2.4,-2.4Z"/><path d="M5,-2 a2.6,2.6 0 0 1 0,4.4"/><path d="M-1,-7 v2.4"/>',
  kultur: '<path d="M-7,-3 L0,-8 L7,-3"/><path d="M-5,-3 v8"/><path d="M0,-3 v8"/><path d="M5,-3 v8"/><path d="M-7,5 H7"/>',
  telt:   '<path d="M0,-7 L7.5,6 L-7.5,6 Z"/><path d="M0,-7 L0,6"/><path d="M0,6 L-2.5,6"/>',
  wc:     '<circle cx="0" cy="0" r="6.5"/><path d="M0,-2.6 v0.2"/><path d="M0,0 v3.2"/>',
};

function makeIconHtml(icon: string, color: string, selected: boolean): string {
  const svg = `<svg viewBox="-12 -12 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] ?? ICONS.wc}</svg>`;
  return `<div class="vl-pin${selected ? ' sel' : ''}" style="--c:${color}">${svg}</div>`;
}

function coloredSvg(icon: string, color: string): string {
  return `<svg viewBox="-12 -12 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] ?? ICONS.wc}</svg>`;
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

const VL_TRAILS: Trail[] = [
  {
    id: 't-rundt', name: 'Rundt øya', en: 'Around the island',
    km: '8,5 km', time: '2 t 30 min', diff: 'Lett',
    no: 'Grusveier og smale stier hele veien rundt — innom skog, åpne jorder, enger og strender med utsyn over skjærgården.',
    enT: 'Gravel roads and narrow paths all the way around — through forest, open fields, meadows and beaches with sea views.',
    path: [[59.1829,10.4182],[59.1816,10.4214],[59.1760,10.4290],[59.1716,10.4308],[59.1692,10.4358],[59.1820,10.4430],[59.1879,10.4422],[59.1965,10.4289],[59.2008,10.4366],[59.1992,10.4242],[59.1902,10.4271],[59.1846,10.4296],[59.1829,10.4182]],
  },
  {
    id: 't-hverv', name: 'Til Hvervodden', en: 'To Hvervodden',
    km: '2,1 km', time: '35 min', diff: 'Lett',
    no: 'Korteste vei fra brygga via øyas sentrum og ned til den fineste sandstranda i sør.',
    enT: 'The shortest route from the quay through the island centre down to the best sandy beach in the south.',
    path: [[59.1846,10.4296],[59.1820,10.4300],[59.1780,10.4305],[59.1745,10.4308],[59.1716,10.4308]],
  },
  {
    id: 't-pilegrim', name: 'Pilegrimsleden', en: 'Pilgrim route',
    km: '3,4 km', time: '50 min', diff: 'Lett',
    no: 'Merket pilegrimsled tvers over øya, forbi den hvite kirka fra 1905 og ned mot nordbrygga.',
    enT: 'A waymarked pilgrim route across the island, past the white church from 1905 and down to the north quay.',
    path: [[59.1829,10.4182],[59.1846,10.4296],[59.1902,10.4271],[59.1965,10.4289],[59.1992,10.4242]],
  },
];

// ─── Map sub-components ───────────────────────────────────────────────────────

function MapSetup({ onReady, onMapClick }: { onReady: (m: L.Map) => void; onMapClick: () => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
    map.on('click', onMapClick);
    return () => { map.off('click', onMapClick); };
  }, [map, onReady, onMapClick]);
  return null;
}

function TileController({ layer }: { layer: string }) {
  const map = useMap();
  const tileRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const cfg = LAYERS[layer];
    if (!cfg) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const tile = L.tileLayer(cfg.url, { ...cfg.opts, zIndex: 0 } as L.TileLayerOptions);
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

function computeSheetH(view: 'browse' | 'detail', mode: 'peek' | 'full'): number {
  if (mode === 'full') return Math.min(window.innerHeight * 0.74, 700);
  if (view === 'detail') return Math.min(window.innerHeight * 0.62, 560);
  return 250;
}

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

function heroArt(color: string) {
  return `<svg width="100%" height="100%" viewBox="0 0 380 120" preserveAspectRatio="xMidYMid slice" style="position:absolute;inset:0">
    <rect width="380" height="120" fill="${color}18"/>
    <defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#cfe7e1"/><stop offset="1" stop-color="#d6e5a6"/>
    </linearGradient></defs>
    <rect width="380" height="120" fill="url(#hg)"/>
    <path d="M0,86 q60,-18 120,-4 t140,-6 140,2 V120 H0 Z" fill="#bfe0d8"/>
    <path d="M0,98 q70,-12 150,2 t170,-2 V120 H0 Z" fill="#a9d6cb"/>
    <circle cx="320" cy="34" r="16" fill="#fff" opacity="0.7"/>
  </svg>`;
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
  const [activeCats, setActiveCats] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'places' | 'trails'>('places');
  const [searchQ, setSearchQ] = useState('');
  const [view, setView] = useState<'browse' | 'detail'>('browse');
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  const [selectedTrail, setSelectedTrail] = useState<Trail | null>(null);
  const [sheetMode, setSheetMode] = useState<'peek' | 'full'>('peek');
  const [sheetH, setSheetH] = useState(250);
  const [currentLayer, setCurrentLayer] = useState('soleng');
  const [showLayerPop, setShowLayerPop] = useState(false);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [trailPath, setTrailPath] = useState<[number, number][] | null>(null);

  // API state for detail view
  const [apiLoading, setApiLoading] = useState(false);
  const [snlData, setSnlData] = useState<SNLData | null>(null);
  const [lokalData, setLokalData] = useState<LokalhistorieData | null>(null);
  const [dimuData, setDimuData] = useState<MuseumPhoto[]>([]);

  const mapRef = useRef<L.Map | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  // Derive category list from actual POI data
  const allCats = useMemo(
    () => Array.from(new Set(ALL_POIS.map(p => p.kategori))).filter(k => CAT_CFG[k]),
    []
  );

  // Filtered POIs
  const filteredPOIs = useMemo(() => {
    return ALL_POIS.filter(p => {
      if (activeCats.size > 0 && !activeCats.has(p.kategori)) return false;
      if (searchQ) {
        const q = searchQ.toLowerCase();
        if (!(p.navn + ' ' + p.beskrivelse).toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [activeCats, searchQ]);

  // Sync sheet height when view/mode changes
  useEffect(() => {
    const h = computeSheetH(view, sheetMode);
    setSheetH(h);
  }, [view, sheetMode]);

  // Apply sheet height to CSS custom property
  useEffect(() => {
    sheetRef.current?.style.setProperty('--sheet-h', `${sheetH}px`);
  }, [sheetH]);

  // Resize handler
  useEffect(() => {
    const handle = () => setSheetH(computeSheetH(view, sheetMode));
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, [view, sheetMode]);

  // Close layer popup on document click
  useEffect(() => {
    const handle = () => setShowLayerPop(false);
    document.addEventListener('click', handle);
    return () => document.removeEventListener('click', handle);
  }, []);

  // Fetch API data for selected POI
  useEffect(() => {
    if (!selectedPOI) return;
    setSnlData(null); setLokalData(null); setDimuData([]);
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
    Promise.all(tasks).then(() => { if (alive) setApiLoading(false); });
    return () => { alive = false; };
  }, [selectedPOI]);

  const onMapReady = useCallback((m: L.Map) => { mapRef.current = m; }, []);
  const onMapClick = useCallback(() => setShowLayerPop(false), []);

  // Actions
  function selectPOI(poi: POI) {
    setSelectedPOI(poi);
    setSelectedTrail(null);
    setTrailPath(null);
    setView('detail');
    setSheetMode('peek');
    mapRef.current?.flyTo(poi.coordinates, 15, { duration: 0.7 });
  }

  function selectTrail(trail: Trail) {
    setSelectedTrail(trail);
    setSelectedPOI(null);
    setView('detail');
    setSheetMode('peek');
    setTrailPath(trail.path);
    const bounds = L.latLngBounds(trail.path);
    mapRef.current?.fitBounds(bounds.pad(0.35), { paddingBottomRight: [0, 260] });
  }

  function goBack() {
    setView('browse');
    setSelectedPOI(null);
    setSelectedTrail(null);
    setTrailPath(null);
    setSheetMode('peek');
    mapRef.current?.flyTo(MAP_CENTER, MAP_ZOOM, { duration: 0.6 });
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

  function toggleCat(k: string) {
    setActiveCats(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  function toggleSaved(id: string) {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Grab drag handlers
  function onGrabPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { startY: e.clientY, startH: sheetH };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onGrabPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const h = Math.max(140, Math.min(window.innerHeight * 0.82, dragRef.current.startH + (dragRef.current.startY - e.clientY)));
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
      sheetRef.current.style.setProperty('--sheet-h', `${h}px`);
    }
    setSheetH(h);
  }
  function onGrabPointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (sheetRef.current) sheetRef.current.style.transition = '';
    setSheetMode(sheetH > window.innerHeight * 0.5 ? 'full' : 'peek');
  }
  function onGrabClick() {
    setSheetMode(prev => prev === 'full' ? 'peek' : 'full');
  }

  const railBottom = sheetH + 16;

  // Text strings
  const T = lang === 'no' ? {
    search: 'Søk på Veierland', all: 'Alle', explore: 'Utforsk Veierland',
    places: 'Steder', trails: 'Turer', back: 'Tilbake',
    directions: 'Veibeskrivelse', length: 'Lengde', duration: 'Tid', diff: 'Vanskelighet',
    layers: 'Kartlag', nohit: 'Ingen treff', easy: 'Lett', showRoute: 'Vis rute',
    np: (n: number) => `${n} ${n === 1 ? 'sted' : 'steder'}`,
    nt: (n: number) => `${n} ${n === 1 ? 'tur' : 'turer'}`,
  } : {
    search: 'Search Veierland', all: 'All', explore: 'Explore Veierland',
    places: 'Places', trails: 'Trails', back: 'Back',
    directions: 'Directions', length: 'Length', duration: 'Time', diff: 'Difficulty',
    layers: 'Map layer', nohit: 'No matches', easy: 'Easy', showRoute: 'Show route',
    np: (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`,
    nt: (n: number) => `${n} ${n === 1 ? 'trail' : 'trails'}`,
  };

  // ── Render: browse ──────────────────────────────────────────────────────────

  function renderBrowse() {
    return (
      <>
        <h2 style={{ margin: '2px 0 12px', fontSize: 21, fontWeight: 800, letterSpacing: '-.01em' }}>
          {T.explore}
        </h2>
        <div className="vl-seg">
          <button className={mode === 'places' ? 'on' : ''} onClick={() => setMode('places')}>{T.places}</button>
          <button className={mode === 'trails' ? 'on' : ''} onClick={() => setMode('trails')}>{T.trails}</button>
        </div>

        {mode === 'places' ? (
          <>
            <div className="vl-count">{filteredPOIs.length ? T.np(filteredPOIs.length) : T.nohit}</div>
            {filteredPOIs.map(poi => {
              const cat = getCat(poi.kategori);
              return (
                <div key={poi.id} className="vl-card" onClick={() => selectPOI(poi)}>
                  <div
                    className="vl-ic"
                    style={{ background: cat.color + '22', color: cat.color }}
                    dangerouslySetInnerHTML={{ __html: coloredSvg(cat.icon, cat.color) }}
                  />
                  <div className="tx">
                    <h4>{poi.navn}</h4>
                    <p>{lang === 'no' ? cat.no : cat.en}</p>
                  </div>
                  <span className="chev"><ChevSvg /></span>
                </div>
              );
            })}
          </>
        ) : (
          <>
            <div className="vl-count">{T.nt(VL_TRAILS.length)}</div>
            {VL_TRAILS.map(tr => {
              const cat = getCat('friluft');
              return (
                <div key={tr.id} className="vl-card" onClick={() => selectTrail(tr)}>
                  <div
                    className="vl-ic"
                    style={{ background: cat.color + '22', color: cat.color }}
                    dangerouslySetInnerHTML={{ __html: coloredSvg('tur', cat.color) }}
                  />
                  <div className="tx">
                    <h4>{lang === 'no' ? tr.name : tr.en}</h4>
                    <p>{tr.km} · {tr.time} · {lang === 'no' ? tr.diff : T.easy}</p>
                  </div>
                  <span className="chev"><ChevSvg /></span>
                </div>
              );
            })}
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
        <div>
          <span className="vl-catpill" style={{ background: cat.color + '22', color: cat.color }}>
            <span className="dot" style={{ background: cat.color }} />
            {lang === 'no' ? cat.no : cat.en}
          </span>
        </div>
        <div className="vl-h2">{poi.navn}</div>
        <div className="vl-hero" dangerouslySetInnerHTML={{ __html: heroArt(cat.color) }} />
        <p className="vl-desc">{poi.beskrivelse}</p>

        {poi.datering && (
          <p className="vl-extra-meta"><strong>Datering:</strong> {poi.datering}</p>
        )}
        {poi.vernestatus && (
          <p className="vl-extra-meta"><strong>Vernestatus:</strong> {poi.vernestatus}</p>
        )}

        <div className="vl-actions">
          <button
            className={`vl-btn sec${saved ? ' on' : ''}`}
            onClick={() => toggleSaved(poi.id)}
            style={{ flex: '0 0 auto' }}
          >
            <HeartSvg />
          </button>
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
        <div>
          <span className="vl-catpill" style={{ background: cat.color + '22', color: cat.color }}>
            <span className="dot" style={{ background: cat.color }} />
            {lang === 'no' ? 'Tursti' : 'Trail'}
          </span>
        </div>
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
              setSheetMode('peek');
            }}
          >
            <RouteSvg /> {T.showRoute}
          </button>
        </div>
      </>
    );
  }

  // ── POI markers (re-created when selection changes for the `.sel` class) ────

  const poiMarkers = useMemo(() => {
    return filteredPOIs.map(poi => {
      const cat = getCat(poi.kategori);
      const selected = selectedPOI?.id === poi.id && view === 'detail';
      const icon = L.divIcon({
        className: '',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        html: makeIconHtml(cat.icon, cat.color, selected),
      });
      return (
        <Marker
          key={`${poi.id}-${selected}`}
          position={poi.coordinates}
          icon={icon}
          eventHandlers={{ click: () => selectPOI(poi) }}
        />
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredPOIs, selectedPOI?.id, view]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="vl-app">
      {/* Map */}
      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
        zoomControl={false}
        attributionControl
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <MapSetup onReady={onMapReady} onMapClick={onMapClick} />
        <TileController layer={currentLayer} />
        {poiMarkers}
        {userPos && (
          <Marker position={userPos} icon={USER_ICON} interactive={false} />
        )}
        {trailPath && (
          <>
            <Polyline
              positions={trailPath}
              pathOptions={{ color: '#fff', weight: 8, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
            />
            <Polyline
              positions={trailPath}
              pathOptions={{ color: '#e08a4f', weight: 4.5, opacity: 1, dashArray: '1 10', lineCap: 'round' }}
            />
          </>
        )}
      </MapContainer>

      {/* Top overlay: search + chips */}
      <div className="vl-top">
        <div className="vl-search">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>
          </svg>
          <input
            type="text"
            placeholder={T.search}
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            autoComplete="off"
          />
          <div className="vl-lang">
            <button className={lang === 'no' ? 'on' : ''} onClick={() => setLang('no')}>NO</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
          </div>
        </div>
        <div className="vl-chips">
          <div
            className={`vl-chip all${activeCats.size === 0 ? ' on' : ''}`}
            onClick={() => setActiveCats(new Set())}
          >
            <span className="dot" />
            {T.all}
          </div>
          {allCats.map(k => {
            const cat = getCat(k);
            const on = activeCats.has(k);
            return (
              <div key={k} className={`vl-chip${on ? ' on' : ''}`} onClick={() => toggleCat(k)}>
                <span className="dot" style={{ background: on ? '#fff' : cat.color }} />
                {lang === 'no' ? cat.no : cat.en}
              </div>
            );
          })}
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
              onClick={() => { setCurrentLayer(k); setShowLayerPop(false); }}
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

      {/* Bottom sheet */}
      <div
        ref={sheetRef}
        className="vl-sheet"
        onClick={() => setShowLayerPop(false)}
      >
        <div
          className="vl-grab"
          onClick={onGrabClick}
          onPointerDown={onGrabPointerDown}
          onPointerMove={onGrabPointerMove}
          onPointerUp={onGrabPointerUp}
        >
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
