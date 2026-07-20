import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MapContainer, Marker, Polyline, GeoJSON, Circle } from 'react-leaflet';
import L from 'leaflet';
import { loadAllPOIs } from '../data/veierland';
import { loadTurkartGeoJSON, Trail, trailsFromGeoJSON } from '../lib/geodata';
import boundaryData from '../data/veierland_boundary.json';
import 'leaflet.markercluster';
import { POI, SNLData, LokalhistorieData, MuseumPhoto, WikimediaImage, WikipediaData } from '../lib/types';
import { fetchSNL, fetchLokalhistorie, fetchDigitalMuseum, fetchWikimediaImages, fetchWikipediaSpecies } from '../lib/api';
import { loadCatCfg, DEFAULT_CAT_CFG, CatCfgMap } from '../lib/catcfg';
import { loadMapAppearance, DEFAULT_MAP_APPEARANCE, MapAppearance } from '../lib/mapsettings';
import { loadMapLayerCfg, DEFAULT_MAP_LAYER_CFG, MapLayerCfgMap, buildFilterString } from '../lib/maplayersettings';
import { NATURE_GROUPS, NatureObs, GBIF_POLYGON, STATIC_NATURE_CACHE, loadNatureObs, applyAssessments, RED_LIST_CATS, ALIEN_CATS, RL_LABEL, RL_DESC } from '../lib/naturedata';
import { ARTS_KATEGORIER, ArtsKategori, CuratedArt, artsgruppeMeta } from '../lib/artscategories';
import { loadFarmData, DEFAULT_FARM_DATA, Farm } from '../lib/farmdata';
import { loadTimelineSections, DEFAULT_TIMELINE_SECTIONS, TimelineSection } from '../lib/timelinedata';
import { FLOOD_BY_THRESHOLD, nearestFloodThreshold, GARDER_TIMELINE } from '../lib/floodlevels';
import { LAYERS, LAYER_ORDER, GEO_LAYERS, GEO_DATA, geoStyle, geoOnEach } from '../lib/maplayers';
import {
  markerSize, makeIconHtml, makeLabeledIconHtml, FilterTile, FILTER_TILES, tileLabel,
  STEDSNAVN_MIN_ZOOM, makeStedsnavnHtml, iconSvg, obsRingClass, makeNatureIconHtml,
} from '../lib/mapicons';
import { pointToPolylineDistM } from '../lib/geo';
import { ICONS } from '../lib/icons';
import { MapSetup, TileController } from './MapSetup';
import { ElevationChart } from './SmallCharts';
import {
  ChevSvg, BackSvg, HeartSvg, RouteSvg, CheckSvg, UpChevSvg,
  MapTabSvg, PlacesTabSvg, TrailsTabSvg, NatureTabSvg, HistoryTabSvg, WeatherIcon,
} from './UiIcons';
import { fetchFerryDepartures, fetchQuaySailings, nearestQuay, FerryBoard, FERRY_QUAYS, fmtDepTime, minsUntil, fmtCountdown } from '../lib/ferrydata';
import {
  hasDomGrid, sunPosition, sunlitAt, shelterAt, computeContours,
  makeSunShadowOverlay, makeShelterOverlay, makeEffectiveTempOverlay, makeBestSpotsOverlay, BestSpotsInfo,
  fetchWeatherNow, fetchWeatherSeries, fetchSeaTemp, WeatherNow, WeatherPoint, windDirLabel, weatherIconKind, WeatherIconKind, weatherKindLabel,
  effectiveTemp, tempRampHex,
  rankBeaches, dailyRecommendation, BeachConditionScore,
} from '../lib/conditions';
import { networkWalkDistanceM, networkWalkRoute } from '../lib/routing';
import { loadThemeCfg, applyThemeCfg } from '../lib/themecfg';

const TRAIL_CAT_GROUPS: Record<'alle' | 'historie' | 'natur' | 'mat' | 'kultur', { no: string; en: string; cats: string[] | null }> = {
  alle:     { no: 'Alle',        en: 'All',          cats: null },
  historie: { no: 'Historie',    en: 'History',      cats: ['arkeologi', 'hvalfangst'] },
  natur:    { no: 'Natur',       en: 'Nature',       cats: null }, // uses natureObs (GBIF), not POI categories
  mat:      { no: 'Mat & Drikke',en: 'Food & Drink', cats: ['mat'] },
  kultur:   { no: 'Kultur',      en: 'Culture',      cats: ['kultur', 'info', 'ferge', 'havn'] },
};

// ≥900px uses the sidebar layout (see index.css) — no mini-card, sheet always visible
function isDesktopView(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches;
}

// Hide <img> elements whose remote source fails instead of showing a broken-image icon
function hideBrokenImg(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.display = 'none';
}

// Keyboard + screen-reader affordances for the app's clickable <div>s (filter
// chips, list rows, popover options). These stay <div>s rather than <button>s
// because each carries nested block layout and per-class styling that button
// UA defaults would fight — role="button" + tabIndex + Enter/Space gives
// assistive tech the same semantics without a restyling pass. `pressed` maps
// to aria-pressed for toggle-style controls (chips); leave it undefined for
// plain activate-once rows.
function pressable(onClick: () => void, pressed?: boolean) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-pressed': pressed,
    onClick,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    },
  };
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
  const [tab, setTab] = useState<'map' | 'places' | 'trails' | 'nature' | 'history' | 'saved' | 'settings'>('map');
  const [searchQ, setSearchQ] = useState('');
  // "Nærmest meg" sort in the Steder list — only offered while position
  // tracking is on (it needs somewhere to measure from), and falls back to
  // the grouped category view automatically if tracking stops.
  const [sortByNearest, setSortByNearest] = useState(false);
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
  const [activityTile, setActivityTile] = useState<FilterTile | null>(null);
  const [dockExpanded, setDockExpanded] = useState(false);
  // Collapsed to just the grab handle while the user pans the map — there was
  // previously no way to see the map without the dock permanently occupying
  // the bottom of the screen. Restored by tapping the handle again.
  const [dockPeeked, setDockPeeked] = useState(false);
  // Drag-to-pull-up on the dock's grab handle — mirrors the sheet's grab
  // handle gesture (see onGrabPointerDown) but snaps between the dock's
  // three discrete CSS states (peeked/default/expanded) instead of following
  // the finger continuously, since the dock's height is content-driven
  // (max-height per state) rather than an arbitrary pixel value.
  const [isDraggingDock, setIsDraggingDock] = useState(false);
  const dockDragStartRef = useRef<{ y: number; moved: boolean } | null>(null);
  // First-open-of-the-day welcome overlay (from the Claude Design prototype):
  // greets the visitor and offers the three most common "what do I do here"
  // answers up front, instead of making them discover the dock themselves.
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return localStorage.getItem('vl-welcome-seen') !== new Date().toISOString().slice(0, 10); }
    catch { return true; }
  });
  function dismissWelcome() {
    setShowWelcome(false);
    try { localStorage.setItem('vl-welcome-seen', new Date().toISOString().slice(0, 10)); } catch { /* ignore */ }
  }
  const [currentLayer, setCurrentLayer] = useState<string>(() => {
    try { return localStorage.getItem('vl-layer') || 'soleng'; } catch { return 'soleng'; }
  });
  // Admin-editable: which base map layers are offered, what they're called,
  // and a color/appearance tweak (CSS filter) per layer (see
  // lib/maplayersettings.ts) — loaded from Firestore, falls back to defaults.
  const [mapLayerCfg, setMapLayerCfg] = useState<MapLayerCfgMap>(DEFAULT_MAP_LAYER_CFG);
  const visibleLayerOrder = useMemo(
    () => LAYER_ORDER.filter(k => mapLayerCfg[k]?.enabled !== false),
    [mapLayerCfg]
  );
  // If the currently-selected layer gets disabled by admin, fall back to the
  // first still-visible one rather than leaving the map on a hidden layer.
  useEffect(() => {
    if (visibleLayerOrder.length > 0 && !visibleLayerOrder.includes(currentLayer as typeof LAYER_ORDER[number])) {
      setCurrentLayer(visibleLayerOrder[0]);
    }
  }, [visibleLayerOrder, currentLayer]);
  const [geoLayer, setGeoLayer] = useState<string | null>(null);
  const [showLayerPop, setShowLayerPop] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [userAccuracy, setUserAccuracy] = useState<number>(0);
  const [locating, setLocating] = useState(false);
  const [offIsland, setOffIsland] = useState(false);
  const [nearbyPoi, setNearbyPoi] = useState<POI | null>(null);
  // User-visible explanation when locating fails — without it the Posisjon
  // button just silently does nothing on denied permission / GPS failure.
  const [locateError, setLocateError] = useState<string | null>(null);
  const locateErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Curated categories (replacing the old auto-generated highlights/most-observed
  // split) — people pick one of these hand-written categories, not a taxon filter.
  const [artsKategoriId, setArtsKategoriId] = useState<string>(ARTS_KATEGORIER[0]?.id ?? '');
  const [natureListN, setNatureListN] = useState(20);
  // Free-text species search across BOTH the curated lists and the full live
  // GBIF-backed observation set — the curated categories are a shop window,
  // but people who look for a specific species shouldn't be limited to it.
  const [natureSearchQ, setNatureSearchQ] = useState('');
  const selectedKategori: ArtsKategori | undefined =
    ARTS_KATEGORIER.find(k => k.id === artsKategoriId) ?? ARTS_KATEGORIER[0];
  // Curated species are matched against the live GBIF-backed observations by
  // scientific name, so a curated row can open the same rich detail (photo,
  // live count, map occurrences) as before when we actually have a hit.
  const obsByName = useMemo(() => {
    const m = new Map<string, NatureObs>();
    for (const o of natureObs) m.set(o.scientificName.toLowerCase().trim(), o);
    return m;
  }, [natureObs]);
  // The map mirrors exactly what the list shows — only curated species with a
  // live match have coordinates to plot.
  const natureVisible = useMemo(() => {
    if (!selectedKategori) return [];
    const seen = new Set<number>();
    const out: NatureObs[] = [];
    for (const art of selectedKategori.arter) {
      const obs = obsByName.get(art.vitenskapelig.toLowerCase().trim());
      if (obs && !seen.has(obs.gbifKey)) { seen.add(obs.gbifKey); out.push(obs); }
    }
    return out;
  }, [selectedKategori, obsByName]);
  const [selectedNatureObs, setSelectedNatureObs] = useState<NatureObs[]>([]);
  const [selectedNature, setSelectedNature] = useState<NatureObs | null>(null);
  // Set when a curated species has no live GBIF match — a lighter detail view
  // (no photo/map/live count) built from the curated JSON alone.
  const [selectedCuratedArt, setSelectedCuratedArt] = useState<CuratedArt | null>(null);
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

  // Conditions overlays (needs the DOM grid) and current weather + sea
  // temperature from MET (for the beach card). Tapping Forhold goes straight
  // to the combined "Beste steder" view; the three expert layers (sun, wind,
  // feels-like) are reached via the 4-icon tab row in the legend card —
  // matches the Claude Design prototype's condCard (Best/Vind/Sol/Felt).
  const COND_VIEWS = ['best', 'sun', 'wind', 'effectiveTemp'] as const;
  const [condLayer, setCondLayer] = useState<'best' | 'sun' | 'wind' | 'effectiveTemp' | null>(null);
  const [weatherNow, setWeatherNow] = useState<WeatherNow | null>(null);
  const [seaTemp, setSeaTemp] = useState<number | null>(null);
  const [tempRange, setTempRange] = useState<[number, number] | null>(null);
  const [bestInfo, setBestInfo] = useState<BestSpotsInfo | null>(null);
  const condOverlayRef = useRef<L.ImageOverlay | null>(null);
  // Value badges (star/lee/temp) drawn on the spots while a Forhold layer is
  // active — see the overlay effect below.
  const condBadgesRef = useRef<L.LayerGroup | null>(null);
  // Forhold ("conditions") can be scrubbed forward through the next ~24h so
  // people can plan ahead, not just see the current moment. condHourOffset is
  // an index into weatherSeries (0 = now); it's shared across all the
  // condLayer views so switching between them keeps the same planning hour.
  const [weatherSeries, setWeatherSeries] = useState<WeatherPoint[] | null>(null);
  const [condHourOffset, setCondHourOffset] = useState(0);
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

  // Map appearance (height contours, admin-editable) — loaded from Firestore,
  // falls back to defaults. Contours are recomputed from the same DTM ground
  // channel the sun/shelter/sea-level features already use (see
  // computeContours in conditions.ts) — no separate data source needed.
  const [mapAppearance, setMapAppearance] = useState<MapAppearance>(DEFAULT_MAP_APPEARANCE);
  const contourSet = useMemo(() => {
    if (!hasDomGrid) return null;
    const raw = computeContours(mapAppearance.contourIntervalM);
    if (!raw) return null;
    // The DTM/DOM grid is a rectangular crop around Veierland, so it can
    // include slivers of neighbouring skerries/mainland at the edges — the
    // same reason sun/shadow only tints isWaterCell()-passing cells, not an
    // exact coastline. Contour lines need the tighter, real boundary
    // (pointInPolygon, also used for the off-island toast) since a stray
    // line on someone else's island reads as a mapping error, not "coarse
    // terrain data".
    const segments = raw.segments.filter(([a, b]) => {
      const midLat = (a[0] + b[0]) / 2, midLng = (a[1] + b[1]) / 2;
      return pointInPolygon(midLat, midLng);
    });
    return { ...raw, segments };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapAppearance.contourIntervalM]);

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

  // First real POI photo (prefers a beach, for a welcoming shot) — the
  // welcome hero uses actual island photography, not a placeholder image.
  const welcomeHeroPhoto = useMemo(() => {
    const withPhoto = allPOIs.filter(p => !!p.bilde);
    const beach = withPhoto.find(p => (p.kategorier ?? [p.kategori]).includes('bad'));
    return (beach ?? withPhoto[0])?.bilde ?? null;
  }, [allPOIs]);

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

  // Fetch Wikipedia when a nature obs or a (unmatched) curated species is selected
  useEffect(() => {
    const sci = selectedNature?.scientificName ?? selectedCuratedArt?.vitenskapelig;
    const pop = selectedNature?.popularName ?? selectedCuratedArt?.norsk ?? '';
    if (!sci) { setSpeciesWiki(null); return; }
    let alive = true;
    setSpeciesWiki(null);
    setSpeciesWikiLoading(true);
    fetchWikipediaSpecies(sci, pop, lang)
      .then(r => { if (alive) { setSpeciesWiki(r); setSpeciesWikiLoading(false); } })
      .catch(() => { if (alive) setSpeciesWikiLoading(false); });
    return () => { alive = false; };
  }, [selectedNature, selectedCuratedArt, lang]);

  // Close layer popup on document click
  useEffect(() => {
    const handle = () => { setShowLayerPop(false); setShowFerryPop(false); setShowMenu(false); };
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
  // Activity-mode pins (the big always-labeled ones) bypass clustering
  // entirely — see the marker-building effect below for why.
  const activityLayerRef = useRef<L.LayerGroup | null>(null);
  // Regular (zoom-scaled) pins from the last marker build, so the zoom
  // restyle effect can resize them in place instead of rebuilding the whole
  // cluster group on every zoom step. Stedsnavn labels and activity pins
  // have fixed sizes and are deliberately not tracked here.
  const pinMarkersRef = useRef<{ marker: L.Marker; cat: { icon: string; color: string }; sel: boolean; faded: boolean; historic: boolean }[]>([]);

  // Fresh activation of Forhold always starts at "now", not wherever the
  // user last scrubbed to.
  useEffect(() => { if (condLayer === null) setCondHourOffset(0); }, [condLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;
    const clear = () => {
      if (condOverlayRef.current) { map.removeLayer(condOverlayRef.current); condOverlayRef.current = null; }
      if (condBadgesRef.current) { map.removeLayer(condBadgesRef.current); condBadgesRef.current = null; }
    };
    clear();
    if (!condLayer || !hasDomGrid) return;
    (async () => {
      const series = weatherSeries ?? await fetchWeatherSeries();
      if (cancelled) return;
      if (series && !weatherSeries) setWeatherSeries(series);
      const point = series?.[Math.min(condHourOffset, series.length - 1)] ?? null;
      const date = point ? new Date(point.time) : new Date();

      let img: { dataUrl: string; bounds: [[number, number], [number, number]]; tempRange?: [number, number]; best?: BestSpotsInfo } | null = null;
      if (condLayer === 'best') {
        if (point) img = makeBestSpotsOverlay(point, date);
      } else if (condLayer === 'sun') {
        img = makeSunShadowOverlay(date);
      } else if (condLayer === 'wind') {
        if (point) img = makeShelterOverlay(point.windFromDeg, point.windSpeed);
      } else if (condLayer === 'effectiveTemp') {
        if (point) img = makeEffectiveTempOverlay(point.airTemp, point.windSpeed, point.windFromDeg, point.humidity);
      }
      if (cancelled) return;
      if (!img) {
        // Sun layer with the sun below the horizon: nothing to draw, but the
        // layer must stay active — the legend explains why the map is bare,
        // and the hour chips let the user scrub to a daylight hour (the whole
        // point of planning ahead). Deactivating here would make "Sol og
        // skygge" appear dead every evening.
        if (condLayer === 'sun') { setTempRange(null); return; }
        setCondLayer(null);
        return;
      }
      setTempRange(img.tempRange ?? null);
      setBestInfo(img.best ?? null);
      clear();
      condOverlayRef.current = L.imageOverlay(img.dataUrl, img.bounds, { opacity: 0.8, interactive: false }).addTo(map);

      // Tappable value badges on the real spots (design canvas: "1a's warmth
      // with 1c's badges") — exact numbers live ON the map, on the beaches,
      // not only in the legend. Clicking one opens that place.
      if (point) {
        const beaches = allPOIs.filter(p => (p.kategorier ?? [p.kategori]).includes('bad'));
        const group = L.layerGroup();
        const addBadge = (poi: POI, html: string, size: [number, number]) => {
          const m = L.marker(poi.coordinates as [number, number], {
            icon: L.divIcon({ className: '', iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2], html }),
            zIndexOffset: 1200,
          });
          m.on('click', () => showOnMap(poi));
          group.addLayer(m);
        };
        if (condLayer === 'best') {
          // Size + tone = how recommended (design 2a): biggest/darkest badge
          // is the top spot right now.
          const ranked = rankBeaches(beaches, point.windFromDeg, date).slice(0, 4);
          ranked.forEach((r, i) => {
            const sz = i === 0 ? 40 : i === 1 ? 32 : 28;
            const bg = i === 0 ? '#56633f' : '#728157';
            addBadge(r.poi as POI,
              `<div class="vl-cond-badge" style="width:${sz}px;height:${sz}px;background:${bg}">
                 <svg viewBox="0 0 24 24" style="width:${Math.round(sz * 0.45)}px;height:${Math.round(sz * 0.45)}px" fill="none" stroke="#fff" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.4l-5.4 3 1-6.1-4.4-4.3 6.1-.9L12 2.5z"/></svg>
               </div>`, [sz, sz]);
          });
        } else if (condLayer === 'wind') {
          // Design 2c: lee spots get a sage pill with a check, exposed spots
          // a cream pill — local wind strength in m/s on each.
          for (const poi of beaches) {
            const shelter = shelterAt(poi.coordinates[0], poi.coordinates[1], point.windFromDeg);
            if (shelter === null) continue;
            const local = Math.max(0, Math.round(point.windSpeed * (1 - shelter)));
            const lee = shelter > 0.55;
            const label = lee
              ? `<svg viewBox="0 0 24 24" style="width:12px;height:12px" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>${lang === 'no' ? 'Le' : 'Lee'} · ${local} m/s`
              : `${lang === 'no' ? 'Åpent' : 'Open'} · ${local} m/s`;
            addBadge(poi, `<div class="vl-cond-pill${lee ? ' lee' : ''}">${label}</div>`, [86, 26]);
          }
        } else if (condLayer === 'effectiveTemp') {
          // Design 2d/1c: exact feels-like values in tappable badges on the
          // actual spots.
          for (const poi of beaches) {
            const shelter = shelterAt(poi.coordinates[0], poi.coordinates[1], point.windFromDeg) ?? 0;
            const t = Math.round(effectiveTemp(point.airTemp, point.windSpeed * (1 - shelter), point.humidity));
            addBadge(poi, `<div class="vl-cond-badge temp">${t}°</div>`, [34, 34]);
          }
        }
        if (group.getLayers().length > 0) {
          condBadgesRef.current = group.addTo(map);
        }
      }
    })();
    return () => { cancelled = true; clear(); };
  // weatherSeries is read once at activation; re-running on its change would flicker
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condLayer, mapReady, condHourOffset, allPOIs, lang]);

  // Load POIs and trails from Firestore (or local JSON fallback)
  useEffect(() => {
    loadAllPOIs().then(setAllPOIs);
    loadTurkartGeoJSON().then(geo => setTrails(trailsFromGeoJSON(geo)));
    loadCatCfg().then(setCatCfg);
    loadThemeCfg().then(applyThemeCfg);
    loadMapAppearance().then(setMapAppearance);
    loadMapLayerCfg().then(setMapLayerCfg);
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
    dismissWelcome();
    setShowLayerPop(false);
    setShowFerryPop(false);
    if (selectedNature || selectedCuratedArt) { setSelectedNature(null); setSelectedNatureObs([]); setSelectedCuratedArt(null); }
    // Tapping empty map while a mini-card is showing dismisses it
    if (tab === 'map' && !sheetOpen && (selectedPOI || selectedTrail)) {
      setSelectedPOI(null);
      setSelectedTrail(null);
      setTrailPath(null);
    }
  }, [selectedNature, selectedCuratedArt, tab, sheetOpen, selectedPOI, selectedTrail]);
  const onZoom = useCallback((z: number) => setMapZoom(z), []);
  // Panning the map means the user wants to see it, not the dock — collapse
  // to just the grab handle so there's a real "map only" state, restored by
  // tapping the handle again (see dockPeeked).
  const onMapDragStart = useCallback(() => {
    dismissWelcome();
    setDockExpanded(false);
    setDockPeeked(true);
  }, []);

  // Whether place-name annotations render at all flips only when the zoom
  // crosses STEDSNAVN_MIN_ZOOM — depending on this boolean instead of the raw
  // zoom level keeps the expensive marker rebuild below from running on every
  // single zoom step (the zoom-restyle effect further down handles pin sizing).
  const stedsnavnVisible = mapZoom >= STEDSNAVN_MIN_ZOOM;

  // Cluster group — rebuild whenever filtered POIs or selection change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Remove existing groups
    if (clusterRef.current) { map.removeLayer(clusterRef.current); clusterRef.current = null; }
    if (activityLayerRef.current) { map.removeLayer(activityLayerRef.current); activityLayerRef.current = null; }
    pinMarkersRef.current = [];
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

    // Read zoom straight off the map: this effect no longer re-runs per zoom
    // step (see stedsnavnVisible above), and the restyle effect below keeps
    // pin sizes current as the user zooms.
    const sz = markerSize(map.getZoom());
    const dimByTrail = mode === 'trails' && view === 'detail' && !!selectedTrail && trailPoiFilter === 'along';

    // Activity-mode labels are always-on (see makeLabeledIconHtml above), so
    // two spots that sit close together geographically can have overlapping
    // name labels even though their pins don't touch. Do a cheap pairwise
    // pass first — in practice this is a handful of markers (one activity
    // category), so O(n²) is fine — and flip a colliding label to sit above
    // its pin instead of below, which resolves the common two-neighbour case.
    const labelAboveIds = new Set<string>();
    if (activityTile) {
      const placed: { x: number; y: number; halfW: number }[] = [];
      for (const poi of filteredPOIs) {
        if (poi.kategori === 'stedsnavn' || !poi.coordinates) continue;
        const pt = map.latLngToContainerPoint(poi.coordinates as [number, number]);
        const halfW = (tileLabel(poi.navn, activityTile).length * 3.4 + 12);
        const collides = placed.some(p => Math.abs(p.x - pt.x) < p.halfW + halfW && Math.abs(p.y - pt.y) < 34);
        if (collides) labelAboveIds.add(poi.id);
        placed.push({ x: pt.x, y: pt.y, halfW });
      }
    }

    // Per the Claude Design prototype: an active dock filter (Bade/Spise/…)
    // dims non-matching pins to 28% instead of removing them, so the map
    // keeps spatial context of everything else. filteredPOIs already IS the
    // matching set, so rendering allPOIs here and checking membership is
    // enough — no separate query needed.
    const activityMatches = activityTile ? new Set(filteredPOIs.map(p => p.id)) : null;
    const activityPOIs = activityTile ? allPOIs : filteredPOIs;
    // Matching activity pins (the big always-labeled ones) go on a plain,
    // unclustered layer — clustering would merge nearby matches into a
    // number bubble at low zoom, hiding exactly the pins the user just
    // asked to see (e.g. "Bade" from the welcome screen with several
    // beaches close together). Non-matching background pins still cluster
    // normally since they're just dimmed context, not the point of the view.
    const directLayer = activityTile ? L.layerGroup() : null;

    activityPOIs.forEach(poi => {
      const cat = getCat(poi.kategori);
      const sel = selectedPOI?.id === poi.id;

      // Place names (stedsnavn) are map annotations, not real POIs — they'd
      // clutter the overview at full-island zoom, so they only render once
      // the user has zoomed in enough for individual names to be useful
      // (unless a search is actively matching one, which is explicit intent).
      if (poi.kategori === 'stedsnavn' && !stedsnavnVisible && !searchQ) return;

      const matchesActivity = !activityMatches || activityMatches.has(poi.id);
      const faded = (dimByTrail && !!poi.coordinates &&
        pointToPolylineDistM(poi.coordinates as [number, number], selectedTrail!.path) > 20)
        || (!!activityTile && !matchesActivity);
      // Heritage categories get a rounded-square pin (see .vl-pin.hist) —
      // shape distinction, driven by the admin-editable showInHistory flag.
      const historic = !!catCfg[poi.kategori]?.showInHistory;
      let html: string, pinSz: number;
      if (poi.kategori === 'stedsnavn') {
        // Lightweight text-only label — no icon circle, so it reads as a
        // map annotation rather than a tappable place, and doesn't compete
        // visually with real POI pins even when both are visible.
        html = makeStedsnavnHtml(poi.navn, sel);
        pinSz = 22;
      } else if (activityTile && matchesActivity) {
        // Activity-mode map view: bigger pins with the name always visible —
        // tapping to find out what something is isn't realistic for young
        // or elderly users on a crowded island map.
        pinSz = sel ? 50 : 44;
        html = makeLabeledIconHtml(cat.icon, cat.color, sel, pinSz, tileLabel(poi.navn, activityTile), labelAboveIds.has(poi.id), historic);
      } else {
        pinSz = sz;
        html = faded
          ? `<div style="opacity:0.28">${makeIconHtml(cat.icon, cat.color, sel, sz, historic)}</div>`
          : makeIconHtml(cat.icon, cat.color, sel, sz, historic);
      }
      const half = Math.round(pinSz / 2);
      const icon = L.divIcon({ className: '', iconSize: [pinSz, pinSz], iconAnchor: [half, half], html });
      const marker = L.marker(poi.coordinates as [number, number], { icon, zIndexOffset: sel ? 1000 : 0 }).on('click', () => selectPOI(poi));
      marker.addTo(activityTile && matchesActivity ? directLayer! : cg);
      // Only regular pins scale with zoom — track them for the restyle effect.
      if (poi.kategori !== 'stedsnavn' && !(activityTile && matchesActivity)) {
        pinMarkersRef.current.push({ marker, cat: { icon: cat.icon, color: cat.color }, sel, faded, historic });
      }
    });

    map.addLayer(cg);
    clusterRef.current = cg;
    if (directLayer) { map.addLayer(directLayer); activityLayerRef.current = directLayer; }

    return () => {
      if (!map) return;
      map.removeLayer(cg);
      if (directLayer) map.removeLayer(directLayer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, mode, filteredPOIs, allPOIs, selectedPOI?.id, view, stedsnavnVisible, selectedTrail, trailPoiFilter, tab, activityTile, searchQ]);

  // Zoom restyle — swap the regular pins' icons to the new zoom-appropriate
  // size in place. Before this split, the whole cluster group (up to ~100
  // markers incl. 66 stedsnavn labels) was torn down and recreated on every
  // zoom step; now a pinch-zoom only re-renders icon HTML for the visible
  // pins. Activity pins (fixed 44/50px) and stedsnavn labels (fixed 22px)
  // don't scale, so they're untouched. Their label-above collision layout is
  // computed at build zoom and deliberately not recomputed here — a slightly
  // stale label side after zooming is invisible next to the rebuild cost.
  useEffect(() => {
    const sz = markerSize(mapZoom);
    const half = Math.round(sz / 2);
    for (const { marker, cat, sel, faded, historic } of pinMarkersRef.current) {
      const html = faded
        ? `<div style="opacity:0.28">${makeIconHtml(cat.icon, cat.color, sel, sz, historic)}</div>`
        : makeIconHtml(cat.icon, cat.color, sel, sz, historic);
      marker.setIcon(L.divIcon({ className: '', iconSize: [sz, sz], iconAnchor: [half, half], html }));
    }
  }, [mapZoom]);

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

  // Entry point from the curated category list: link the curated species up
  // against whatever live GBIF-backed observation we have for it (matched by
  // scientific name, see obsByName) — a hit reuses the existing rich detail
  // flow unchanged; no hit falls back to a lighter, curated-only detail view.
  function openArt(art: CuratedArt) {
    setSelectedCuratedArt(art);
    const obs = obsByName.get(art.vitenskapelig.toLowerCase().trim());
    if (obs) {
      selectNatureSpecies(obs);
    } else {
      setSelectedNature(null);
      setSelectedNatureObs([]);
      setSheetOpen(true);
    }
  }

  async function selectNatureSpecies(obs: NatureObs) {
    setSelectedNature(obs);
    setSelectedNatureObs([obs]);
    setSheetOpen(true);
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
  }

  // Actions
  function selectPOI(poi: POI) {
    dismissWelcome();
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

  function selectTab(t: 'map' | 'places' | 'trails' | 'nature' | 'history' | 'saved' | 'settings') {
    dismissWelcome();
    // Settings has no map mode/layer of its own — it's a plain static screen,
    // so it skips all the map-mode bookkeeping below rather than forcing a
    // fake "mode" for it.
    if (t === 'settings') {
      setShowLayerPop(false);
      setSelectedPOI(null);
      setSelectedTrail(null);
      setView('browse');
      setTab(t);
      setDockPeeked(false);
      setSheetOpen(true);
      return;
    }
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
    setSelectedCuratedArt(null);
    setTrailPath(null);
    setView('browse');
    setTab(t);
    setDockPeeked(false);
    // Leaving via a tab clears any active dock filter tile so it doesn't
    // linger over the map when you come back to Kart. (Only fires for dock
    // filters — the Steder category chips run with activityTile === null.)
    if (activityTile) { setActivityTile(null); setActiveCats(new Set()); }
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
    if (t === 'nature') { setArtsKategoriId(ARTS_KATEGORIER[0]?.id ?? ''); setNatureListN(20); setNatureSearchQ(''); }
    setSheetOpen(t !== 'map');
  }

  // The dock's activity tiles are the entry points for "what do you want
  // today" on the map screen. Filter tiles (see FILTER_TILES) narrow the map
  // to a set of POI categories and swap the dock to a compact summary +
  // expandable list. Route tiles (Gå tur/Historie/Dyreliv) jump straight to
  // the existing, richer Turer/Historie/Natur tabs instead of a lesser
  // filtered view — those features are already built and better than anything
  // a quick filter could offer, so this reuses them wholesale.
  function applyActivityTile(tile: FilterTile | 'gatur' | 'historie' | 'natur') {
    dismissWelcome();
    if (tile === 'gatur') { selectTab('trails'); return; }
    if (tile === 'historie') { selectTab('history'); return; }
    if (tile === 'natur') { selectTab('nature'); return; }
    setActivityTile(tile);
    setDockExpanded(false);
    setDockPeeked(false);
    setActiveCats(new Set(FILTER_TILES[tile].cats));
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
    setDockPeeked(false);
    setActiveCats(new Set());
  }

  function closeSheet() {
    setSheetOpen(false);
    setView('browse');
    setSelectedPOI(null);
    setSelectedTrail(null);
    setSelectedNature(null);
    setSelectedNatureObs([]);
    setSelectedCuratedArt(null);
    setTrailPath(null);
    setTab('map');
    setDockPeeked(false);
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

  // Names the "Best spots" overlay's winning cell for the legend's word
  // conclusion ("Best nå: Kongshavn") — nearest named point (POI or place
  // name) within a generous radius, since the winning cell is often just a
  // patch of terrain rather than an actual POI.
  function nearestPlaceName(lat: number, lng: number, maxM = 600): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const poi of allPOIs) {
      if (!poi.coordinates) continue;
      const d = distanceM(lat, lng, poi.coordinates[0], poi.coordinates[1]);
      if (d < bestD) { bestD = d; best = poi.navn; }
    }
    return bestD <= maxM ? best : null;
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

  // Draw the walking route to whichever POI is currently selected — both in
  // the full detail view and in the map's mini-card state (a place tapped
  // straight on the map), from the user's live position when tracking or
  // from Vestgården quay otherwise — recomputed whenever either changes, so
  // it follows along as you walk.
  useEffect(() => {
    const wantRoute = !!selectedPOI && (view === 'detail' || (tab === 'map' && !sheetOpen));
    if (!wantRoute) { setWalkRoutePath(null); return; }
    const from = userPos ?? [WALK_BASIS_QUAY.lat, WALK_BASIS_QUAY.lng];
    const route = networkWalkRoute(from, selectedPOI!.coordinates);
    setWalkRoutePath(route?.path ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPOI, view, tab, sheetOpen, userPos]);

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
      // Tell the user WHY nothing happened — a silently dead button reads as
      // a broken app. One toast at a time; auto-dismissed below.
      const msg = err.code === err.PERMISSION_DENIED
        ? (lang === 'no'
            ? 'Fikk ikke tilgang til posisjonen din — sjekk stedstilgang i innstillingene.'
            : 'Location access was denied — check location permissions in settings.')
        : (lang === 'no'
            ? 'Fant ikke posisjonen din — prøv igjen om litt.'
            : 'Couldn’t find your position — try again in a moment.');
      setLocateError(cur => cur ?? msg);
      if (locateErrorTimer.current) clearTimeout(locateErrorTimer.current);
      locateErrorTimer.current = setTimeout(() => setLocateError(null), 5000);
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

  // Full-screen browse pages (Steder/Turer/Natur/Historie/Lagret), per the
  // Claude Design prototype's tab views — a back-arrow + serif-title page
  // instead of a partial sheet. POI/trail detail (and a selected nature
  // species) stay a partial, draggable sheet, matching the same prototype's
  // POI detail card and this app's own peek/drag feature.
  const isFullScreenBrowse = tab !== 'map' && view === 'browse' && !selectedNature && !selectedCuratedArt && !isDesktopView();

  // Browse lists are capped lower than detail so the map always stays in view
  // (interactions like the sea-level slider have a visible effect). Natur is
  // capped lower still — its content is about the map.
  const SHEET_MAX_H = isFullScreenBrowse ? window.innerHeight : Math.min(window.innerHeight * (
    view === 'detail' || selectedNature || selectedCuratedArt ? 0.82 : tab === 'nature' ? 0.45 : 0.62
  ), 720);
  const TAB_BAR_H = 62; // floor for the rail's resting offset (the mobile tab bar itself is gone)
  const MINI_CARD_H = 68;
  const SHEET_PEEK_H = 110; // grab handle + a sliver of the header, map stays mostly visible

  // After content renders, shrink sheet to fit actual content (avoids excess
  // white space) — skipped for full-screen browse pages, which always want
  // the full height regardless of how little content they hold.
  useEffect(() => {
    if (!sheetOpen || isFullScreenBrowse) { setAutoSheetH(null); return; }
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
  }, [sheetOpen, view, selectedPOI, selectedTrail, selectedNature, selectedCuratedArt, selectedEra, selectedFarm, historyView, tab, isFullScreenBrowse]);

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

  function onDockGrabPointerDown(e: React.PointerEvent) {
    dockDragStartRef.current = { y: e.clientY, moved: false };
    setIsDraggingDock(true);
  }
  useEffect(() => {
    if (!isDraggingDock) return;
    const PULL = 24; // px of vertical movement before a drag counts as a pull, not a tap
    const handleMove = (e: PointerEvent) => {
      const start = dockDragStartRef.current;
      if (start && Math.abs(e.clientY - start.y) > 4) start.moved = true;
    };
    const handleUp = (e: PointerEvent) => {
      const start = dockDragStartRef.current;
      dockDragStartRef.current = null;
      setIsDraggingDock(false);
      if (!start) return;
      if (!start.moved) {
        // Plain tap: same behaviour as before this gesture existed.
        if (dockPeeked) setDockPeeked(false);
        else setDockExpanded(v => !v);
        return;
      }
      const dy = e.clientY - start.y;
      if (dy < -PULL) { setDockPeeked(false); setDockExpanded(true); }
      else if (dy > PULL) {
        if (dockExpanded) setDockExpanded(false);
        else setDockPeeked(true);
      }
    };
    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleUp);
    };
  }, [isDraggingDock, dockExpanded, dockPeeked]);
  // Kart tab, nothing open: a selected POI shows as a compact mini-card above the tab bar
  // instead of pushing the full sheet up over the map.
  const showMiniCard = tab === 'map' && !sheetOpen && view === 'browse' && !!(selectedPOI || selectedTrail);
  // Offsets are measured within .vl-map-area, which already ends at the tab bar
  const rawRailBottom = sheetOpen
    ? sheetCurrentH + 16
    : showMiniCard
      ? MINI_CARD_H + 28
      // Resting state (dock closed, nothing selected): sit well above the
      // dock instead of hugging it, so the cluster reads as map controls
      // rather than part of the dock.
      : Math.max(TAB_BAR_H + 14, window.innerHeight * 0.32);
  // A tall open sheet (e.g. Historie) pushes the rail's "bottom" offset up so
  // far that the 3-button cluster's top edge climbs above the glass top bar
  // and overlaps it. Cap how high the rail can go so its top edge always
  // stays clear of the top bar, regardless of how tall the sheet gets.
  const RAIL_HEIGHT_ESTIMATE = 200; // 3 buttons + gaps, generous
  const TOPBAR_CLEARANCE = 130;     // top bar's usual bottom edge + a margin
  const railBottom = Math.min(
    rawRailBottom,
    Math.max(TAB_BAR_H + 14, window.innerHeight - TOPBAR_CLEARANCE - RAIL_HEIGHT_ESTIMATE)
  );

  // Text strings
  const T = lang === 'no' ? {
    search: 'Søk på Veierland', all: 'Alle', explore: 'Utforsk Veierland',
    map: 'Kart', saved: 'Lagret', settings: 'Innstillinger',
    places: 'Steder', trails: 'Turer', nature: 'Natur', history: 'Historie', back: 'Tilbake',
    directions: 'Veibeskrivelse', length: 'Lengde', duration: 'Tid', diff: 'Vanskelighet', climb: 'Stigning',
    layers: 'Kartlag', nohit: 'Ingen treff', easy: 'Lett', showRoute: 'Vis rute dit',
    np: (n: number) => `${n} ${n === 1 ? 'sted' : 'steder'}`,
    nt: (n: number) => `${n} ${n === 1 ? 'tur' : 'turer'}`,
    tidslinje: 'Tidslinje', garder: 'Gårder',
    kontekst: 'Norsk kontekst', anekdoter: 'Historier',
  } : {
    search: 'Search Veierland', all: 'All', explore: 'Explore Veierland',
    map: 'Map', saved: 'Saved', settings: 'Settings',
    places: 'Places', trails: 'Trails', nature: 'Nature', history: 'History', back: 'Back',
    directions: 'Directions', length: 'Length', duration: 'Time', diff: 'Difficulty', climb: 'Climb',
    layers: 'Map layer', nohit: 'No matches', easy: 'Easy', showRoute: 'Show route',
    np: (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`,
    nt: (n: number) => `${n} ${n === 1 ? 'trail' : 'trails'}`,
    tidslinje: 'Timeline', garder: 'Farms',
    kontekst: 'Norwegian context', anekdoter: 'Stories',
  };

  // ── Render: nature ──────────────────────────────────────────────────────────

  function renderNature() {
    // Rich detail: a curated species matched to a live GBIF-backed observation.
    if (selectedNature) {
      const cfg = NATURE_GROUPS[selectedNature.group];
      const dateStr = selectedNature.date.slice(0, 10).replace(/-/g, '.');
      return (
        <>
          <button className="vl-back" onClick={() => { setSelectedNature(null); setSelectedNatureObs([]); setSelectedCuratedArt(null); }}><BackSvg />{T.back}</button>
          <div><span className="vl-catpill">{lang === 'no' ? cfg.no : cfg.en}</span></div>
          <div className="vl-h2">{selectedNature.popularName || selectedNature.scientificName}</div>
          {selectedNature.popularName && (
            <div className="vl-sub" style={{ marginBottom: 14 }}><em>{selectedNature.scientificName}</em></div>
          )}
          {selectedCuratedArt?.note && (
            <p className="vl-nat-curated-note">{selectedCuratedArt.note}</p>
          )}
          {selectedCuratedArt?.beskrivelse && (
            <p className="vl-nat-curated-body">{selectedCuratedArt.beskrivelse}</p>
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
              <img src={selectedNature.photoUrl} alt={selectedNature.popularName || selectedNature.scientificName} className="vl-api-img" loading="lazy" decoding="async" onError={hideBrokenImg} />
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
                <img src={speciesWiki.imageUrl} alt={speciesWiki.title} className="vl-api-img" loading="lazy" decoding="async" onError={hideBrokenImg} />
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

    // Lighter detail: a curated species with no live GBIF match yet — static
    // curated data only (no photo, no map occurrences, no live count).
    if (selectedCuratedArt) {
      const art = selectedCuratedArt;
      const meta = artsgruppeMeta(art.gruppe);
      const isRedList = RED_LIST_CATS.test(art.kategori);
      const isAlien = ALIEN_CATS.test(art.kategori);
      return (
        <>
          <button className="vl-back" onClick={() => setSelectedCuratedArt(null)}><BackSvg />{T.back}</button>
          <div><span className="vl-catpill" style={{ background: `${meta.color}1a`, color: meta.color }}>{art.gruppe}</span></div>
          <div className="vl-h2">{art.norsk || art.vitenskapelig}</div>
          {art.norsk && <div className="vl-sub" style={{ marginBottom: 14 }}><em>{art.vitenskapelig}</em></div>}
          <p className="vl-nat-curated-note">{art.note}</p>
          {art.beskrivelse && <p className="vl-nat-curated-body">{art.beskrivelse}</p>}
          <div className="vl-trailmeta">
            <div className="vl-tm">
              <div className="k">{lang === 'no' ? 'Funn (kuratert)' : 'Records (curated)'}</div>
              <div className="v">{art.antallFunn}</div>
            </div>
            <div className="vl-tm">
              <div className="k">{lang === 'no' ? 'Årsspenn' : 'Year range'}</div>
              <div className="v" style={{ fontSize: 14 }}>{art.aarSpenn}</div>
            </div>
          </div>

          {isRedList && (
            <div className="vl-assess-box vl-rl-box">
              <div><span className="vl-rlbadge">{art.kategori}</span> <strong>{RL_LABEL[art.kategori]}</strong></div>
              <p>{RL_DESC[art.kategori]}</p>
              <a href="https://artsdatabanken.no/rodliste" target="_blank" rel="noreferrer">Norsk rødliste ↗</a>
            </div>
          )}
          {isAlien && (
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
              {speciesWiki.imageUrl && (
                <img src={speciesWiki.imageUrl} alt={speciesWiki.title} className="vl-api-img" loading="lazy" decoding="async" onError={hideBrokenImg} />
              )}
              <p className="vl-api-text">{speciesWiki.extract}</p>
              <a href={speciesWiki.pageUrl} target="_blank" rel="noreferrer" className="vl-api-link">
                {lang === 'no' ? 'Les mer på Wikipedia ↗' : 'Read more on Wikipedia ↗'}
              </a>
            </div>
          )}

          <a
            href={`https://www.gbif.org/species/search?q=${encodeURIComponent(art.vitenskapelig)}`}
            target="_blank" rel="noreferrer" className="vl-btn pri"
            style={{ textDecoration: 'none', marginBottom: 10 }}
          >
            {lang === 'no' ? 'Søk art på GBIF ↗' : 'Search species on GBIF ↗'}
          </a>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
            {lang === 'no' ? 'Kilde: kuratert utvalg · Wikipedia (CC BY-SA)' : 'Source: curated selection · Wikipedia (CC BY-SA)'}
          </p>
        </>
      );
    }

    const artRow = (art: CuratedArt) => {
      const meta = artsgruppeMeta(art.gruppe);
      const obs = obsByName.get(art.vitenskapelig.toLowerCase().trim());
      const isRedList = RED_LIST_CATS.test(art.kategori);
      const isAlien = ALIEN_CATS.test(art.kategori);
      return (
        <div key={art.vitenskapelig} className="vl-sp-row flat" onClick={() => openArt(art)}>
          <span className="vl-sp-ico" style={{ background: `${meta.color}1a`, color: meta.color }}
            dangerouslySetInnerHTML={{ __html: iconSvg(meta.icon) }} />
          <div className="vl-sp-main">
            <span className="vl-sp-name">{art.norsk || art.vitenskapelig}</span>
            <span className="vl-sp-sci">{art.norsk ? art.vitenskapelig : art.gruppe}</span>
          </div>
          <div className="vl-sp-right">
            {isRedList && <span className="vl-rlbadge" title={RL_LABEL[art.kategori]}>{art.kategori}</span>}
            {isAlien && <span className="vl-albadge" title="Fremmedart">FA</span>}
            <span className="vl-sp-cnt">{obs?.obsCount ?? art.antallFunn}</span>
            <span className="vl-chev"><ChevSvg /></span>
          </div>
        </div>
      );
    };

    // Row for a live GBIF-backed species with no curated entry — same visual
    // shape as artRow, opens the rich detail directly.
    const liveRow = (obs: NatureObs) => {
      const cfg = NATURE_GROUPS[obs.group];
      return (
        <div key={`live-${obs.gbifKey}`} className="vl-sp-row flat" onClick={() => selectNatureSpecies(obs)}>
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

    const natQ = natureSearchQ.trim().toLowerCase();

    const searchField = (
      <div className="vl-panel-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
          <circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>
        </svg>
        <input
          type="search"
          placeholder={lang === 'no' ? 'Søk etter art' : 'Search species'}
          value={natureSearchQ}
          onChange={e => setNatureSearchQ(e.target.value)}
          autoComplete="off"
        />
        {natureSearchQ && (
          <button className="vl-search-close" onClick={() => setNatureSearchQ('')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        )}
      </div>
    );

    // Active search: results across BOTH the curated lists and the full live
    // observation set replace the category browsing entirely.
    if (natQ) {
      const curatedHits: CuratedArt[] = [];
      const seenSci = new Set<string>();
      for (const k of ARTS_KATEGORIER) {
        for (const art of k.arter) {
          const sci = art.vitenskapelig.toLowerCase().trim();
          if (seenSci.has(sci)) continue;
          if ((art.norsk ?? '').toLowerCase().includes(natQ) || sci.includes(natQ)) {
            seenSci.add(sci);
            curatedHits.push(art);
          }
        }
      }
      const liveHits = natureObs.filter(o =>
        !seenSci.has(o.scientificName.toLowerCase().trim()) &&
        (o.popularName.toLowerCase().includes(natQ) || o.scientificName.toLowerCase().includes(natQ))
      ).slice(0, 50);

      return (
        <>
          {searchField}
          {curatedHits.length === 0 && liveHits.length === 0 ? (
            <p className="vl-nat-sec-sub" style={{ marginTop: 10 }}>
              {natureLoading
                ? (lang === 'no' ? 'Henter observasjoner…' : 'Fetching observations…')
                : (lang === 'no' ? `Ingen arter funnet for «${natureSearchQ}».` : `No species found for “${natureSearchQ}”.`)}
            </p>
          ) : (
            <>
              {curatedHits.length > 0 && (
                <>
                  <div className="vl-nat-sec">{lang === 'no' ? 'Utvalgte arter' : 'Curated species'}</div>
                  {curatedHits.map(artRow)}
                </>
              )}
              {liveHits.length > 0 && (
                <>
                  <div className="vl-nat-sec">{lang === 'no' ? 'Alle observasjoner' : 'All observations'}</div>
                  {liveHits.map(liveRow)}
                </>
              )}
            </>
          )}
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
            Kilde: GBIF (CC BY 4.0)
          </p>
        </>
      );
    }

    return (
      <>
        {searchField}
        {(['Artsmangfold', 'Kulturhistorie'] as const).map(seksjon => {
          const kats = ARTS_KATEGORIER.filter(k => k.seksjon === seksjon);
          if (kats.length === 0) return null;
          return (
            <div key={seksjon} style={{ marginBottom: 4 }}>
              <div className="vl-nat-sec">
                {seksjon === 'Artsmangfold'
                  ? (lang === 'no' ? 'Artsmangfold' : 'Biodiversity')
                  : (lang === 'no' ? 'Kulturhistorie' : 'Cultural history')}
              </div>
              <div className="vl-chips">
                {kats.map(k => (
                  <div key={k.id} className={`vl-chip lbl${artsKategoriId === k.id ? ' on' : ''}`}
                    {...pressable(() => { setArtsKategoriId(k.id); setNatureListN(20); }, artsKategoriId === k.id)} title={k.beskrivelse}>
                    <span className="cl">{k.tittel}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {natureLoading && (
          <div aria-live="polite">
            <span className="vl-skel-tag">{lang === 'no' ? 'Henter arter …' : 'Fetching species …'}</span>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="vl-skel-row" aria-hidden="true">
                <div className="vl-skel-ico" />
                <div className="vl-skel-lines">
                  <div className="vl-skel-line" style={{ width: `${72 - i * 9}%` }} />
                  <div className="vl-skel-line thin" style={{ width: `${48 - i * 5}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedKategori && (
          <>
            <p className="vl-nat-sec-sub">{selectedKategori.beskrivelse}</p>
            {selectedKategori.arter.slice(0, natureListN).map(artRow)}
            {selectedKategori.arter.length > natureListN && (
              <button className="vl-showmore" onClick={() => setNatureListN(n => n + 20)}>
                {lang === 'no' ? 'Vis flere' : 'Show more'} ({selectedKategori.arter.length - natureListN})
              </button>
            )}
          </>
        )}

        <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
          {lang === 'no' ? 'Kilde: kuratert utvalg · GBIF (CC BY 4.0)' : 'Source: curated selection · GBIF (CC BY 4.0)'}
        </p>
      </>
    );
  }

  // ── Render: history ─────────────────────────────────────────────────────────

  function renderHistory() {
    const viewToggle = (
      <div className="vl-chips" style={{ marginBottom: 14 }}>
        <div className={`vl-chip${historyView === 'tidslinje' ? ' on' : ''}`}
          {...pressable(() => { setHistoryView('tidslinje'); setSelectedEra(null); setSelectedFarm(null); }, historyView === 'tidslinje')}>
          <span className="ci" dangerouslySetInnerHTML={{ __html: iconSvg('kart') }} />
          <span className="cl">{T.tidslinje}</span>
        </div>
        <div className={`vl-chip${historyView === 'garder' ? ' on' : ''}`}
          {...pressable(() => { setHistoryView('garder'); setSelectedEra(null); setSelectedFarm(null); }, historyView === 'garder')}>
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
              <img src={selectedEra.image} alt={selectedEra.image_caption || selectedEra.era} loading="lazy" decoding="async" onError={hideBrokenImg} />
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
              <div className="vl-poi-zone" {...pressable(() => {
                if (coords) mapRef.current?.setView(coords, Math.max(mapZoom, 14));
              })}>
                <div className="vl-poi-ico"
                  style={{ background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}
                  dangerouslySetInnerHTML={{ __html: iconSvg('hus') }} />
                <div className="vl-poi-body">
                  <h4>{farm.name}</h4>
                  <p>{farm.norron_name ? `${farm.norron_name} · ` : ''}{farm.location}</p>
                </div>
              </div>
              <div className="vl-poi-sep" />
              <div className="vl-poi-arr" aria-label={lang === 'no' ? `Åpne ${farm.name}` : `Open ${farm.name}`} {...pressable(() => {
                setSelectedFarm(farm);
                setSheetOpen(true);
                if (coords) mapRef.current?.setView(coords, Math.max(mapZoom, 14));
              })}>
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
        {/* One consistent filter chip type — always-visible label + a small
            colored dot, whether the chip represents a whole group ("Praktisk")
            or a single category. Previously groups and individual categories
            rendered as two visually different chip styles side by side
            (labeled pills vs. icon-only pills that only grew a label once
            active) — a single glance couldn't tell which chips were groups
            of things and which were one specific thing. */}
        {mode === 'places' && (
          <div className="vl-chips vl-panel-chips">
            <div className={`vl-chip lbl${activeCats.size === 0 ? ' on' : ''}`} {...pressable(() => setActiveCats(new Set()), activeCats.size === 0)} title={T.all}>
              <span className="cl">{T.all}</span>
            </div>
            {[...catGroups.entries()].map(([groupName, groupCats]) => {
              const on = groupCats.some(k => activeCats.has(k));
              const groupColor = (catCfg as Record<string, {color?: string}>)[groupCats[0]]?.color ?? 'var(--muted)';
              return (
                <div key={groupName} className={`vl-chip lbl${on ? ' on' : ''}`}
                  style={{ '--chip-color': groupColor } as React.CSSProperties}
                  {...pressable(() => toggleGroup(groupCats), on)} title={groupName}>
                  <span className="cd" />
                  <span className="cl">{groupName}</span>
                </div>
              );
            })}
            {allCats.filter(k => !(catCfg as Record<string, {group?: string}>)[k]?.group).map(k => {
              const cat = getCat(k);
              const on = activeCats.has(k);
              return (
                <div key={k} className={`vl-chip lbl${on ? ' on' : ''}`}
                  style={{ '--chip-color': cat.color } as React.CSSProperties}
                  {...pressable(() => toggleCat(k), on)} title={lang === 'no' ? cat.no : cat.en}>
                  <span className="cd" />
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

        {/* "Nærmest meg" — flat distance-sorted view, offered only while
            position tracking is on (it needs a here to measure from). */}
        {mode === 'places' && userPos && (
          <button
            className={`vl-nearestbtn${sortByNearest ? ' on' : ''}`}
            aria-pressed={sortByNearest}
            onClick={() => setSortByNearest(v => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3.4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>
            </svg>
            {lang === 'no' ? 'Nærmest meg' : 'Nearest me'}
          </button>
        )}

        {mode === 'places' && sortByNearest && userPos ? (
          <>
            {filteredPOIs
              .filter(p => p.kategori !== 'stedsnavn' && p.coordinates)
              .map(p => ({ p, d: distanceM(userPos[0], userPos[1], p.coordinates![0], p.coordinates![1]) }))
              .sort((a, b) => a.d - b.d)
              .map(({ p, d }) => {
                const cat = getCat(p.kategori);
                return (
                  <div key={p.id} className="vl-poi-card">
                    <div className="vl-poi-zone" {...pressable(() => showOnMap(p))}>
                      <div className="vl-poi-ico" style={{ background: cat.color, color: '#fff' }}
                        dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                      <div className="vl-poi-body">
                        <h4>{p.navn}</h4>
                        <p>{d < 950 ? `${Math.round(d / 50) * 50} m` : `${(d / 1000).toFixed(1)} km`} · {walkShort(p.coordinates)} · {lang === 'no' ? cat.no : cat.en}</p>
                      </div>
                    </div>
                    <div className="vl-poi-sep" />
                    <div className="vl-poi-arr" aria-label={lang === 'no' ? `Åpne ${p.navn}` : `Open ${p.navn}`} {...pressable(() => selectPOI(p))}>
                      <ChevSvg />
                    </div>
                  </div>
                );
              })}
          </>
        ) : mode === 'places' ? (
          <>
            {/* Place-name lookups (66 of ~98 entries) would drown the real count.
                Only shown once the user is actually searching/filtering, where
                a count is useful feedback ("3 treff") — as a raw baseline
                ("40 steder · 61 stedsnavn") on the very first view it was just
                noise before any real content, and the per-category badges
                below already communicate volume. */}
            {(searchQ || activeCats.size > 0) && (
              <div className="vl-count">{(() => {
                const sn = filteredPOIs.filter(p => p.kategori === 'stedsnavn').length;
                const main = filteredPOIs.length - sn;
                if (!filteredPOIs.length) return T.nohit;
                return T.np(main) + (sn ? ` · ${sn} ${lang === 'no' ? 'stedsnavn' : 'place names'}` : '');
              })()}</div>
            )}
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
                  <div className="vl-grp-hdr" aria-expanded={isOpen} {...pressable(() => toggleExpandedPlaceCat(catKey))}>
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
                            {...pressable(() => showOnMap(poi))}>
                            <div className="vl-poi-ico"
                              style={{ background: cat.color, color: '#fff' }}
                              dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                            <div className="vl-poi-body">
                              <h4>{poi.navn}</h4>
                              <p>{walkShort(poi.coordinates)}{poi.beskrivelse ? ` · ${poi.beskrivelse}` : ''}</p>
                            </div>
                          </div>
                          <div className="vl-poi-sep" />
                          <div className="vl-poi-arr" aria-label={lang === 'no' ? `Åpne ${poi.navn}` : `Open ${poi.navn}`} {...pressable(() => selectPOI(poi))}>
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
                <div className="vl-poi-zone" {...pressable(() => selectTrail(tr))}>
                  <div className="vl-poi-ico"
                    style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
                    dangerouslySetInnerHTML={{ __html: iconSvg('tur') }} />
                  <div className="vl-poi-body">
                    <h4>{lang === 'no' ? tr.name : tr.en}</h4>
                    <p>{tr.km} · {tr.time} · {lang === 'no' ? tr.diff : T.easy}</p>
                  </div>
                </div>
                <div className="vl-poi-sep" />
                <div className="vl-poi-arr" aria-label={lang === 'no' ? `Åpne ${tr.name}` : `Open ${tr.en}`} {...pressable(() => selectTrail(tr))}>
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
          <p>{lang === 'no' ? 'Ingen lagrede steder ennå. Trykk på hjertet på et sted eller en tur.' : 'No saved places yet. Tap the heart on a place or trail.'}</p>
          <button className="vl-empty-clear" onClick={() => selectTab('map')}>
            {lang === 'no' ? 'Utforsk kartet' : 'Explore the map'}
          </button>
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
              <div className="vl-poi-zone" {...pressable(() => showOnMap(poi))}>
                <div className="vl-poi-ico" style={{ background: cat.color, color: '#fff' }}
                  dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                <div className="vl-poi-body">
                  <h4>{poi.navn}</h4>
                  <p>{walkShort(poi.coordinates)}{poi.beskrivelse ? ` · ${poi.beskrivelse}` : ''}</p>
                </div>
              </div>
              <div className="vl-poi-sep" />
              <div className="vl-poi-arr" aria-label={lang === 'no' ? `Åpne ${poi.navn}` : `Open ${poi.navn}`} {...pressable(() => selectPOI(poi))}>
                <ChevSvg />
              </div>
            </div>
          );
        })}
        {savedTrails.map(tr => (
          <div key={tr.id} className="vl-poi-card">
            <div className="vl-poi-zone" {...pressable(() => selectTrail(tr))}>
              <div className="vl-poi-ico" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
                dangerouslySetInnerHTML={{ __html: iconSvg('tur') }} />
              <div className="vl-poi-body">
                <h4>{lang === 'no' ? tr.name : tr.en}</h4>
                <p>{tr.km} · {tr.time} · {lang === 'no' ? tr.diff : T.easy}</p>
              </div>
            </div>
            <div className="vl-poi-sep" />
            <div className="vl-poi-arr" aria-label={lang === 'no' ? `Åpne ${tr.name}` : `Open ${tr.en}`} {...pressable(() => selectTrail(tr))}>
              <ChevSvg />
            </div>
          </div>
        ))}
      </>
    );
  }

  // ── Render: Innstillinger (settings) ────────────────────────────────────────

  function renderSettings() {
    return (
      <>
        <div className="vl-settings-group">
          <div className="vl-settings-label">{lang === 'no' ? 'Språk' : 'Language'}</div>
          <div className="vl-seg">
            <button className={lang === 'no' ? 'on' : ''} onClick={() => setLang('no')}>Norsk</button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
          </div>
        </div>
        <div className="vl-settings-group">
          <div className="vl-settings-label">{lang === 'no' ? 'Om appen' : 'About'}</div>
          <p className="vl-settings-text">
            {lang === 'no'
              ? 'Veierland øykart samler praktisk informasjon og lokalhistorie om øya på ett sted — steder, turer, natur og historie.'
              : 'Veierland island map brings together practical information and local history about the island in one place — places, trails, nature and history.'}
          </p>
        </div>
        <div className="vl-settings-group">
          <div className="vl-settings-label">{lang === 'no' ? 'Kilder' : 'Sources'}</div>
          <p className="vl-settings-text">
            {lang === 'no'
              ? 'Kart: OpenStreetMap · CARTO. Vær: MET Norway. Historisk innhold: Lokalhistoriewiki, DigitaltMuseum, Wikimedia Commons.'
              : 'Map: OpenStreetMap · CARTO. Weather: MET Norway. Historical content: Lokalhistoriewiki, DigitaltMuseum, Wikimedia Commons.'}
          </p>
        </div>
        <div className="vl-settings-group">
          <div className="vl-settings-label">{lang === 'no' ? 'Personvern' : 'Privacy'}</div>
          <p className="vl-settings-text">
            {lang === 'no'
              ? 'Posisjonen din brukes kun lokalt i appen for å vise avstand og «nærmest meg» — den lagres ikke og deles ikke.'
              : 'Your location is only used locally in the app to show distance and "nearest me" — it is not stored or shared.'}
          </p>
        </div>
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
        {/* Photo header (design screen 3): the POI photo sits at the top with
            back/save floating on it. POIs without a photo keep the plain
            text back-button row. */}
        {poi.bilde ? (
          <div className="vl-poi-hero">
            <img src={poi.bilde} alt={poi.navn} loading="lazy" decoding="async" onError={hideBrokenImg} />
            {!backRedundant && (
              <button className="hbtn back" onClick={goBack} aria-label={T.back}><BackSvg /></button>
            )}
            <button
              className={`hbtn save${saved ? ' on' : ''}`}
              onClick={() => { toggleSaved(poi.id); setHeartAnim(true); setTimeout(() => setHeartAnim(false), 350); }}
              aria-label={saved ? (lang === 'no' ? 'Fjern fra lagret' : 'Remove from saved') : (lang === 'no' ? 'Lagre' : 'Save')}
              aria-pressed={saved}
            >
              <HeartSvg />
            </button>
            {poi.bilde_lisens && <span className="vl-photo-credit">{poi.bilde_lisens}</span>}
          </div>
        ) : (
          !backRedundant && <button className="vl-back" onClick={goBack}><BackSvg />{T.back}</button>
        )}
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
          {/* Walk time sits in the tag row (design screen 3), not on its own line */}
          <span className="vl-catpill">{walkLong(poi.coordinates)}</span>
        </div>
        <div className="vl-h2">{poi.navn}</div>
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
                  {!quayBoard.tomorrow && <span className="in">{fmtCountdown(minsUntil(sl.time), lang)}</span>}
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

        {(poi.apent || poi.parkering) && (
          <div className="vl-factcards">
            {poi.apent && (
              <div className="vl-factcard">
                <div className="k">{lang === 'no' ? 'Åpent' : 'Open'}</div>
                <div className="v">{poi.apent}</div>
              </div>
            )}
            {poi.parkering && (
              <div className="vl-factcard">
                <div className="k">{lang === 'no' ? 'Parkering' : 'Parking'}</div>
                <div className="v">{poi.parkering}</div>
              </div>
            )}
          </div>
        )}
        {poi.visste_du_at && (
          <div className="vl-fact">
            <div className="vl-fact-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.2 3.8c-2.3-2.3-7-1.2-9.8 1.6-2.2 2.2-3 5.6-2.3 8.5L3 19l1.4 1.4 2-2 2.6.5c2.4.2 5-.7 6.8-2.5 2.8-2.8 6.7-10.3 4.4-12.6z"/><path d="M8.5 15.5 15 9"/></svg>
              {lang === 'no' ? 'Visste du at?' : 'Did you know?'}
            </div>
            <p className="vl-fact-text">{poi.visste_du_at}</p>
          </div>
        )}

        {wikimediaImages.length === 1 && (
          <a href={wikimediaImages[0].pageUrl} target="_blank" rel="noreferrer" className="vl-poi-static-img" style={{ display: 'block', textDecoration: 'none' }}>
            <img src={wikimediaImages[0].thumbUrl} alt={wikimediaImages[0].title} style={{ width: '100%', height: 220, objectFit: 'cover', borderRadius: 10, display: 'block' }} loading="lazy" decoding="async" onError={hideBrokenImg} />
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
                  <img src={img.thumbUrl} alt={img.title} loading="lazy" decoding="async" onError={hideBrokenImg} />
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
          {/* Design screen 3: primary "Vis rute dit" — jump to the map with
              the place selected; the walking route draws via the existing
              selected-POI route effect. */}
          <button className="vl-btn pri" onClick={() => showOnMap(poi)}>
            <RouteSvg /> {T.showRoute}
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
                <img src={lokalData.bilde} alt={lokalData.tittel} className="vl-api-img" loading="lazy" decoding="async" onError={hideBrokenImg} />
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
                  <img src={img.bilde600} alt={img.tittel} className="vl-api-img" loading="lazy" decoding="async" onError={hideBrokenImg} />
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

        {/* Related places: the three nearest real POIs, so the detail card
            ends with a "keep exploring" step instead of a dead stop. Pure
            distance beats same-category-only here — on a small island the
            neighbouring bathing spot, quay, or burial mound is a natural
            next stop regardless of type. */}
        {(() => {
          if (!poi.coordinates) return null;
          const related = allPOIs
            .filter(p => p.id !== poi.id && p.kategori !== 'stedsnavn' && p.coordinates)
            .map(p => ({ p, d: distanceM(poi.coordinates![0], poi.coordinates![1], p.coordinates![0], p.coordinates![1]) }))
            .sort((a, b) => a.d - b.d)
            .slice(0, 3);
          if (related.length === 0) return null;
          return (
            <div style={{ marginTop: 18 }}>
              <p className="vl-api-label">{lang === 'no' ? 'I nærheten' : 'Nearby'}</p>
              {related.map(({ p, d }) => {
                const rcat = getCat(p.kategori);
                return (
                  <div key={p.id} className="vl-poi-card">
                    <div className="vl-poi-zone" {...pressable(() => selectPOI(p))}>
                      <div className="vl-poi-ico" style={{ background: `${rcat.color}1a`, color: rcat.color }}
                        dangerouslySetInnerHTML={{ __html: iconSvg(rcat.icon) }} />
                      <div className="vl-poi-body">
                        <h4>{p.navn}</h4>
                        <p>{lang === 'no' ? rcat.no : rcat.en} · {d < 950 ? `${Math.round(d / 50) * 50} m` : `${(d / 1000).toFixed(1)} km`}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
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
                        <div className="vl-poi-zone" {...pressable(() => {
                          selectNatureSpecies(obs);
                          setMode('nature');
                        })}>
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
                        <div className="vl-poi-arr" aria-label={lang === 'no' ? `Åpne ${obs.popularName || obs.scientificName}` : `Open ${obs.popularName || obs.scientificName}`} {...pressable(() => { selectNatureSpecies(obs); setMode('nature'); })}>
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
                      <div className="vl-poi-zone" {...pressable(() => showOnMap(poi))}>
                        <div className="vl-poi-ico"
                          style={{ background: cat.color, color: '#fff' }}
                          dangerouslySetInnerHTML={{ __html: iconSvg(cat.icon) }} />
                        <div className="vl-poi-body">
                          <h4>{poi.navn}</h4>
                          {poi.beskrivelse && <p>{poi.beskrivelse}</p>}
                        </div>
                      </div>
                      <div className="vl-poi-sep" />
                      <div className="vl-poi-arr" aria-label={lang === 'no' ? `Åpne ${poi.navn}` : `Open ${poi.navn}`} {...pressable(() => selectPOI(poi))}>
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
  const DOCK_PEEK_H = 40; // just the grab handle
  const dockReservedH = dockShown ? (dockPeeked ? DOCK_PEEK_H : activityTile ? 84 : 268) : 12;

  return (
    <div className="vl-app">
      {/* First-open-of-the-day welcome: a full-screen hero over the map
          (per the Organic redesign's screen 1), not folded into the dock —
          the map itself only becomes visible once the visitor dismisses it. */}
      {showWelcome && (
        <div
          className="vl-welcome-hero"
          style={welcomeHeroPhoto ? { backgroundImage: `url(${welcomeHeroPhoto})` } : undefined}
          {...pressable(dismissWelcome)}
        >
          <div className="vl-welcome-scrim" />
          <div className="vl-welcome-content" onClick={e => e.stopPropagation()}>
            <span className="vl-welcome-tag">Færder kommune · Vestfold</span>
            <h1 className="vl-welcome-title">{lang === 'no' ? 'Velkommen til Veierland' : 'Welcome to Veierland'}</h1>
            <p className="vl-welcome-sub">
              {lang === 'no'
                ? 'En bilfri øy med sandstrender, en tusen år gammel bosetning og et lite fellesskap som fortsatt lever av sjøen.'
                : 'A car-free island with sandy beaches, a thousand-year-old settlement and a small community that still lives off the sea.'}
            </p>
            <div className="vl-welcome-chips">
              <button className="vl-welcome-chip" onClick={() => applyActivityTile('bade')}>
                <span dangerouslySetInnerHTML={{ __html: iconSvg('bade') }} />
                {lang === 'no' ? 'Bade' : 'Swim'}
              </button>
              <button className="vl-welcome-chip" onClick={() => applyActivityTile('gatur')}>
                <span dangerouslySetInnerHTML={{ __html: iconSvg('tur') }} />
                {lang === 'no' ? 'Gå tur' : 'Walk'}
              </button>
              <button className="vl-welcome-chip" onClick={() => applyActivityTile('historie')}>
                <span dangerouslySetInnerHTML={{ __html: iconSvg('kultur') }} />
                {lang === 'no' ? 'Historie' : 'History'}
              </button>
            </div>
            <button className="vl-welcome-cta" onClick={dismissWelcome}>
              {lang === 'no' ? 'Start utforsking' : 'Start exploring'}
            </button>
          </div>
        </div>
      )}

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
        preferCanvas
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <MapSetup onReady={onMapReady} onMapClick={onMapClick} onZoom={onZoom} onDragStart={onMapDragStart} />
        <TileController layer={currentLayer} filterOverride={mapLayerCfg[currentLayer] ? buildFilterString(mapLayerCfg[currentLayer]) : undefined} />
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
              pathOptions={{ color: '#c67139', weight: 3.6, opacity: 1, lineCap: 'round', lineJoin: 'round' }}
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
        {mapAppearance.contoursEnabled && contourSet && mapZoom >= mapAppearance.contourMinZoom && contourSet.segments.length > 0 && (
          <Polyline
            positions={contourSet.segments}
            pathOptions={{
              color: mapAppearance.contourColor,
              weight: mapAppearance.contourWeight,
              opacity: mapAppearance.contourOpacity,
            }}
            interactive={false}
          />
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

      {/* Locate-failure toast: same slot/style as the off-island toast (the
          two can't appear together — no position means no island check).
          Wraps to two lines since the permission message is long. */}
      {locateError && !offIsland && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--ink)', color: '#fff', borderRadius: 12,
          padding: '10px 18px', fontSize: 13, fontWeight: 600, lineHeight: 1.45,
          zIndex: 1100, maxWidth: 'min(320px, calc(100% - 32px))', textAlign: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,.25)', pointerEvents: 'none',
        }}>
          {locateError}
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

      {/* Glass top bar — re-skinned per the "Veierland Prototype" Claude
          Design file: human-language weather line instead of a bare number,
          and the ferry as a plain countdown text instead of the ring (a
          deliberate reversal of the earlier ring decision — the user's own
          design mock calls for text here, so it wins). NO/EN lives in the menu. */}
      <div className="vl-topbar2">
        <button className="vl-menubtn" onClick={e => { e.stopPropagation(); setShowMenu(m => !m); }}
          aria-label={lang === 'no' ? 'Meny' : 'Menu'} title={lang === 'no' ? 'Meny' : 'Menu'}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
        <div className="vl-topbar2-info">
          <button
            className={`vl-topbar2-weather${condLayer ? ' on' : ''}`}
            disabled={!hasDomGrid}
            onClick={e => { e.stopPropagation(); setCondLayer(c => c ? null : 'best'); }}
            aria-label={lang === 'no' ? 'Forhold nå (beste steder, sol, vind, temperatur)' : 'Conditions now (best spots, sun, wind, temperature)'}
            title={lang === 'no' ? 'Forhold nå' : 'Conditions now'}
          >
            {weatherNow ? (
              <>
                <span className="wico"><WeatherIcon kind={weatherIconKind(weatherNow.symbolCode)} /></span>
                <span className="wval">{Math.round(weatherNow.airTemp)}°</span>
                <span className="wsep">·</span>
                <span className="wphrase">{weatherKindLabel(weatherIconKind(weatherNow.symbolCode), lang)}</span>
              </>
            ) : (lang === 'no' ? 'Henter vær…' : 'Loading weather…')}
          </button>
        </div>
        <button className={`vl-ferrytext-btn${showFerryPop ? ' on' : ''}`}
          onClick={e => { e.stopPropagation(); toggleFerryPop(); }}
          title={lang === 'no' ? 'Fergetider' : 'Ferry times'}>
          <div className="time">{nextFromIsland ? fmtDepTime(nextFromIsland.time) : '–'}</div>
          <div className="cd">
            {nextFromIsland
              ? (ferryTomorrow
                  ? (lang === 'no' ? 'I MORGEN' : 'TOMORROW')
                  : (lang === 'no' ? `FERJE OM ${fmtCountdown(minsUntil(nextFromIsland.time), lang).toUpperCase()}` : `FERRY IN ${fmtCountdown(minsUntil(nextFromIsland.time), lang).toUpperCase()}`))
              : (lang === 'no' ? 'FERGETIDER' : 'FERRY TIMES')}
          </div>
        </button>
      </div>

      {/* Menu: reaches Steder/Turer/Natur/Historie/Lagret now that the tab
          bar is gone — wired straight to the existing selectTab(), so this
          adds a new entry point without any new list/browse logic. */}
      {showMenu && (
        <div className="vl-menu" onClick={e => e.stopPropagation()}>
          {/* "Kart" first: the only other way back to the map from an open
              list is dragging the sheet down — a gesture first-time users
              don't know about. This gives them an always-visible exit. */}
          <button className="vl-menu-item" onClick={() => { setShowMenu(false); exitActivityTile(); selectTab('map'); }}>
            <MapTabSvg /><span>{T.map}</span>
          </button>
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
          <button className="vl-menu-item" onClick={() => { setShowMenu(false); exitActivityTile(); selectTab('settings'); }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>{T.settings}</span>
          </button>
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
                        ? <span className="in pill">{lang === 'no' ? 'om' : 'in'} {fmtCountdown(minsUntil(d.time), lang)}</span>
                        : <span className="in">{fmtCountdown(minsUntil(d.time), lang)}</span>
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
                        ? <span className="in pill">{lang === 'no' ? 'om' : 'in'} {fmtCountdown(minsUntil(d.time), lang)}</span>
                        : <span className="in">{fmtCountdown(minsUntil(d.time), lang)}</span>
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
        {/* Mobile-only: Min posisjon folds into this same popover instead of
            its own rail button, so the mobile map screen has one floating
            "map tools" entry point instead of two separate icon buttons
            competing for thumb space. Forhold is no longer reachable from
            here or from a desktop rail button — the weather pill in the top
            bar is the sole entry point, on both breakpoints. */}
        <div className="vl-pop-mobileonly">
          <div className={`vl-opt${locating ? ' on' : ''}`} {...pressable(() => { locate(); setShowLayerPop(false); }, locating)}>
            <span className="sw vl-opt-ic" style={{ color: 'var(--ink)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3.4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>
              </svg>
            </span>
            <span className="nm">{lang === 'no' ? (locating ? 'Stopp sporing' : 'Min posisjon') : (locating ? 'Stop tracking' : 'My location')}</span>
            <span className="chk">{locating && <CheckSvg />}</span>
          </div>
          <div className="vl-pop-sep" />
        </div>
        <h5>{T.layers}</h5>
        {visibleLayerOrder.map(k => {
          const cfg = LAYERS[k];
          const custom = mapLayerCfg[k];
          const on = currentLayer === k;
          const label = custom ? (lang === 'no' ? custom.label.no : custom.label.en) : (lang === 'no' ? cfg.label.no : cfg.label.en);
          return (
            <div
              key={k}
              className={`vl-opt${on ? ' on' : ''}`}
              {...pressable(() => { setCurrentLayer(k); setShowLayerPop(false); try { localStorage.setItem('vl-layer', k); } catch {} }, on)}
            >
              <span className="sw" style={{ background: cfg.sw, filter: custom ? buildFilterString(custom) : undefined }} />
              <span className="nm">{label}</span>
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
              {...pressable(() => { if (hasData) { setGeoLayer(on ? null : k); setShowLayerPop(false); } }, on)}
              aria-disabled={!hasData}
            >
              <span className="sw" style={{ background: cfg.sw }} />
              <span className="nm">{lang === 'no' ? cfg.label.no : cfg.label.en}</span>
              <span className="chk">{on ? <CheckSvg /> : (!hasData && <span style={{fontSize:10,color:'var(--muted)'}}>↓</span>)}</span>
            </div>
          );
        })}
      </div>

      {/* Desktop-only zoom in/out — with the mobile tab bar gone there was no
          visible zoom affordance at all on desktop (scroll-to-zoom works but
          isn't discoverable without a trackpad), and the top-right of the
          map is otherwise empty now that the top bar caps its width. Hidden
          on mobile via CSS — pinch/the rail cover that there. */}
      <div className="vl-zoomctl">
        <button onClick={() => mapRef.current?.zoomIn()} aria-label={lang === 'no' ? 'Zoom inn' : 'Zoom in'} title={lang === 'no' ? 'Zoom inn' : 'Zoom in'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <button onClick={() => mapRef.current?.zoomOut()} aria-label={lang === 'no' ? 'Zoom ut' : 'Zoom out'} title={lang === 'no' ? 'Zoom ut' : 'Zoom out'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14"/></svg>
        </button>
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
          <span className="rl">{isDesktopView() ? (lang === 'no' ? 'Kartlag' : 'Layers') : (lang === 'no' ? 'Kart' : 'Map')}</span>
        </button>
        <button
          className={`vl-rbtn posisjon${locating ? ' active' : ''}`}
          aria-label="Min posisjon"
          title={lang === 'no' ? (locating ? 'Stopp sporing' : 'Min posisjon') : (locating ? 'Stop tracking' : 'My location')}
          onClick={locate}
          style={locating ? { background: 'var(--ink)' } : undefined}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3.4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>
          </svg>
          <span className="rl">{lang === 'no' ? 'Posisjon' : 'Locate'}</span>
        </button>
      </div>

      {/* Legend for the active conditions overlay */}
      {condLayer && hasDomGrid && (() => {
        const condPoint = weatherSeries?.[Math.min(condHourOffset, weatherSeries.length - 1)] ?? null;
        const condDate = condPoint ? new Date(condPoint.time) : new Date();
        const condTimeLabel = condHourOffset === 0
          ? (lang === 'no' ? 'nå' : 'now')
          : `${lang === 'no' ? 'kl.' : 'at'} ${String(condDate.getHours()).padStart(2, '0')}:${String(condDate.getMinutes()).padStart(2, '0')}`;
        const HOUR_STEPS = [0, 3, 6, 12, 24];

        const COND_TITLES: Record<string, [string, string]> = {
          best: ['Beste steder', 'Best spots'],
          sun: ['Sol og skygge', 'Sun & shade'],
          wind: ['Vindeksponering', 'Wind exposure'],
          effectiveTemp: ['Effektiv temperatur', 'Feels like'],
        };
        const condTitle = COND_TITLES[condLayer][lang === 'no' ? 0 : 1];
        // Icon per view, matching the Claude Design prototype's 4-icon tab
        // row (Best/Vind/Sol/Felt) — direct taps instead of swipe-only, which
        // wasn't discoverable without the pager dots as a hint.
        const CondIcon = ({ view }: { view: typeof COND_VIEWS[number] }) => {
          const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
          if (view === 'best') return <svg {...p}><path d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>;
          if (view === 'wind') return <svg {...p}><path d="M3 8h11a2.5 2.5 0 1 0-2.2-3.7"/><path d="M3 12.5h15a2.5 2.5 0 1 1-2.2 3.7"/><path d="M3 17h8"/></svg>;
          if (view === 'sun') return <svg {...p}><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8"/></svg>;
          return <svg {...p}><path d="M12 14.5V4.5a2 2 0 1 0-4 0v10a4 4 0 1 0 4 0z"/></svg>;
        };

        // Design 2b: a small sun disc at the map edge in the sun's actual
        // direction, with a dashed ray toward the island — explains WHY the
        // shadows fall where they do. Screen position from the azimuth
        // (0 = north = up); the ray points back toward the centre.
        const sunInd = (() => {
          if (condLayer !== 'sun') return null;
          const sun = sunPosition(condDate, 59.155, 10.351);
          if (sun.elevation <= 0) return null;
          const rad = (sun.azimuth * Math.PI) / 180;
          const left = 50 + Math.sin(rad) * 40;
          const top = 46 - Math.cos(rad) * 34;
          return (
            <div className="vl-sunind" style={{ left: `${left}%`, top: `${top}%`, transform: `translate(-50%,-50%) rotate(${sun.azimuth}deg)` }} aria-hidden="true">
              <div className="disc" />
              <div className="ray" />
            </div>
          );
        })();

        return (
          <>
          {sunInd}
          <div className="vl-condlegend" onClick={e => e.stopPropagation()}>
            <div className="vl-condlegend-hd">
              <span className="t">{condTitle} · {condTimeLabel}</span>
              <button className="vl-condlegend-close" aria-label={lang === 'no' ? 'Lukk' : 'Close'}
                onClick={() => setCondLayer(null)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
              </button>
            </div>
            <div className="vl-cond-tabs">
              {COND_VIEWS.map(v => (
                <button key={v} className={condLayer === v ? 'on' : ''} title={COND_TITLES[v][lang === 'no' ? 0 : 1]}
                  onClick={() => setCondLayer(v)}>
                  <CondIcon view={v} />
                </button>
              ))}
            </div>
            {weatherSeries && (
              <div className="vl-condhours">
                {HOUR_STEPS.filter(h => h < weatherSeries.length).map(h => (
                  <button key={h} className={condHourOffset === h ? 'on' : ''} onClick={() => setCondHourOffset(h)}>
                    {h === 0 ? (lang === 'no' ? 'Nå' : 'Now') : `+${h}t`}
                  </button>
                ))}
              </div>
            )}
            {condLayer === 'best' ? (
              condPoint && bestInfo ? (() => {
                const place = nearestPlaceName(bestInfo.lat, bestInfo.lng);
                const traits = [
                  bestInfo.sunlit && (lang === 'no' ? 'sol' : 'sun'),
                  bestInfo.sheltered && (lang === 'no' ? 'godt le for vind' : 'good shelter from wind'),
                ].filter(Boolean).join(lang === 'no' ? ' og ' : ' and ');
                return (
                  <>
                    <div className="vl-cond-conclusion">
                      {place
                        ? (lang === 'no' ? `Best nå: ${place}` : `Best now: ${place}`)
                        : (lang === 'no' ? 'Best nå: i nærheten' : 'Best now: nearby')}
                    </div>
                    <p className="vl-cond-note" style={{ marginBottom: 8 }}>
                      {traits
                        ? (lang === 'no' ? `${traits.charAt(0).toUpperCase()}${traits.slice(1)} akkurat nå.` : `${traits.charAt(0).toUpperCase()}${traits.slice(1)} right now.`)
                        : (lang === 'no' ? 'Mildest sted på øya akkurat nå.' : 'Mildest spot on the island right now.')}
                    </p>
                    <div className="vl-cond-main">
                      <span className="big">{Math.round(bestInfo.perceivedC)}°</span>
                      <span className="sub">{lang === 'no' ? 'føles som' : 'feels like'}</span>
                    </div>
                    <div className="vl-cond-keys">
                      {bestInfo.sunlit && <span className="k"><i style={{ background: '#fabf24' }} />{lang === 'no' ? 'Sol' : 'Sun'}</span>}
                      {bestInfo.sheltered && <span className="k"><i style={{ background: '#5f9438' }} />{lang === 'no' ? 'God le' : 'Sheltered'}</span>}
                      {!bestInfo.sunlit && !bestInfo.sheltered && (
                        <span className="k"><i style={{ background: '#f6b23c' }} />{lang === 'no' ? 'Mildest' : 'Mildest'}</span>
                      )}
                    </div>
                  </>
                );
              })() : (
                <span className="vl-cond-note">{lang === 'no' ? 'Henter vær…' : 'Loading weather…'}</span>
              )
            ) : condLayer === 'sun' ? (() => {
              const sun = sunPosition(condDate, 59.155, 10.351);
              return sun.elevation > 0 ? (
                <>
                  <div className="vl-cond-main">
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
                      style={{ transform: `rotate(${sun.azimuth}deg)`, flexShrink: 0, color: '#f5b120' }}>
                      <path d="M12 2 L12 20 M12 2 L6 9 M12 2 L18 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="big">{Math.round(sun.elevation)}°</span>
                    <span className="sub">{lang === 'no' ? 'over horisonten' : 'above horizon'}</span>
                  </div>
                  <div className="vl-cond-keys">
                    <span className="k"><i style={{ background: '#fabf24' }} />{lang === 'no' ? 'Sol' : 'Sun'}</span>
                    <span className="k"><i style={{ background: '#3a4250' }} />{lang === 'no' ? 'Skygge' : 'Shade'}</span>
                  </div>
                </>
              ) : (
                <span className="vl-cond-note">{lang === 'no'
                  ? 'Sola er under horisonten — velg et senere tidspunkt for å se morgensola.'
                  : 'The sun is below the horizon — pick a later hour to see morning sun.'}</span>
              );
            })() : condLayer === 'wind' ? (
              condPoint ? (
                <>
                  <div className="vl-cond-main">
                    {/* windFromDeg is meteorological convention (direction the wind
                        blows FROM); the arrow itself should point where it's blowing
                        TO, hence the +180. */}
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
                      style={{ transform: `rotate(${condPoint.windFromDeg + 180}deg)`, flexShrink: 0, color: 'var(--accent)' }}>
                      <path d="M12 2 L12 20 M12 2 L6 9 M12 2 L18 9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="big">{Math.round(condPoint.windSpeed)} m/s</span>
                    <span className="sub">{lang === 'no' ? `fra ${windDirLabel(condPoint.windFromDeg, 'no')}` : `from ${windDirLabel(condPoint.windFromDeg, 'en')}`}</span>
                  </div>
                  {/* Design 2c: zone colours, not a strength gradient — the
                      m/s numbers live in the badges on the spots. */}
                  <div className="vl-cond-keys">
                    <span className="k"><i style={{ background: '#8fa073' }} />{lang === 'no' ? 'Le' : 'Lee'}</span>
                    <span className="k"><i style={{ background: '#8c491a' }} />{lang === 'no' ? 'Eksponert' : 'Exposed'}</span>
                  </div>
                </>
              ) : (
                <span className="vl-cond-note">{lang === 'no' ? 'Henter vind…' : 'Loading wind…'}</span>
              )
            ) : (
              condPoint ? (
                <>
                  <div className="vl-cond-main">
                    <span className="big">{Math.round(effectiveTemp(condPoint.airTemp, condPoint.windSpeed, condPoint.humidity))}°</span>
                    <span className="sub">{lang === 'no' ? `luft ${Math.round(condPoint.airTemp)}°` : `air ${Math.round(condPoint.airTemp)}°`}</span>
                  </div>
                  {(() => {
                    // Design 2d: the legend mirrors the isotherm lines — one
                    // coloured tag per whole degree present on the island at
                    // the selected hour (the overlay's autoscaled range), so
                    // ring colour → exact value is a one-glance lookup.
                    const [MIN_T, MAX_T] = tempRange ?? [10, 20];
                    const span = MAX_T - MIN_T || 1;
                    const levels: number[] = [];
                    for (let t = Math.ceil(MIN_T); t <= Math.floor(MAX_T); t++) levels.push(t);
                    if (levels.length === 0) levels.push(Math.round((MIN_T + MAX_T) / 2));
                    return (
                      <div className="vl-cond-temptags">
                        {levels.map(t => (
                          <span key={t} style={{ background: tempRampHex((t - MIN_T) / span) }}>{t}°</span>
                        ))}
                      </div>
                    );
                  })()}
                </>
              ) : (
                <span className="vl-cond-note">{lang === 'no' ? 'Henter temperatur…' : 'Loading temperature…'}</span>
              )
            )}
          </div>
          </>
        );
      })()}

      {/* Compact mini-card: shown for a map-tapped POI when nothing else is open */}
      {showMiniCard && selectedPOI && (() => {
        const cat = getCat(selectedPOI.kategori);
        const saved = savedIds.has(selectedPOI.id);
        return (
          <div className="vl-minicard" onClick={() => { setView('detail'); setSheetOpen(true); }}>
            <div className="vl-ic" style={{ background: cat.color, color: '#fff' }}
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
              {walkRoutePath && (
                <button className="ab" aria-label={T.directions} title={T.directions}
                  onClick={e => {
                    e.stopPropagation();
                    // Zoom out to show the whole walking route (drawn on the
                    // map already), start to destination, clear of the top
                    // bar and this mini-card.
                    const map = mapRef.current;
                    if (!map) return;
                    const b = L.latLngBounds(walkRoutePath.map(p => [p[0], p[1]] as [number, number]));
                    map.fitBounds(b.pad(0.15), { paddingTopLeft: [20, 110], paddingBottomRight: [20, 100], animate: true });
                  }}>
                  <RouteSvg />
                </button>
              )}
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
        <div className={`vl-dock${dockExpanded ? ' expanded' : ''}${dockPeeked ? ' peeked' : ''}`}>
          <div className="vl-dock-grab" onPointerDown={onDockGrabPointerDown}>
            <div className="bar" />
          </div>
          {!activityTile ? (
            <>
              <div className="vl-dock-titlerow">
                <div className="vl-dock-title">
                  {lang === 'no' ? 'Hva vil du oppleve i dag?' : 'What do you want to experience today?'}
                </div>
                {/* A clear, always-visible way to jump straight to the full
                    place list without going through the hamburger menu — the
                    map screen previously had no map/list toggle at all until
                    an activity tile was already active (see .vl-dock-summary
                    below, whose "Vis liste" only appears after that point). */}
                <button className="vl-dock-listbtn" onClick={() => selectTab('places')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                  {lang === 'no' ? 'Liste' : 'List'}
                </button>
              </div>
              {/* Design screen 2: the daily recommendation is the dock title's
                  subtitle, not a separate banner at the bottom. */}
              {recoText && <div className="vl-dock-sub">{recoText}</div>}
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
              {/* Secondary activities: compact pill row so the dock doesn't
                  eat the map — the four tiles above are the headline acts. */}
              <div className="vl-dock-tiles-sec">
                <button className="vl-dock-tile-sm" style={{ color: NATURE_GROUPS.Fugler.color } as React.CSSProperties} onClick={() => applyActivityTile('natur')}>
                  <span dangerouslySetInnerHTML={{ __html: iconSvg('blad') }} />
                  <span className="lbl">{lang === 'no' ? 'Dyreliv' : 'Wildlife'}</span>
                </button>
                <button className="vl-dock-tile-sm" style={{ color: catCfg.arkeologi?.color ?? '#b5673e' } as React.CSSProperties} onClick={() => applyActivityTile('fornminner')}>
                  <span dangerouslySetInnerHTML={{ __html: iconSvg('kultur') }} />
                  <span className="lbl">{lang === 'no' ? 'Fornminner' : 'Heritage'}</span>
                </button>
                <button className="vl-dock-tile-sm" style={{ color: catCfg.havn?.color ?? '#3d6ea5' } as React.CSSProperties} onClick={() => applyActivityTile('praktisk')}>
                  <span dangerouslySetInnerHTML={{ __html: iconSvg('anker') }} />
                  {/* Was "Praktisk" — collided with the Steder tab's "Praktisk"
                      group chip, which covers a much broader set of categories
                      (bad+ferge+havn+kultur+info+mat+friluft vs. this tile's
                      ferge+havn+info). Same label, two different meanings. */}
                  <span className="lbl">{lang === 'no' ? 'Tjenester' : 'Services'}</span>
                </button>
              </div>
            </>
          ) : (
            <div className="vl-dock-summary">
              <button className="back" onClick={exitActivityTile} aria-label={lang === 'no' ? 'Tilbake' : 'Back'}><BackSvg /></button>
              <div className="txt">
                {`${filteredPOIs.length} ${FILTER_TILES[activityTile].noun[lang === 'no' ? 0 : 1]}`}
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
                  {...pressable(() => { const poi = allPOIs.find(p => p.id === b.poi.id); if (poi) showOnMap(poi); setDockExpanded(false); })}>
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
          {activityTile && activityTile !== 'bade' && dockExpanded && (
            <div className="vl-dock-list">
              {filteredPOIs.map(poi => (
                <div key={poi.id} className="vl-dock-row" {...pressable(() => { showOnMap(poi); setDockExpanded(false); })}>
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
        {/* Desktop-only sidebar branding — the sidebar otherwise starts cold
            with mobile-style tab icons and no sense of "this is Veierland",
            unlike the admin shell which already has this. Hidden on mobile
            via CSS (the tab bar there is the bottom nav, not a sidebar). */}
        <div className="vl-sidebar-brand">
          <span className="vl-sidebar-brand-ic">
            <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 1C5.2 1 3 3.2 3 6c0 3.8 5 9 5 9s5-5.2 5-9c0-2.8-2.2-5-5-5z"/>
              <circle cx="8" cy="6" r="1.5"/>
            </svg>
          </span>
          <span className="vl-sidebar-brand-name">Veierland</span>
        </div>
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
          <button className={`vl-tabbtn${tab === 'settings' ? ' on' : ''}`} onClick={() => selectTab('settings')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span>{T.settings}</span>
          </button>
        </nav>
        <div className="vl-grab" onPointerDown={onGrabPointerDown}>
          <div className="bar" />
        </div>
        {/* Full-screen browse-page header (back-circle + serif title), per
            the Claude Design prototype's tab views. The grab handle above
            still works too — dragging down peeks at the map without going
            all the way back. */}
        {isFullScreenBrowse && (
          <div className="vl-fsheader">
            <button className="vl-fsheader-back" onClick={() => selectTab('map')} aria-label={T.back}>
              <BackSvg />
            </button>
            <h2 className="vl-fsheader-title">
              {tab === 'places' ? T.places : tab === 'trails' ? T.trails : tab === 'nature' ? T.nature
                : tab === 'history' ? T.history : tab === 'settings' ? T.settings : T.saved}
            </h2>
          </div>
        )}
        <div className="vl-body" ref={bodyRef}>
          {view === 'browse' && tab === 'nature' && renderNature()}
          {view === 'browse' && tab === 'history' && renderHistory()}
          {view === 'browse' && tab === 'saved' && renderSaved()}
          {view === 'browse' && tab === 'settings' && renderSettings()}
          {view === 'browse' && (tab === 'map' || tab === 'places' || tab === 'trails') && renderBrowse()}
          {view === 'detail' && selectedPOI && renderPOIDetail(selectedPOI)}
          {view === 'detail' && selectedTrail && renderTrailDetail(selectedTrail)}
        </div>
      </div>
    </div>
  );
}
