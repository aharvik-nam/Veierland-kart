import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export interface CatEntry {
  no: string;
  en: string;
  color: string;
  icon: string;
  group: string;
  showInFilter: boolean;
  showInHistory: boolean;
}

export type CatCfgMap = Record<string, CatEntry>;

export const DEFAULT_CAT_CFG: CatCfgMap = {
  bad:        { no: 'Badeplasser',  en: 'Beaches',      color: '#2f9e8f', icon: 'bade',   group: 'Praktisk',  showInFilter: true,  showInHistory: false },
  ferge:      { no: 'Brygge',       en: 'Quays',        color: '#3d6ea5', icon: 'ferge',  group: 'Praktisk',  showInFilter: true,  showInHistory: false },
  havn:       { no: 'Havn',         en: 'Harbour',      color: '#3d6ea5', icon: 'anker',  group: 'Praktisk',  showInFilter: true,  showInHistory: false },
  kultur:     { no: 'Kulturminner', en: 'Heritage',     color: '#b5673e', icon: 'kultur', group: 'Praktisk',  showInFilter: true,  showInHistory: true  },
  hvalfangst: { no: 'Hvalfangst',   en: 'Whaling',      color: '#7b5ea7', icon: 'utsikt', group: '',          showInFilter: true,  showInHistory: true  },
  info:       { no: 'Fasiliteter',  en: 'Facilities',   color: '#6b7a86', icon: 'wc',     group: 'Praktisk',  showInFilter: true,  showInHistory: false },
  mat:        { no: 'Servering',    en: 'Food & drink', color: '#e0823c', icon: 'mat',    group: 'Praktisk',  showInFilter: true,  showInHistory: false },
  friluft:    { no: 'Friluft',      en: 'Outdoor',      color: '#5f9438', icon: 'tur',    group: 'Praktisk',  showInFilter: true,  showInHistory: false },
  arkeologi:  { no: 'Arkeologi',    en: 'Archaeology',  color: '#b5673e', icon: 'kultur', group: 'Historisk', showInFilter: true,  showInHistory: true  },
  stedsnavn:  { no: 'Stedsnavn',    en: 'Place names',  color: '#7c876f', icon: 'wc',     group: '',          showInFilter: false, showInHistory: false },
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
  if (!isFirebaseConfigured) throw new Error('Firebase ikke konfigurert');
  await setDoc(doc(db, COL, DOC_ID), { json: JSON.stringify(cfg) });
}
