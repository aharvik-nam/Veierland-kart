// Server-side half of the openrouteservice (https://github.com/GIScience/openrouteservice)
// walking-route lookup. Shared by the Vercel function (api/route.ts) and the
// Express dev/self-host server (server.ts), so the API key never reaches the
// browser. Files prefixed with "_" are not turned into Vercel functions.
//
// Env:
//   ORS_API_KEY   key from https://openrouteservice.org/dev — not needed for a
//                 self-hosted instance without auth
//   ORS_BASE_URL  defaults to the public API; point it at a self-hosted
//                 instance instead, e.g. http://localhost:8080/ors

const DEFAULT_BASE_URL = 'https://api.openrouteservice.org';

export const ORS_PROFILES = ['foot-walking', 'foot-hiking', 'cycling-regular'] as const;
export type OrsProfile = typeof ORS_PROFILES[number];

// Only routes on and around Veierland are proxied (same bbox as
// scripts/generate_road_network.mjs) — keeps the key from being usable as a
// general-purpose routing service by anyone who finds the endpoint.
const BBOX = { south: 59.12, west: 10.31, north: 59.21, east: 10.40 };

export interface OrsRouteResult {
  distanceM: number;
  durationS: number;
  path: [number, number][]; // [lat, lng]
}

export class OrsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function parseLatLng(s: string | null | undefined): [number, number] | null {
  if (!s) return null;
  const parts = s.split(',').map(Number);
  if (parts.length !== 2 || parts.some(n => !Number.isFinite(n))) return null;
  const [lat, lng] = parts;
  if (lat < BBOX.south || lat > BBOX.north || lng < BBOX.west || lng > BBOX.east) return null;
  return [lat, lng];
}

// Validates the query (?from=lat,lng&to=lat,lng&profile=foot-walking), asks
// openrouteservice for the route, and returns it in the app's [lat, lng]
// convention. Throws OrsError with an HTTP status on any failure.
export async function orsRoute(query: { from?: string | null; to?: string | null; profile?: string | null }): Promise<OrsRouteResult> {
  const from = parseLatLng(query.from);
  const to = parseLatLng(query.to);
  if (!from || !to) throw new OrsError(400, 'from/to must be lat,lng on Veierland');
  const profile = (query.profile || 'foot-walking') as OrsProfile;
  if (!ORS_PROFILES.includes(profile)) throw new OrsError(400, 'unknown profile');

  const baseUrl = (process.env.ORS_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey && baseUrl === DEFAULT_BASE_URL) throw new OrsError(503, 'ORS_API_KEY not configured');

  const res = await fetch(`${baseUrl}/v2/directions/${profile}/geojson`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/geo+json, application/json',
      ...(apiKey ? { Authorization: apiKey } : {}),
    },
    body: JSON.stringify({ coordinates: [[from[1], from[0]], [to[1], to[0]]] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new OrsError(502, `openrouteservice ${res.status}`);
  const data = await res.json() as {
    features?: { geometry: { coordinates: [number, number][] }; properties: { summary: { distance?: number; duration?: number } } }[];
  };
  const f = data.features?.[0];
  if (!f) throw new OrsError(502, 'no route');
  return {
    distanceM: f.properties.summary.distance ?? 0,
    durationS: f.properties.summary.duration ?? 0,
    path: f.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
  };
}
