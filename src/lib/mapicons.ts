// Pin/marker HTML builders and the dock's filter-tile config. Kept separate
// from VeierlandApp.tsx so the pure "given data, build an icon string" logic
// isn't buried inside the 4000+ line component file.
import { ICONS } from './icons';
import { NatureObs, RED_LIST_CATS } from './naturedata';

export function markerSize(zoom: number): number {
  return Math.round(Math.max(14, Math.min(34, 14 + (zoom - 11) * 5)));
}

export function makeIconHtml(icon: string, color: string, selected: boolean, sz: number): string {
  const svgSz = Math.round(sz * 0.59);
  const svg = `<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="${svgSz}" height="${svgSz}">${ICONS[icon] ?? ICONS.wc}</svg>`;
  return `<div class="vl-pin${selected ? ' sel' : ''}" style="--pc:${color};width:${sz}px;height:${sz}px">${svg}</div>`;
}

// Bigger pin with the place name shown directly beneath it, for activity-mode
// map views (e.g. "Bade") where tapping to see a name isn't realistic for
// young or elderly users. Kept separate from makeIconHtml so the hot default
// per-marker render path (called for every POI, every render) stays untouched.
export function makeLabeledIconHtml(icon: string, color: string, selected: boolean, sz: number, label: string, labelAbove = false): string {
  const svgSz = Math.round(sz * 0.55);
  const svg = `<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="${svgSz}" height="${svgSz}">${ICONS[icon] ?? ICONS.wc}</svg>`;
  return `<div class="vl-pin-labeled-wrap${labelAbove ? ' above' : ''}"><div class="vl-pin vl-pin-lg${selected ? ' sel' : ''}" style="--pc:${color};width:${sz}px;height:${sz}px">${svg}</div><div class="vl-pin-label">${label}</div></div>`;
}

// The dock's "Hva vil du i dag?" tiles come in two kinds. Filter tiles
// (below) narrow the map to a set of POI categories and swap the dock to a
// compact summary + list; route tiles (Gå tur/Historie/Dyreliv) jump straight
// to the existing richer Turer/Historie/Natur tabs instead of a lesser
// filtered view. FILTER_TILES is the single source of truth for the filter
// kind — categories + the counted-noun label — so adding one is one entry.
export type FilterTile = 'bade' | 'spise' | 'fornminner' | 'praktisk';
export const FILTER_TILES: Record<FilterTile, { cats: string[]; noun: [string, string] }> = {
  bade:       { cats: ['bad'],                   noun: ['badeplasser', 'beaches'] },
  spise:      { cats: ['mat'],                   noun: ['spisesteder', 'places to eat'] },
  fornminner: { cats: ['arkeologi'],             noun: ['fornminner', 'ancient sites'] },
  // Label is "Tjenester"/"Services" in the dock, not "Praktisk" — that name
  // is already taken by the Steder tab's broader "Praktisk" group chip
  // (bad+ferge+havn+kultur+info+mat+friluft), a different, larger set.
  praktisk:   { cats: ['ferge', 'havn', 'info'], noun: ['tjenester', 'services'] },
};

// Activity-mode labels drop the word that's already implied by the active
// tile (e.g. "badeplass" while browsing Bade) — shorter text collides with
// neighbouring labels less often when two spots sit close together.
export function tileLabel(navn: string, tile: FilterTile | null): string {
  if (tile === 'bade') return navn.replace(/\s*badeplass$/i, '');
  return navn;
}

// Place names (stedsnavn): a plain text label with no icon circle, kept
// visually lighter than real POI pins since it's a map annotation, not a
// tappable place. Only rendered once zoomed in — see STEDSNAVN_MIN_ZOOM.
export const STEDSNAVN_MIN_ZOOM = 15;
export function makeStedsnavnHtml(name: string, selected: boolean): string {
  return `<div class="vl-stedsnavn${selected ? ' sel' : ''}">${name}</div>`;
}

export function iconSvg(icon: string): string {
  return `<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">${ICONS[icon] ?? ICONS.wc}</svg>`;
}

export function obsRingClass(obs: NatureObs): string {
  if (obs.redListCategory && RED_LIST_CATS.test(obs.redListCategory)) return ' ring-rl';
  if (obs.alienCategory) return ' ring-al';
  return '';
}

export function makeNatureIconHtml(color: string, iconKey: string, selected: boolean, sz: number, dimmed = false, ring = ''): string {
  const svgSz = Math.round(sz * 0.56);
  const svg = `<svg viewBox="-12 -12 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="${svgSz}" height="${svgSz}">${ICONS[iconKey] ?? ICONS.blad}</svg>`;
  return `<div class="vl-nat-pin${selected ? ' sel' : ''}${dimmed ? ' dimmed' : ''}${ring}" style="--gc:${color};width:${sz}px;height:${sz}px">${svg}</div>`;
}
