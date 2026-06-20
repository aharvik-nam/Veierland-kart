import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import historyData from '../data/veierland_history.json';

export interface FarmPerson {
  name: string;
  role: string;
  period: string;
  note: string;
}

export interface FarmShip {
  name: string;
  type: string;
  year: string;
  details: string;
}

export interface Farm {
  name: string;
  visible: boolean;
  coordinates: [number, number];
  koordinat_sikkerhet: 'antatt' | 'usikker' | 'sikker';
  norron_name: string;
  meaning: string;
  gnr: number;
  gnr_pre_1964: number;
  matrikkel_1838: number;
  bruk_1838: number;
  bruk_1886: number;
  bruk_1950: number;
  location: string;
  history: string;
  archaeology: string;
  key_people: FarmPerson[];
  ships_built: FarmShip[];
  anekdoter: string[];
  sources: string[];
}

const COL = 'geodata';
const DOC_ID = 'history_farms';

function defaultFarmData(): Farm[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (historyData.farms as any[]).map(f => ({
    name: f.name ?? '',
    visible: true,
    coordinates: (f.coordinates ?? [0, 0]) as [number, number],
    koordinat_sikkerhet: (f.koordinat_sikkerhet ?? 'antatt') as 'antatt' | 'usikker' | 'sikker',
    norron_name: f.norron_name ?? '',
    meaning: f.meaning ?? '',
    gnr: f.gnr ?? 0,
    gnr_pre_1964: f.gnr_pre_1964 ?? 0,
    matrikkel_1838: f.matrikkel_1838 ?? 0,
    bruk_1838: f.bruk_1838 ?? 0,
    bruk_1886: f.bruk_1886 ?? 0,
    bruk_1950: f.bruk_1950 ?? 0,
    location: f.location ?? '',
    history: f.history ?? '',
    archaeology: f.archaeology ?? '',
    key_people: f.key_people ?? [],
    ships_built: f.ships_built ?? [],
    anekdoter: f.anekdoter ?? [],
    sources: f.sources ?? [],
  }));
}

export const DEFAULT_FARM_DATA: Farm[] = defaultFarmData();

export async function loadFarmData(): Promise<Farm[]> {
  const base = defaultFarmData();
  if (!isFirebaseConfigured) return base;
  try {
    const snap = await getDoc(doc(db, COL, DOC_ID));
    if (snap.exists()) {
      const raw = snap.data();
      if (raw.json) {
        const stored: Farm[] = JSON.parse(raw.json);
        // Merge: prefer stored data, fill in any new farms from JSON defaults
        return base.map(b => stored.find(s => s.name === b.name) ?? b);
      }
    }
    // Backward compat: check for coordinates saved in old farm_coords doc
    const coordsSnap = await getDoc(doc(db, COL, 'farm_coords'));
    if (coordsSnap.exists()) {
      const rawCoords = coordsSnap.data();
      const saved: Record<string, [number, number]> = rawCoords.json ? JSON.parse(rawCoords.json) : {};
      return base.map(b => saved[b.name] ? { ...b, coordinates: saved[b.name] } : b);
    }
    return base;
  } catch {
    return base;
  }
}

export async function saveFarmData(farms: Farm[]): Promise<void> {
  if (!isFirebaseConfigured) throw new Error('Firebase ikke konfigurert');
  await setDoc(doc(db, COL, DOC_ID), { json: JSON.stringify(farms) });
}
