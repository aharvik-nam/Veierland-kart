export const ICONS: Record<string, string> = {
  // Steder / POI
  bade:       '<path d="M-6,-2 q3,-3 6,0 q3,3 6,0"/><path d="M-6,3 q3,-3 6,0 q3,3 6,0"/>',
  tur:        '<path d="M-5,6 C-8,1 -1,2 0,-2 C1,-6 7,-5 4,-9"/>',
  utsikt:     '<path d="M-7,0 C-4,-4.5 4,-4.5 7,0 C4,4.5 -4,4.5 -7,0 Z"/><circle cx="0" cy="0" r="1.7" fill="#fff" stroke="none"/>',
  ferge:      '<path d="M-7,2 L7,2 L5,6 L-5,6 Z"/><path d="M0,2 L0,-6"/><path d="M0,-6 L5,-3 L0,-1" fill="#fff"/>',
  anker:      '<circle cx="0" cy="-5" r="2.2" fill="none"/><path d="M0,-2.8 L0,6"/><path d="M-5,0 H5"/><path d="M-5,6 C-8,6 -8,3 -5,3"/><path d="M5,6 C8,6 8,3 5,3"/>',
  mat:        '<path d="M-5,-3 L5,-3 L4,3 a2.4,2.4 0 0 1-2.4,2.4L-1.6,2.4a2.4,2.4 0 0 1-2.4,-2.4Z"/><path d="M5,-2 a2.6,2.6 0 0 1 0,4.4"/><path d="M-1,-7 v2.4"/>',
  kultur:     '<path d="M-7,-3 L0,-8 L7,-3"/><path d="M-5,-3 v8"/><path d="M0,-3 v8"/><path d="M5,-3 v8"/><path d="M-7,5 H7"/>',
  telt:       '<path d="M0,-7 L7.5,6 L-7.5,6 Z"/><path d="M0,-7 L0,6"/><path d="M0,6 L-2.5,6"/>',
  wc:         '<circle cx="0" cy="0" r="6.5"/><path d="M0,-2.6 v0.2"/><path d="M0,0 v3.2"/>',
  blad:       '<path d="M0,8 Q-8,-1 0,-9 Q8,-1 0,8Z"/><path d="M0,-9 Q-2,0 0,8"/>',
  all:        '<rect x="-7" y="-7" width="5.5" height="5.5" rx="1.2"/><rect x="1.5" y="-7" width="5.5" height="5.5" rx="1.2"/><rect x="-7" y="1.5" width="5.5" height="5.5" rx="1.2"/><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2"/>',
  // Natur
  fugl:       '<path d="M-9,3 C-5,-5 5,-5 9,3 C5,0 1,0 0,-2 C-1,0 -5,0 -9,3Z"/><path d="M0,-2 L0,7"/><path d="M-2,7 L2,7"/>',
  plante:     '<path d="M0,9 C-7,5 -7,-2 0,-9 C7,-2 7,5 0,9Z"/><path d="M0,-9 L0,9"/>',
  pattedyr:   '<circle cx="-3.5" cy="-5.5" r="2.5"/><circle cx="3.5" cy="-5.5" r="2.5"/><path d="M-6,0 C-7,-4 -4,-6 0,-4 C4,-6 7,-4 6,0 C5,5 3,8 0,8 C-3,8 -5,5 -6,0Z"/>',
  sopp:       '<path d="M-8,-1 Q-8,-9 0,-9 Q8,-9 8,-1 Z"/><path d="M0,-1 L0,8"/><path d="M-3,8 L3,8"/>',
  sommerfugl: '<path d="M0,1 C-2,-1 -9,0 -8,-5 C-7,-9 -2,-7 0,1Z"/><path d="M0,1 C2,-1 9,0 8,-5 C7,-9 2,-7 0,1Z"/><path d="M0,1 C-1,2 -5,5 -3,8 C-1,9 0,5 0,1Z"/><path d="M0,1 C1,2 5,5 3,8 C1,9 0,5 0,1Z"/>',
  rodliste:   '<path d="M0,-9 L8.5,7 L-8.5,7 Z"/><path d="M0,-2 L0,2"/><circle cx="0" cy="5" r="1.5" fill="currentColor" stroke="none"/>',
  fremmed:    '<circle cx="0" cy="1" r="7"/><path d="M0,-10 L0,-6"/><path d="M-3,-8 L0,-6 L3,-8"/>',
  // Ekstra POI-ikoner
  kirke:      '<path d="M0,-9 V-2"/><path d="M-3.5,-6 H3.5"/><path d="M-5,-2 H5 V8 H-5 Z"/><path d="M-2,8 V3 H2 V8"/>',
  fyr:        '<path d="M-2.5,-9 H2.5 L4,2 H-4 Z"/><path d="M-5,2 H5"/><path d="M-4,2 L-5,8 H5 L4,2"/><path d="M-7,-6 L-3,-4"/><path d="M7,-6 L3,-4"/>',
  hus:        '<path d="M-7,1 L0,-7 L7,1"/><path d="M-6,1 V8 H6 V1"/><path d="M-2,8 V4 H2 V8"/>',
  bat:        '<path d="M-8,3 Q0,-1 8,3"/><path d="M-6,3 L-5,7 H5 L6,3"/><path d="M0,3 V-5"/><path d="M0,-5 L4,-2"/>',
  fisk:       '<path d="M8,0 C5,-5 -1,-4 -5,-1 C-8,0 -9,0 -8,1 C-6,4 -1,4 -5,1 C-1,4 5,5 8,0Z"/><circle cx="5" cy="-1" r="1.2" fill="#fff" stroke="none"/>',
  sykkel:     '<circle cx="-5" cy="4" r="4" fill="none"/><circle cx="5" cy="4" r="4" fill="none"/><path d="M-5,4 L0,-3 L5,4"/><path d="M0,-3 V-7"/><path d="M-2,-7 H2"/>',
  baal:       '<path d="M0,8 C-3,4 -4,-1 -1,-6 C0,-2 2,-4 1,-8 C4,-4 4,2 2,5 C3,2 3,-1 1,-3 C2,1 1,5 0,8Z"/>',
  kors:       '<path d="M0,-8 V8"/><path d="M-5,-2 H5"/>',
  parkering:  '<rect x="-7" y="-8" width="14" height="16" rx="2" fill="none"/><path d="M-3,-5 H1 C3,-5 4.5,-3.5 4.5,-1.5 C4.5,0.5 3,2 1,2 H-3"/><path d="M-3,-5 V6"/>',
  overnatting:'<path d="M-8,4 H8"/><path d="M-7,4 V-2 Q-7,-5 -4,-5 H4 Q7,-5 7,-2 V4"/><path d="M-8,-2 Q-8,-8 0,-8 Q8,-8 8,-2"/>',
  attraksjon: '<path d="M0,-9 L2.2,-3 L9,-3 L3.5,1 L5.5,8 L0,4 L-5.5,8 L-3.5,1 L-9,-3 L-2.2,-3 Z"/>',
  kart:       '<rect x="-8" y="-7" width="16" height="14" rx="1.5" fill="none"/><path d="M-3,-7 V7"/><path d="M3,-7 V7"/><path d="M-8,-1 H8"/>',
  info:       '<circle cx="0" cy="-5" r="1.8" fill="currentColor" stroke="none"/><path d="M-2.5,0 H0 V7 M-2.5,7 H2.5"/>',
  hval:       '<path d="M-9,2 C-6,-4 2,-5 6,-2 C8,-1 9,1 7,3 C5,5 2,4 0,3 C-2,2 -4,1 -6,4 Z"/><path d="M-9,2 C-10,-1 -10,-3 -8,-5"/>',
};

export const ICON_LABELS: Record<string, string> = {
  bade: 'Bading', tur: 'Tur/sti', utsikt: 'Utsikt', ferge: 'Ferge/brygge',
  anker: 'Anker/havn', mat: 'Mat', kultur: 'Kulturminne', telt: 'Camping',
  wc: 'Generell', blad: 'Natur/blad', fugl: 'Fugl', plante: 'Plante',
  pattedyr: 'Pattedyr', sopp: 'Sopp', sommerfugl: 'Sommerfugl',
  kirke: 'Kirke', fyr: 'Fyrtårn', hus: 'Hus/gård', bat: 'Båt',
  fisk: 'Fisk', sykkel: 'Sykkel', baal: 'Bål', kors: 'Kors',
  parkering: 'Parkering', overnatting: 'Overnatting', attraksjon: 'Attraksjon',
  kart: 'Kart', info: 'Info', hval: 'Hval',
};

export function iconSvg(key: string): string {
  const path = ICONS[key] ?? ICONS.wc;
  return `<svg viewBox="-10 -10 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
