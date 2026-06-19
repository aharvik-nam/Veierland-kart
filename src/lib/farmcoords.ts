import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import historyData from '../data/veierland_history.json';

export type FarmCoordsMap = Record<string, [number, number]>;

const COL = 'geodata';
const DOC_ID = 'farm_coords';

function defaultFromJson(): FarmCoordsMap {
  const map: FarmCoordsMap = {};
  for (const farm of historyData.farms as unknown as Array<{ name: string; coordinates: [number, number] }>) {
    if (farm.coordinates) map[farm.name] = farm.coordinates;
  }
  return map;
}

export const DEFAULT_FARM_COORDS: FarmCoordsMap = defaultFromJson();

export async function loadFarmCoords(): Promise<FarmCoordsMap> {
  const base = defaultFromJson();
  if (!isFirebaseConfigured) return base;
  try {
    const snap = await getDoc(doc(db, COL, DOC_ID));
    if (!snap.exists()) return base;
    const raw = snap.data();
    const overrides: FarmCoordsMap = raw.json ? JSON.parse(raw.json) : {};
    return { ...base, ...overrides };
  } catch {
    return base;
  }
}

export async function saveFarmCoords(coords: FarmCoordsMap): Promise<void> {
  await setDoc(doc(db, COL, DOC_ID), { json: JSON.stringify(coords) });
}
