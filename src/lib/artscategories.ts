import raw from '../data/veierland_arter_app.json';

// Hand-curated species categories (replacing the old auto-generated
// "Høydepunkter"/"Mest observert" split) — each category is a deliberately
// chosen, ordered list of species with a short written note, covering both
// biodiversity framing (Artsmangfold) and the island's maritime/cultural
// history framing (Kulturhistorie).

export type ArtsSeksjon = 'Artsmangfold' | 'Kulturhistorie';

export interface CuratedArt {
  norsk: string | null;
  vitenskapelig: string;
  gruppe: string;
  kategori: string; // red-list/alien code, or 'Unknown' for un-assessed taxa
  antallFunn: number;
  aarSpenn: string;
  note: string;       // short one-line hook, shown as the accent quote
  beskrivelse: string; // fuller written paragraph, shown as the main body text
}

export interface ArtsKategori {
  id: string;
  tittel: string;
  seksjon: ArtsSeksjon;
  beskrivelse: string;
  antallArter: number;
  arter: CuratedArt[];
}

export const ARTS_KATEGORIER: ArtsKategori[] = (raw as any).kategorier;

// Icon + colour per free-text `gruppe` label. Only 5 of these overlap with
// NATURE_GROUPS (the taxon groups GBIF is queried by) — the curated list
// also reaches into marine invertebrates, algae, and other phyla with no
// dedicated icon, so those fall back to a shared "other nature" glyph with
// their own tint so chips/rows are still visually distinct.
export const ARTSGRUPPE_META: Record<string, { icon: string; color: string }> = {
  'Fugler':        { icon: 'fugl',       color: '#3b7fc4' },
  'Karplanter':    { icon: 'plante',     color: '#4a8a2a' },
  'Pattedyr':      { icon: 'pattedyr',   color: '#8b5c2a' },
  'Sommerfugler':  { icon: 'sommerfugl', color: '#b84fa0' },
  'Sopper':        { icon: 'sopp',       color: '#c07a3a' },
  'Amfibier, reptiler': { icon: 'reptil', color: '#5c8a3a' },
  'Fisker':        { icon: 'fisk',       color: '#2f7a99' },
  'Krepsdyr':      { icon: 'fisk',       color: '#c0682f' },
  'Bløtdyr':       { icon: 'blad',       color: '#3a8a7a' },
  'Alger':         { icon: 'blad',       color: '#2a9d6f' },
  'Armfotinger, pigghuder, kappedyr': { icon: 'blad', color: '#7a6a9d' },
  'Spretthaler':   { icon: 'blad',       color: '#8a7355' },
  'svamper, nesledyr, kammaneter': { icon: 'blad', color: '#b8497a' },
  'Hesteskoormer': { icon: 'blad',       color: '#7a8085' },
};

export function artsgruppeMeta(gruppe: string): { icon: string; color: string } {
  return ARTSGRUPPE_META[gruppe] ?? { icon: 'blad', color: '#6b7a86' };
}
