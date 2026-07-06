// Real walking distance along the island's actual path/road network, instead
// of straight-line distance. The network is generated once offline (see
// scripts/generate_road_network.mjs, pulled from OpenStreetMap) and bundled
// as a graph: nodes are path/road coordinates (mostly at intersections),
// edges are the great-circle length of each OSM way segment.

import roadNetworkData from '../data/road_network.json';

interface RoadNetworkJson {
  nodes: [number, number][];       // [lat, lng]
  edges: [number, number, number, number?][]; // [fromNodeIdx, toNodeIdx, meters, surfaceClass?]
}

const NETWORK = roadNetworkData as unknown as RoadNetworkJson;
export const hasRoadNetwork = NETWORK.nodes.length > 0;

// A point further than this from the nearest known path is treated as
// "off the network" (e.g. a beach or lawn not traced in OSM) — routing
// falls back to the straight-line estimate rather than snapping it to a
// path that isn't really how you'd walk there.
const MAX_SNAP_M = 120;

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Adjacency list, built once and cached — the graph is static (bundled data).
let adjacency: { to: number; m: number }[][] | null = null;
function getAdjacency(): { to: number; m: number }[][] {
  if (adjacency) return adjacency;
  const adj: { to: number; m: number }[][] = Array.from({ length: NETWORK.nodes.length }, () => []);
  for (const [a, b, m] of NETWORK.edges) {
    adj[a].push({ to: b, m });
    adj[b].push({ to: a, m });
  }
  adjacency = adj;
  return adj;
}

function nearestNode(lat: number, lng: number): { idx: number; distM: number } | null {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < NETWORK.nodes.length; i++) {
    const [nlat, nlng] = NETWORK.nodes[i];
    const d = distanceM(lat, lng, nlat, nlng);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best < 0 ? null : { idx: best, distM: bestD };
}

// Plain-array Dijkstra — the graph has ~3k nodes, so an O(n^2) scan is
// instant and avoids pulling in a heap implementation for this one query.
// Tracks predecessors so the actual node sequence can be reconstructed, not
// just the total distance.
function shortestPath(fromIdx: number, toIdx: number): { m: number; nodeIdxs: number[] } | null {
  const adj = getAdjacency();
  const dist = new Float64Array(NETWORK.nodes.length).fill(Infinity);
  const prev = new Int32Array(NETWORK.nodes.length).fill(-1);
  const visited = new Uint8Array(NETWORK.nodes.length);
  dist[fromIdx] = 0;

  for (let iter = 0; iter < NETWORK.nodes.length; iter++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < dist.length; i++) {
      if (!visited[i] && dist[i] < best) { best = dist[i]; u = i; }
    }
    if (u < 0 || u === toIdx) break;
    visited[u] = 1;
    for (const { to, m } of adj[u]) {
      const nd = dist[u] + m;
      if (nd < dist[to]) { dist[to] = nd; prev[to] = u; }
    }
  }
  if (dist[toIdx] === Infinity) return null;

  const nodeIdxs: number[] = [];
  for (let n = toIdx; n !== -1; n = prev[n]) nodeIdxs.push(n);
  nodeIdxs.reverse();
  return { m: dist[toIdx], nodeIdxs };
}

// Walking distance in metres from `from` to `to` along the actual path
// network, including the short off-network legs to/from the nearest path.
// Returns null when the network can't be used (missing data, or either
// point too far from any known path) — callers should fall back to a
// straight-line estimate in that case.
export function networkWalkDistanceM(from: [number, number], to: [number, number]): number | null {
  return networkWalkRoute(from, to)?.distanceM ?? null;
}

export interface WalkRoute {
  distanceM: number;
  path: [number, number][]; // from -> ...network nodes... -> to
}

// Same as networkWalkDistanceM but also returns the actual route geometry,
// for drawing the walking route on the map.
export function networkWalkRoute(from: [number, number], to: [number, number]): WalkRoute | null {
  if (!hasRoadNetwork) return null;
  const a = nearestNode(from[0], from[1]);
  const b = nearestNode(to[0], to[1]);
  if (!a || !b || a.distM > MAX_SNAP_M || b.distM > MAX_SNAP_M) return null;
  const result = shortestPath(a.idx, b.idx);
  if (!result) return null;
  const networkPath = result.nodeIdxs.map(i => NETWORK.nodes[i]);
  return {
    distanceM: a.distM + result.m + b.distM,
    path: [from, ...networkPath, to],
  };
}

// ── Route builder (admin) ──────────────────────────────────────────────────
// Everything below mirrors scripts/generate_running_routes.mjs so the admin
// route builder computes exactly what a batch regeneration would produce —
// surface-preferring, no-backtrack multi-leg routing, elevation-derived
// difficulty, and per-activity time estimates.

export const NETWORK_NODES: [number, number][] = NETWORK.nodes;
export const NETWORK_EDGES: [number, number, number, number?][] = NETWORK.edges;

export interface NamedWaypoint { key: string; name: string; lat: number; lng: number }

// Same named anchors as scripts/generate_running_routes.mjs's `P` — kept in
// sync manually since that script runs under plain Node and can't import
// this bundled TS module. Update both places if a point moves.
export const NAMED_WAYPOINTS: NamedWaypoint[] = [
  { key: 'Vestgarden', name: 'Vestgården fergeleie', lat: 59.1650133, lng: 10.3434834 },
  { key: 'Kirken', name: 'Veierland kirke', lat: 59.16259772755725, lng: 10.34618810591324 },
  { key: 'Dagros', name: 'Dagros kafé', lat: 59.15292, lng: 10.35122 },
  { key: 'TangenFerge', name: 'Tangen fergekai', lat: 59.1535242, lng: 10.3380491 },
  { key: 'Brentas', name: 'Brentås (48m)', lat: 59.155731, lng: 10.361225 },
  { key: 'Hvervodden', name: 'Hvervodden', lat: 59.1454859, lng: 10.3514448 },
  { key: 'Kjolholmen', name: 'Kjølholmen', lat: 59.164907, lng: 10.3601789 },
  { key: 'Kongshavn', name: 'Kongshavn badeplass', lat: 59.14567, lng: 10.33569 },
  { key: 'Alby', name: 'Alby gård', lat: 59.163406, lng: 10.352505 },
  { key: 'VillaVeierland', name: 'Villa Veierland', lat: 59.155874, lng: 10.3530783 },
];

// surfaceClass: 0=path/footway/steps, 1=track, 2=service, 3=unclassified/residential, 4=tertiary
const SURFACE_WEIGHT: Record<number, number> = { 0: 1.0, 1: 1.05, 2: 1.15, 3: 1.3, 4: 1.6 };
const BACKTRACK_PENALTY = 25;
const BIKE_TRAIL_TOLERANCE_M = 20;

let weightedAdjacency: { to: number; m: number; cls: number; i: number }[][] | null = null;
function getWeightedAdjacency() {
  if (weightedAdjacency) return weightedAdjacency;
  const adj: { to: number; m: number; cls: number; i: number }[][] = Array.from({ length: NETWORK.nodes.length }, () => []);
  NETWORK.edges.forEach(([a, b, m, cls], i) => {
    adj[a].push({ to: b, m, cls: cls ?? 3, i });
    adj[b].push({ to: a, m, cls: cls ?? 3, i });
  });
  weightedAdjacency = adj;
  return adj;
}

// Dijkstra weighted by surface preference + a penalty on edges in `usedEdges`
// (mutated in place so callers can grow it leg by leg across a whole route).
function weightedShortestPath(fromIdx: number, toIdx: number, usedEdges: Set<number>) {
  const adj = getWeightedAdjacency();
  const dist = new Float64Array(NETWORK.nodes.length).fill(Infinity);
  const realM = new Float64Array(NETWORK.nodes.length).fill(Infinity);
  const prev = new Int32Array(NETWORK.nodes.length).fill(-1);
  const prevEdge = new Int32Array(NETWORK.nodes.length).fill(-1);
  const visited = new Uint8Array(NETWORK.nodes.length);
  dist[fromIdx] = 0; realM[fromIdx] = 0;

  for (let iter = 0; iter < NETWORK.nodes.length; iter++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < dist.length; i++) if (!visited[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0 || u === toIdx) break;
    visited[u] = 1;
    for (const { to, m, cls, i } of adj[u]) {
      const penalty = usedEdges.has(i) ? BACKTRACK_PENALTY : 1;
      const cost = m * SURFACE_WEIGHT[cls] * penalty;
      const nd = dist[u] + cost;
      if (nd < dist[to]) { dist[to] = nd; realM[to] = realM[u] + m; prev[to] = u; prevEdge[to] = i; }
    }
  }
  if (dist[toIdx] === Infinity) return null;
  const nodeIdxs: number[] = [], edgeIdxs: number[] = [];
  for (let n = toIdx; n !== -1; n = prev[n]) {
    nodeIdxs.push(n);
    if (prevEdge[n] !== -1) edgeIdxs.push(prevEdge[n]);
  }
  nodeIdxs.reverse();
  return { realM: realM[toIdx], nodeIdxs, edgeIdxs };
}

export interface BuiltRoute {
  path: [number, number][];
  totalM: number;
  reusedM: number;
  trailM: number;
}

// Builds one continuous path through a sequence of waypoints (a loop if the
// first and last coincide, otherwise one-way), preferring forest paths over
// gravel over village roads, and heavily penalizing reuse of an edge already
// walked earlier in the route so outbound/return legs diverge wherever the
// network offers a choice. Throws if any leg is unreachable.
export function buildWeightedRoute(waypoints: [number, number][]): BuiltRoute {
  const usedEdges = new Set<number>();
  const edgeUseCount = new Map<number, number>();
  let fullPath: [number, number][] = [];
  let totalM = 0, reusedM = 0, trailM = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i], to = waypoints[i + 1];
    const a = nearestNode(from[0], from[1]);
    const b = nearestNode(to[0], to[1]);
    if (!a || !b) throw new Error('road network unavailable');
    const r = weightedShortestPath(a.idx, b.idx, usedEdges);
    if (!r) throw new Error(`unreachable: leg ${i + 1}`);
    let legReusedM = 0, legTrailM = 0;
    for (const e of r.edgeIdxs) {
      usedEdges.add(e);
      edgeUseCount.set(e, (edgeUseCount.get(e) ?? 0) + 1);
      if (edgeUseCount.get(e)! > 1) legReusedM += NETWORK.edges[e][2];
      if ((NETWORK.edges[e][3] ?? 3) === 0) legTrailM += NETWORK.edges[e][2];
    }
    const legPath: [number, number][] = [from, ...r.nodeIdxs.map(idx => NETWORK.nodes[idx]), to];
    totalM += a.distM + r.realM + b.distM;
    reusedM += legReusedM;
    trailM += legTrailM;
    fullPath = fullPath.concat(i === 0 ? legPath : legPath.slice(1));
  }
  return { path: fullPath, totalM, reusedM, trailM };
}

export function fmtKm(m: number): string {
  return (m / 1000).toFixed(1).replace('.', ',') + ' km';
}
export function fmtRouteTime(m: number, minPerKm: number): string {
  const mins = Math.round((m / 1000) * minPerKm);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), rem = mins % 60;
  return rem === 0 ? `${h} t` : `${h} t ${rem} min`;
}
// Combines distance and climb-per-km into a rough difficulty label — a
// short flat loop is "Lett" even if a longer one covers more elevation.
export function routeDifficulty(totalM: number, ascentM: number): string {
  const km = totalM / 1000;
  const climbPerKm = ascentM / km;
  if (km >= 8 || climbPerKm >= 25) return 'Krevende';
  if (km >= 5 || climbPerKm >= 12) return 'Middels';
  return 'Lett';
}
export interface RouteMode { mode: 'gaa' | 'lop' | 'sykkel'; tid: string }
export function routeActivityModes(totalM: number, trailM: number): RouteMode[] {
  const modes: RouteMode[] = [
    { mode: 'gaa', tid: fmtRouteTime(totalM, 12) },
    { mode: 'lop', tid: fmtRouteTime(totalM, 6.5) },
  ];
  if (trailM <= BIKE_TRAIL_TOLERANCE_M) modes.push({ mode: 'sykkel', tid: fmtRouteTime(totalM, 4) });
  return modes;
}

// Elevation profile resampled to `numPoints` evenly-spaced-by-distance
// samples — [metresFromStart, elevationM][] — plus ascent/descent/min/max.
// Takes an `elevationAt` lookup so this module doesn't need to know about
// the DTM grid format (see conditions.ts's elevationAt).
export interface ElevationProfile {
  ascentM: number; descentM: number; maxElevationM: number; minElevationM: number;
  series: [number, number][];
}
export function computeElevationProfile(
  path: [number, number][],
  elevationAt: (lat: number, lng: number) => number,
  numPoints = 60
): ElevationProfile {
  const dist = [0];
  const elev = [elevationAt(path[0][0], path[0][1])];
  let ascent = 0, descent = 0, maxEl = elev[0], minEl = elev[0];
  for (let i = 1; i < path.length; i++) {
    const [lat, lng] = path[i];
    const el = elevationAt(lat, lng);
    dist.push(dist[i - 1] + distanceM(path[i - 1][0], path[i - 1][1], lat, lng));
    elev.push(el);
    const d = el - elev[i - 1];
    if (d > 0) ascent += d; else descent -= d;
    if (el > maxEl) maxEl = el;
    if (el < minEl) minEl = el;
  }
  const total = dist[dist.length - 1];
  const series: [number, number][] = [];
  let j = 0;
  for (let k = 0; k < numPoints; k++) {
    const target = total * k / (numPoints - 1);
    while (j < dist.length - 2 && dist[j + 1] < target) j++;
    const d0 = dist[j], d1 = dist[j + 1], e0 = elev[j], e1 = elev[j + 1];
    const t = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
    series.push([Math.round(target), Math.round((e0 + t * (e1 - e0)) * 10) / 10]);
  }
  return {
    ascentM: Math.round(ascent), descentM: Math.round(descent),
    maxElevationM: Math.round(maxEl), minElevationM: Math.round(minEl),
    series,
  };
}
