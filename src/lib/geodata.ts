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

// Firestore doesn't support nested arrays (e.g. LineString coordinates),
// so we serialize the entire GeoJSON as a JSON string in a { json: "..." } document.
async function fromFirestore(docId: string): Promise<GeoCollection | null> {
  if (!isFirebaseConfigured) return null;
  try {
    const snap = await getDoc(doc(db, COL, docId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return d.json ? JSON.parse(d.json) : (d as GeoCollection);
  } catch {
    return null;
  }
}

export async function saveGeoJSON(docId: string, data: GeoCollection): Promise<void> {
  await setDoc(doc(db, COL, docId), { json: JSON.stringify(data) });
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

// ─── Trail data ───────────────────────────────────────────────────────────────

export interface TrailMode {
  mode: 'gaa' | 'lop' | 'sykkel';
  tid: string;
}

export interface Trail {
  id: string;
  name: string;
  en: string;
  km: string;
  time: string;
  diff: string;
  climb?: string;
  profile?: [number, number][];
  minEl?: number;
  maxEl?: number;
  modes?: TrailMode[];
  no: string;
  enT: string;
  path: [number, number][];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function trailsFromGeoJSON(geo: any): Trail[] {
  return (geo as any).features.map((f: any) => ({
    id: f.properties.id,
    name: f.properties.navn,
    en: f.properties.en,
    km: f.properties.km,
    time: f.properties.tid,
    diff: f.properties.vanskelighet,
    climb: f.properties.stigning,
    profile: f.properties.hoydeprofil,
    minEl: f.properties.minHoyde,
    maxEl: f.properties.maxHoyde,
    modes: f.properties.transportmodi,
    no: f.properties.no,
    enT: f.properties.enT,
    path: f.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]),
  }));
}
