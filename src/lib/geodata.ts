import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import poiFallback from '../data/veierland_poi.json';
import stedsnavnFallback from '../data/veierland_stedsnavn.json';
import turkartRaw from '../data/turkart.geojson?raw';

export interface GeoCollection {
  type: string;
  features: any[];
  [key: string]: any;
}

const turkartFallback: GeoCollection = JSON.parse(turkartRaw);
const COL = 'geodata';

async function fromFirestore(docId: string): Promise<GeoCollection | null> {
  if (!isFirebaseConfigured) return null;
  try {
    const snap = await getDoc(doc(db, COL, docId));
    return snap.exists() ? (snap.data() as GeoCollection) : null;
  } catch {
    return null;
  }
}

export async function saveGeoJSON(docId: string, data: GeoCollection): Promise<void> {
  await setDoc(doc(db, COL, docId), data);
}

export async function hasFirestoreData(docId: string): Promise<boolean> {
  if (!isFirebaseConfigured) return false;
  try {
    const snap = await getDoc(doc(db, COL, docId));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function loadPoiGeoJSON(): Promise<GeoCollection> {
  return (await fromFirestore('veierland_poi')) ?? (poiFallback as unknown as GeoCollection);
}

export async function loadStedsnavnGeoJSON(): Promise<GeoCollection> {
  return (await fromFirestore('veierland_stedsnavn')) ?? (stedsnavnFallback as unknown as GeoCollection);
}

export async function loadTurkartGeoJSON(): Promise<GeoCollection> {
  return (await fromFirestore('turkart')) ?? turkartFallback;
}

export { poiFallback, stedsnavnFallback, turkartFallback };
