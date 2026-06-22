import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import historyData from '../data/veierland_history.json';

export interface TimelineSection {
  era: string;
  period: string;
  title: { no: string; en: string };
  body: { no: string; en: string };
  body_lang?: { no: string; en: string };
  anekdoter: string[];
  kontekst_norge: string;
  sea_level_m: number;
  image?: string;
  image_caption?: string;
  poi_ids?: string[];
}

// Default sea levels per era — moved here so they travel with the data,
// not as a hardcoded lookup table keyed by a string that can change.
const DEFAULT_SEA_LEVEL: Record<string, number> = {
  'Steinalder': 15,       // ca. 6000 f.Kr. → +10-15 m (teksten sier 15 m)
  'Bronsealder': 5,       // ca. 2000 f.Kr. → +4-6 m
  'Jernalder': 3,         // ca. 0 e.Kr.    → +2-4 m
  'Folkevandringstid': 2, // ca. 550 e.Kr.  → +2-3 m (interpolert)
  'Vikingtid': 2,         // ca. 800 e.Kr.  → +1.5-3 m
  'Middelalder': 1,       // ca. 1200 e.Kr. → +1-2 m
  'Napoleonskrigene': 1,
  'Gårder og kulturlandskap': 1,
  'Skipsbygging og handel': 1,
  'Hvalfangst': 1,
  'Veierland kirke': 0,
};

const COL = 'geodata';
const DOC_ID = 'timeline_sections';

function defaultSections(): TimelineSection[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (historyData.sections as any[]).map(s => ({
    era: s.era ?? '',
    period: s.period ?? '',
    title: { no: s.title?.no ?? '', en: s.title?.en ?? '' },
    body: { no: s.body?.no ?? '', en: s.body?.en ?? '' },
    anekdoter: s.anekdoter ?? [],
    kontekst_norge: s.kontekst_norge ?? '',
    sea_level_m: s.sea_level_m ?? DEFAULT_SEA_LEVEL[s.era as string] ?? 0,
    image: s.image ?? '',
    image_caption: s.image_caption ?? '',
  }));
}

export const DEFAULT_TIMELINE_SECTIONS: TimelineSection[] = defaultSections();

export async function loadTimelineSections(): Promise<TimelineSection[]> {
  const base = defaultSections();
  if (!isFirebaseConfigured) return base;
  try {
    const snap = await getDoc(doc(db, COL, DOC_ID));
    if (snap.exists()) {
      const raw = snap.data();
      if (raw.json) {
        // Merge by position: Firestore wins field-by-field, base fills any missing fields.
        // Using index (not era) so renaming an era never loses its data.
        const stored: Partial<TimelineSection>[] = JSON.parse(raw.json);
        return base.map((b, i) => stored[i] ? { ...b, ...stored[i], sea_level_m: b.sea_level_m } : b);
      }
    }
    return base;
  } catch {
    return base;
  }
}

export async function saveTimelineSections(sections: TimelineSection[]): Promise<void> {
  if (!isFirebaseConfigured) throw new Error('Firebase ikke konfigurert');
  await setDoc(doc(db, COL, DOC_ID), { json: JSON.stringify(sections) });
}
