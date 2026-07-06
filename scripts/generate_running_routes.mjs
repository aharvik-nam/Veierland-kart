/**
 * Run with: node scripts/generate_running_routes.mjs
 *
 * Builds named running/hiking loops on top of the road network
 * (src/data/road_network.json, see scripts/generate_road_network.mjs) and
 * writes them into src/data/turkart.geojson, replacing any previously
 * generated entries (tracked by GENERATED_IDS below) while leaving
 * hand-authored trails (like "Rundt øya") untouched.
 *
 * Two things beyond plain shortest-path routing:
 *  - Surface preference: path/footway/track edges cost less than gravel
 *    service roads, which cost less than village roads, so loops favour
 *    quiet forest trails over driveways where a choice exists.
 *  - No-backtrack: edges already used earlier in the same loop are made
 *    very expensive (not impossible — a genuine dead-end spur still needs
 *    an out-and-back), so the outbound and return legs take different
 *    paths wherever the network offers one.
 *
 * Elevation profiles come from the DTM ground channel already generated
 * for the sun/shadow layer (src/data/dom_grid.json, see
 * scripts/generate_dom_grid.py) — total ascent per loop feeds into the
 * difficulty rating alongside distance.
 */
import { writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const NETWORK = JSON.parse(readFileSync(join(__dir, '../src/data/road_network.json'), 'utf8'));
const DOM_GRID_RAW = JSON.parse(readFileSync(join(__dir, '../src/data/dom_grid.json'), 'utf8'));
const TURKART_PATH = join(__dir, '../src/data/turkart.geojson');

// ── DTM elevation (mirrors src/lib/conditions.ts's decode + lookup) ────────

function b64ToU16(b64) {
  const bin = Buffer.from(b64, 'base64');
  return new Uint16Array(bin.buffer, bin.byteOffset, bin.length / 2);
}
const domGround = DOM_GRID_RAW.b64Ground ? b64ToU16(DOM_GRID_RAW.b64Ground) : b64ToU16(DOM_GRID_RAW.b64);
function elevationAt(lat, lng) {
  const g = DOM_GRID_RAW;
  const col = Math.round(((lng - g.minLng) / (g.maxLng - g.minLng)) * (g.cols - 1));
  const row = Math.round(((g.maxLat - lat) / (g.maxLat - g.minLat)) * (g.rows - 1));
  if (row < 0 || row >= g.rows || col < 0 || col >= g.cols) return 0;
  return domGround[row * g.cols + col] / 10;
}

// Resamples the (irregularly spaced) per-point elevation into `numPoints`
// evenly-spaced-by-distance samples, for a compact elevation-profile chart —
// [metresFromStart, elevationM][].
function resampleByDistance(dist, elev, numPoints) {
  const total = dist[dist.length - 1];
  const series = [];
  let j = 0;
  for (let k = 0; k < numPoints; k++) {
    const target = total * k / (numPoints - 1);
    while (j < dist.length - 2 && dist[j + 1] < target) j++;
    const d0 = dist[j], d1 = dist[j + 1], e0 = elev[j], e1 = elev[j + 1];
    const t = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
    series.push([Math.round(target), Math.round((e0 + t * (e1 - e0)) * 10) / 10]);
  }
  return series;
}

function elevationProfile(path, numPoints = 60) {
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
  return {
    ascentM: Math.round(ascent),
    descentM: Math.round(descent),
    maxElevationM: Math.round(maxEl),
    minElevationM: Math.round(minEl),
    series: resampleByDistance(dist, elev, numPoints),
  };
}

// ── Distance + weighted (surface + no-backtrack) Dijkstra ─────────────────

function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// surfaceClass: 0=path/footway/steps, 1=track, 2=service, 3=unclassified/residential, 4=tertiary
const SURFACE_WEIGHT = { 0: 1.0, 1: 1.05, 2: 1.15, 3: 1.3, 4: 1.6 };
const BACKTRACK_PENALTY = 25;

const adj = Array.from({ length: NETWORK.nodes.length }, () => []);
NETWORK.edges.forEach(([a, b, m, cls], i) => {
  adj[a].push({ to: b, m, cls: cls ?? 3, i });
  adj[b].push({ to: a, m, cls: cls ?? 3, i });
});

function nearestNode(lat, lng) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < NETWORK.nodes.length; i++) {
    const [nlat, nlng] = NETWORK.nodes[i];
    const d = distanceM(lat, lng, nlat, nlng);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { idx: best, distM: bestD };
}

// Dijkstra weighted by surface preference + a penalty on edges in `usedEdges`.
// Returns both the "real" distance (sum of actual metres) and the edge/node
// path, so callers can grow `usedEdges` leg by leg across a whole loop.
function weightedShortestPath(fromIdx, toIdx, usedEdges) {
  const dist = new Float64Array(NETWORK.nodes.length).fill(Infinity); // weighted cost
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
  const nodeIdxs = [], edgeIdxs = [];
  for (let n = toIdx; n !== -1; n = prev[n]) {
    nodeIdxs.push(n);
    if (prevEdge[n] !== -1) edgeIdxs.push(prevEdge[n]);
  }
  nodeIdxs.reverse();
  return { realM: realM[toIdx], nodeIdxs, edgeIdxs };
}

function walkLeg(from, to, usedEdges, edgeUseCount) {
  const a = nearestNode(from[0], from[1]);
  const b = nearestNode(to[0], to[1]);
  const r = weightedShortestPath(a.idx, b.idx, usedEdges);
  if (!r) throw new Error(`unreachable: ${from} -> ${to}`);
  let legReusedM = 0, legTrailM = 0;
  for (const e of r.edgeIdxs) {
    usedEdges.add(e);
    edgeUseCount.set(e, (edgeUseCount.get(e) ?? 0) + 1);
    if (edgeUseCount.get(e) > 1) legReusedM += NETWORK.edges[e][2];
    if ((NETWORK.edges[e][3] ?? 3) === 0) legTrailM += NETWORK.edges[e][2]; // path/footway/steps
  }
  return { m: a.distM + r.realM + b.distM, path: [from, ...r.nodeIdxs.map(i => NETWORK.nodes[i]), to], legReusedM, legTrailM };
}

// Builds one continuous path from a sequence of named waypoints (a loop if
// the first and last are the same point, otherwise a one-way route),
// penalizing re-use of edges across the WHOLE route (not just within one
// leg) so it only backtracks where the network truly dead-ends.
function buildLoopPath(seq, points) {
  const usedEdges = new Set();
  const edgeUseCount = new Map();
  let fullPath = [];
  let totalM = 0;
  let reusedM = 0;
  let trailM = 0; // metres on narrow path/footway/steps — used to gate cycling
  for (let i = 0; i < seq.length - 1; i++) {
    const leg = walkLeg(points[seq[i]], points[seq[i + 1]], usedEdges, edgeUseCount);
    totalM += leg.m;
    reusedM += leg.legReusedM;
    trailM += leg.legTrailM;
    fullPath = fullPath.concat(i === 0 ? leg.path : leg.path.slice(1));
  }
  return { path: fullPath, totalM, reusedM, trailM };
}

// ── Activity modes (walking / running / cycling) ───────────────────────────

// Any meaningful stretch of narrow trail rules a route out for cycling —
// a route is either bike-friendly throughout or it isn't recommended for
// biking at all, rather than "mostly rideable with one unrideable bit".
const BIKE_TRAIL_TOLERANCE_M = 20;
function activityModes(totalM, trailM) {
  const modes = [
    { mode: 'gaa', tid: fmtTime(totalM, 12) },      // walking, ~5 km/h
    { mode: 'lop', tid: fmtTime(totalM, 6.5) },     // running, ~9 km/h
  ];
  if (trailM <= BIKE_TRAIL_TOLERANCE_M) {
    modes.push({ mode: 'sykkel', tid: fmtTime(totalM, 4) }); // cycling, ~15 km/h
  }
  return modes;
}

// ── Formatting + difficulty ────────────────────────────────────────────────

function fmtKm(m) { return (m / 1000).toFixed(1).replace('.', ',') + ' km'; }
function fmtTime(m, minPerKm) {
  const mins = Math.round((m / 1000) * minPerKm);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), rem = mins % 60;
  return rem === 0 ? `${h} t` : `${h} t ${rem} min`;
}
// Combines distance and climb-per-km into a rough difficulty label — a
// short flat loop is "Lett" even if a longer one covers more elevation.
function difficulty(totalM, ascentM) {
  const km = totalM / 1000;
  const climbPerKm = ascentM / km;
  if (km >= 8 || climbPerKm >= 25) return 'Krevende';
  if (km >= 5 || climbPerKm >= 12) return 'Middels';
  return 'Lett';
}

// ── Named anchor points (real coordinates from the app's POI/stedsnavn data
// and OpenStreetMap) ────────────────────────────────────────────────────────

const P = {
  Vestgarden: [59.1650133, 10.3434834],   // Vestgården fergeleie
  Kirken: [59.16259772755725, 10.34618810591324], // Veierland kirke
  Dagros: [59.15292, 10.35122],           // Dagros kafé
  TangenFerge: [59.1535242, 10.3380491],  // Tangen fergekai
  Brentas: [59.155731, 10.361225],        // Brentås viewpoint (48m)
  Hvervodden: [59.1454859, 10.3514448],   // Hvervodden, south tip
  Kjolholmen: [59.164907, 10.3601789],    // Kjølholmen / Kjølholmhåsen area
  Kongshavn: [59.14567, 10.33569],        // Kongshavn badeplass, SW coast
  Alby: [59.163406, 10.352505],           // Alby gård
  VillaVeierland: [59.155874, 10.3530783], // Villa Veierland (kafé)
};

const ROUTES = [
  {
    id: 't-kirkerunden',
    navn: 'Kirke- og bygderunden',
    en: 'Church and village loop',
    seq: ['Vestgarden', 'Kirken', 'Dagros', 'Vestgarden'],
    no: 'Kort løype fra Vestgården forbi Veierland kirke og Dagros og tilbake — populær rundtur blant øyas løpere og en fin kveldstur for de fleste.',
    enT: "A short loop from Vestgården past Veierland church and Dagros café and back — a popular route among the island's runners, and an easy evening walk for most.",
  },
  {
    id: 't-ostrunden',
    navn: 'Østrunden',
    en: 'East loop',
    seq: ['Dagros', 'Brentas', 'Hvervodden', 'Kongshavn', 'Dagros'],
    no: 'Rundtur på østsiden av øya forbi utsiktspunktet Brentås (48 moh) ned til Hvervodden, med hjemtur via Kongshavn i stedet for samme vei tilbake.',
    enT: "A loop on the east side past the Brentås viewpoint (48m) down to Hvervodden, returning via Kongshavn instead of retracing the outbound path.",
  },
  {
    id: 't-store-oyrunden',
    navn: 'Store øyrunden',
    en: 'Grand island loop',
    seq: ['Vestgarden', 'Kirken', 'Brentas', 'Hvervodden', 'TangenFerge', 'Vestgarden'],
    no: 'Den lengste av øyas populære løyper — fra Vestgården via kirken, Brentås og Hvervodden til Tangen fergekai og tilbake. Dekker det meste av øyas veinett.',
    enT: "The longest of the island's popular loops — from Vestgården via the church, Brentås and Hvervodden to Tangen ferry quay and back. Covers most of the island's road network.",
  },
  {
    id: 't-kjolholmrunden',
    navn: 'Kjølholmrunden',
    en: 'Kjølholmen loop',
    seq: ['Kirken', 'Kjolholmen', 'Brentas', 'Kirken'],
    no: 'Skogsstirunde til Kjølholmhåsen på østsiden av øya, med hjemtur forbi Brentås fremfor å snu og gå tilbake samme sti.',
    enT: "A forest-trail loop out to Kjølholmhåsen on the east side, returning past Brentås rather than turning back the way you came.",
  },
  {
    id: 't-pilegrimsleden',
    navn: 'Pilegrimsleden gjennom Veierland',
    en: 'The Pilgrim\'s Way across Veierland',
    seq: ['Vestgarden', 'Alby', 'VillaVeierland', 'Dagros', 'TangenFerge'],
    no: 'Pilegrimsleden krysser øya fra Vestgården fergeleie i nord til Tangen fergekai i sør, forbi Alby gård, Villa Veierland og Dagros.',
    enT: "The Pilgrim's Way crosses the island from Vestgården ferry quay in the north to Tangen ferry quay in the south, passing Alby farm, Villa Veierland and Dagros.",
  },
];

// ── Build + write ────────────────────────────────────────────────────────

const turkart = JSON.parse(readFileSync(TURKART_PATH, 'utf8'));
const GENERATED_IDS = new Set(ROUTES.map(r => r.id));
turkart.features = turkart.features.filter(f => !GENERATED_IDS.has(f.properties.id));

for (const r of ROUTES) {
  const { path, totalM, reusedM, trailM } = buildLoopPath(r.seq, P);
  const { ascentM, descentM, maxElevationM, minElevationM, series } = elevationProfile(path);
  const coordinates = path.map(([lat, lng]) => [lng, lat]); // GeoJSON order
  const modes = activityModes(totalM, trailM);
  turkart.features.push({
    type: 'Feature',
    properties: {
      id: r.id,
      navn: r.navn,
      en: r.en,
      km: fmtKm(totalM),
      tid: fmtTime(totalM, 6.5), // running pace estimate, ~6.5 min/km
      vanskelighet: difficulty(totalM, ascentM),
      stigning: `${ascentM} m`,
      // Elevation profile for the chart: [metresFromStart, elevationM][],
      // resampled to an even spacing (see resampleByDistance).
      hoydeprofil: series,
      minHoyde: minElevationM,
      maxHoyde: maxElevationM,
      // Which activities the route suits + an estimated time for each —
      // cycling is left out entirely once the route uses any real stretch
      // of narrow trail (see activityModes / BIKE_TRAIL_TOLERANCE_M).
      transportmodi: modes,
      // The named-waypoint sequence this route was built from (see `P` and
      // `ROUTES` above) — lets the admin route builder load a route back by
      // its logical waypoints instead of only the dense computed geometry.
      // Display names for each `key` come from routing.ts's NAMED_WAYPOINTS.
      rutepunkter: r.seq.map(key => ({ key, lat: P[key][0], lng: P[key][1] })),
      no: r.no,
      enT: r.enT,
    },
    geometry: { type: 'LineString', coordinates },
  });
  const reusedPct = (reusedM / totalM * 100).toFixed(0);
  console.log(
    `${r.navn}: ${fmtKm(totalM)}, ${fmtTime(totalM, 6.5)} løp, ` +
    `stigning ${ascentM}m / fall ${descentM}m, maks ${maxElevationM}moh, ` +
    `${difficulty(totalM, ascentM)}, backtrack ${reusedM.toFixed(0)}m (${reusedPct}%), ` +
    `sti ${trailM.toFixed(0)}m, modi [${modes.map(m => m.mode).join(',')}], ${path.length} punkter`
  );
}

// ── Enrich hand-authored trails that aren't (re)generated above ────────────
// "Rundt øya" keeps its own hand-traced geometry, but still gets an
// elevation profile from the DTM and activity-time estimates. Its own
// description already says it mixes gravel roads and narrow paths, so
// cycling is left off rather than trying to infer trail-fraction from a
// geometry we didn't build ourselves.
const NO_BIKE_HAND_AUTHORED = new Set(['t-rundt']);
for (const f of turkart.features) {
  if (GENERATED_IDS.has(f.properties.id) || f.properties.hoydeprofil) continue;
  const path = f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  const { ascentM, descentM, maxElevationM, minElevationM, series } = elevationProfile(path);
  let totalM = 0;
  for (let i = 1; i < path.length; i++) totalM += distanceM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
  const modes = [
    { mode: 'gaa', tid: fmtTime(totalM, 12) },
    { mode: 'lop', tid: fmtTime(totalM, 6.5) },
  ];
  if (!NO_BIKE_HAND_AUTHORED.has(f.properties.id)) modes.push({ mode: 'sykkel', tid: fmtTime(totalM, 4) });
  f.properties.stigning = `${ascentM} m`;
  f.properties.hoydeprofil = series;
  f.properties.minHoyde = minElevationM;
  f.properties.maxHoyde = maxElevationM;
  f.properties.transportmodi = modes;
  console.log(
    `${f.properties.navn} (hand-authored): stigning ${ascentM}m / fall ${descentM}m, ` +
    `maks ${maxElevationM}moh, modi [${modes.map(m => m.mode).join(',')}]`
  );
}

writeFileSync(TURKART_PATH, JSON.stringify(turkart));
console.log(`\nWrote ${TURKART_PATH}`);
