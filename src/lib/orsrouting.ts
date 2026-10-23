// Walking routes from openrouteservice (https://github.com/GIScience/openrouteservice),
// fetched through the app's own /api/route proxy (api/_ors.ts) so the API key
// stays server-side. The bundled network in routing.ts remains the instant,
// offline fallback: callers draw that first and swap in the ORS route once it
// arrives, and keep using it whenever ORS is unconfigured or unreachable.

import type { WalkRoute } from './routing';

// Cache key rounds to ~50 m so a live GPS position drifting a few metres
// doesn't trigger a new request on every update.
function key(from: [number, number], to: [number, number]): string {
  const r = (n: number) => (Math.round(n * 2000) / 2000).toFixed(4);
  return `${r(from[0])},${r(from[1])}|${to[0].toFixed(5)},${to[1].toFixed(5)}`;
}

const cache = new Map<string, WalkRoute | null>();
const inflight = new Map<string, Promise<WalkRoute | null>>();
// Set once the proxy says ORS isn't available here (no key configured, or no
// /api/route at all, e.g. `vite preview`) — stops further requests this session.
let unavailable = false;

// Synchronous lookup of an already-fetched route; undefined if not fetched yet.
export function cachedOrsWalkRoute(from: [number, number], to: [number, number]): WalkRoute | null | undefined {
  return cache.get(key(from, to));
}

export function fetchOrsWalkRoute(from: [number, number], to: [number, number]): Promise<WalkRoute | null> {
  const k = key(from, to);
  if (cache.has(k)) return Promise.resolve(cache.get(k)!);
  if (unavailable) return Promise.resolve(null);
  const pending = inflight.get(k);
  if (pending) return pending;

  const qs = new URLSearchParams({
    from: `${from[0]},${from[1]}`,
    to: `${to[0]},${to[1]}`,
    profile: 'foot-walking',
  });
  const p = fetch(`/api/route?${qs}`)
    .then(async res => {
      if (res.status === 503 || res.status === 404) { unavailable = true; return null; }
      // 400 = outside Veierland (e.g. tracking from the mainland) — a real
      // "no route" answer, cached like a success so it isn't retried.
      if (res.status === 400) { cache.set(k, null); return null; }
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const data = await res.json() as { distanceM: number; path: [number, number][] };
      if (!data.path?.length) return null;
      const route: WalkRoute = { distanceM: data.distanceM, path: [from, ...data.path, to] };
      cache.set(k, route);
      return route;
    })
    .catch(() => null)
    .finally(() => { inflight.delete(k); });
  inflight.set(k, p);
  return p;
}
