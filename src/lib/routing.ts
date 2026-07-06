// Real walking distance along the island's actual path/road network, instead
// of straight-line distance. The network is generated once offline (see
// scripts/generate_road_network.mjs, pulled from OpenStreetMap) and bundled
// as a graph: nodes are path/road coordinates (mostly at intersections),
// edges are the great-circle length of each OSM way segment.

import roadNetworkData from '../data/road_network.json';

interface RoadNetworkJson {
  nodes: [number, number][];       // [lat, lng]
  edges: [number, number, number][]; // [fromNodeIdx, toNodeIdx, meters]
}

const NETWORK = roadNetworkData as RoadNetworkJson;
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
