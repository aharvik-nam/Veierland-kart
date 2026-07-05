// Ferry departures for M/F Jutøya (Tenvik–Veierland) via Entur's open
// journey-planner API. Nothing is hardcoded beyond the quay coordinates:
// stop-place IDs are discovered from coordinates and cached, and the
// timetable itself lives with VKT/Entur — season changes arrive by
// themselves. On any failure the UI falls back to linking the dedicated
// ferry app at https://jutoya.veierland.org/.

const ENTUR_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const CLIENT_NAME = 'veierland-kartapp';

export type FerryQuayKey = 'vestgarden' | 'tangen' | 'engo' | 'tenvik';

export interface FerryQuay {
  key: FerryQuayKey;
  name: string;
  lat: number;
  lng: number;
  onIsland: boolean;
}

// Coordinates from the Veierland-Ferge app (authoritative for the quays)
export const FERRY_QUAYS: FerryQuay[] = [
  { key: 'vestgarden', name: 'Vestgården', lat: 59.16496191981857, lng: 10.343429236051696, onIsland: true },
  { key: 'tangen',     name: 'Tangen',     lat: 59.15344925258157, lng: 10.33775055215706,  onIsland: true },
  { key: 'engo',       name: 'Engø',       lat: 59.147476312611,   lng: 10.31832985729631,  onIsland: true },
  { key: 'tenvik',     name: 'Tenvik',     lat: 59.1744256064253,  lng: 10.364987204418728, onIsland: false },
];

export interface FerryDeparture {
  quay: FerryQuayKey;
  quayName: string;
  onIsland: boolean;
  time: string;        // ISO timestamp (expected, i.e. realtime when available)
  aimedTime: string;   // ISO timestamp from the timetable
  realtime: boolean;
  destination: string; // e.g. "Tenvik"
}

const ID_CACHE_KEY = 'vl-ferry-nsr-v1';

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENTUR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Entur HTTP ${res.status}`);
  const data = await res.json();
  if (data.errors?.length) throw new Error(data.errors[0]?.message ?? 'Entur GraphQL error');
  return data.data as T;
}

// Find the NSR stop-place ID closest to a quay's coordinates
async function discoverStopPlaceId(q: FerryQuay): Promise<string | null> {
  interface NearestResp {
    nearest: { edges: { node: { distance: number; place: { id?: string; name?: string } | null } }[] } | null;
  }
  const d = await gql<NearestResp>(
    `query($lat: Float!, $lng: Float!) {
      nearest(latitude: $lat, longitude: $lng, maximumDistance: 600, maximumResults: 5,
              filterByPlaceTypes: [stopPlace]) {
        edges { node { distance place { ... on StopPlace { id name } } } }
      }
    }`,
    { lat: q.lat, lng: q.lng }
  );
  const edges = d.nearest?.edges ?? [];
  const hit = edges.find(e => e.node.place?.id);
  return hit?.node.place?.id ?? null;
}

async function getStopPlaceIds(): Promise<Partial<Record<FerryQuayKey, string>>> {
  try {
    const cached = localStorage.getItem(ID_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<Record<FerryQuayKey, string>>;
      if (Object.keys(parsed).length > 0) return parsed;
    }
  } catch { /* fall through to discovery */ }

  const ids: Partial<Record<FerryQuayKey, string>> = {};
  await Promise.all(FERRY_QUAYS.map(async q => {
    try {
      const id = await discoverStopPlaceId(q);
      if (id) ids[q.key] = id;
    } catch { /* quay missing from Entur — skip it */ }
  }));
  if (Object.keys(ids).length > 0) {
    try { localStorage.setItem(ID_CACHE_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
  }
  return ids;
}

interface CallsResp {
  stopPlace: {
    estimatedCalls: {
      expectedDepartureTime: string;
      aimedDepartureTime: string;
      realtime: boolean;
      destinationDisplay: { frontText: string } | null;
      serviceJourney: { line: { transportMode: string } | null } | null;
    }[];
  } | null;
}

async function fetchQuayDepartures(q: FerryQuay, id: string, n: number): Promise<FerryDeparture[]> {
  const d = await gql<CallsResp>(
    `query($id: String!, $n: Int!) {
      stopPlace(id: $id) {
        estimatedCalls(numberOfDepartures: $n, timeRange: 86400) {
          expectedDepartureTime aimedDepartureTime realtime
          destinationDisplay { frontText }
          serviceJourney { line { transportMode } }
        }
      }
    }`,
    { id, n }
  );
  return (d.stopPlace?.estimatedCalls ?? [])
    // The quays may serve other modes in theory — only keep boat departures
    .filter(c => c.serviceJourney?.line?.transportMode === 'water')
    .map(c => ({
      quay: q.key,
      quayName: q.name,
      onIsland: q.onIsland,
      time: c.expectedDepartureTime,
      aimedTime: c.aimedDepartureTime,
      realtime: c.realtime,
      destination: c.destinationDisplay?.frontText ?? '',
    }));
}

// All upcoming ferry departures (both directions), sorted by time.
// Returns null when Entur is unreachable or has no data for the route,
// so the caller can fall back to linking the ferry app.
export async function fetchFerryDepartures(): Promise<FerryDeparture[] | null> {
  try {
    const ids = await getStopPlaceIds();
    const quays = FERRY_QUAYS.filter(q => ids[q.key]);
    if (quays.length === 0) return null;
    const per = await Promise.all(
      quays.map(q => fetchQuayDepartures(q, ids[q.key]!, 6).catch(() => [] as FerryDeparture[]))
    );
    const all = per.flat().sort((a, b) => a.time.localeCompare(b.time));
    if (all.length === 0) {
      // Stop places found but no boat departures — cached IDs may be stale/wrong
      try { localStorage.removeItem(ID_CACHE_KEY); } catch { /* ignore */ }
      return null;
    }
    return all;
  } catch {
    return null;
  }
}

export function fmtDepTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function minsUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}
