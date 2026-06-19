import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export interface CatEntry {
  no: string;
  en: string;
  color: string;
  icon: string;
  group: 'praktisk' | 'historisk' | '';
  showInFilter: boolean;
}

export type CatCfgMap = Record<string, CatEntry>;

export const DEFAULT_CAT_CFG: CatCfgMap = {
  bad:        { no: 'Badeplasser',  en: 'Beaches',      color: '#2f9e8f', icon: 'bade',   group: 'praktisk',  showInFilter: true },
  ferge:      { no: 'Brygge',       en: 'Quays',        color: '#3d6ea5', icon: 'ferge',  group: 'praktisk',  showInFilter: true },
  havn:       { no: 'Havn',         en: 'Harbour',      color: '#3d6ea5', icon: 'anker',  group: 'praktisk',  showInFilter: true },
  kultur:     { no: 'Kulturminner', en: 'Heritage',     color: '#b5673e', icon: 'kultur', group: 'praktisk',  showInFilter: true },
  hvalfangst: { no: 'Hvalfangst',   en: 'Whaling',      color: '#7b5ea7', icon: 'utsikt', group: '',          showInFilter: true },
  info:       { no: 'Fasiliteter',  en: 'Facilities',   color: '#6b7a86', icon: 'wc',     group: 'praktisk',  showInFilter: true },
  mat:        { no: 'Servering',    en: 'Food & drink', color: '#e0823c', icon: 'mat',    group: 'praktisk',  showInFilter: true },
  friluft:    { no: 'Friluft',      en: 'Outdoor',      color: '#5f9438', icon: 'tur',    group: 'praktisk',  showInFilter: true },
  arkeologi:  { no: 'Arkeologi',    en: 'Archaeology',  color: '#b5673e', icon: 'kultur', group: 'historisk', showInFilter: true },
  stedsnavn:  { no: 'Stedsnavn',    en: 'Place names',  color: '#7c876f', icon: 'wc',     group: '',          showInFilter: false },
};

const COL = 'geodata';
const DOC_ID = 'cat_cfg';

export async function loadCatCfg(): Promise<CatCfgMap> {
  if (!isFirebaseConfigured) return DEFAULT_CAT_CFG;
  try {
    const snap = await getDoc(doc(db, COL, DOC_ID));
    if (!snap.exists()) return DEFAULT_CAT_CFG;
    const raw = snap.data();
    return raw.json ? JSON.parse(raw.json) : DEFAULT_CAT_CFG;
  } catch {
    return DEFAULT_CAT_CFG;
  }
}

export async function saveCatCfg(cfg: CatCfgMap): Promise<void> {
  await setDoc(doc(db, COL, DOC_ID), { json: JSON.stringify(cfg) });
}
