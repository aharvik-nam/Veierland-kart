import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// Admin-editable overlay on top of the static LAYERS config in maplayers.ts:
// which base map layers are offered at all, what they're called, and a
// simple color/appearance tweak (CSS filter, decomposed into sliders) — not
// the tile URL/zoom/attribution, which stay developer-only technical detail.
export interface MapLayerAppearance {
  enabled: boolean;
  label: { no: string; en: string };
  saturate: number;   // 0–2, 1 = unchanged
  brightness: number;  // 0–2, 1 = unchanged
  contrast: number;    // 0–2, 1 = unchanged
  sepia: number;       // 0–1
  hueRotate: number;   // degrees, 0–360
}

export type MapLayerCfgMap = Record<string, MapLayerAppearance>;

// Matches the visual defaults already baked into maplayers.ts's LAYERS
// filter strings, just decomposed into individually-editable sliders.
export const DEFAULT_MAP_LAYER_CFG: MapLayerCfgMap = {
  soleng:    { enabled: true, label: { no: 'Lyst', en: 'Light' },     saturate: 1,    brightness: 1,    contrast: 1,   sepia: 0,  hueRotate: 0 },
  friluft:   { enabled: true, label: { no: 'Friluft', en: 'Outdoor' }, saturate: 1.05, brightness: 1.01, contrast: 1,   sepia: 0,  hueRotate: 0 },
  flyfoto:   { enabled: true, label: { no: 'Flyfoto', en: 'Satellite' }, saturate: 1,  brightness: 1,    contrast: 1,   sepia: 0,  hueRotate: 0 },
  historisk: { enabled: true, label: { no: 'Historisk', en: 'Historic' }, saturate: 1, brightness: 1.05, contrast: 1.1, sepia: .4, hueRotate: 0 },
};

export function buildFilterString(a: MapLayerAppearance): string {
  return `saturate(${a.saturate}) brightness(${a.brightness}) contrast(${a.contrast}) sepia(${a.sepia}) hue-rotate(${a.hueRotate}deg)`;
}

const COL = 'geodata';
const DOC_ID = 'map_layers';

export async function loadMapLayerCfg(): Promise<MapLayerCfgMap> {
  if (!isFirebaseConfigured) return DEFAULT_MAP_LAYER_CFG;
  try {
    const snap = await getDoc(doc(db, COL, DOC_ID));
    if (!snap.exists()) return DEFAULT_MAP_LAYER_CFG;
    const raw = snap.data();
    const stored = raw.json ? JSON.parse(raw.json) : {};
    // Merge over defaults so a newly-added layer key (future maplayers.ts
    // entry) still has sane values even if the stored doc predates it.
    const merged: MapLayerCfgMap = {};
    for (const key of Object.keys(DEFAULT_MAP_LAYER_CFG)) {
      merged[key] = { ...DEFAULT_MAP_LAYER_CFG[key], ...stored[key] };
    }
    return merged;
  } catch {
    return DEFAULT_MAP_LAYER_CFG;
  }
}

export async function saveMapLayerCfg(cfg: MapLayerCfgMap): Promise<void> {
  if (!isFirebaseConfigured) throw new Error('Firebase ikke konfigurert');
  await setDoc(doc(db, COL, DOC_ID), { json: JSON.stringify(cfg) });
}
