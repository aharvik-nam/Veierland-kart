import { db, isFirebaseConfigured } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

/* Admin-editable app theme. The six colors below are the "voice" of the UI
   (Organic design system roles); every other tone the app needs (hover
   tints, pressed states, hairlines, muted text) is DERIVED from them in
   applyThemeCfg, so the admin only ever has to pick colors that make sense
   together — the ramps follow automatically. */

export interface ThemeCfg {
  /** Primary accent (buttons, active states) — terracotta by default */
  accent: string;
  /** Second accent ("second voice": position dot, group rails) — sage */
  accent2: string;
  /** Page ground behind everything */
  page: string;
  /** Card / sheet surface */
  card: string;
  /** Secondary surface (tinted fills, hovers) */
  card2: string;
  /** Text ink */
  ink: string;
}

export const DEFAULT_THEME_CFG: ThemeCfg = {
  accent: '#c67139',
  accent2: '#7a8a5e',
  page: '#f5ead8',
  card: '#f9f4ed',
  card2: '#eee7db',
  ink: '#201e1d',
};

const COL = 'geodata';
const DOC_ID = 'theme_cfg';

export async function loadThemeCfg(): Promise<ThemeCfg> {
  if (!isFirebaseConfigured) return DEFAULT_THEME_CFG;
  try {
    const snap = await getDoc(doc(db, COL, DOC_ID));
    if (!snap.exists()) return DEFAULT_THEME_CFG;
    const raw = snap.data();
    return raw.json ? { ...DEFAULT_THEME_CFG, ...JSON.parse(raw.json) } : DEFAULT_THEME_CFG;
  } catch {
    return DEFAULT_THEME_CFG;
  }
}

export async function saveThemeCfg(cfg: ThemeCfg): Promise<void> {
  if (!isFirebaseConfigured) throw new Error('Firebase ikke konfigurert');
  await setDoc(doc(db, COL, DOC_ID), { json: JSON.stringify(cfg) });
}

/* ── Color math ─────────────────────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Blend `hex` toward `toward` by weight 0..1 (0 = unchanged). */
export function mixHex(hex: string, toward: string, weight: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(toward);
  return rgbToHex(r1 + (r2 - r1) * weight, g1 + (g2 - g1) * weight, b1 + (b2 - b1) * weight);
}

/** WCAG relative-luminance contrast ratio between two hex colors. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const [a, b] = [lum(hexA), lum(hexB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/* ── Apply ──────────────────────────────────────────────────────────────── */

/** Set every CSS custom property the stylesheet reads, deriving the tonal
 * ramp steps (hover/pressed/tint/muted/hairline) from the six base colors. */
export function applyThemeCfg(t: ThemeCfg): void {
  const root = document.documentElement.style;
  const set = (k: string, v: string) => root.setProperty(k, v);

  set('--accent', t.accent);
  set('--accent-600', mixHex(t.accent, '#000000', 0.12)); // hover
  set('--accent-700', mixHex(t.accent, '#000000', 0.30)); // pressed / AA text
  set('--accent-100', mixHex(t.accent, '#ffffff', 0.88)); // tinted fill
  set('--accent2', t.accent2);
  set('--accent2-100', mixHex(t.accent2, '#ffffff', 0.88));
  set('--accent2-800', mixHex(t.accent2, '#000000', 0.50));
  set('--page', t.page);
  set('--card', t.card);
  set('--card2', t.card2);
  set('--sidebar', mixHex(t.page, t.ink, 0.04));
  set('--ink', t.ink);
  set('--ink2', mixHex(t.ink, t.card2, 0.18));
  set('--muted', mixHex(t.ink, t.card2, 0.33));
  set('--line', `color-mix(in srgb, ${t.ink} 16%, transparent)`);
  set('--line2', `color-mix(in srgb, ${t.ink} 9%, transparent)`);
  set('--onaccent', t.page);
  set('--me', t.accent2);
}
