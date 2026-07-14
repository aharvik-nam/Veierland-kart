// Tiny inline SVG charts (Forhold legend gradient, trail elevation profile) —
// no shared state with VeierlandApp, just data in / SVG out.

// Small gradient bar used in the sun/wind legend, with a marker at the
// current value's position (0..1) along the scale.
export function GradientBar({ stops, posT }: { stops: { r: number; g: number; b: number }[]; posT: number }) {
  const css = stops.map((c, i) => `rgb(${c.r},${c.g},${c.b}) ${(i / (stops.length - 1)) * 100}%`).join(', ');
  const pct = Math.min(1, Math.max(0, posT)) * 100;
  return (
    <div style={{ position: 'relative', height: 10, marginTop: 8, marginBottom: 2 }}>
      <div style={{ height: 8, borderRadius: 999, background: `linear-gradient(to right, ${css})` }} />
      <div style={{
        position: 'absolute', top: -3, left: `${pct}%`, transform: 'translateX(-50%)',
        width: 4, height: 14, borderRadius: 2, background: 'var(--ink)',
        boxShadow: '0 0 0 1.5px #fff',
      }} />
    </div>
  );
}

// Elevation-vs-distance chart for a trail, from the DTM-sampled profile
// (see scripts/generate_running_routes.mjs). [metresFromStart, elevationM][].
export function ElevationChart({ profile, minEl, maxEl }: { profile: [number, number][]; minEl: number; maxEl: number }) {
  if (profile.length < 2) return null;
  const W = 300, H = 70, PAD_Y = 8;
  const totalM = profile[profile.length - 1][0];
  const span = Math.max(1, maxEl - minEl);
  const x = (m: number) => (m / totalM) * W;
  const y = (el: number) => PAD_Y + (1 - (el - minEl) / span) * (H - PAD_Y * 2);

  const linePts = profile.map(([m, el]) => `${x(m).toFixed(1)},${y(el).toFixed(1)}`).join(' ');
  const areaPts = `0,${H} ${linePts} ${W},${H}`;

  return (
    <div style={{ margin: '2px 0 14px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
        <polygon points={areaPts} fill="var(--accent)" opacity={0.14} />
        <polyline points={linePts} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>
        <span>{Math.round(minEl)} moh</span>
        <span>{(totalM / 1000).toFixed(1)} km</span>
        <span>{Math.round(maxEl)} moh</span>
      </div>
    </div>
  );
}
