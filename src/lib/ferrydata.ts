// Ferry departures for M/F Jutøya (Tenvik–Veierland).
//
// Entur does not cover this ferry (only the buses that connect to it), so the
// timetable is read straight from the dedicated ferry app's repository:
//   https://github.com/aharvik-nam/Veierland-Ferge  →  src/data.ts
// raw.githubusercontent.com serves it with CORS `*`, so the browser can fetch
// it directly. That repo stays the single source of truth — update the
// timetable there and this app follows along. Results are cached in
// localStorage so the map still shows times offline/on flaky ferry wifi.

const DATA_URL = 'https://raw.githubusercontent.com/aharvik-nam/Veierland-Ferge/main/src/data.ts';
const CACHE_KEY = 'vl-ferry-tables-v1';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export type FerryQuayKey = 'vestgarden' | 'tangen' | 'engo' | 'tenvik';

export interface FerryQuay {
  key: FerryQuayKey;
  name: string;
  lat: number;
  lng: number;
  onIsland: boolean;
}

// Coordinates from the Veierland-Ferge app (authoritative for the quays).
// Island quays are Vestgården and Tangen; Tenvik (Nøtterøy) and Engø
// (Sandefjord side) are on the mainland.
export const FERRY_QUAYS: FerryQuay[] = [
  { key: 'vestgarden', name: 'Vestgården', lat: 59.16496191981857, lng: 10.343429236051696, onIsland: true },
  { key: 'tangen',     name: 'Tangen',     lat: 59.15344925258157, lng: 10.33775055215706,  onIsland: true },
  { key: 'engo',       name: 'Engø',       lat: 59.147476312611,   lng: 10.31832985729631,  onIsland: false },
  { key: 'tenvik',     name: 'Tenvik',     lat: 59.1744256064253,  lng: 10.364987204418728, onIsland: false },
];

interface FerryLoop {
  id: string;
  tenvikUt: string | null;
  vestgardenUt: string | null;
  engoUt: string | null;
  tangenUt: string | null;
  tangenInn: string | null;
  engoInn: string | null;
  vestgardenInn: string | null;
  tenvikInn: string | null;
  [key: string]: string | null;
}

interface FerryTables {
  monFriLoops: FerryLoop[];
  satLoops: FerryLoop[];
  sunLoops: FerryLoop[];
  summerMonFriLoops: FerryLoop[];
  summerSatLoops: FerryLoop[];
  summerSunLoops: FerryLoop[];
}

const TABLE_NAMES: (keyof FerryTables)[] = [
  'monFriLoops', 'satLoops', 'sunLoops',
  'summerMonFriLoops', 'summerSatLoops', 'summerSunLoops',
];

export interface FerryDeparture {
  quay: FerryQuayKey;
  quayName: string;
  onIsland: boolean;
  time: Date;          // in the Oslo-shifted clock (compare with osloNow())
  destination: string;
}

export interface FerryBoard {
  deps: FerryDeparture[]; // upcoming, sorted by time
  tomorrow: boolean;      // true when today's sailings are done and this is tomorrow's list
}

// ── Timetable parsing ─────────────────────────────────────────────────────────

// Extract `export const <name> ... = [ ... ];` array literals from the TS
// source and parse them as JSON (quote the keys, strip trailing commas).
function parseTables(src: string): FerryTables | null {
  const out: Partial<FerryTables> = {};
  for (const name of TABLE_NAMES) {
    const declAt = src.indexOf(`export const ${name}`);
    if (declAt < 0) return null;
    // Scan from the `=` so the `[` in a `FerryLoop[]` type annotation isn't matched
    const eqAt = src.indexOf('=', declAt);
    if (eqAt < 0) return null;
    const start = src.indexOf('[', eqAt);
    if (start < 0) return null;
    let depth = 0, end = -1;
    for (let i = start; i < src.length; i++) {
      if (src[i] === '[') depth++;
      else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return null;
    const literal = src.slice(start, end + 1)
      .replace(/([A-Za-z_]\w*)\s*:/g, '"$1":')   // quote keys (times are "HH:MM" strings, unaffected)
      .replace(/,\s*([\]}])/g, '$1');            // strip trailing commas
    try {
      const arr = JSON.parse(literal) as FerryLoop[];
      if (!Array.isArray(arr) || arr.length === 0) return null; // empty table = parse went wrong
      out[name] = arr;
    } catch {
      return null;
    }
  }
  return out as FerryTables;
}

async function loadTables(): Promise<FerryTables | null> {
  // Fresh-enough cache?
  let cached: { at: number; tables: FerryTables } | null = null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch { /* ignore */ }
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.tables;

  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tables = parseTables(await res.text());
    if (!tables) throw new Error('parse failed');
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), tables })); } catch { /* ignore */ }
    return tables;
  } catch {
    // Network/parse failure: fall back to a stale cache if we have one
    return cached?.tables ?? null;
  }
}

// ── Day selection (mirrors the ferry app's ferryData.ts) ─────────────────────

export function osloNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
}

// Summer timetable applies 22 June – 16 August
function isSummerSeason(d: Date): boolean {
  const m = d.getMonth() + 1, day = d.getDate();
  if (m === 7) return true;
  if (m === 6) return day >= 22;
  if (m === 8) return day <= 16;
  return false;
}

function loopsFor(tables: FerryTables, d: Date): FerryLoop[] {
  const summer = isSummerSeason(d);
  const wd = d.getDay();
  if (wd === 6) return summer ? tables.summerSatLoops : tables.satLoops;
  if (wd === 0) return summer ? tables.summerSunLoops : tables.sunLoops;
  return summer ? tables.summerMonFriLoops : tables.monFriLoops;
}

// ── Departure boards ──────────────────────────────────────────────────────────

const ISLAND_IN_FIELDS: { field: string; quay: FerryQuayKey; name: string }[] = [
  { field: 'vestgardenInn', quay: 'vestgarden', name: 'Vestgården' },
  { field: 'tangenInn',     quay: 'tangen',     name: 'Tangen' },
];

// Engø is only served 1 April – 28 September (single sailings outside the
// season are on-request by phone — the full ferry app covers the rules)
function engoInService(d: Date): boolean {
  const m = d.getMonth() + 1, day = d.getDate();
  if (m >= 4 && m <= 8) return true;
  if (m === 9) return day <= 28;
  return false;
}

function timeOn(base: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

function departuresForDate(tables: FerryTables, date: Date): FerryDeparture[] {
  const deps: FerryDeparture[] = [];
  for (const loop of loopsFor(tables, date)) {
    // Island → Tenvik ("Inn" legs)
    for (const f of ISLAND_IN_FIELDS) {
      const t = loop[f.field];
      if (t) deps.push({ quay: f.quay, quayName: f.name, onIsland: true, time: timeOn(date, t), destination: 'Tenvik' });
    }
    // Tenvik → island ("Ut" leg); destination = the loop's first island stop
    if (loop.tenvikUt) {
      const dest = loop.vestgardenUt ? 'Vestgården' : loop.tangenUt ? 'Tangen' : 'Veierland';
      deps.push({ quay: 'tenvik', quayName: 'Tenvik', onIsland: false, time: timeOn(date, loop.tenvikUt), destination: dest });
    }
    // Engø (Sandefjord side) → island: the outbound leg continues to Tangen,
    // the return leg calls at Vestgården on its way to Tenvik
    if (engoInService(date)) {
      if (loop.engoUt) {
        deps.push({ quay: 'engo', quayName: 'Engø', onIsland: false, time: timeOn(date, loop.engoUt), destination: 'Tangen' });
      }
      if (loop.engoInn) {
        deps.push({ quay: 'engo', quayName: 'Engø', onIsland: false, time: timeOn(date, loop.engoInn), destination: 'Vestgården' });
      }
    }
  }
  return deps.sort((a, b) => a.time.getTime() - b.time.getTime());
}

// Upcoming departures: the rest of today, or tomorrow's board once today is done.
// Returns null only when the timetable can't be loaded at all.
export async function fetchFerryDepartures(): Promise<FerryBoard | null> {
  const tables = await loadTables();
  if (!tables) return null;
  const now = osloNow();
  const today = departuresForDate(tables, now).filter(d => d.time.getTime() >= now.getTime() - 60_000);
  if (today.length > 0) return { deps: today, tomorrow: false };
  const tmrw = new Date(now);
  tmrw.setDate(tmrw.getDate() + 1);
  tmrw.setHours(0, 0, 0, 0);
  return { deps: departuresForDate(tables, tmrw), tomorrow: true };
}

export function fmtDepTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function minsUntil(d: Date): number {
  return Math.round((d.getTime() - osloNow().getTime()) / 60000);
}
