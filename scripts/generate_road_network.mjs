/**
 * Run with: node scripts/generate_road_network.mjs
 *
 * Fetches every walkable way (path/track/footway/service/unclassified/
 * residential/steps) from OpenStreetMap within Veierland's bounding box, then
 * keeps only the ones that actually lie on the island — the raw Overpass
 * query also returns roads on the Nøtterøy/Tjøme mainland side, since ways
 * that merely cross the bbox are returned in full (Veierland has no bridge,
 * only the ferry, so anything with a majority of points outside the island
 * boundary is mainland and gets dropped).
 *
 * Builds a routing graph — nodes at shared coordinates (intersections and
 * endpoints), edges with real great-circle segment lengths — and writes
 * src/data/road_network.json for use by the walking-time/route calculator.
 */
import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '../src/data/road_network.json');

const boundary = JSON.parse(
  readFileSync(join(__dir, '../src/data/veierland_boundary.json'), 'utf8')
);
const poly = boundary.coordinates[0]; // [lng, lat] pairs

function pointInPolygon(lat, lng) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Bounding box padded a little around the island (same one used elsewhere,
// e.g. scripts/generate_dom_grid.py) — wide enough to catch every on-island
// way in one query.
const BBOX = '59.12,10.31,59.21,10.40';
const HIGHWAY_TYPES = 'path|track|footway|service|unclassified|residential|steps|tertiary';

function distanceM(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

async function fetchWays() {
  const query = `[out:json][timeout:30];way["highway"~"^(${HIGHWAY_TYPES})$"](${BBOX});out geom;`;
  const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'veierland-kart/1.0 (contact: aharvik@gmail.com)',
    },
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = await res.json();
  return data.elements ?? [];
}

// Coordinates are quantized to ~0.1 m so shared endpoints between adjacent
// OSM ways collapse onto the same graph node instead of staying disconnected.
function nodeKey(lat, lon) {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

// Path "feel", used to steer route suggestions toward quiet forest trails
// over gravel driveways over paved/village roads — 0 is the most trail-like.
const SURFACE_CLASS = {
  path: 0, footway: 0, steps: 0,
  track: 1,
  service: 2,
  unclassified: 3, residential: 3,
  tertiary: 4,
};

function buildGraph(ways) {
  const nodeIndex = new Map(); // key -> index into `nodes`
  const nodes = [];
  const edges = []; // [fromIdx, toIdx, meters, surfaceClass]

  function getNode(lat, lon) {
    const key = nodeKey(lat, lon);
    let idx = nodeIndex.get(key);
    if (idx === undefined) {
      idx = nodes.length;
      nodes.push([lat, lon]);
      nodeIndex.set(key, idx);
    }
    return idx;
  }

  for (const w of ways) {
    const cls = SURFACE_CLASS[w.tags?.highway] ?? 3;
    const g = w.geometry ?? [];
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i];
      if (!a || !b) continue;
      const d = distanceM(a, b);
      if (d <= 0) continue;
      const ai = getNode(a.lat, a.lon);
      const bi = getNode(b.lat, b.lon);
      edges.push([ai, bi, Math.round(d * 10) / 10, cls]);
    }
  }
  return { nodes, edges };
}

async function main() {
  console.log('Fetching OSM ways for Veierland...');
  const ways = await fetchWays();
  console.log(`  ${ways.length} ways returned from Overpass (bbox includes some mainland)`);

  const onIsland = ways.filter(w => {
    const g = w.geometry ?? [];
    if (!g.length) return false;
    const inside = g.filter(p => p && pointInPolygon(p.lat, p.lon)).length;
    return inside / g.length > 0.5;
  });
  console.log(`  ${onIsland.length} ways kept after dropping mainland-majority ways`);

  const { nodes, edges } = buildGraph(onIsland);
  const totalKm = edges.reduce((s, e) => s + e[2], 0) / 1000;
  console.log(`  graph: ${nodes.length} nodes, ${edges.length} edges, ${totalKm.toFixed(1)} km total`);

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'OpenStreetMap contributors (Overpass API)',
    nodes,  // [lat, lng][]
    edges,  // [fromNodeIdx, toNodeIdx, meters, surfaceClass][] — surfaceClass: 0=path/footway/steps, 1=track, 2=service, 3=unclassified/residential, 4=tertiary
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${OUT} (${(JSON.stringify(out).length / 1024).toFixed(0)} kB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
