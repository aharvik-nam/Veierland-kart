import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  NETWORK_NODES, NETWORK_EDGES, NAMED_WAYPOINTS,
  buildWeightedRoute, computeElevationProfile,
  fmtKm, fmtRouteTime, routeDifficulty, routeActivityModes,
  BuiltRoute,
} from '../lib/routing';
import { elevationAt } from '../lib/conditions';

const MAP_CENTER: [number, number] = [59.1506, 10.3521];

// ── Small geometry helpers for direction arrows ────────────────────────────

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}
function bearingDeg(a: [number, number], b: [number, number]): number {
  const [lat1, lng1] = a.map(x => x * Math.PI / 180) as [number, number];
  const [lat2, lng2] = b.map(x => x * Math.PI / 180) as [number, number];
  const dLng = lng2 - lng1;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
// Points evenly spaced by distance along a path, each with the local
// direction of travel — used to draw arrowheads showing which way a route
// is meant to be walked.
function arrowsAlong(path: [number, number][], count: number): { pos: [number, number]; deg: number }[] {
  if (path.length < 2) return [];
  const dist = [0];
  for (let i = 1; i < path.length; i++) dist.push(dist[i - 1] + distanceM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
  const total = dist[dist.length - 1];
  const out: { pos: [number, number]; deg: number }[] = [];
  for (let k = 1; k <= count; k++) {
    const target = total * k / (count + 1);
    let j = 0;
    while (j < dist.length - 2 && dist[j + 1] < target) j++;
    const d0 = dist[j], d1 = dist[j + 1];
    const t = d1 > d0 ? (target - d0) / (d1 - d0) : 0;
    const a = path[j], b = path[j + 1];
    const pos: [number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    out.push({ pos, deg: bearingDeg(a, b) });
  }
  return out;
}

function arrowIcon(deg: number, color: string) {
  return L.divIcon({
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<div style="width:16px;height:16px;transform:rotate(${deg}deg);color:${color};display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 0 1.5px #fff)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 L20 20 L12 15 L4 20 Z"/></svg>
    </div>`,
  });
}
function flagIcon(color: string, letter: string) {
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font:700 12px sans-serif">${letter}</div>`,
  });
}
function waypointIcon(active: boolean) {
  return L.divIcon({
    className: '',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${active ? '#2d6cdf' : '#fff'};border:2px solid ${active ? '#fff' : '#2d6cdf'};box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
  });
}

// ── Route summary type shared with the caller ──────────────────────────────

export interface BuiltRouteResult {
  path: [number, number][];
  km: string;
  tid: string;
  vanskelighet: string;
  stigning: string;
  hoydeprofil: [number, number][];
  minHoyde: number;
  maxHoyde: number;
  transportmodi: { mode: string; tid: string }[];
  rutepunkter: { key?: string; lat: number; lng: number }[];
}

function computeFull(waypoints: { key?: string; lat: number; lng: number }[]): { result: BuiltRouteResult; error: null } | { result: null; error: string } {
  try {
    const coords: [number, number][] = waypoints.map(w => [w.lat, w.lng]);
    const built: BuiltRoute = buildWeightedRoute(coords);
    const prof = computeElevationProfile(built.path, elevationAt);
    const modes = routeActivityModes(built.totalM, built.trailM);
    return {
      result: {
        path: built.path,
        km: fmtKm(built.totalM),
        tid: fmtRouteTime(built.totalM, 12), // walking pace by default — most people walk these
        vanskelighet: routeDifficulty(built.totalM, prof.ascentM),
        stigning: `${prof.ascentM} m`,
        hoydeprofil: prof.series,
        minHoyde: prof.minElevationM,
        maxHoyde: prof.maxElevationM,
        transportmodi: modes,
        rutepunkter: waypoints,
      },
      error: null,
    };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : 'Ukjent feil' };
  }
}

// Snaps a click to the nearest named waypoint within 40m, else the nearest
// road-network node — so every click lands on something actually routable.
function snapClick(lat: number, lng: number): { key?: string; lat: number; lng: number } {
  let bestNamed = -1, bestNamedD = Infinity;
  NAMED_WAYPOINTS.forEach((w, i) => {
    const d = distanceM(lat, lng, w.lat, w.lng);
    if (d < bestNamedD) { bestNamedD = d; bestNamed = i; }
  });
  if (bestNamed >= 0 && bestNamedD < 40) {
    const w = NAMED_WAYPOINTS[bestNamed];
    return { key: w.key, lat: w.lat, lng: w.lng };
  }
  let bestNode = -1, bestNodeD = Infinity;
  for (let i = 0; i < NETWORK_NODES.length; i++) {
    const [nlat, nlng] = NETWORK_NODES[i];
    const d = distanceM(lat, lng, nlat, nlng);
    if (d < bestNodeD) { bestNodeD = d; bestNode = i; }
  }
  const [nlat, nlng] = NETWORK_NODES[bestNode];
  return { lat: nlat, lng: nlng };
}

function ClickCatcher({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: e => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

// Leaflet computes its tile/pane layout from the container's size at the
// moment it mounts. If that container was 0×0 or mid-transition (a flex
// child whose height hadn't settled yet, a modal still animating in), the
// map can end up permanently mis-sized — tiles missing or the whole thing
// looking "hidden" even though the DOM node is there. Forcing a couple of
// invalidateSize() calls after mount (and on window resize) fixes that.
function InvalidateSizeOnMount() {
  const map = useMap();
  useEffect(() => {
    const t1 = setTimeout(() => map.invalidateSize(), 0);
    const t2 = setTimeout(() => map.invalidateSize(), 250);
    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', onResize); };
  }, [map]);
  return null;
}

// Degree-2 nodes are just interior points along a single OSM way segment —
// not decision points. Junctions (degree >= 3) and dead-ends (degree 1) are
// what you actually want to click on when building a route by hand.
function useJunctionNodes(): [number, number][] {
  return useMemo(() => {
    const degree = new Array(NETWORK_NODES.length).fill(0);
    for (const [a, b] of NETWORK_EDGES) { degree[a]++; degree[b]++; }
    const out: [number, number][] = [];
    for (let i = 0; i < degree.length; i++) if (degree[i] !== 2) out.push(NETWORK_NODES[i]);
    return out;
  }, []);
}

const nameForKey = (key?: string) => NAMED_WAYPOINTS.find(w => w.key === key)?.name;

export function RouteBuilderMap({
  initialWaypoints, onUse, onCancel,
}: {
  initialWaypoints: { key?: string; lat: number; lng: number }[];
  onUse: (r: BuiltRouteResult) => void;
  onCancel: () => void;
}) {
  const [waypoints, setWaypoints] = useState(initialWaypoints);

  const networkLines = useMemo(() => NETWORK_EDGES.map(([a, b]) => [NETWORK_NODES[a], NETWORK_NODES[b]] as [[number, number], [number, number]]), []);
  const junctionNodes = useJunctionNodes();

  const { result, error } = useMemo(() => waypoints.length >= 2 ? computeFull(waypoints) : { result: null, error: null }, [waypoints]);
  const arrows = result ? arrowsAlong(result.path, Math.max(2, Math.round(result.path.length / 40))) : [];

  const addPoint = (lat: number, lng: number) => setWaypoints(w => [...w, snapClick(lat, lng)]);
  const removeAt = (i: number) => setWaypoints(w => w.filter((_, j) => j !== i));
  const moveUp = (i: number) => setWaypoints(w => i === 0 ? w : [...w.slice(0, i - 1), w[i], w[i - 1], ...w.slice(i + 1)]);
  const moveDown = (i: number) => setWaypoints(w => i === w.length - 1 ? w : [...w.slice(0, i), w[i + 1], w[i], ...w.slice(i + 2)]);
  const reverse = () => setWaypoints(w => [...w].reverse());
  const clear = () => setWaypoints([]);

  // Full-screen overlay: the builder is a precision map-clicking tool, and
  // embedding it inline in the (narrow, max-width-860px) admin content
  // column left too little room and made the map prone to mis-sizing on
  // mount. Escape closes it, same as the Avbryt button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000, background: 'var(--page, #fff)',
      display: 'flex', flexDirection: 'column', padding: 16, boxSizing: 'border-box',
    }}>
    <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
      <div style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--muted)' }}>
          Små blå prikker = alle kryss og endepunkter i veinettet — store blå prikker = navngitte steder.
          Klikk på en av dem (eller hvor som helst på en sti) for å legge til et rutepunkt; klikket snappes
          alltid til nærmeste faktiske sti/vei. Rekkefølgen under er rekkefølgen ruta går i —
          <b> grønt flagg = start, rødt flagg = mål</b>, piler viser retning.
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={reverse} disabled={waypoints.length < 2}
            style={{ flex: 1, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', cursor: 'pointer', fontSize: 12.5 }}>
            ↕ Snu retning
          </button>
          <button type="button" onClick={clear} disabled={waypoints.length === 0}
            style={{ flex: 1, padding: '7px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', cursor: 'pointer', fontSize: 12.5 }}>
            Tøm
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {waypoints.map((w, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
              background: 'var(--card2)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5,
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                background: i === 0 ? '#22c55e' : i === waypoints.length - 1 ? '#dc2626' : 'var(--line2)',
                color: i === 0 || i === waypoints.length - 1 ? '#fff' : 'var(--muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
              }}>{i + 1}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nameForKey(w.key) ?? `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}`}
              </span>
              <button type="button" onClick={() => moveUp(i)} disabled={i === 0} title="Flytt opp"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2 }}>▲</button>
              <button type="button" onClick={() => moveDown(i)} disabled={i === waypoints.length - 1} title="Flytt ned"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2 }}>▼</button>
              <button type="button" onClick={() => removeAt(i)} title="Fjern"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#dc2626', padding: 2 }}>✕</button>
            </div>
          ))}
          {waypoints.length === 0 && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', padding: '8px 0' }}>
              Ingen punkter ennå — klikk på kartet.
            </div>
          )}
        </div>

        {error && <div style={{ fontSize: 12.5, color: '#dc2626' }}>{error}</div>}
        {result && (
          <div style={{ background: 'var(--card2)', border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div><b>{result.km}</b> · {result.tid} gange · {result.vanskelighet}</div>
            <div>Stigning: {result.stigning}</div>
            <div>Modi: {result.transportmodi.map(m => m.mode).join(', ')}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
          <button type="button" onClick={onCancel}
            style={{ flex: 1, padding: '9px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', cursor: 'pointer', fontSize: 13 }}>
            Avbryt
          </button>
          <button type="button" disabled={!result} onClick={() => result && onUse(result)}
            style={{ flex: 1, padding: '9px 8px', borderRadius: 8, border: 'none', background: result ? 'var(--accent)' : 'var(--line2)', color: '#fff', cursor: result ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}>
            Bruk denne ruten
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
        <button type="button" onClick={onCancel} title="Lukk (Esc)" style={{
          position: 'absolute', top: 10, right: 10, zIndex: 1000, width: 32, height: 32,
          borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', cursor: 'pointer',
          fontSize: 16, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>✕</button>
        <MapContainer center={MAP_CENTER} zoom={13} style={{ width: '100%', height: '100%' }}>
          <InvalidateSizeOnMount />
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" subdomains="abcd" maxZoom={19} />
          <ClickCatcher onClick={addPoint} />

          {/* Road network, for reference — one multi-segment Polyline rather than
              ~3000 separate components, since react-leaflet/Leaflet accepts an
              array of disjoint line-strings as a single layer. */}
          <Polyline positions={networkLines} pathOptions={{ color: '#94a3b8', weight: 1.2, opacity: 0.5 }} interactive={false} />

          {/* Every road junction/dead-end (degree != 2) — click any of these
              to add that exact point, no guessing where the network actually
              lets you turn. */}
          {junctionNodes.map((pos, i) => (
            <CircleMarker key={i} center={pos} radius={3.5}
              pathOptions={{ color: '#2d6cdf', fillColor: '#2d6cdf', fillOpacity: 0.65, weight: 1 }}
              eventHandlers={{ click: () => addPoint(pos[0], pos[1]) }}
            />
          ))}

          {/* Named waypoints, clickable — bigger + labeled */}
          {NAMED_WAYPOINTS.map(w => (
            <CircleMarker key={w.key} center={[w.lat, w.lng]} radius={6}
              pathOptions={{ color: '#fff', fillColor: '#2d6cdf', fillOpacity: 1, weight: 2 }}
              eventHandlers={{ click: () => addPoint(w.lat, w.lng) }}
            />
          ))}

          {/* Current sequence markers */}
          {waypoints.map((w, i) => (
            <Marker key={i} position={[w.lat, w.lng]}
              icon={i === 0 ? flagIcon('#22c55e', 'S') : i === waypoints.length - 1 ? flagIcon('#dc2626', 'M') : waypointIcon(true)}
            />
          ))}

          {/* Computed route + direction arrows */}
          {result && (
            <>
              <Polyline positions={result.path} pathOptions={{ color: '#fff', weight: 6, opacity: 0.9 }} />
              <Polyline positions={result.path} pathOptions={{ color: '#2d6cdf', weight: 3, opacity: 0.95 }} />
              {arrows.map((a, i) => <Marker key={i} position={a.pos} icon={arrowIcon(a.deg, '#2d6cdf')} interactive={false} />)}
            </>
          )}
        </MapContainer>
      </div>
    </div>
    </div>
  );
}

// ── Read-only overview: all existing routes with start/end + direction ────

export function RouteOverviewMap({ routes }: { routes: { id: string; navn: string; path: [number, number][] }[] }) {
  const colors = ['#2d6cdf', '#dc7a2d', '#7a2ddc', '#2ddc9c', '#dc2d5e', '#8a8a2d'];
  return (
    <div style={{ height: 480, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)' }}>
      <MapContainer center={MAP_CENTER} zoom={13} style={{ width: '100%', height: '100%' }}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" subdomains="abcd" maxZoom={19} />
        {routes.map((r, ri) => {
          const color = colors[ri % colors.length];
          const arrows = arrowsAlong(r.path, Math.max(2, Math.round(r.path.length / 30)));
          return (
            <React.Fragment key={r.id}>
              <Polyline positions={r.path} pathOptions={{ color: '#fff', weight: 5, opacity: 0.8 }} interactive={false} />
              <Polyline positions={r.path} pathOptions={{ color, weight: 2.6, opacity: 0.95 }} interactive={false} />
              {arrows.map((a, i) => <Marker key={i} position={a.pos} icon={arrowIcon(a.deg, color)} interactive={false} />)}
              {r.path.length > 0 && <Marker position={r.path[0]} icon={flagIcon('#22c55e', 'S')} interactive={false} />}
              {r.path.length > 0 && <Marker position={r.path[r.path.length - 1]} icon={flagIcon('#dc2626', 'M')} interactive={false} />}
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}
