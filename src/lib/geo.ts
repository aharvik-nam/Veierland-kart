// Generic flat-earth geometry helpers (accurate for the short distances this
// app deals with — a few kilometres across one small island).

// Minimum distance in meters from point P to a polyline
export function pointToPolylineDistM(p: [number, number], poly: [number, number][]): number {
  const R = 6371000 * Math.PI / 180;
  let minDist = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const [ay, ax] = poly[i], [by, bx] = poly[i + 1];
    const cosLat = Math.cos(((ay + by) / 2) * Math.PI / 180);
    const axm = ax * R * cosLat, aym = ay * R;
    const bxm = bx * R * cosLat, bym = by * R;
    const pxm = p[1] * R * cosLat, pym = p[0] * R;
    const dx = bxm - axm, dy = bym - aym;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((pxm - axm) * dx + (pym - aym) * dy) / len2));
    const dist = Math.sqrt((pxm - axm - t * dx) ** 2 + (pym - aym - t * dy) ** 2);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}
