import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import natureCacheData from '../data/nature_cache.json';
import assessmentCacheData from '../data/assessment_cache.json';
import boundaryData from '../data/veierland_boundary.json';
import { fetchArtsdatabankenAssessment } from './api';

export const NATURE_GROUPS = {
  Fugler:       { no: 'Fugler',       en: 'Birds',       color: '#3b7fc4', taxonKey: 212, icon: 'fugl'       },
  Karplanter:   { no: 'Karplanter',   en: 'Plants',      color: '#4a8a2a', taxonKey: 6,   icon: 'plante'     },
  Pattedyr:     { no: 'Pattedyr',     en: 'Mammals',     color: '#8b5c2a', taxonKey: 359, icon: 'pattedyr'   },
  Sommerfugler: { no: 'Sommerfugler', en: 'Butterflies', color: '#b84fa0', taxonKey: 797, icon: 'sommerfugl' },
  Sopper:       { no: 'Sopper',       en: 'Fungi',       color: '#c07a3a', taxonKey: 5,   icon: 'sopp'       },
} as const;

export type NatureGroup = keyof typeof NATURE_GROUPS;

export interface NatureObs {
  scientificName: string;
  popularName: string;
  photoUrl: string;
  photoAttribution: string;
  group: NatureGroup;
  lat: number;
  lng: number;
  date: string;
  obsCount: number;
  gbifKey: number;
  family?: string;
  familyKey?: number;
  redListCategory?: string;
  alienCategory?: string;
}

export const STATIC_NATURE_CACHE = natureCacheData as { generatedAt: string; obs: NatureObs[] };

export const GBIF_POLYGON = encodeURIComponent(
  'POLYGON((' +
  [...(boundaryData as any).coordinates[0]].reverse().map((c: number[]) => `${c[0]} ${c[1]}`).join(',') +
  '))'
);

const COL = 'geodata';
const DOC_ID = 'nature_obs';

export async function loadNatureObs(): Promise<NatureObs[] | null> {
  if (!isFirebaseConfigured) return null;
  try {
    const snap = await getDoc(doc(db, COL, DOC_ID));
    if (!snap.exists()) return null;
    const raw = snap.data();
    return raw.json ? JSON.parse(raw.json) : null;
  } catch {
    return null;
  }
}

export async function saveNatureObs(obs: NatureObs[]): Promise<void> {
  if (!isFirebaseConfigured) throw new Error('Firebase ikke konfigurert');
  await setDoc(doc(db, COL, DOC_ID), {
    json: JSON.stringify(obs),
    updatedAt: new Date().toISOString(),
    count: obs.length,
  });
}

export async function getNatureObsMetadata(): Promise<{ updatedAt: string; count: number } | null> {
  if (!isFirebaseConfigured) return null;
  try {
    const snap = await getDoc(doc(db, COL, DOC_ID));
    if (!snap.exists()) return null;
    const raw = snap.data();
    return { updatedAt: raw.updatedAt ?? '', count: raw.count ?? 0 };
  } catch {
    return null;
  }
}

export async function fetchNatureGroup(group: NatureGroup): Promise<{ group: NatureGroup; obs: unknown[] }> {
  try {
    const allResults: unknown[] = [];
    const limit = 300;
    let offset = 0;
    while (true) {
      const url = `https://api.gbif.org/v1/occurrence/search?geometry=${GBIF_POLYGON}&taxonKey=${NATURE_GROUPS[group].taxonKey}&limit=${limit}&offset=${offset}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allResults.push(...(data.results ?? []));
      if (data.endOfRecords) break;
      offset += limit;
      if (offset > 9000) break;
    }
    return { group, obs: allResults };
  } catch {
    return { group, obs: [] };
  }
}

async function fetchINaturalistTaxon(scientificName: string): Promise<{ norwegianName: string; photoUrl: string; photoAttribution: string }> {
  const empty = { norwegianName: '', photoUrl: '', photoAttribution: '' };
  try {
    const res = await fetch(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&locale=nb&per_page=5`
    );
    if (!res.ok) return empty;
    const data = await res.json();
    const genus = scientificName.split(' ')[0].toLowerCase();
    const taxon = (data.results as any[]).find(t => t.name.toLowerCase().startsWith(genus));
    if (!taxon) return empty;
    return {
      norwegianName: taxon.preferred_common_name ?? '',
      photoUrl: taxon.default_photo?.medium_url ?? '',
      photoAttribution: taxon.default_photo?.attribution ?? '',
    };
  } catch {
    return empty;
  }
}

export async function enrichWithINaturalist(obs: NatureObs[]): Promise<NatureObs[]> {
  const uniqueNames = [...new Set(obs.map(o => o.scientificName))];
  // Batch requests to stay under iNaturalist's rate limit
  const BATCH = 20;
  const results: { norwegianName: string; photoUrl: string; photoAttribution: string }[] = [];
  for (let i = 0; i < uniqueNames.length; i += BATCH) {
    const batch = uniqueNames.slice(i, i + BATCH);
    results.push(...await Promise.all(batch.map(n => fetchINaturalistTaxon(n))));
  }
  const map = new Map(uniqueNames.map((n, i) => [n, results[i]]));
  return obs.map(o => {
    const r = map.get(o.scientificName)!;
    return { ...o, popularName: r.norwegianName || o.popularName, photoUrl: r.photoUrl, photoAttribution: r.photoAttribution };
  });
}

const _assessmentCache = (assessmentCacheData as { assessments: Record<string, { redListCategory?: string; alienCategory?: string }> }).assessments;

export async function enrichWithAssessments(obs: NatureObs[]): Promise<NatureObs[]> {
  const uniqueNames = [...new Set(obs.map(o => o.scientificName))];
  const amap = new Map<string, { redListCategory?: string; alienCategory?: string }>();

  const cacheMisses = uniqueNames.filter(n => {
    const cached = _assessmentCache[n];
    if (cached !== undefined) { amap.set(n, cached); return false; }
    return true;
  });

  if (cacheMisses.length > 0) {
    const BATCH = 20;
    for (let i = 0; i < cacheMisses.length; i += BATCH) {
      const batch = cacheMisses.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(n => fetchArtsdatabankenAssessment(n)));
      batch.forEach((n, j) => amap.set(n, results[j]));
    }
  }

  return obs.map(o => ({ ...o, ...(amap.get(o.scientificName) ?? {}) }));
}

export function processNatureData(rawGroups: { group: NatureGroup; obs: unknown[] }[]): NatureObs[] {
  const countMap = new Map<number, number>();
  const latestMap = new Map<number, { raw: Record<string, unknown>; group: NatureGroup; date: string }>();

  for (const { group, obs } of rawGroups) {
    for (const o of obs as Record<string, unknown>[]) {
      const key = o.speciesKey as number;
      if (!key || !o.decimalLatitude || !o.species) continue;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
      const date = String(o.eventDate ?? '');
      const existing = latestMap.get(key);
      if (!existing || date > existing.date) latestMap.set(key, { raw: o, group, date });
    }
  }

  const result: NatureObs[] = [];
  for (const [key, { raw, group, date }] of latestMap) {
    result.push({
      scientificName: String(raw.species ?? ''),
      popularName: '',
      photoUrl: '',
      photoAttribution: '',
      group,
      lat: raw.decimalLatitude as number,
      lng: raw.decimalLongitude as number,
      date,
      obsCount: countMap.get(key) ?? 1,
      gbifKey: key,
      family: String(raw.family ?? ''),
      familyKey: raw.familyKey as number | undefined,
    });
  }

  return result.sort((a, b) => b.obsCount - a.obsCount || a.scientificName.localeCompare(b.scientificName));
}
