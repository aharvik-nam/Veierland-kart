import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export interface MapAppearance {
  contoursEnabled: boolean;
  contourIntervalM: number;
  contourColor: string;
  contourWeight: number;
  contourOpacity: number;
  contourMinZoom: number;
}

export const DEFAULT_MAP_APPEARANCE: MapAppearance = {
  contoursEnabled: false,
  contourIntervalM: 10,
  contourColor: '#8a6a3a',
  contourWeight: 1,
  contourOpacity: 0.55,
  contourMinZoom: 14,
};

const COL = 'geodata';
const DOC_ID = 'map_appearance';

export async function loadMapAppearance(): Promise<MapAppearance> {
  if (!isFirebaseConfigured) return DEFAULT_MAP_APPEARANCE;
  try {
    const snap = await getDoc(doc(db, COL, DOC_ID));
    if (!snap.exists()) return DEFAULT_MAP_APPEARANCE;
    const raw = snap.data();
    return { ...DEFAULT_MAP_APPEARANCE, ...(raw.json ? JSON.parse(raw.json) : {}) };
  } catch {
    return DEFAULT_MAP_APPEARANCE;
  }
}

export async function saveMapAppearance(cfg: MapAppearance): Promise<void> {
  if (!isFirebaseConfigured) throw new Error('Firebase ikke konfigurert');
  await setDoc(doc(db, COL, DOC_ID), { json: JSON.stringify(cfg) });
}
