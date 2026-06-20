import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import historyData from '../data/veierland_history.json';

export interface TimelineSection {
  era: string;
  period: string;
  title: { no: string; en: string };
  body: { no: string; en: string };
  anekdoter: string[];
  kontekst_norge: string;
  image?: string;
  image_caption?: string;
}

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
        return base.map((b, i) => stored[i] ? { ...b, ...stored[i] } : b);
      }
    }
    return base;
  } catch {
    return base;
  }
}

export async function saveTimelineSections(sections: TimelineSection[]): Promise<void> {
  await setDoc(doc(db, COL, DOC_ID), { json: JSON.stringify(sections) });
}
