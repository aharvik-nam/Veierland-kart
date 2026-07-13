// Sun/shadow and wind-shelter conditions for the island, plus current
// weather (MET locationforecast) and sea temperature (MET oceanforecast).
//
// Terrain input is produced by scripts/generate_dom_grid.py from hoydedata.no
// data: a DOM (surface model incl. trees/buildings) used for what blocks sun
// and wind, plus — when available — a DTM ground channel (b64Ground) used for
// where the observer actually stands. Without the ground channel the observer
// would be placed on top of the tree canopy and forests would read as sunny.
// Until the script has been run the bundled dom_grid.json is `{"empty": true}`
// and the terrain-based features stay hidden — same pattern as the geology
// layers.

import domGridData from '../data/dom_grid.json';

// ── DOM grid ──────────────────────────────────────────────────────────────────

interface DomGridJson {
  empty: boolean;
  minLng?: number; minLat?: number; maxLng?: number; maxLat?: number;
  cols?: number; rows?: number; cellM?: number;
  b64?: string;
  b64Ground?: string;
}

export interface DomGrid {
  minLng: number; minLat: number; maxLng: number; maxLat: number;
  cols: number; rows: number; cellM: number;
  heights: Uint16Array; // DOM surface, decimetres, row-major from the north-west corner
  ground: Uint16Array;  // DTM ground level; equals heights when no DTM was supplied
}

function b64ToU16(b64: string): Uint16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint16Array(bytes.buffer);
}

function decodeGrid(raw: DomGridJson): DomGrid | null {
  if (raw.empty || !raw.b64 || !raw.cols || !raw.rows) return null;
  const heights = b64ToU16(raw.b64);
  return {
    minLng: raw.minLng!, minLat: raw.minLat!, maxLng: raw.maxLng!, maxLat: raw.maxLat!,
    cols: raw.cols, rows: raw.rows, cellM: raw.cellM ?? 15,
    heights,
    ground: raw.b64Ground ? b64ToU16(raw.b64Ground) : heights,
  };
}

export const DOM_GRID: DomGrid | null = decodeGrid(domGridData as DomGridJson);
export const hasDomGrid = DOM_GRID !== null;

// Surface height (DOM) in metres at a cell (row/col), 0 outside the grid
function cellH(g: DomGrid, row: number, col: number): number {
  if (row < 0 || row >= g.rows || col < 0 || col >= g.cols) return 0;
  return g.heights[row * g.cols + col] / 10;
}

// Ground height (DTM) in metres at a cell — where a person actually stands
function cellGround(g: DomGrid, row: number, col: number): number {
  if (row < 0 || row >= g.rows || col < 0 || col >= g.cols) return 0;
  return g.ground[row * g.cols + col] / 10;
}

// Canopy: vegetation/building height above the ground at a cell. More than a
// couple of metres means you are standing inside forest or under a roof.
const CANOPY_M = 2.5;
function underCanopy(g: DomGrid, row: number, col: number): boolean {
  return cellH(g, row, col) - cellGround(g, row, col) > CANOPY_M;
}

// The source DTM/DOM rasters have no explicit sea mask — nodata over open
// water gets zeroed at generation time (see generate_dom_grid.py), so a cell
// at ~sea level reads identically to a real 0 m clearing. In practice actual
// dry land on the island rises above this within a cell or two of the
// shoreline, so a small threshold is a good enough proxy for "this is the
// fjord, not a place to stand" — without it, the conditions overlays tint
// the water the same as land, which reads as if the whole fjord were solid
// ground.
const WATER_LEVEL_M = 0.3;
function isWaterCell(g: DomGrid, row: number, col: number): boolean {
  return cellGround(g, row, col) <= WATER_LEVEL_M;
}

function toCell(g: DomGrid, lat: number, lng: number): { row: number; col: number } {
  const col = Math.round(((lng - g.minLng) / (g.maxLng - g.minLng)) * (g.cols - 1));
  const row = Math.round(((g.maxLat - lat) / (g.maxLat - g.minLat)) * (g.rows - 1));
  return { row, col };
}

// Inverse of toCell — used to name the winning cell in the "best spots"
// overlay (nearest real place to point at, not just a bare temperature).
function cellToLatLng(g: DomGrid, row: number, col: number): [number, number] {
  const lng = g.minLng + (col / (g.cols - 1)) * (g.maxLng - g.minLng);
  const lat = g.maxLat - (row / (g.rows - 1)) * (g.maxLat - g.minLat);
  return [lat, lng];
}

export function elevationAt(lat: number, lng: number): number {
  if (!DOM_GRID) return 0;
  const { row, col } = toCell(DOM_GRID, lat, lng);
  return cellGround(DOM_GRID, row, col);
}

// Max horizon angle (degrees) seen from a cell toward a bearing (deg from
// north, clockwise), sampled out to maxDist metres. This is what decides both
// "is the sun blocked" and "is there something upwind giving shelter".
// The observer's eyes are at GROUND level + 1.6 m (people stand on the DTM);
// the obstacles are the DOM surface (hills, trees, buildings).
function horizonAngleCells(g: DomGrid, row: number, col: number, bearingDeg: number, maxDist: number): number {
  const h0 = cellGround(g, row, col) + 1.6; // eye height above ground
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

// True when the sun is up and no surface (trees/buildings/hills) blocks it.
// Standing inside forest (canopy overhead) counts as shade regardless of the
// horizon toward the sun.
export function sunlitAt(lat: number, lng: number, date: Date): boolean | null {
  if (!DOM_GRID) return null;
  const sun = sunPosition(date, lat, lng);
  if (sun.elevation <= 0) return false;
  const { row, col } = toCell(DOM_GRID, lat, lng);
  if (underCanopy(DOM_GRID, row, col)) return false;
  return horizonAngleCells(DOM_GRID, row, col, sun.azimuth, 400) < sun.elevation;
}

// 0 = fully exposed, 1 = well sheltered from wind coming FROM windFromDeg.
// An upwind horizon of ~8° within 300 m reads as good lee; standing inside
// forest is good lee by itself.
export function shelterAt(lat: number, lng: number, windFromDeg: number): number | null {
  if (!DOM_GRID) return null;
  const { row, col } = toCell(DOM_GRID, lat, lng);
  if (underCanopy(DOM_GRID, row, col)) return 1;
  const ang = horizonAngleCells(DOM_GRID, row, col, windFromDeg, 300);
  return Math.min(1, Math.max(0, ang / 8));
}

// ── Heatmap overlays ──────────────────────────────────────────────────────────

export interface OverlayImage {
  dataUrl: string;
  bounds: [[number, number], [number, number]]; // [[s, w], [n, e]]
  tempRange?: [number, number]; // effective-temp overlay only: the °C range the colour scale was stretched over
}

function makeCanvas(g: DomGrid): CanvasRenderingContext2D | null {
  const c = document.createElement('canvas');
  c.width = g.cols;
  c.height = g.rows;
  return c.getContext('2d');
}

// The grid is coarse (15 m cells), so drawing it 1:1 and letting Leaflet
// stretch the <img> over the map looks blocky. Upscale with bilinear
// smoothing baked into the PNG itself so cell edges blend softly no matter
// how the browser handles the final image scaling.
function toSmoothDataUrl(src: HTMLCanvasElement, scale = 4): string {
  const out = document.createElement('canvas');
  out.width = src.width * scale;
  out.height = src.height * scale;
  const octx = out.getContext('2d');
  if (!octx) return src.toDataURL();
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(src, 0, 0, out.width, out.height);
  return out.toDataURL();
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
    alpha: 0.22 + t * 0.68, // vindstille: faint · orkan: strong
  };
}

// Individual 15 m cells flip between forest/clearing at high frequency, so a
// hard per-cell decision reads as speckled noise even once the final image
// is smoothly upscaled. Averaging each cell with its neighbours first turns
// that into soft, natural-looking patches.
function boxBlur(vals: Float32Array, cols: number, rows: number, radius: number): Float32Array {
  const out = new Float32Array(vals.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0, n = 0;
      for (let dr = -radius; dr <= radius; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        const base = rr * cols;
        for (let dc = -radius; dc <= radius; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          sum += vals[base + cc];
          n++;
        }
      }
      out[r * cols + c] = sum / n;
    }
  }
  return out;
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

  const shade = new Float32Array(g.cols * g.rows);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const blocked = underCanopy(g, r, c)
        || horizonAngleCells(g, r, c, sun.azimuth, 400) >= sun.elevation;
      shade[r * g.cols + c] = blocked ? 1 : 0;
    }
  }
  const smooth = boxBlur(shade, g.cols, g.rows, 1);

  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const t = smooth[r * g.cols + c];
      const i = (r * g.cols + c) * 4;
      d[i] = Math.round(SUNLIT.r + t * (SHADED.r - SUNLIT.r));
      d[i + 1] = Math.round(SUNLIT.g + t * (SHADED.g - SUNLIT.g));
      d[i + 2] = Math.round(SUNLIT.b + t * (SHADED.b - SUNLIT.b));
      // Fjord water reads identically to flat land in the raw height grid
      // (see isWaterCell) — without this the sea gets tinted the same as
      // the island, which reads as solid ground.
      d[i + 3] = isWaterCell(g, r, c) ? 0 : ALPHA;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    dataUrl: toSmoothDataUrl(ctx.canvas),
    bounds: [[g.minLat, g.minLng], [g.maxLat, g.maxLng]],
  };
}

// Per-cell wind exposure (0 = fully sheltered/lee, 1 = fully exposed) for a
// given "wind from" bearing. Shared by the wind-shelter overlay and the
// effective-temperature overlay, so both agree on where the wind actually
// reaches: inside forest canopy is always sheltered, and anywhere with high
// ground/trees upwind gets progressively more lee.
const LEE_CUTOFF = 0.45; // shelter score above this counts as "in lee" -> no exposure
function windExposureField(g: DomGrid, windFromDeg: number): Float32Array {
  const exposure = new Float32Array(g.cols * g.rows);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (underCanopy(g, r, c)) continue; // inside forest: good lee, stays 0
      const ang = horizonAngleCells(g, r, c, windFromDeg, 300);
      const s = Math.min(1, Math.max(0, ang / 8)); // 0 exposed, 1 well sheltered
      if (s < LEE_CUTOFF) exposure[r * g.cols + c] = 1 - s / LEE_CUTOFF;
    }
  }
  return boxBlur(exposure, g.cols, g.rows, 1);
}

// Wind exposure for the current wind: sheltered (le) cells get no colour at
// all; exposed cells are tinted by current wind strength (calm green to
// orkan magenta), fading in as exposure increases.
export function makeShelterOverlay(windFromDeg: number, windSpeed: number): OverlayImage | null {
  if (!DOM_GRID) return null;
  const g = DOM_GRID;
  const ctx = makeCanvas(g);
  if (!ctx) return null;
  const img = ctx.createImageData(g.cols, g.rows);
  const d = img.data;
  const col = windColor(windSpeed);

  const smooth = windExposureField(g, windFromDeg);

  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const e = smooth[r * g.cols + c];
      if (e <= 0.02 || isWaterCell(g, r, c)) continue; // invisible, or fjord water (see isWaterCell)
      const i = (r * g.cols + c) * 4;
      d[i] = col.r; d[i + 1] = col.g; d[i + 2] = col.b;
      d[i + 3] = Math.round(255 * col.alpha * e);
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    dataUrl: toSmoothDataUrl(ctx.canvas),
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
  humidity: number;       // relative humidity, 0–100
  symbolCode: string;     // MET Yr symbol code, e.g. "partlycloudy_day" — see weatherIconKind()
}

// A single point in the hourly forecast — same fields as WeatherNow plus the
// timestamp it applies to, so the Forhold panel can let people scrub forward
// through the day instead of only ever seeing "right now".
export interface WeatherPoint extends WeatherNow {
  time: string; // ISO timestamp
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

// Next ~24 hours, one point per hour, so the Forhold panel can show what
// sun/wind/temperature will look like later today — not just right now.
export async function fetchWeatherSeries(): Promise<WeatherPoint[] | null> {
  const cached = readCache<WeatherPoint[]>('vl-weather-series-v1', 30 * 60 * 1000);
  if (cached) return cached;
  try {
    const res = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${ISLAND.lat}&lon=${ISLAND.lng}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const series = data?.properties?.timeseries;
    if (!Array.isArray(series) || !series.length) return null;
    const points: WeatherPoint[] = series.slice(0, 25).map((entry: any) => {
      const det = entry?.data?.instant?.details ?? {};
      return {
        time: entry.time,
        windFromDeg: det.wind_from_direction ?? 0,
        windSpeed: det.wind_speed ?? 0,
        airTemp: det.air_temperature ?? 0,
        cloudFraction: det.cloud_area_fraction ?? 0,
        humidity: det.relative_humidity ?? 50,
        symbolCode: entry?.data?.next_1_hours?.summary?.symbol_code
          ?? entry?.data?.next_6_hours?.summary?.symbol_code ?? 'cloudy',
      };
    });
    writeCache('vl-weather-series-v1', points);
    return points;
  } catch {
    return null;
  }
}

export async function fetchWeatherNow(): Promise<WeatherNow | null> {
  const cached = readCache<WeatherNow>('vl-weather-v3', 30 * 60 * 1000);
  if (cached) return cached;
  const series = await fetchWeatherSeries();
  const first = series?.[0];
  if (!first) return null;
  const w: WeatherNow = {
    windFromDeg: first.windFromDeg, windSpeed: first.windSpeed, airTemp: first.airTemp,
    cloudFraction: first.cloudFraction, humidity: first.humidity, symbolCode: first.symbolCode,
  };
  writeCache('vl-weather-v3', w);
  return w;
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

// Windchill at a given air temp and wind speed.
// Formula: W = 13.12 + 0.6215·T − 11.37·V^0.16 + 0.3965·T·V^0.16
// Valid for T ≤ 10°C and V ≥ 0.5 m/s; outside range return air temperature.
function windChill(airTempC: number, windSpeedMs: number): number {
  if (airTempC > 10 || windSpeedMs < 0.5) return airTempC;
  return 13.12 + 0.6215 * airTempC - 11.37 * Math.pow(windSpeedMs, 0.16) + 0.3965 * airTempC * Math.pow(windSpeedMs, 0.16);
}

// Heat index (Rothfusz regression) at a given air temp and relative humidity.
// Full formula requires T ≥ 27°C and RH ≥ 40%; below that a simpler linear
// approximation is used, which itself is only meaningful once it settles
// above 27°C (otherwise plain air temperature is close enough).
function heatIndex(airTempC: number, rh: number): number {
  const T = airTempC;
  if (T >= 27 && rh >= 40) {
    const hi = -8.78469475556 + 1.61139411 * T + 2.33854883889 * rh - 0.14611605 * T * rh
      - 0.012308094 * T * T - 0.016424828 * rh * rh + 0.002211732 * T * T * rh
      + 0.00072546 * T * rh * rh - 0.000003582 * T * T * rh * rh;
    return hi <= 20 ? T : hi;
  }
  let hi = 0.5 * (T + 16.0 + (T - 20.0) * 1.2 + rh * 0.094);
  if (hi < 27) hi = (T + hi) / 2;
  return hi;
}

// Effective ("feels like") temperature: windchill below 10°C, heat index
// above 27°C, and a light empirical wind-cooling term in between where
// neither the windchill nor heat-index formula applies.
export function effectiveTemp(airTempC: number, windSpeedMs: number, humidity: number): number {
  if (airTempC <= 10) return windChill(airTempC, windSpeedMs);
  if (airTempC >= 27) return heatIndex(airTempC, humidity);
  return airTempC - 0.1 * windSpeedMs;
}

// Temperature -> colour, cold (blue) to hot (red), stretched over [minT, maxT].
export function effectiveTempColor(tempC: number, minT = -20, maxT = 40): { r: number; g: number; b: number; alpha: number } {
  const t = Math.min(1, Math.max(0, (tempC - minT) / (maxT - minT)));

  // Blue at cold, yellow at moderate, red at hot
  let r, g, b;
  if (t < 0.5) {
    // Blue (#0066cc) to yellow (#ffd700)
    const s = t * 2; // 0 to 1
    r = Math.round(0 + s * 255);
    g = Math.round(102 + s * 85);
    b = Math.round(204 - s * 204);
  } else {
    // Yellow (#ffd700) to red (#ff3300)
    const s = (t - 0.5) * 2; // 0 to 1
    r = Math.round(255);
    g = Math.round(215 - s * 215);
    b = Math.round(0 + s * 0);
  }

  return { r, g, b, alpha: 0.65 };
}

// Effective temperature heatmap: windchill/wind-cooling-adjusted temperature
// across the island. Reuses the same per-cell wind exposure as the shelter
// overlay (windExposureField) so sheltered spots (in the lee of hills/forest)
// feel closer to the still-air temperature while exposed spots feel the full
// effect of the current wind.
// The wind's effect on effective temperature is often just 1-3°C — invisible
// if plotted on a fixed -20..40°C scale. The colour scale is instead
// stretched to whatever range is actually present on the island right now
// (with a floor so a dead-calm day doesn't blow up a near-zero spread into
// visual noise), the same way you'd autoscale a chart's y-axis.
const MIN_SPAN = 2; // °C — minimum colour-scale width, even if the real spread is smaller
export function makeEffectiveTempOverlay(airTempC: number, windSpeedMs: number, windFromDeg: number, humidity: number): OverlayImage | null {
  if (!DOM_GRID) return null;
  const g = DOM_GRID;
  const ctx = makeCanvas(g);
  if (!ctx) return null;
  const img = ctx.createImageData(g.cols, g.rows);
  const d = img.data;

  // Wind matters for the windchill branch (≤10°C) and the empirical
  // wind-cooling branch (10–27°C); the heat-index branch (≥27°C) is uniform
  // across the island since the Rothfusz formula doesn't take wind into account.
  const exposure = airTempC < 27 ? windExposureField(g, windFromDeg) : null;

  const rawTemp = new Float32Array(g.cols * g.rows);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const localWind = exposure ? windSpeedMs * exposure[r * g.cols + c] : windSpeedMs;
      rawTemp[r * g.cols + c] = effectiveTemp(airTempC, localWind, humidity);
    }
  }
  const smooth = boxBlur(rawTemp, g.cols, g.rows, 1);

  // Water cells are excluded from the range too — otherwise a fjord that
  // happens to compute a different "feels like" value than the land could
  // skew the colour scale's stretch (see isWaterCell).
  let minT = Infinity, maxT = -Infinity;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      if (isWaterCell(g, r, c)) continue;
      const t = smooth[r * g.cols + c];
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
  }
  if (maxT - minT < MIN_SPAN) {
    const mid = (minT + maxT) / 2;
    minT = mid - MIN_SPAN / 2;
    maxT = mid + MIN_SPAN / 2;
  }

  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = (r * g.cols + c) * 4;
      if (isWaterCell(g, r, c)) { d[i + 3] = 0; continue; }
      const col = effectiveTempColor(smooth[r * g.cols + c], minT, maxT);
      d[i] = col.r;
      d[i + 1] = col.g;
      d[i + 2] = col.b;
      d[i + 3] = Math.round(255 * col.alpha);
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    dataUrl: toSmoothDataUrl(ctx.canvas),
    bounds: [[g.minLat, g.minLng], [g.maxLat, g.maxLng]],
    tempRange: [minT, maxT],
  };
}

// ── "Best spots" combined overlay ────────────────────────────────────────────
// One layer answering the question the three expert layers (sun, wind,
// feels-like) only answer fragments of: where is it actually pleasant to BE
// right now? Per cell: perceived temperature = effective temp with the local
// (lee-adjusted) wind, plus a solar-radiation bonus when the cell is sunlit
// (scaled by cloud cover and sun height). Cells scoring near a comfort ideal
// get a soft golden glow; everything else stays untinted so the map keeps
// its map-first calm. Same physical model as the beach ranking, generalized
// to the whole island.

export interface BestSpotsInfo {
  perceivedC: number; // perceived temp at the best-scoring cell
  sunlit: boolean;
  sheltered: boolean;
  lat: number; // best-scoring cell's location, for naming the nearest place
  lng: number;
}

// Standing in full sun reads several degrees warmer than shade — up to this
// many °C at high sun and clear sky, scaled down by cloud cover / low sun.
const SUN_GAIN_MAX_C = 7;
const COMFORT_IDEAL_C = 22.5;
const COMFORT_SIGMA_C = 6;
const GLOW = { r: 246, g: 178, b: 60 };

export function makeBestSpotsOverlay(
  w: { airTemp: number; windSpeed: number; windFromDeg: number; humidity: number; cloudFraction: number },
  date: Date,
): (OverlayImage & { best: BestSpotsInfo }) | null {
  if (!DOM_GRID) return null;
  const g = DOM_GRID;
  const ctx = makeCanvas(g);
  if (!ctx) return null;

  const midLat = (g.minLat + g.maxLat) / 2;
  const midLng = (g.minLng + g.maxLng) / 2;
  const sun = sunPosition(date, midLat, midLng);
  const sunUp = sun.elevation > 0;
  // Cloud cover and low sun both cut the radiant warmth of "being in the sun"
  const sunGain = sunUp
    ? SUN_GAIN_MAX_C * (1 - w.cloudFraction / 100) * Math.min(1, sun.elevation / 40)
    : 0;

  const exposure = windExposureField(g, w.windFromDeg);

  const score = new Float32Array(g.cols * g.rows);
  const sunlitCells = new Uint8Array(g.cols * g.rows);
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      if (isWaterCell(g, r, c)) continue; // stays 0 → never glows
      const sunlit = sunUp && !underCanopy(g, r, c)
        && horizonAngleCells(g, r, c, sun.azimuth, 400) < sun.elevation;
      if (sunlit) sunlitCells[i] = 1;
      const localWind = w.windSpeed * exposure[i];
      const perceived = effectiveTemp(w.airTemp, localWind, w.humidity) + (sunlit ? sunGain : 0);
      const d = perceived - COMFORT_IDEAL_C;
      score[i] = Math.exp(-(d * d) / (2 * COMFORT_SIGMA_C * COMFORT_SIGMA_C));
    }
  }
  const smooth = boxBlur(score, g.cols, g.rows, 1);

  // Find the best cell (for the legend's "føles som X°, sol, god le" readout)
  // and the score range. The glow threshold is relative to the day's best —
  // "best spots" is inherently a relative question; even on a raw day the
  // most sheltered sunny corner is worth pointing at.
  let maxScore = 0, bestIdx = -1;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      if (isWaterCell(g, r, c)) continue;
      if (smooth[i] > maxScore) { maxScore = smooth[i]; bestIdx = i; }
    }
  }
  if (bestIdx < 0 || maxScore <= 0) return null;

  const img = ctx.createImageData(g.cols, g.rows);
  const d = img.data;
  const THRESHOLD = 0.82; // fraction of maxScore below which a cell stays untinted
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      const rel = smooth[i] / maxScore;
      if (rel < THRESHOLD || isWaterCell(g, r, c)) continue;
      const t = (rel - THRESHOLD) / (1 - THRESHOLD); // 0..1 within the glow band
      const px = i * 4;
      d[px] = GLOW.r; d[px + 1] = GLOW.g; d[px + 2] = GLOW.b;
      d[px + 3] = Math.round(150 * t);
    }
  }
  ctx.putImageData(img, 0, 0);

  const bestSunlit = sunlitCells[bestIdx] === 1;
  const bestPerceived = effectiveTemp(w.airTemp, w.windSpeed * exposure[bestIdx], w.humidity)
    + (bestSunlit ? sunGain : 0);
  const [bestLat, bestLng] = cellToLatLng(g, Math.floor(bestIdx / g.cols), bestIdx % g.cols);
  return {
    dataUrl: toSmoothDataUrl(ctx.canvas),
    bounds: [[g.minLat, g.minLng], [g.maxLat, g.maxLng]],
    best: {
      perceivedC: bestPerceived,
      sunlit: bestSunlit,
      sheltered: exposure[bestIdx] < 0.4,
      lat: bestLat, lng: bestLng,
    },
  };
}

// Buckets MET Yr's ~50 symbol codes (e.g. "partlycloudy_day",
// "lightrainshowers_night") into the handful of icon kinds the top bar
// actually draws — day/night variants and shower/continuous variants of
// the same precipitation type collapse to one icon.
export type WeatherIconKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'sleet' | 'snow' | 'thunder';
export function weatherIconKind(symbolCode: string): WeatherIconKind {
  const s = symbolCode.toLowerCase();
  if (s.includes('thunder')) return 'thunder';
  if (s.includes('sleet')) return 'sleet';
  if (s.includes('snow')) return 'snow';
  if (s.includes('rain') || s.includes('drizzle')) return 'rain';
  if (s.includes('fog')) return 'fog';
  if (s.startsWith('cloudy')) return 'cloudy';
  if (s.startsWith('partlycloudy') || s.startsWith('fair')) return 'partly';
  return 'clear';
}

// Compass direction label for a "wind from" bearing
export function windDirLabel(deg: number, lang: 'no' | 'en'): string {
  const no = ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'];
  const en = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return (lang === 'no' ? no : en)[i];
}

// ── Beach ranking, for the dock's "Bade" list and daily recommendation ────

export interface BeachLike { id: string; navn: string; coordinates: [number, number] }
export interface BeachConditionScore {
  poi: BeachLike;
  sunlit: boolean | null;
  shelter: number | null; // 0–1
  score: number; // higher = better; sun + shelter, sea temp is island-wide so doesn't discriminate between beaches
}

// Ranks beaches by current sun + wind shelter at each one specifically (sea
// temperature is fetched once for the whole island, so it doesn't help rank
// individual beaches against each other — sun and lee are what actually
// differ from one beach to the next). Generalizes the single-beach sun/
// shelter lookup already used on the POI detail card (sunlitAt/shelterAt)
// across every beach at once.
export function rankBeaches(beaches: BeachLike[], windFromDeg: number | null, date: Date): BeachConditionScore[] {
  return beaches
    .map(poi => {
      const [lat, lng] = poi.coordinates;
      const sunlit = sunlitAt(lat, lng, date);
      const shelter = windFromDeg === null ? null : shelterAt(lat, lng, windFromDeg);
      const score = (sunlit ? 1 : 0) + (shelter ?? 0);
      return { poi, sunlit, shelter, score };
    })
    .sort((a, b) => b.score - a.score);
}

// Sunset time by stepping sunPosition() forward until elevation crosses
// zero — sunPosition is a cheap trig calc (not grid-based), so this is fine
// to run interactively. Returns null if the sun is already down or DOM data
// (needed for horizon shadowing elsewhere, not here) isn't the blocker —
// this only needs lat/lng, not the terrain grid.
export function sunsetTime(lat: number, lng: number, from: Date): Date | null {
  if (sunPosition(from, lat, lng).elevation <= 0) return null;
  const stepMs = 5 * 60 * 1000;
  let t = from.getTime();
  for (let i = 0; i < 12 * 12; i++) { // up to 12h ahead, 5-min steps
    t += stepMs;
    if (sunPosition(new Date(t), lat, lng).elevation <= 0) return new Date(t);
  }
  return null;
}

// The dock's default-state "what's good today" line, built from whichever
// beach currently ranks best. Returns null when there's nothing to say
// (no DOM grid, or no beaches at all).
export function dailyRecommendation(ranked: BeachConditionScore[], seaTemp: number | null, lang: 'no' | 'en'): string | null {
  const best = ranked[0];
  if (!best || best.sunlit === null) return null;
  const [lat, lng] = best.poi.coordinates;
  const sunset = best.sunlit ? sunsetTime(lat, lng, new Date()) : null;
  const parts: string[] = [];
  if (seaTemp !== null) parts.push(`${Math.round(seaTemp)}°${lang === 'no' ? ' i vannet' : ' in the water'}`);
  if (best.sunlit && sunset) {
    const t = `${String(sunset.getHours()).padStart(2, '0')}:${String(sunset.getMinutes()).padStart(2, '0')}`;
    parts.push(lang === 'no' ? `sol til ${t}` : `sun until ${t}`);
  } else {
    parts.push(best.sunlit ? (lang === 'no' ? 'sol nå' : 'sun now') : (lang === 'no' ? 'skyet nå' : 'cloudy now'));
  }
  if ((best.shelter ?? 0) > 0.5) parts.push(lang === 'no' ? 'god le' : 'good shelter');
  const lede = lang === 'no' ? 'Fin badedag' : 'Good day for a swim';
  const at = lang === 'no' ? 'på' : 'at';
  return `${lede}: ${parts.join(', ')} ${at} ${best.poi.navn}`;
}
