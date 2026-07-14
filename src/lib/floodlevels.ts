// Sea-level flood overlay lookup (Gårder tab's historical sea-level slider)
// and the long-range sea-level curve it drives, from scripts/generate_flood_levels
// output plus UIB/NGU/Kartverket land-uplift data.
import floodData from '../data/sea_level_flood.geojson';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const FLOOD_BY_THRESHOLD = new Map<number, object>(
  (floodData as any).features?.map((f: any) => [f.properties.threshold_m, f]) ?? []
);

// Derived from the GeoJSON data — automatically picks up new thresholds when the file is regenerated
export const FLOOD_THRESHOLDS: number[] = [...FLOOD_BY_THRESHOLD.keys()].sort((a, b) => a - b);

// Returns the largest available threshold ≤ m (or null if none)
export function nearestFloodThreshold(m: number): number | null {
  const below = FLOOD_THRESHOLDS.filter(t => t <= m);
  return below.length > 0 ? below[below.length - 1] : null;
}

// Long-range sea level curve for Gårder slider (UIB, NGU, Kartverket sources)
export const GARDER_TIMELINE = [
  { year: -12000, label: '12 000 f.Kr.', sea_level_m: 50 },
  { year: -11000, label: '11 000 f.Kr.', sea_level_m: 45 },
  { year: -10000, label: '10 000 f.Kr.', sea_level_m: 40 },
  { year:  -9000, label:  '9 000 f.Kr.', sea_level_m: 35 },
  { year:  -8000, label:  '8 000 f.Kr.', sea_level_m: 30 },
  { year:  -7000, label:  '7 000 f.Kr.', sea_level_m: 22 },
  { year:  -6000, label:  '6 000 f.Kr.', sea_level_m: 15 },
  { year:  -5000, label:  '5 000 f.Kr.', sea_level_m: 12 },
  { year:  -4000, label:  '4 000 f.Kr.', sea_level_m: 10 },
  { year:  -3000, label:  '3 000 f.Kr.', sea_level_m:  8 },
  { year:  -2000, label:  '2 000 f.Kr.', sea_level_m:  5 },
  { year:  -1000, label:  '1 000 f.Kr.', sea_level_m:  3.5 },
  { year:      0, label:       'År 0',   sea_level_m:  3 },
  { year:   1000, label: '1 000 e.Kr.', sea_level_m:  2 },
  { year:   2000, label: '2 000 e.Kr.', sea_level_m:  0 },
  { year:   2026, label:      'I dag',  sea_level_m:  0 },
] as const;
