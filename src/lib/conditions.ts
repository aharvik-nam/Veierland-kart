// Sun/shadow and wind-shelter conditions for the island, plus current
// weather (MET locationforecast) and sea temperature (MET oceanforecast).
//
// Terrain input is a DOM grid (surface model incl. trees/buildings) produced
// by scripts/generate_dom_grid.py from hoydedata.no data. Until that script
// has been run the bundled dom_grid.json is `{"empty": true}` and the
// terrain-based features stay hidden — same pattern as the geology layers.

import domGridData from '../data/dom_grid.json';

// ── DOM grid ──────────────────────────────────────────────────────────────────

interface DomGridJson {
  empty: boolean;
  minLng?: number; minLat?: number; maxLng?: number; maxLat?: number;
  cols?: number; rows?: number; cellM?: number;
  b64?: string;
}

export interface DomGrid {
  minLng: number; minLat: number; maxLng: number; maxLat: number;
  cols: number; rows: number; cellM: number;
  heights: Uint16Array; // decimetres, row-major from the north-west corner
}

function decodeGrid(raw: DomGridJson): DomGrid | null {
  if (raw.empty || !raw.b64 || !raw.cols || !raw.rows) return null;
  const bin = atob(raw.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return {
    minLng: raw.minLng!, minLat: raw.minLat!, maxLng: raw.maxLng!, maxLat: raw.maxLat!,
    cols: raw.cols, rows: raw.rows, cellM: raw.cellM ?? 15,
    heights: new Uint16Array(bytes.buffer),
  };
}

export const DOM_GRID: DomGrid | null = decodeGrid(domGridData as DomGridJson);
export const hasDomGrid = DOM_GRID !== null;

// Height in metres at a cell (row/col), 0 outside the grid
function cellH(g: DomGrid, row: number, col: number): number {
  if (row < 0 || row >= g.rows || col < 0 || col >= g.cols) return 0;
  return g.heights[row * g.cols + col] / 10;
}

function toCell(g: DomGrid, lat: number, lng: number): { row: number; col: number } {
  const col = Math.round(((lng - g.minLng) / (g.maxLng - g.minLng)) * (g.cols - 1));
  const row = Math.round(((g.maxLat - lat) / (g.maxLat - g.minLat)) * (g.rows - 1));
  return { row, col };
}

export function elevationAt(lat: number, lng: number): number {
  if (!DOM_GRID) return 0;
  const { row, col } = toCell(DOM_GRID, lat, lng);
  return cellH(DOM_GRID, row, col);
}

// Max horizon angle (degrees) seen from a cell toward a bearing (deg from
// north, clockwise), sampled out to maxDist metres. This is what decides both
// "is the sun blocked" and "is there something upwind giving shelter".
function horizonAngleCells(g: DomGrid, row: number, col: number, bearingDeg: number, maxDist: number): number {
  const h0 = cellH(g, row, col) + 1.6; // eye height
  const rad = (bearingDeg * Math.PI) / 180;
  // Grid steps per cell toward the bearing (row axis points south)
  const dCol = Math.sin(rad);
  const dRow = -Math.cos(rad);
  let best = -90;
  const steps = Math.floor(maxDist / g.cellM);
  for (let s = 1; s <= steps; s++) {
    const h = cellH(g, Math.round(row + dRow * s), Math.round(col + dCol * s));
    if (h <= 0) continue;
    const ang = (Math.atan2(h - h0, s * g.cellM) * 180) / Math.PI;
    if (ang > best) best = ang;
  }
  return best;
}

export function horizonAngleAt(lat: number, lng: number, bearingDeg: number, maxDist = 400): number {
  if (!DOM_GRID) return -90;
  const { row, col } = toCell(DOM_GRID, lat, lng);
  return horizonAngleCells(DOM_GRID, row, col, bearingDeg, maxDist);
}

// ── Solar position (NOAA approximation — good to ~0.1°) ─────────────────────

export interface SunPos {
  azimuth: number;   // degrees from north, clockwise
  elevation: number; // degrees above the horizon
}

export function sunPosition(date: Date, lat: number, lng: number): SunPos {
  const rad = Math.PI / 180;
  const ms = date.getTime();
  const jd = ms / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;

  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C =
    Math.sin(M * rad) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * M * rad) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * M * rad) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);

  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);

  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) / rad;

  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime =
    (4 / rad) *
    (y * Math.sin(2 * L0 * rad) -
      2 * e * Math.sin(M * rad) +
      4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
      0.5 * y * y * Math.sin(4 * L0 * rad) -
      1.25 * e * e * Math.sin(2 * M * rad)); // minutes

  const utcMins = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarMins = (utcMins + eqTime + 4 * lng + 1440) % 1440;
  let hourAngle = trueSolarMins / 4 - 180;
  if (hourAngle < -180) hourAngle += 360;

  const cosZen =
    Math.sin(lat * rad) * Math.sin(decl * rad) +
    Math.cos(lat * rad) * Math.cos(decl * rad) * Math.cos(hourAngle * rad);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZen))) / rad;
  const elevation = 90 - zen;

  let az =
    Math.acos(
      Math.min(1, Math.max(-1,
        (Math.sin(lat * rad) * Math.cos(zen * rad) - Math.sin(decl * rad)) /
        (Math.cos(lat * rad) * Math.sin(zen * rad))
      ))
    ) / rad;
  az = hourAngle > 0 ? (az + 180) % 360 : (540 - az) % 360;

  return { azimuth: az, elevation };
}

// ── Per-point scores ──────────────────────────────────────────────────────────

// True when the sun is up and no surface (trees/buildings/hills) blocks it
export function sunlitAt(lat: number, lng: number, date: Date): boolean | null {
  if (!DOM_GRID) return null;
  const sun = sunPosition(date, lat, lng);
  if (sun.elevation <= 0) return false;
  return horizonAngleAt(lat, lng, sun.azimuth, 400) < sun.elevation;
}

// 0 = fully exposed, 1 = well sheltered from wind coming FROM windFromDeg.
// An upwind horizon of ~8° within 300 m reads as good lee.
export function shelterAt(lat: number, lng: number, windFromDeg: number): number | null {
  if (!DOM_GRID) return null;
  const ang = horizonAngleAt(lat, lng, windFromDeg, 300);
  return Math.min(1, Math.max(0, ang / 8));
}

// ── Heatmap overlays ──────────────────────────────────────────────────────────

export interface OverlayImage {
  dataUrl: string;
  bounds: [[number, number], [number, number]]; // [[s, w], [n, e]]
}

function makeCanvas(g: DomGrid): CanvasRenderingContext2D | null {
  const c = document.createElement('canvas');
  c.width = g.cols;
  c.height = g.rows;
  return c.getContext('2d');
}

// Wind speed -> colour + alpha, calm (faint green) to hurricane (strong magenta).
// 32.7 m/s = Beaufort 12 (orkan).
export const ORKAN_MS = 32.7;
export function windColor(speedMs: number): { r: number; g: number; b: number; alpha: number } {
  const t = Math.min(1, Math.max(0, speedMs / ORKAN_MS));
  const from = { r: 34, g: 197, b: 94 };    // calm: green
  const to = { r: 192, g: 38, b: 211 };     // orkan: magenta
  return {
    r: Math.round(from.r + t * (to.r - from.r)),
    g: Math.round(from.g + t * (to.g - from.g)),
    b: Math.round(from.b + t * (to.b - from.b)),
    alpha: 0.12 + t * 0.63, // vindstille: barely visible · orkan: strong
  };
}

// Current sun exposure: sunlit cells tinted sun-yellow, shaded cells tinted
// dark — both semi-transparent so the map stays visible underneath.
const SUNLIT = { r: 250, g: 191, b: 36 };
const SHADED = { r: 22, g: 26, b: 33 };
export function makeSunShadowOverlay(date: Date): OverlayImage | null {
  if (!DOM_GRID) return null;
  const g = DOM_GRID;
  const midLat = (g.minLat + g.maxLat) / 2;
  const midLng = (g.minLng + g.maxLng) / 2;
  const sun = sunPosition(date, midLat, midLng);
  if (sun.elevation <= 0) return null; // night: the whole island is shaded, nothing to draw
  const ctx = makeCanvas(g);
  if (!ctx) return null;
  const img = ctx.createImageData(g.cols, g.rows);
  const d = img.data;
  const ALPHA = 130;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const blocked = horizonAngleCells(g, r, c, sun.azimuth, 400) >= sun.elevation;
      const col = blocked ? SHADED : SUNLIT;
      const i = (r * g.cols + c) * 4;
      d[i] = col.r; d[i + 1] = col.g; d[i + 2] = col.b; d[i + 3] = ALPHA;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    dataUrl: ctx.canvas.toDataURL(),
    bounds: [[g.minLat, g.minLng], [g.maxLat, g.maxLng]],
  };
}

// Wind exposure for the current wind: sheltered (le) cells get no colour at
// all; exposed cells are tinted by current wind strength (calm green to
// orkan magenta), fading in as exposure increases.
const LEE_CUTOFF = 0.45; // shelter score above this counts as "in lee" -> no colour
export function makeShelterOverlay(windFromDeg: number, windSpeed: number): OverlayImage | null {
  if (!DOM_GRID) return null;
  const g = DOM_GRID;
  const ctx = makeCanvas(g);
  if (!ctx) return null;
  const img = ctx.createImageData(g.cols, g.rows);
  const d = img.data;
  const col = windColor(windSpeed);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const ang = horizonAngleCells(g, r, c, windFromDeg, 300);
      const s = Math.min(1, Math.max(0, ang / 8)); // 0 exposed, 1 well sheltered
      if (s >= LEE_CUTOFF) continue; // in lee: leave transparent
      const exposure = 1 - s / LEE_CUTOFF; // 0 at the lee boundary, 1 fully exposed
      const i = (r * g.cols + c) * 4;
      d[i] = col.r; d[i + 1] = col.g; d[i + 2] = col.b;
      d[i + 3] = Math.round(255 * col.alpha * exposure);
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    dataUrl: ctx.canvas.toDataURL(),
    bounds: [[g.minLat, g.minLng], [g.maxLat, g.maxLng]],
  };
}

// ── MET weather + sea temperature ────────────────────────────────────────────
// api.met.no is free and CORS-enabled; the browser's User-Agent identifies us.

const ISLAND = { lat: 59.155, lng: 10.351 };

export interface WeatherNow {
  windFromDeg: number;
  windSpeed: number;      // m/s
  airTemp: number;        // °C
  cloudFraction: number;  // 0–100
}

interface CacheEntry<T> { at: number; val: T }

function readCache<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const e = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - e.at > ttlMs) return null;
    return e.val;
  } catch { return null; }
}

function writeCache<T>(key: string, val: T): void {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), val })); } catch { /* ignore */ }
}

export async function fetchWeatherNow(): Promise<WeatherNow | null> {
  const cached = readCache<WeatherNow>('vl-weather-v1', 30 * 60 * 1000);
  if (cached) return cached;
  try {
    const res = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${ISLAND.lat}&lon=${ISLAND.lng}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const det = data?.properties?.timeseries?.[0]?.data?.instant?.details;
    if (!det) return null;
    const w: WeatherNow = {
      windFromDeg: det.wind_from_direction ?? 0,
      windSpeed: det.wind_speed ?? 0,
      airTemp: det.air_temperature ?? 0,
      cloudFraction: det.cloud_area_fraction ?? 0,
    };
    writeCache('vl-weather-v1', w);
    return w;
  } catch {
    return null;
  }
}

export async function fetchSeaTemp(): Promise<number | null> {
  const cached = readCache<number>('vl-seatemp-v1', 60 * 60 * 1000);
  if (cached !== null) return cached;
  try {
    const res = await fetch(
      `https://api.met.no/weatherapi/oceanforecast/2.0/complete?lat=${ISLAND.lat}&lon=${ISLAND.lng}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const t = data?.properties?.timeseries?.[0]?.data?.instant?.details?.sea_water_temperature;
    if (typeof t !== 'number') return null;
    writeCache('vl-seatemp-v1', t);
    return t;
  } catch {
    return null;
  }
}

// Compass direction label for a "wind from" bearing
export function windDirLabel(deg: number, lang: 'no' | 'en'): string {
  const no = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
  const en = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return (lang === 'no' ? no : en)[i];
}
