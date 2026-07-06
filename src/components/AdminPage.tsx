import React, { useState, useEffect, useRef } from 'react';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../lib/firebase';
import { poiFallback, stedsnavnFallback, turkartFallback, GeoCollection } from '../lib/geodata';
import { DEFAULT_CAT_CFG, CatCfgMap, CatEntry, loadCatCfg, saveCatCfg } from '../lib/catcfg';
import { loadFarmData, saveFarmData, DEFAULT_FARM_DATA, Farm, FarmPerson, FarmShip } from '../lib/farmdata';
import { loadTimelineSections, saveTimelineSections, DEFAULT_TIMELINE_SECTIONS, TimelineSection } from '../lib/timelinedata';
import { ICONS, ICON_LABELS } from '../lib/icons';
import { RouteBuilderMap, RouteOverviewMap, BuiltRouteResult } from './RouteBuilderMap';
import {
  NATURE_GROUPS, NatureGroup, NatureObs, STATIC_NATURE_CACHE,
  loadNatureObs, saveNatureObs, getNatureObsMetadata,
  fetchNatureGroup, processNatureData, enrichWithINaturalist, enrichWithAssessments,
  applyAssessments,
} from '../lib/naturedata';

type Tab = 'poi' | 'stedsnavn' | 'turer' | 'kategorier' | 'garder' | 'tidslinje' | 'natur';
type GeoTab = 'poi' | 'stedsnavn' | 'turer';

const COL = 'geodata';
const DOC: Record<GeoTab, string> = {
  poi: 'veierland_poi',
  stedsnavn: 'veierland_stedsnavn',
  turer: 'turkart',
};
const FALLBACK: Record<GeoTab, GeoCollection> = {
  poi: poiFallback as unknown as GeoCollection,
  stedsnavn: stedsnavnFallback as unknown as GeoCollection,
  turer: turkartFallback,
};


function groupByCat<T>(items: T[], getKey: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of items) {
    const k = getKey(item);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(item);
  }
  return m;
}

// Sections report unsaved changes here so the shell can warn before losing them
const DirtyCtx = React.createContext<(dirty: boolean) => void>(() => {});
function useReportDirty(dirty: boolean) {
  const report = React.useContext(DirtyCtx);
  useEffect(() => {
    report(dirty);
    return () => report(false);
  }, [dirty, report]);
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: '100vh', background: 'var(--page)', color: 'var(--ink)', fontFamily: "'Hanken Grotesk', system-ui, sans-serif", fontSize: 14 } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 56, background: 'var(--card)', borderBottom: '1px solid var(--line)', position: 'sticky' as const, top: 0, zIndex: 100, boxShadow: '0 1px 4px rgba(0,0,0,.05)' },
  h1: { margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', display: 'flex', alignItems: 'center', gap: 8 },
  tabs: { display: 'flex', padding: '0 24px', background: 'var(--card)', borderBottom: '1px solid var(--line)', gap: 2 },
  tab: (active: boolean): React.CSSProperties => ({ padding: '13px 15px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 13.5, color: active ? 'var(--accent)' : 'var(--ink2)', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1, letterSpacing: '-.01em', whiteSpace: 'nowrap' }),
  body: { padding: '24px', maxWidth: 860, margin: '0 auto' },
  pill: (v: 'primary' | 'secondary' | 'danger'): React.CSSProperties => ({ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, background: v === 'primary' ? 'var(--accent)' : v === 'danger' ? '#dc2626' : 'var(--card)', color: v === 'secondary' ? 'var(--ink)' : '#fff', boxShadow: v === 'secondary' ? 'inset 0 0 0 1px var(--line)' : v === 'primary' ? '0 1px 4px rgba(74,124,100,.25)' : '0 1px 3px rgba(220,38,38,.2)', letterSpacing: '-.01em' }),
  featureRow: { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 7, overflow: 'hidden' },
  featureHdr: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', userSelect: 'none' as const, background: 'none', border: 'none', flex: 1, textAlign: 'left' as const, font: 'inherit', color: 'inherit', minWidth: 0 },
  chev: (open: boolean): React.CSSProperties => ({ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', color: 'var(--muted)', flexShrink: 0, display: 'block' }),
  editGrid: { padding: '18px 18px 20px', borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 18px', background: 'var(--card2)' },
  fullSpan: { gridColumn: '1 / -1' } as React.CSSProperties,
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase' as const, letterSpacing: '.06em' },
  input: { width: '100%', boxSizing: 'border-box' as const, padding: '8px 11px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink)', fontSize: 13.5, font: 'inherit' },
  textarea: { width: '100%', boxSizing: 'border-box' as const, padding: '8px 11px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink)', fontSize: 13.5, font: 'inherit', resize: 'vertical' as const, minHeight: 80 },
  imgPreview: { marginTop: 8, borderRadius: 10, maxHeight: 140, maxWidth: '100%', border: '1px solid var(--line)', objectFit: 'cover' as const, display: 'block' },
  deleteBtn: { gridColumn: '1 / -1', padding: '8px 16px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff5f5', color: '#dc2626', fontSize: 13, cursor: 'pointer', fontWeight: 500, justifySelf: 'end', letterSpacing: '-.01em' } as React.CSSProperties,
  addBtn: { width: '100%', padding: '12px', borderRadius: 12, border: '2px dashed var(--line)', background: 'none', color: 'var(--accent)', fontSize: 14, cursor: 'pointer', marginTop: 10, fontWeight: 500, letterSpacing: '-.01em' },
  fileActions: { display: 'flex', gap: 8, marginBottom: 18, alignItems: 'center', flexWrap: 'wrap' as const, padding: '12px 16px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12 },
  infoBox: { background: 'color-mix(in srgb, var(--accent) 8%, var(--card))', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, lineHeight: 1.55 },
  login: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--page)' },
  loginCard: { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 20, padding: '40px 36px', width: 340, boxShadow: '0 4px 28px rgba(0,0,0,.09)' },
  loginTitle: { fontSize: 26, fontWeight: 600, marginBottom: 4, textAlign: 'center' as const, fontFamily: "'Newsreader', Georgia, serif", letterSpacing: '-.02em' },
  loginSub: { fontSize: 13, color: 'var(--muted)', textAlign: 'center' as const, marginBottom: 24 },
  loginInput: { width: '100%', boxSizing: 'border-box' as const, padding: '11px 14px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--card2)', color: 'var(--ink)', fontSize: 15, font: 'inherit', marginBottom: 10 },
  loginBtn: { width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', font: 'inherit', letterSpacing: '-.01em', boxShadow: '0 2px 10px rgba(74,124,100,.3)' },
  error: { color: '#dc2626', fontSize: 13, marginTop: 10, textAlign: 'center' as const, fontWeight: 500 },
  notConfigured: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--page)' },
  toolbar: { display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' as const },
  searchInput: { flex: 1, minWidth: 160, boxSizing: 'border-box' as const, padding: '9px 13px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink)', fontSize: 13.5, font: 'inherit' },
  selectInput: { padding: '9px 11px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink)', fontSize: 13.5, font: 'inherit', cursor: 'pointer' } as React.CSSProperties,
  groupHeader: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '.08em', padding: '18px 0 7px', display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
  groupBadge: { background: 'var(--line2)', border: '1px solid var(--line)', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 600 } as React.CSSProperties,
  moveBtn: { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 7, color: 'var(--muted)', width: 28, height: 28, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 } as React.CSSProperties,
  catPanel: { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 18, overflow: 'hidden' } as React.CSSProperties,
  catPanelHdr: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', cursor: 'pointer', background: 'none', border: 'none', width: '100%', font: 'inherit', color: 'inherit', textAlign: 'left' as const },
  catBody: { padding: '6px 18px 18px', background: 'var(--card2)', borderTop: '1px solid var(--line)' } as React.CSSProperties,
  catItem: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, marginTop: 8 } as React.CSSProperties,
  catInput: { flex: 1, padding: '7px 11px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--ink)', fontSize: 13.5, font: 'inherit' } as React.CSSProperties,
  catDelBtn: { background: 'none', border: '1px solid #fecaca', borderRadius: 7, color: '#dc2626', width: 30, height: 30, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 } as React.CSSProperties,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div style={full ? S.fullSpan : {}}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

// ─── Login ───────────────────────────────────────────────────────────────────
function LoginForm({ onLogin }: { onLogin: (u: User) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, pw);
      onLogin(cred.user);
    } catch {
      setErr('Feil e-post eller passord');
    } finally { setLoading(false); }
  };

  return (
    <div style={S.login}>
      <div style={S.loginCard}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'color-mix(in srgb, var(--accent) 12%, var(--card))', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" />
              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
              <path d="M9 9h.01M15 9h.01" />
            </svg>
          </div>
        </div>
        <div style={S.loginTitle}>Veierland</div>
        <div style={S.loginSub}>Logg inn for å redigere kartdata</div>
        <form onSubmit={submit}>
          <input type="email" placeholder="E-post" autoFocus style={S.loginInput} value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" placeholder="Passord" style={S.loginInput} value={pw} onChange={e => setPw(e.target.value)} />
          <button type="submit" style={S.loginBtn} disabled={loading}>{loading ? 'Logger inn…' : 'Logg inn'}</button>
          {err && <p style={S.error}>{err}</p>}
        </form>
        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <a href="/" style={{ fontSize: 13, color: 'var(--muted)', textDecoration: 'none' }}>← Tilbake til kartet</a>
        </div>
      </div>
    </div>
  );
}

// ─── Data hooks ──────────────────────────────────────────────────────────────
function useTabData(tab: GeoTab) {
  const [data, setDataState] = useState<GeoCollection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    setDataState(null); setErr(''); setDirty(false); setSeeded(false);
    getDoc(doc(db, COL, DOC[tab])).then(snap => {
      if (snap.exists()) {
        const raw = snap.data();
        setDataState(raw.json ? JSON.parse(raw.json) : raw as GeoCollection);
        setSeeded(true);
      } else {
        setDataState(FALLBACK[tab]);
        setSeeded(false);
      }
    }).catch(e => { setErr(e.message); setDataState(FALLBACK[tab]); });
  }, [tab]);

  useReportDirty(dirty);

  const setData = (d: GeoCollection) => { setDataState(d); setDirty(true); };

  const save = async () => {
    if (!data) return;
    setSaving(true); setErr('');
    try {
      await setDoc(doc(db, COL, DOC[tab]), { json: JSON.stringify(data) });
      setDirty(false); setSeeded(true);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return { data, setData, dirty, saving, save, err, seeded };
}

function useCategories() {
  const [cats, setCats] = useState<string[]>(Object.keys(DEFAULT_CAT_CFG));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Derive available categories from cat_cfg (single source of truth)
    loadCatCfg().then(cfg => setCats(Object.keys(cfg)));
  }, []);

  const save = async (newCats: string[]) => {
    // Persist reordered/renamed list back to cat_cfg, preserving existing entry config
    setSaving(true);
    try {
      const current = await loadCatCfg();
      const next: CatCfgMap = {};
      for (const k of newCats) {
        next[k] = current[k] ?? { no: k, en: k, color: '#7c876f', icon: 'wc', group: '', showInFilter: true, showInHistory: false };
      }
      await saveCatCfg(next);
      setCats(newCats);
    } finally { setSaving(false); }
  };

  return { cats, setCats, save, saving };
}

// ─── Categories panel ─────────────────────────────────────────────────────────
function CategoriesPanel({ cats, onChange, onSave, saving }: {
  cats: string[]; onChange: (c: string[]) => void; onSave: (c: string[]) => void; saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [newCat, setNewCat] = useState('');

  const rename = (i: number, v: string) => { const next = [...cats]; next[i] = v; onChange(next); };
  const remove = (i: number) => onChange(cats.filter((_, j) => j !== i));
  const add = () => {
    const v = newCat.trim();
    if (!v || cats.map(c => c.toLowerCase()).includes(v.toLowerCase())) return;
    onChange([...cats, v]);
    setNewCat('');
  };

  return (
    <div style={S.catPanel}>
      <button style={S.catPanelHdr} onClick={() => setOpen(o => !o)}>
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="5" height="5" rx="1.5"/><rect x="9" y="2" width="5" height="5" rx="1.5"/><rect x="2" y="9" width="5" height="5" rx="1.5"/><rect x="9" y="9" width="5" height="5" rx="1.5"/>
        </svg>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Administrer kategorier</span>
        <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 4 }}>{cats.length} stk</span>
        <svg style={{ marginLeft: 'auto', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', color: 'var(--muted)' }} viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="4,6 8,10 12,6"/></svg>
      </button>
      {open && (
        <div style={S.catBody}>
          {cats.map((c, i) => (
            <div key={i} style={S.catItem}>
              <input style={S.catInput} value={c} onChange={e => rename(i, e.target.value)} />
              <button style={S.catDelBtn} onClick={() => remove(i)} title="Slett kategori">✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input
              style={{ ...S.catInput, flex: 1 }}
              placeholder="Ny kategori…"
              value={newCat}
              onChange={e => setNewCat(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
            />
            <button style={{ ...S.pill('secondary'), padding: '7px 14px' }} onClick={add}>+ Legg til</button>
          </div>
          <div style={{ marginTop: 14 }}>
            <button style={S.pill('primary')} onClick={() => onSave(cats)} disabled={saving}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 13H3V3h7l3 3v7z"/><path d="M10 13V9H6v4"/><path d="M6 3v3h5"/></svg>
              {saving ? 'Lagrer…' : 'Lagre kategorier til Firebase'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── POI editor ──────────────────────────────────────────────────────────────
function parseLatLon(text: string): [number, number] | null {
  const parts = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length < 2) return null;
  const a = parseFloat(parts[0]);
  const b = parseFloat(parts[1]);
  if (isNaN(a) || isNaN(b)) return null;
  // Heuristic: lat is typically 55–72 for Norway, lon 4–32
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && Math.abs(a) > Math.abs(b)) return [a, b];
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180 && Math.abs(b) > Math.abs(a)) return [b, a];
  return [a, b];
}

function CoordPasteField({ onParse }: { onParse: (lat: number, lon: number) => void }) {
  const [val, setVal] = useState('');
  const [ok, setOk] = useState<boolean | null>(null);

  const tryParse = (text: string) => {
    const result = parseLatLon(text);
    if (result) {
      onParse(result[0], result[1]);
      setVal('');
      setOk(true);
      setTimeout(() => setOk(null), 1500);
    } else if (text.trim()) {
      setOk(false);
    } else {
      setOk(null);
    }
  };

  return (
    <Field label="Lim inn koordinater (lat, lon)" full>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          style={{ ...S.input, borderColor: ok === false ? '#e53e3e' : ok === true ? '#38a169' : undefined }}
          placeholder="59.157523, 10.353481"
          value={val}
          onChange={e => { setVal(e.target.value); setOk(null); }}
          onPaste={e => {
            const text = e.clipboardData.getData('text');
            e.preventDefault();
            setVal(text);
            tryParse(text);
          }}
          onKeyDown={e => e.key === 'Enter' && tryParse(val)}
        />
        <button
          style={{ ...S.pill('secondary'), padding: '6px 12px', flexShrink: 0 }}
          onClick={() => tryParse(val)}
          type="button"
        >
          {ok === true ? '✓' : 'Sett'}
        </button>
      </div>
      {ok === false && <div style={{ fontSize: 11, color: '#e53e3e', marginTop: 3 }}>Ugyldig format — prøv «59.157, 10.353»</div>}
    </Field>
  );
}

function PoiEditor({ feature, onChange, onDelete, categories }: {
  feature: any; onChange: (f: any) => void; onDelete: () => void; categories: string[];
}) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const setP = (k: string, v: any) => onChange({ ...feature, properties: { ...p, [k]: v } });
  const setCoord = (which: 'lat' | 'lon', v: string) => {
    const n = parseFloat(v); if (isNaN(n)) return;
    const c = [...feature.geometry.coordinates] as [number, number];
    if (which === 'lon') c[0] = n; else c[1] = n;
    onChange({ ...feature, geometry: { ...feature.geometry, coordinates: c } });
  };
  const setLatLon = (newLat: number, newLon: number) => {
    onChange({ ...feature, geometry: { ...feature.geometry, coordinates: [newLon, newLat] } });
  };
  const secDivider = (title: string) => (
    <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--line)', paddingTop: 16, marginTop: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 12 }}>{title}</div>
    </div>
  );

  return (
    <div style={S.editGrid}>
      <Field label="Navn" full><input style={S.input} value={p.navn ?? ''} onChange={e => setP('navn', e.target.value)} /></Field>
      <Field label="Kategorier" full>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', padding: '6px 0' }}>
          {categories.map(c => {
            const current: string[] = p.kategorier ?? (p.kategori ? [p.kategori] : []);
            const checked = current.includes(c);
            return (
              <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => {
                    const next = e.target.checked ? [...current, c] : current.filter(k => k !== c);
                    onChange({ ...feature, properties: { ...p, kategorier: next, kategori: next[0] ?? '' } });
                  }}
                />
                {c}
              </label>
            );
          })}
        </div>
        {(p.kategorier ?? [p.kategori]).filter(Boolean).length === 0 && (
          <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>Velg minst én kategori</div>
        )}
      </Field>
      <Field label="Verifisert">
        <select style={S.input} value={p.verifisert ? 'ja' : 'nei'} onChange={e => setP('verifisert', e.target.value === 'ja')}>
          <option value="ja">Ja</option><option value="nei">Nei (omtrentlig)</option>
        </select>
      </Field>
      {secDivider('Innhold')}
      <Field label="Kortbeskrivelse" full><textarea style={S.textarea} value={p.beskrivelse ?? ''} onChange={e => setP('beskrivelse', e.target.value)} rows={3} /></Field>
      <Field label="Les mer (utvidet tekst)" full><textarea style={{ ...S.textarea, minHeight: 100 }} value={p.beskrivelse_lang ?? ''} onChange={e => setP('beskrivelse_lang', e.target.value)} rows={5} placeholder="Vises kun når brukeren trykker «Les mer»…" /></Field>
      <Field label="Nettside (URL)" full><input style={S.input} type="url" value={p.nettside ?? ''} onChange={e => setP('nettside', e.target.value)} placeholder="https://…" /></Field>
      {secDivider('Bilde')}
      <Field label="Bilde (URL)" full>
        <input style={S.input} type="url" value={p.bilde ?? ''} onChange={e => setP('bilde', e.target.value)} placeholder="https://…" />
        {p.bilde && <img src={p.bilde} alt="" style={S.imgPreview} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
      </Field>
      <Field label="Bildekilde / lisens" full><input style={S.input} value={p.bilde_lisens ?? ''} onChange={e => setP('bilde_lisens', e.target.value)} placeholder="CC BY 2.0 – Navn Navnesen" /></Field>
      {secDivider('Koordinater')}
      <CoordPasteField onParse={setLatLon} />
      <Field label="Breddegrad (lat)"><input style={S.input} type="number" step="0.000001" value={lat} onChange={e => setCoord('lat', e.target.value)} /></Field>
      <Field label="Lengdegrad (lon)"><input style={S.input} type="number" step="0.000001" value={lon} onChange={e => setCoord('lon', e.target.value)} /></Field>
      <Field label="Koordinatkilde"><input style={S.input} value={p.koordinat_kilde ?? ''} onChange={e => setP('koordinat_kilde', e.target.value)} /></Field>
      <button style={S.deleteBtn} onClick={onDelete}>Slett dette punktet</button>
    </div>
  );
}

// ─── Stedsnavn editor ─────────────────────────────────────────────────────────
function StedsnavnEditor({ feature, onChange, onDelete, onMoveToPoi, categories }: {
  feature: any; onChange: (f: any) => void; onDelete: () => void;
  onMoveToPoi: (category: string) => Promise<void>; categories: string[];
}) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const [moveCategory, setMoveCategory] = useState('arkeologi');
  const [moving, setMoving] = useState(false);
  const setP = (k: string, v: any) => onChange({ ...feature, properties: { ...p, [k]: v } });
  const setCoord = (which: 'lat' | 'lon', v: string) => {
    const n = parseFloat(v); if (isNaN(n)) return;
    const c = [...feature.geometry.coordinates] as [number, number];
    if (which === 'lon') c[0] = n; else c[1] = n;
    onChange({ ...feature, geometry: { ...feature.geometry, coordinates: c } });
  };
  const setLatLon = (newLat: number, newLon: number) => {
    onChange({ ...feature, geometry: { ...feature.geometry, coordinates: [newLon, newLat] } });
  };
  const handleMove = async () => {
    setMoving(true);
    try { await onMoveToPoi(moveCategory); } finally { setMoving(false); }
  };
  return (
    <div style={S.editGrid}>
      <Field label="Navn" full><input style={S.input} value={p.navn ?? ''} onChange={e => setP('navn', e.target.value)} /></Field>
      <Field label="Vis på kart">
        <select style={S.input} value={p.visibility === false ? 'nei' : 'ja'} onChange={e => setP('visibility', e.target.value !== 'nei')}>
          <option value="ja">Ja</option><option value="nei">Nei (skjult)</option>
        </select>
      </Field>
      <Field label="Kategori"><input style={S.input} value={p.kategori ?? ''} onChange={e => setP('kategori', e.target.value)} /></Field>
      <Field label="Forklaring" full><textarea style={S.textarea} value={p.forklaring ?? ''} onChange={e => setP('forklaring', e.target.value)} rows={4} /></Field>
      <CoordPasteField onParse={setLatLon} />
      <Field label="Breddegrad (lat)"><input style={S.input} type="number" step="0.000001" value={lat} onChange={e => setCoord('lat', e.target.value)} /></Field>
      <Field label="Lengdegrad (lon)"><input style={S.input} type="number" step="0.000001" value={lon} onChange={e => setCoord('lon', e.target.value)} /></Field>

      {/* Move to Steder */}
      <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const }}>
        <span style={{ fontSize: 13, color: 'var(--muted)', flexShrink: 0 }}>Flytt til Steder som:</span>
        <select
          style={{ ...S.input, flex: 1, minWidth: 120, padding: '6px 8px', fontSize: 13 }}
          value={moveCategory}
          onChange={e => setMoveCategory(e.target.value)}
        >
          {categories.filter(c => c !== '__groups__').map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          style={{ ...S.pill('primary'), flexShrink: 0 }}
          onClick={handleMove}
          disabled={moving}
          type="button"
        >
          {moving ? 'Flytter…' : 'Flytt til Steder →'}
        </button>
      </div>

      <button style={S.deleteBtn} onClick={onDelete}>Slett dette stedsnavnet</button>
    </div>
  );
}

// ─── Collapsible feature row ──────────────────────────────────────────────────
function FeatureRow({ label, meta, children, onMoveUp, onMoveDown }: {
  label: string; meta?: string; children: React.ReactNode;
  onMoveUp?: () => void; onMoveDown?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const showArrows = onMoveUp !== undefined || onMoveDown !== undefined;
  return (
    <div style={{ ...S.featureRow, boxShadow: open ? '0 2px 10px rgba(0,0,0,.06)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button style={S.featureHdr} onClick={() => setOpen(o => !o)}>
          <span style={{ fontWeight: 500, fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-.01em' }}>{label}</span>
          {meta && (
            <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0, background: 'var(--line2)', borderRadius: 6, padding: '2px 8px', fontWeight: 500 }}>
              {meta}
            </span>
          )}
          <svg style={S.chev(open)} viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4,6 8,10 12,6" />
          </svg>
        </button>
        {showArrows && (
          <div style={{ display: 'flex', gap: 3, paddingRight: 12, flexShrink: 0 }}>
            <button style={{ ...S.moveBtn, opacity: onMoveUp ? 1 : 0.25 }} onClick={onMoveUp} disabled={!onMoveUp} title="Flytt opp">↑</button>
            <button style={{ ...S.moveBtn, opacity: onMoveDown ? 1 : 0.25 }} onClick={onMoveDown} disabled={!onMoveDown} title="Flytt ned">↓</button>
          </div>
        )}
      </div>
      {open && children}
    </div>
  );
}

// ─── File actions ─────────────────────────────────────────────────────────────
function FileActions({ tab, data, onUpload, dirty, onSave, saving, seeded }: {
  tab: GeoTab; data: GeoCollection | null; onUpload: (d: GeoCollection) => void;
  dirty: boolean; onSave: () => void; saving: boolean; seeded: boolean;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const r = new FileReader();
    r.onload = ev => { try { onUpload(JSON.parse(ev.target?.result as string)); } catch { alert('Ugyldig JSON-fil'); } };
    r.readAsText(file); e.target.value = '';
  };
  const download = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${DOC[tab]}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div style={S.fileActions}>
      <button style={S.pill('secondary')} onClick={download}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="8,3 8,11"/><polyline points="5,8 8,11 11,8"/><polyline points="3,13 13,13"/></svg>
        Last ned JSON
      </button>
      <button style={S.pill('secondary')} onClick={() => uploadRef.current?.click()}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="8,11 8,3"/><polyline points="5,6 8,3 11,6"/><polyline points="3,13 13,13"/></svg>
        Last opp JSON
      </button>
      <input ref={uploadRef} type="file" accept=".json,.geojson" style={{ display: 'none' }} onChange={handleUpload} />
      <div style={{ flex: 1 }} />
      {dirty && seeded && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>Ulagrede endringer</span>}
      {(dirty || !seeded) && (
        <button style={S.pill('primary')} onClick={onSave} disabled={saving}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 13H3V3h7l3 3v7z"/><path d="M10 13V9H6v4"/><path d="M6 3v3h5"/></svg>
          {saving ? 'Lagrer…' : !seeded ? 'Last opp til Firebase' : 'Lagre til Firebase'}
        </button>
      )}
    </div>
  );
}

// ─── Steder tab ───────────────────────────────────────────────────────────────
function PoiTab() {
  const { data, setData, dirty, saving, save, err, seeded } = useTabData('poi');
  const { cats, setCats, save: saveCats, saving: savingCats } = useCategories();
  const [searchQ, setSearchQ] = useState('');
  const [filterCat, setFilterCat] = useState('');

  const update = (i: number, f: any) => {
    if (!data) return;
    const features = [...data.features]; features[i] = f;
    setData({ ...data, features });
  };
  const del = (i: number) => {
    if (!data || !confirm(`Slett "${data.features[i].properties.navn}"?`)) return;
    setData({ ...data, features: data.features.filter((_, j) => j !== i) });
  };
  const addNew = () => {
    if (!data) return;
    setData({ ...data, features: [...data.features, {
      type: 'Feature',
      properties: { navn: 'Nytt punkt', kategori: cats[0] ?? 'info', beskrivelse: '', verifisert: false, koordinat_kilde: 'manuelt' },
      geometry: { type: 'Point', coordinates: [10.350, 59.160] },
    }]});
  };

  const moveInCat = (i: number, dir: -1 | 1) => {
    if (!data) return;
    const features = [...data.features];
    const cat = features[i].properties.kategori;
    let j = i + dir;
    while (j >= 0 && j < features.length) {
      if (features[j].properties.kategori === cat) break;
      j += dir;
    }
    if (j < 0 || j >= features.length || features[j].properties.kategori !== cat) return;
    [features[i], features[j]] = [features[j], features[i]];
    setData({ ...data, features });
  };

  const hasSameCatNeighbor = (i: number, dir: -1 | 1): boolean => {
    if (!data) return false;
    const cat = data.features[i].properties.kategori;
    for (let j = i + dir; j >= 0 && j < data.features.length; j += dir) {
      if (data.features[j].properties.kategori === cat) return true;
    }
    return false;
  };

  if (!data) return <p style={{ color: 'var(--muted)' }}>{err || 'Laster…'}</p>;

  const indexed = data.features.map((f, i) => ({ f, i }));
  const filtered = indexed.filter(({ f }) => {
    const name = (f.properties.navn ?? '').toLowerCase();
    const matchQ = !searchQ || name.includes(searchQ.toLowerCase());
    const cats: string[] = f.properties.kategorier ?? (f.properties.kategori ? [f.properties.kategori] : []);
    const matchCat = !filterCat || cats.includes(filterCat);
    return matchQ && matchCat;
  });

  const groups = groupByCat(filtered, ({ f }) => f.properties.kategori ?? 'ukjent');
  const presentCats = [...new Set(data.features.map(f => f.properties.kategori).filter(Boolean) as string[])].sort();

  return (
    <>
      <FileActions tab="poi" data={data} onUpload={setData} dirty={dirty} onSave={save} saving={saving} seeded={seeded} />
      {err && <p style={{ color: '#e53e3e', marginBottom: 12 }}>{err}</p>}
      {!seeded && (
        <div style={{ ...S.infoBox, marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="#b45309" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10 2L2 17h16L10 2z"/><line x1="10" y1="9" x2="10" y2="13"/><circle cx="10" cy="16" r=".5" fill="#b45309"/></svg>
          <span style={{ color: '#92400e' }}>Ingen data i Firebase ennå — viser lokal JSON. Trykk «Last opp til Firebase» for å laste opp.</span>
        </div>
      )}

      <CategoriesPanel cats={cats} onChange={setCats} onSave={saveCats} saving={savingCats} />

      <div style={S.toolbar}>
        <input
          style={S.searchInput}
          placeholder="Søk etter steder…"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
        />
        <select style={S.selectInput} value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">Alle kategorier</option>
          {presentCats.map(c => (
            <option key={c} value={c}>
              {c} ({data.features.filter(f => f.properties.kategori === c).length})
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {filtered.length} / {data.features.length} steder
        </span>
      </div>

      {[...groups.entries()].map(([cat, items]) => (
        <div key={cat}>
          <div style={S.groupHeader}>
            <span>{cat}</span>
            <span style={S.groupBadge}>{items.length}</span>
          </div>
          {items.map(({ f, i }) => (
            <FeatureRow
              key={i}
              label={f.properties.navn ?? `Punkt ${i + 1}`}
              meta={(f.properties.kategorier as string[] | undefined)?.join(', ') ?? f.properties.kategori}
              onMoveUp={hasSameCatNeighbor(i, -1) ? () => moveInCat(i, -1) : undefined}
              onMoveDown={hasSameCatNeighbor(i, 1) ? () => moveInCat(i, 1) : undefined}
            >
              <PoiEditor feature={f} onChange={nf => update(i, nf)} onDelete={() => del(i)} categories={cats} />
            </FeatureRow>
          ))}
        </div>
      ))}

      {filtered.length === 0 && (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>Ingen resultater for søket.</p>
      )}

      <button style={S.addBtn} onClick={addNew}>+ Legg til nytt punkt</button>
    </>
  );
}

// ─── Stedsnavn tab ────────────────────────────────────────────────────────────
function StedsnavnTab() {
  const { data, setData, dirty, saving, save, err, seeded } = useTabData('stedsnavn');
  const [searchQ, setSearchQ] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [moveMsg, setMoveMsg] = useState('');

  useEffect(() => {
    loadCatCfg().then(cfg => setCategories(Object.keys(cfg).filter(k => k !== '__groups__')));
  }, []);

  const update = (i: number, f: any) => {
    if (!data) return;
    const features = [...data.features]; features[i] = f;
    setData({ ...data, features });
  };
  const del = (i: number) => {
    if (!data || !confirm(`Slett "${data.features[i].properties.navn}"?`)) return;
    setData({ ...data, features: data.features.filter((_, j) => j !== i) });
  };
  const addNew = () => {
    if (!data) return;
    setData({ ...data, features: [...data.features, {
      type: 'Feature',
      properties: { navn: 'Nytt stedsnavn', forklaring: '', kategori: 'stedsnavn', visibility: true },
      geometry: { type: 'Point', coordinates: [10.350, 59.160] },
    }]});
  };

  const moveToPoi = async (i: number, category: string) => {
    if (!data) return;
    const feature = data.features[i];
    const navn = feature.properties.navn ?? 'Ukjent';

    // Fetch current POI collection
    const snap = await getDoc(doc(db, COL, DOC['poi']));
    const poiData: any = snap.exists()
      ? (snap.data().json ? JSON.parse(snap.data().json) : snap.data())
      : { type: 'FeatureCollection', features: [] };

    // Build new POI feature from stedsnavn fields
    const newPoi = {
      type: 'Feature',
      properties: {
        navn,
        kategori: category,
        kategorier: [category],
        beskrivelse: feature.properties.forklaring ?? '',
        verifisert: false,
        koordinat_kilde: 'Flyttet fra stedsnavn',
      },
      geometry: { ...feature.geometry },
    };

    // Save updated POI collection
    await setDoc(doc(db, COL, DOC['poi']), {
      json: JSON.stringify({ ...poiData, features: [...poiData.features, newPoi] }),
    });

    // Remove from stedsnavn and save immediately
    const nextData = { ...data, features: data.features.filter((_, j) => j !== i) };
    await setDoc(doc(db, COL, DOC['stedsnavn']), { json: JSON.stringify(nextData) });
    setData(nextData);
    setMoveMsg(`«${navn}» ble flyttet til Steder som kategori «${category}».`);
    setTimeout(() => setMoveMsg(''), 4000);
  };

  if (!data) return <p style={{ color: 'var(--muted)' }}>{err || 'Laster…'}</p>;

  const filtered = data.features
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !searchQ || (f.properties.navn ?? '').toLowerCase().includes(searchQ.toLowerCase()));

  return (
    <>
      <FileActions tab="stedsnavn" data={data} onUpload={setData} dirty={dirty} onSave={save} saving={saving} seeded={seeded} />
      {err && <p style={{ color: '#e53e3e', marginBottom: 12 }}>{err}</p>}
      {moveMsg && <div style={{ ...S.infoBox, marginBottom: 12, color: '#276749' }}>✓ {moveMsg}</div>}
      {!seeded && (
        <div style={{ ...S.infoBox, marginBottom: 16 }}>
          ⚠️ Ingen data i Firebase ennå — viser lokal JSON. Trykk «Last opp til Firebase» for å laste opp.
        </div>
      )}

      <div style={S.toolbar}>
        <input
          style={S.searchInput}
          placeholder="Søk etter stedsnavn…"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
        />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {filtered.length} / {data.features.length} stedsnavn
        </span>
      </div>

      {filtered.map(({ f, i }) => (
        <FeatureRow
          key={i}
          label={f.properties.navn ?? `Stedsnavn ${i + 1}`}
          meta={f.properties.visibility === false ? 'skjult' : undefined}
        >
          <StedsnavnEditor
            feature={f}
            onChange={nf => update(i, nf)}
            onDelete={() => del(i)}
            onMoveToPoi={category => moveToPoi(i, category)}
            categories={categories}
          />
        </FeatureRow>
      ))}

      {filtered.length === 0 && (
        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>Ingen resultater for søket.</p>
      )}

      <button style={S.addBtn} onClick={addNew}>+ Legg til nytt stedsnavn</button>
    </>
  );
}

// ─── Turer tab ────────────────────────────────────────────────────────────────
// Applies a builder result onto a feature: new geometry + all the computed
// properties, keeping name/id/description untouched so re-routing an
// existing trail doesn't wipe its text content.
function applyBuiltRoute(feature: any, built: BuiltRouteResult): any {
  return {
    ...feature,
    properties: {
      ...feature.properties,
      km: built.km,
      tid: built.tid,
      vanskelighet: built.vanskelighet,
      stigning: built.stigning,
      hoydeprofil: built.hoydeprofil,
      minHoyde: built.minHoyde,
      maxHoyde: built.maxHoyde,
      transportmodi: built.transportmodi,
      rutepunkter: built.rutepunkter,
    },
    geometry: { type: 'LineString', coordinates: built.path.map(([lat, lng]) => [lng, lat]) },
  };
}

function TrailEditor({ feature, onChange, onDelete, onOpenBuilder }: {
  feature: any; onChange: (f: any) => void; onDelete: () => void; onOpenBuilder: () => void;
}) {
  const p = feature.properties;
  const setP = (k: string, v: any) => onChange({ ...feature, properties: { ...p, [k]: v } });
  return (
    <div style={S.editGrid}>
      <Field label="Navn (norsk)"><input style={S.input} value={p.navn ?? ''} onChange={e => setP('navn', e.target.value)} /></Field>
      <Field label="Navn (engelsk)"><input style={S.input} value={p.en ?? ''} onChange={e => setP('en', e.target.value)} /></Field>
      <Field label="Lengde"><input style={S.input} value={p.km ?? ''} onChange={e => setP('km', e.target.value)} placeholder="8,5 km" /></Field>
      <Field label="Tid"><input style={S.input} value={p.tid ?? ''} onChange={e => setP('tid', e.target.value)} placeholder="2 t 30 min" /></Field>
      <Field label="Vanskelighet">
        <select style={S.input} value={p.vanskelighet ?? 'Lett'} onChange={e => setP('vanskelighet', e.target.value)}>
          <option>Lett</option><option>Middels</option><option>Krevende</option>
        </select>
      </Field>
      <Field label="Rute-ID"><input style={S.input} value={p.id ?? ''} onChange={e => setP('id', e.target.value)} /></Field>
      <Field label="Beskrivelse (norsk)" full><textarea style={S.textarea} value={p.no ?? ''} onChange={e => setP('no', e.target.value)} rows={3} /></Field>
      <Field label="Beskrivelse (engelsk)" full><textarea style={S.textarea} value={p.enT ?? ''} onChange={e => setP('enT', e.target.value)} rows={3} /></Field>
      <div style={S.fullSpan}>
        <button type="button" onClick={onOpenBuilder} style={{ ...S.pill('secondary'), width: '100%', justifyContent: 'center' }}>
          🗺️ {p.rutepunkter ? 'Rediger rute på kart' : 'Bygg rute på kart (erstatter sporet)'}
        </button>
        {!p.rutepunkter && (
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
            Denne ruta har ingen lagrede rutepunkter (håndtegnet spor) — å bygge på kart her erstatter hele sporet med en ny rute langs veinettet.
          </div>
        )}
      </div>
      <button style={S.deleteBtn} onClick={onDelete}>Slett denne turen</button>
    </div>
  );
}

function TurerTab() {
  const { data, setData, dirty, saving, save, err, seeded } = useTabData('turer');
  const [builderFor, setBuilderFor] = useState<number | 'new' | null>(null);
  const [showOverview, setShowOverview] = useState(false);

  const update = (i: number, f: any) => {
    if (!data) return;
    const features = [...data.features]; features[i] = f;
    setData({ ...data, features });
  };
  const del = (i: number) => {
    if (!data || !confirm(`Slett turen "${data.features[i].properties.navn}"?`)) return;
    setData({ ...data, features: data.features.filter((_, j) => j !== i) });
  };

  if (!data) return <p style={{ color: 'var(--muted)' }}>{err || 'Laster…'}</p>;

  if (builderFor !== null) {
    const editingExisting = typeof builderFor === 'number';
    const feature = editingExisting ? data.features[builderFor as number] : null;
    const initialWaypoints = feature?.properties.rutepunkter ?? [];
    return (
      <div>
        <div style={{ marginBottom: 12, fontWeight: 600 }}>
          {editingExisting ? `Redigerer: ${feature.properties.navn}` : 'Ny rute'}
        </div>
        <RouteBuilderMap
          initialWaypoints={initialWaypoints}
          onCancel={() => setBuilderFor(null)}
          onUse={built => {
            if (editingExisting) {
              update(builderFor as number, applyBuiltRoute(feature, built));
            } else {
              const id = `t-custom-${Date.now()}`;
              const newFeature = applyBuiltRoute({
                type: 'Feature',
                properties: { id, navn: 'Ny rute', en: '', no: '', enT: '' },
                geometry: { type: 'LineString', coordinates: [] },
              }, built);
              setData({ ...data, features: [...data.features, newFeature] });
            }
            setBuilderFor(null);
          }}
        />
      </div>
    );
  }

  return (
    <>
      <FileActions tab="turer" data={data} onUpload={setData} dirty={dirty} onSave={save} saving={saving} seeded={seeded} />
      {err && <p style={{ color: '#e53e3e', marginBottom: 12 }}>{err}</p>}
      {!seeded && (
        <div style={{ ...S.infoBox, marginBottom: 16 }}>
          ⚠️ Ingen data i Firebase ennå — viser lokal JSON. Trykk «Last opp til Firebase» for å laste opp.
        </div>
      )}
      <div style={S.infoBox}>
        {data.features.length} turrute(r). Navn, lengde, tid og beskrivelser redigeres her direkte; selve ruta bygges på kart —
        klikk «Bygg rute på kart» inne på en tur, eller «Ny rute» under.
      </div>
      <div style={S.toolbar}>
        <button type="button" style={S.pill('secondary')} onClick={() => setShowOverview(v => !v)}>
          {showOverview ? 'Skjul kartoversikt' : '🗺️ Vis alle ruter på kart'}
        </button>
        <button type="button" style={S.pill('primary')} onClick={() => setBuilderFor('new')}>+ Ny rute</button>
      </div>
      {showOverview && (
        <div style={{ marginBottom: 18 }}>
          <RouteOverviewMap routes={data.features.map((f, i) => ({
            id: f.properties.id ?? String(i),
            navn: f.properties.navn ?? `Rute ${i + 1}`,
            path: (f.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]),
          }))} />
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
            Grønt flagg = start, rødt flagg = mål, piler viser gåretningen for hver rute.
          </div>
        </div>
      )}
      {data.features.map((f, i) => (
        <FeatureRow key={i}
          label={f.properties.navn ?? f.properties.id ?? `Rute ${i + 1}`}
          meta={[f.properties.km, f.properties.tid, f.properties.vanskelighet].filter(Boolean).join(' · ')}>
          <TrailEditor feature={f} onChange={nf => update(i, nf)} onDelete={() => del(i)} onOpenBuilder={() => setBuilderFor(i)} />
        </FeatureRow>
      ))}
    </>
  );
}

// ─── Kategorier tab ───────────────────────────────────────────────────────────

const ALL_ICON_KEYS = Object.keys(ICONS).filter(k => k !== 'all');

function IconPicker({ value, color, onChange }: { value: string; color: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const svgEl = (key: string, sz = 20, stroke = 'currentColor') =>
    `<svg viewBox="-10 -10 20 20" width="${sz}" height="${sz}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] ?? ICONS.wc}</svg>`;

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button
        type="button"
        title={ICON_LABELS[value] ?? value}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', border: '1px solid var(--line)', borderRadius: 6,
          background: 'var(--bg)', cursor: 'pointer', color,
        }}
      >
        <span dangerouslySetInnerHTML={{ __html: svgEl(value, 22, color) }} />
        <span style={{ fontSize: 12, color: 'var(--fg)' }}>{value}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', left: 0, zIndex: 999,
          background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8,
          padding: 8, boxShadow: '0 4px 18px rgba(0,0,0,.18)',
          display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 3, width: 230,
        }}>
          {ALL_ICON_KEYS.map(k => (
            <button
              key={k}
              type="button"
              title={ICON_LABELS[k] ?? k}
              onClick={() => { onChange(k); setOpen(false); }}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 2, padding: '5px 2px', border: '2px solid',
                borderColor: k === value ? color : 'transparent',
                borderRadius: 6, background: k === value ? color + '20' : 'transparent',
                cursor: 'pointer', color: k === value ? color : 'var(--muted)',
              }}
            >
              <span dangerouslySetInnerHTML={{ __html: svgEl(k, 20, k === value ? color : 'currentColor') }} />
              <span style={{ fontSize: 8, lineHeight: 1, textAlign: 'center', color: 'var(--muted)', maxWidth: 34, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryConfigTab() {
  const [cfg, setCfg] = useState<CatCfgMap>(DEFAULT_CAT_CFG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirtyLocal, setDirtyLocal] = useState(false);
  useReportDirty(dirtyLocal);
  const [newKey, setNewKey] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [editingGroupVal, setEditingGroupVal] = useState('');

  useEffect(() => {
    loadCatCfg().then(setCfg);
  }, []);

  const set = (key: string, field: keyof CatEntry, val: any) => {
    setCfg(prev => ({ ...prev, [key]: { ...prev[key], [field]: val } }));
    setSaved(false); setDirtyLocal(true);
  };

  const groups = [...new Set(Object.values(cfg).map(e => e.group).filter(Boolean))];

  const addGroup = () => {
    const g = newGroup.trim();
    if (!g || groups.includes(g)) return;
    // Assign the first ungrouped category to anchor the new group, or just track via a placeholder
    // We store groups by assigning at least one category; here we just add it to datalist state
    // so user can assign categories to it — no category change needed until they assign one.
    // We store "defined but empty" groups by adding a _groups meta field on the cfg object.
    // Simplest: just update the datalist and let the user pick it in the Gruppe field below.
    setCfg(prev => {
      // Find an ungrouped cat to assign, otherwise just store the group name as metadata
      // We'll use a special __groups__ key to track manually-added group names
      const meta: any = prev['__groups__'] ?? { no: '', en: '', color: '', icon: 'wc', group: '', showInFilter: false, showInHistory: false };
      const existing: string[] = meta._groupList ?? [];
      return {
        ...prev,
        __groups__: { ...meta, _groupList: [...existing.filter((x: string) => x !== g), g] },
      };
    });
    setNewGroup('');
    setSaved(false); setDirtyLocal(true);
  };

  const renameGroup = (oldName: string, newName: string) => {
    const n = newName.trim();
    if (!n || n === oldName) { setEditingGroup(null); return; }
    setCfg(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key].group === oldName) next[key] = { ...next[key], group: n };
      }
      // update __groups__ list too
      if (next['__groups__']) {
        const gl: string[] = (next['__groups__'] as any)._groupList ?? [];
        (next['__groups__'] as any)._groupList = gl.map((x: string) => x === oldName ? n : x);
      }
      return next;
    });
    setEditingGroup(null);
    setSaved(false); setDirtyLocal(true);
  };

  const deleteGroup = (g: string) => {
    const count = Object.values(cfg).filter(e => e.group === g).length;
    if (!confirm(`Slett gruppen «${g}»? ${count > 0 ? `${count} kategori(er) mister grupperingen sin.` : ''}`)) return;
    setCfg(prev => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key].group === g) next[key] = { ...next[key], group: '' };
      }
      if (next['__groups__']) {
        const gl: string[] = (next['__groups__'] as any)._groupList ?? [];
        (next['__groups__'] as any)._groupList = gl.filter((x: string) => x !== g);
      }
      return next;
    });
    setSaved(false); setDirtyLocal(true);
  };

  const addCategory = () => {
    const k = newKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!k || cfg[k]) return;
    setCfg(prev => ({ ...prev, [k]: { no: k, en: k, color: '#7c876f', icon: 'wc', group: '', showInFilter: true, showInHistory: false } }));
    setNewKey('');
    setSaved(false); setDirtyLocal(true);
  };

  const removeCategory = (key: string) => {
    if (!confirm(`Slett kategorien «${key}»? POI-er som bruker den beholder verdien, men den vises ikke lenger i filteret.`)) return;
    setCfg(prev => { const next = { ...prev }; delete next[key]; return next; });
    setSaved(false); setDirtyLocal(true);
  };

  const save = async () => {
    setSaving(true);
    await saveCatCfg(cfg);
    setSaving(false);
    setSaved(true); setDirtyLocal(false);
  };

  // Merge groups from cfg + manually-added
  const manualGroups: string[] = (cfg['__groups__'] as any)?._groupList ?? [];
  const allGroups = [...new Set([...groups, ...manualGroups])];

  const tdS: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle' };
  const thS: React.CSSProperties = { ...tdS, fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'left', background: 'var(--bg)' };

  return (
    <>
      <div style={{ ...S.infoBox, marginBottom: 16 }}>
        Her styrer du kategorier og filtergrupper. <strong>Filtergrupper</strong> er knappene øverst i listen på nettsiden (f.eks. «Praktisk», «Historisk»). Legg til nye grupper nedenfor, og tilordne kategorier til dem i tabellen.
      </div>

      {/* ── Grupper (filterknapper) ── */}
      <div style={{ marginBottom: 24, padding: '14px 16px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--card)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
          Filtergrupper på nettsiden
        </div>
        {allGroups.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>Ingen grupper ennå. Legg til en nedenfor.</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {allGroups.map(g => {
            const catCount = Object.values(cfg).filter(e => e.group === g).length;
            return editingGroup === g ? (
              <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  autoFocus
                  style={{ ...S.input, padding: '4px 8px', fontSize: 13, width: 140 }}
                  value={editingGroupVal}
                  onChange={e => setEditingGroupVal(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') renameGroup(g, editingGroupVal);
                    if (e.key === 'Escape') setEditingGroup(null);
                  }}
                />
                <button onClick={() => renameGroup(g, editingGroupVal)}
                  style={{ ...S.pill('primary'), padding: '4px 10px', fontSize: 12 }}>OK</button>
                <button onClick={() => setEditingGroup(null)}
                  style={{ ...S.pill('secondary'), padding: '4px 10px', fontSize: 12 }}>Avbryt</button>
              </div>
            ) : (
              <div key={g} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 10px', background: 'var(--bg)', border: '1px solid var(--line)',
                borderRadius: 20, fontSize: 13,
              }}>
                <span style={{ fontWeight: 600 }}>{g}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>({catCount})</span>
                <button title="Gi nytt navn" onClick={() => { setEditingGroup(g); setEditingGroupVal(g); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>✎</button>
                <button title="Slett gruppe" onClick={() => deleteGroup(g)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e53e3e', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>✕</button>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            style={{ ...S.input, padding: '5px 10px', maxWidth: 200 }}
            placeholder="Ny gruppe, f.eks. «Natur»"
            value={newGroup}
            onChange={e => setNewGroup(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addGroup()}
          />
          <button style={S.pill('secondary')} onClick={addGroup}>+ Legg til gruppe</button>
        </div>
      </div>


      <div style={{ overflowX: 'auto', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thS}>Nøkkel</th>
              <th style={thS}>Norsk navn</th>
              <th style={thS}>Engelsk navn</th>
              <th style={thS}>Farge</th>
              <th style={thS}>Ikon</th>
              <th style={thS}>Gruppe</th>
              <th style={thS}>Vis i filter</th>
              <th style={thS}>Vis i historie</th>
              <th style={thS}></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(cfg).filter(([key]) => key !== '__groups__').map(([key, entry]) => (
              <tr key={key} style={{ background: 'var(--card)' }}>
                <td style={{ ...tdS, fontWeight: 600, fontFamily: 'monospace', color: 'var(--muted)' }}>{key}</td>
                <td style={tdS}>
                  <input style={{ ...S.input, padding: '5px 8px' }} value={entry.no} onChange={e => set(key, 'no', e.target.value)} />
                </td>
                <td style={tdS}>
                  <input style={{ ...S.input, padding: '5px 8px' }} value={entry.en} onChange={e => set(key, 'en', e.target.value)} />
                </td>
                <td style={{ ...tdS, width: 70 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="color" value={entry.color} onChange={e => set(key, 'color', e.target.value)}
                      style={{ width: 32, height: 28, border: '1px solid var(--line)', borderRadius: 5, cursor: 'pointer', padding: 2, background: 'var(--bg)' }} />
                    <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{entry.color}</span>
                  </div>
                </td>
                <td style={{ ...tdS, width: 130 }}>
                  <IconPicker value={entry.icon} color={entry.color} onChange={v => set(key, 'icon', v)} />
                </td>
                <td style={{ ...tdS, width: 130 }}>
                  <select
                    style={{ ...S.input, padding: '5px 7px', fontSize: 13 }}
                    value={entry.group}
                    onChange={e => set(key, 'group', e.target.value)}
                  >
                    <option value="">— Ingen gruppe —</option>
                    {allGroups.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </td>
                <td style={{ ...tdS, width: 90, textAlign: 'center' }}>
                  <input type="checkbox" checked={entry.showInFilter} onChange={e => set(key, 'showInFilter', e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }} />
                </td>
                <td style={{ ...tdS, width: 90, textAlign: 'center' }}>
                  <input type="checkbox" checked={!!entry.showInHistory} onChange={e => set(key, 'showInHistory', e.target.checked)}
                    style={{ width: 16, height: 16, cursor: 'pointer' }} />
                </td>
                <td style={{ ...tdS, width: 40 }}>
                  <button onClick={() => removeCategory(key)}
                    style={{ background: 'none', border: 'none', color: '#e53e3e', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        <input
          style={{ ...S.input, maxWidth: 200 }}
          placeholder="ny-kategori-nøkkel"
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addCategory()}
        />
        <button style={S.pill('secondary')} onClick={addCategory}>+ Legg til kategori</button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '16px 20px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <button style={S.pill('primary')} onClick={save} disabled={saving}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 13H3V3h7l3 3v7z"/><path d="M10 13V9H6v4"/><path d="M6 3v3h5"/></svg>
          {saving ? 'Lagrer…' : 'Lagre til Firebase'}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,8 6,12 14,4"/></svg>
            Lagret! Endringer er aktive etter neste sideoppdatering.
          </span>
        )}
      </div>
    </>
  );
}

// ─── Gårder tab ──────────────────────────────────────────────────────────────

function FarmEditor({ farm, onChange }: {
  farm: Farm;
  onChange: (patch: Partial<Farm>) => void;
}) {
  const [open, setOpen] = useState(false);

  const setPerson = (i: number, patch: Partial<FarmPerson>) =>
    onChange({ key_people: farm.key_people.map((p, j) => j === i ? { ...p, ...patch } : p) });
  const removePerson = (i: number) =>
    onChange({ key_people: farm.key_people.filter((_, j) => j !== i) });
  const addPerson = () =>
    onChange({ key_people: [...farm.key_people, { name: '', role: '', period: '', note: '' }] });

  const setShip = (i: number, patch: Partial<FarmShip>) =>
    onChange({ ships_built: farm.ships_built.map((s, j) => j === i ? { ...s, ...patch } : s) });
  const removeShip = (i: number) =>
    onChange({ ships_built: farm.ships_built.filter((_, j) => j !== i) });
  const addShip = () =>
    onChange({ ships_built: [...farm.ships_built, { name: '', type: '', year: '', details: '' }] });

  const setAnekdote = (i: number, val: string) =>
    onChange({ anekdoter: farm.anekdoter.map((a, j) => j === i ? val : a) });
  const removeAnekdote = (i: number) =>
    onChange({ anekdoter: farm.anekdoter.filter((_, j) => j !== i) });
  const addAnekdote = () =>
    onChange({ anekdoter: [...farm.anekdoter, ''] });

  const setSource = (i: number, val: string) =>
    onChange({ sources: farm.sources.map((src, j) => j === i ? val : src) });
  const removeSource = (i: number) =>
    onChange({ sources: farm.sources.filter((_, j) => j !== i) });
  const addSource = () =>
    onChange({ sources: [...farm.sources, ''] });

  const setCoord = (idx: 0 | 1, val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n)) {
      const next: [number, number] = [...farm.coordinates] as [number, number];
      next[idx] = n;
      onChange({ coordinates: next });
    }
  };

  const xBtn: React.CSSProperties = {
    background: 'none', border: '1px solid var(--line)', borderRadius: 6,
    color: 'var(--muted)', cursor: 'pointer', padding: '2px 10px', fontSize: 14, flexShrink: 0,
  };
  const addBtnSt: React.CSSProperties = {
    background: 'none', border: '1px dashed var(--line)', borderRadius: 8,
    color: 'var(--accent)', cursor: 'pointer', padding: '6px 14px', fontSize: 13, marginTop: 6, display: 'block',
  };
  const secHdr: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase',
    letterSpacing: '.06em', margin: '18px 0 8px',
  };
  const itemCard: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8,
    padding: '10px 12px', marginBottom: 8,
  };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', background: 'var(--card)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}>
          <input type="checkbox" checked={farm.visible}
            onChange={e => onChange({ visible: e.target.checked })} />
          <strong style={{ fontSize: 15 }}>{farm.name}</strong>
          {farm.norron_name && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{farm.norron_name} · {farm.meaning}</span>
          )}
        </label>
        <button onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, cursor: 'pointer', padding: '4px 12px', fontSize: 12, color: 'var(--muted)' }}>
          {open ? 'Lukk ▲' : 'Rediger ▼'}
        </button>
      </div>

      {open && (
        <div style={{ padding: '0 16px 18px' }}>
          <div style={secHdr}>Koordinater</div>
          <div style={{ display: 'flex', gap: 12 }}>
            {(['Breddegrad (lat)', 'Lengdegrad (lng)'] as const).map((lbl, idx) => (
              <label key={idx} style={{ flex: 1 }}>
                <span style={S.label}>{lbl}</span>
                <input style={S.input} type="number" step="0.0001"
                  value={farm.coordinates[idx as 0 | 1]}
                  onChange={e => setCoord(idx as 0 | 1, e.target.value)} />
              </label>
            ))}
          </div>
          <label style={{ display: 'block', marginTop: 10 }}>
            <span style={S.label}>Plasseringens sikkerhet</span>
            <select style={S.input}
              value={farm.koordinat_sikkerhet}
              onChange={e => onChange({ koordinat_sikkerhet: e.target.value as 'antatt' | 'usikker' | 'sikker' })}>
              <option value="antatt">Antatt</option>
              <option value="usikker">Usikker</option>
              <option value="sikker">Sikker</option>
            </select>
          </label>

          <div style={secHdr}>Grunninfo</div>
          <div style={S.editGrid}>
            <label>
              <span style={S.label}>Norrønt navn</span>
              <input style={S.input} value={farm.norron_name}
                onChange={e => onChange({ norron_name: e.target.value })} />
            </label>
            <label>
              <span style={S.label}>Betydning</span>
              <input style={S.input} value={farm.meaning}
                onChange={e => onChange({ meaning: e.target.value })} />
            </label>
            <label>
              <span style={S.label}>Gårdsnummer (gnr)</span>
              <input style={S.input} type="number" value={farm.gnr}
                onChange={e => onChange({ gnr: parseInt(e.target.value) || 0 })} />
            </label>
            <label>
              <span style={S.label}>Beliggenhet</span>
              <input style={S.input} value={farm.location}
                onChange={e => onChange({ location: e.target.value })} />
            </label>
          </div>

          <div style={secHdr}>Historikk</div>
          <textarea style={{ ...S.textarea, minHeight: 100 }} value={farm.history}
            onChange={e => onChange({ history: e.target.value })} />

          <div style={secHdr}>Arkeologi</div>
          <textarea style={{ ...S.textarea, minHeight: 70 }} value={farm.archaeology}
            onChange={e => onChange({ archaeology: e.target.value })} />

          <div style={secHdr}>Kjente personer</div>
          {farm.key_people.map((p, i) => (
            <div key={i} style={itemCard}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(['name', 'role', 'period', 'note'] as const).map(field => (
                  <input key={field} style={S.input}
                    placeholder={field === 'name' ? 'Navn' : field === 'role' ? 'Rolle' : field === 'period' ? 'Periode' : 'Merknad'}
                    value={p[field]} onChange={e => setPerson(i, { [field]: e.target.value })} />
                ))}
              </div>
              <div style={{ textAlign: 'right', marginTop: 8 }}>
                <button onClick={() => removePerson(i)} style={xBtn}>Fjern</button>
              </div>
            </div>
          ))}
          <button style={addBtnSt} onClick={addPerson}>+ Legg til person</button>

          <div style={secHdr}>Skuter bygget</div>
          {farm.ships_built.map((s, i) => (
            <div key={i} style={itemCard}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(['name', 'type', 'year', 'details'] as const).map(field => (
                  <input key={field} style={S.input}
                    placeholder={field === 'name' ? 'Navn' : field === 'type' ? 'Type' : field === 'year' ? 'År' : 'Detaljer'}
                    value={s[field]} onChange={e => setShip(i, { [field]: e.target.value })} />
                ))}
              </div>
              <div style={{ textAlign: 'right', marginTop: 8 }}>
                <button onClick={() => removeShip(i)} style={xBtn}>Fjern</button>
              </div>
            </div>
          ))}
          <button style={addBtnSt} onClick={addShip}>+ Legg til skute</button>

          <div style={secHdr}>Anekdoter</div>
          {farm.anekdoter.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <textarea style={{ ...S.textarea, flex: 1, minHeight: 60 }} value={a}
                onChange={e => setAnekdote(i, e.target.value)} />
              <button onClick={() => removeAnekdote(i)} style={xBtn}>×</button>
            </div>
          ))}
          <button style={addBtnSt} onClick={addAnekdote}>+ Legg til anekdote</button>

          <div style={secHdr}>Kilder</div>
          {farm.sources.map((src, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input style={{ ...S.input, flex: 1 }} value={src}
                onChange={e => setSource(i, e.target.value)} />
              <button onClick={() => removeSource(i)} style={xBtn}>×</button>
            </div>
          ))}
          <button style={addBtnSt} onClick={addSource}>+ Legg til kilde</button>
        </div>
      )}
    </div>
  );
}

function GarderTab() {
  const [farms, setFarms] = useState<Farm[]>(DEFAULT_FARM_DATA);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirtyLocal, setDirtyLocal] = useState(false);
  useReportDirty(dirtyLocal);

  useEffect(() => { loadFarmData().then(setFarms); }, []);

  const update = (name: string, patch: Partial<Farm>) => {
    setFarms(prev => prev.map(f => f.name === name ? { ...f, ...patch } : f));
    setSaved(false); setDirtyLocal(true);
  };

  const save = async () => {
    setSaving(true);
    try { await saveFarmData(farms); setSaved(true); setDirtyLocal(false); }
    catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        Hak av en gård for å vise den i Historisk-fanen. Klikk «Rediger» for å endre innhold,
        koordinater, skip, folk og anekdoter. Trykk «Lagre» når du er ferdig.
      </p>
      {farms.map(farm => (
        <FarmEditor key={farm.name} farm={farm}
          onChange={patch => update(farm.name, patch)} />
      ))}
      <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center', padding: '16px 20px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <button style={S.pill('primary')} onClick={save} disabled={saving}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 13H3V3h7l3 3v7z"/><path d="M10 13V9H6v4"/><path d="M6 3v3h5"/></svg>
          {saving ? 'Lagrer…' : 'Lagre til Firebase'}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,8 6,12 14,4"/></svg>
            Lagret! Endringer vises etter neste sideoppdatering.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── TidslinjeTab ─────────────────────────────────────────────────────────────

// ─── POI multi-picker ─────────────────────────────────────────────────────────
function PoiMultiPick({ selected, onChange, pois }: {
  selected: string[];
  onChange: (ids: string[]) => void;
  pois: { id: string; navn: string; kategori: string }[];
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = pois.filter(p =>
    !search ||
    p.navn.toLowerCase().includes(search.toLowerCase()) ||
    p.kategori.toLowerCase().includes(search.toLowerCase())
  );
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
          {selected.map(id => {
            const poi = pois.find(p => p.id === id);
            return (
              <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'color-mix(in srgb, var(--accent) 11%, var(--card))', border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)', borderRadius: 20, padding: '3px 6px 3px 10px', fontSize: 12, fontWeight: 500 }}>
                {poi?.navn ?? id}
                <button type="button" onClick={() => toggle(id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '1px 3px', lineHeight: 1, fontSize: 14, borderRadius: 4 }}>×</button>
              </span>
            );
          })}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <input
          style={{ ...S.input, paddingRight: selected.length > 0 ? 44 : 11 }}
          placeholder={pois.length ? `Søk blant ${pois.length} steder…` : 'Laster steder…'}
          value={search}
          onChange={e => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {selected.length > 0 && (
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'var(--accent)', color: '#fff', borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '2px 7px', pointerEvents: 'none' }}>
            {selected.length}
          </span>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 999, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,.13)', maxHeight: 270, overflowY: 'auto' }}>
          {filtered.map(poi => {
            const checked = selected.includes(poi.id);
            return (
              <label key={poi.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', cursor: 'pointer', background: checked ? 'color-mix(in srgb, var(--accent) 7%, var(--card))' : 'transparent', borderBottom: '1px solid var(--line2)' }}>
                <input type="checkbox" checked={checked} onChange={() => toggle(poi.id)} style={{ width: 15, height: 15, accentColor: 'var(--accent)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: checked ? 600 : 400 }}>{poi.navn}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--line2)', borderRadius: 6, padding: '2px 7px', flexShrink: 0 }}>{poi.kategori}</span>
              </label>
            );
          })}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 999, background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', color: 'var(--muted)', fontSize: 13 }}>
          Ingen treff for «{search}».
        </div>
      )}
    </div>
  );
}

// ─── TidslinjeTab ─────────────────────────────────────────────────────────────
function TidslinjeTab() {
  const [sections, setSections] = useState<TimelineSection[]>(DEFAULT_TIMELINE_SECTIONS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirtyLocal, setDirtyLocal] = useState(false);
  useReportDirty(dirtyLocal);
  const [open, setOpen] = useState<number | null>(null);
  const [allPois, setAllPois] = useState<{ id: string; navn: string; kategori: string }[]>([]);

  useEffect(() => { loadTimelineSections().then(setSections); }, []);

  useEffect(() => {
    getDoc(doc(db, COL, DOC['poi'])).then(snap => {
      const raw = snap.exists() ? (snap.data().json ? JSON.parse(snap.data().json) : snap.data()) : poiFallback;
      setAllPois(
        ((raw as any).features ?? [])
          .map((f: any) => ({ id: f.properties.id ?? f.properties.navn, navn: f.properties.navn ?? 'Ukjent', kategori: f.properties.kategori ?? '' }))
          .sort((a: any, b: any) => a.navn.localeCompare(b.navn, 'no'))
      );
    }).catch(() => {
      setAllPois(
        (poiFallback.features ?? [])
          .map((f: any) => ({ id: f.properties.id ?? f.properties.navn, navn: f.properties.navn ?? 'Ukjent', kategori: f.properties.kategori ?? '' }))
          .sort((a: any, b: any) => a.navn.localeCompare(b.navn, 'no'))
      );
    });
  }, []);

  const update = (idx: number, patch: Partial<TimelineSection>) => {
    setSections(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
    setSaved(false); setDirtyLocal(true);
  };

  const save = async () => {
    setSaving(true);
    try { await saveTimelineSections(sections); setSaved(true); setDirtyLocal(false); }
    catch (e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const fieldStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '.05em', marginBottom: 3, display: 'block' };
  const rowStyle: React.CSSProperties = { marginBottom: 12 };

  return (
    <div style={{ maxWidth: 680 }}>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
        Rediger tidslinjeelementene. Lim inn en bilde-URL for å vise bilde i appen.
      </p>
      {sections.map((sec, idx) => {
        const isOpen = open === idx;
        return (
          <div key={idx} style={{ border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8, overflow: 'hidden', background: 'var(--card)' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', background: isOpen ? 'var(--card2)' : 'transparent' }}
              onClick={() => setOpen(isOpen ? null : idx)}
            >
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{sec.era}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>{sec.period}</span>
                {sec.image && <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 8 }}>🖼 bilde</span>}
              </div>
              <span style={{ color: 'var(--muted)', fontSize: 11 }}>{isOpen ? '▲' : '▼'}</span>
            </div>
            {isOpen && (
              <div style={{ padding: '14px 16px', borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div style={rowStyle}>
                    <label style={labelStyle}>Epoke (era)</label>
                    <input style={fieldStyle} value={sec.era} onChange={e => update(idx, { era: e.target.value })} />
                  </div>
                  <div style={rowStyle}>
                    <label style={labelStyle}>Periode</label>
                    <input style={fieldStyle} value={sec.period} onChange={e => update(idx, { period: e.target.value })} />
                  </div>
                </div>
                <div style={rowStyle}>
                  <label style={labelStyle}>Tittel (norsk)</label>
                  <input style={fieldStyle} value={sec.title.no} onChange={e => update(idx, { title: { ...sec.title, no: e.target.value } })} />
                </div>
                <div style={rowStyle}>
                  <label style={labelStyle}>Tittel (engelsk)</label>
                  <input style={fieldStyle} value={sec.title.en} onChange={e => update(idx, { title: { ...sec.title, en: e.target.value } })} />
                </div>
                <div style={rowStyle}>
                  <label style={labelStyle}>Tekst (norsk)</label>
                  <textarea style={{ ...fieldStyle, minHeight: 90, resize: 'vertical' }} value={sec.body.no} onChange={e => update(idx, { body: { ...sec.body, no: e.target.value } })} />
                </div>
                <div style={rowStyle}>
                  <label style={labelStyle}>Les mer – utvidet tekst (norsk)</label>
                  <textarea style={{ ...fieldStyle, minHeight: 80, resize: 'vertical' }} value={sec.body_lang?.no ?? ''} onChange={e => update(idx, { body_lang: { no: e.target.value, en: sec.body_lang?.en ?? '' } })} placeholder="Vises kun når brukeren trykker «Les mer»…" />
                </div>
                <div style={rowStyle}>
                  <label style={labelStyle}>Tekst (engelsk)</label>
                  <textarea style={{ ...fieldStyle, minHeight: 90, resize: 'vertical' }} value={sec.body.en} onChange={e => update(idx, { body: { ...sec.body, en: e.target.value } })} />
                </div>
                <div style={rowStyle}>
                  <label style={labelStyle}>Les mer – utvidet tekst (engelsk)</label>
                  <textarea style={{ ...fieldStyle, minHeight: 80, resize: 'vertical' }} value={sec.body_lang?.en ?? ''} onChange={e => update(idx, { body_lang: { no: sec.body_lang?.no ?? '', en: e.target.value } })} placeholder="Shown only when the user taps «Les mer»…" />
                </div>
                <div style={rowStyle}>
                  <label style={labelStyle}>Kontekst Norge</label>
                  <textarea style={{ ...fieldStyle, minHeight: 60, resize: 'vertical' }} value={sec.kontekst_norge} onChange={e => update(idx, { kontekst_norge: e.target.value })} />
                </div>
                <div style={rowStyle}>
                  <label style={labelStyle}>Steder synlige på kartet for denne epoken</label>
                  <PoiMultiPick
                    selected={sec.poi_ids ?? []}
                    onChange={ids => update(idx, { poi_ids: ids })}
                    pois={allPois}
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
                    Disse stedene vises som markerte pinner på kartet når brukeren er på denne epoken.
                  </div>
                </div>
                <div style={rowStyle}>
                  <label style={labelStyle}>Havnivå (meter over i dag, 0–15)</label>
                  <input
                    style={{ ...fieldStyle, width: 100 }}
                    type="number" min={0} max={15} step={1}
                    value={sec.sea_level_m}
                    onChange={e => update(idx, { sea_level_m: Math.max(0, Math.min(15, Number(e.target.value) || 0)) })}
                  />
                </div>

                {/* Image */}
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Bilde</div>
                  <div style={rowStyle}>
                    <label style={labelStyle}>Bilde-URL</label>
                    <input style={fieldStyle} type="url" placeholder="https://…" value={sec.image ?? ''} onChange={e => update(idx, { image: e.target.value })} />
                  </div>
                  {sec.image && (
                    <div style={{ marginBottom: 10, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
                      <img src={sec.image} alt="preview" style={{ display: 'block', width: '100%', maxHeight: 160, objectFit: 'cover' }} />
                    </div>
                  )}
                  <div style={rowStyle}>
                    <label style={labelStyle}>Bildetekst</label>
                    <input style={fieldStyle} placeholder="Tekst under bildet…" value={sec.image_caption ?? ''} onChange={e => update(idx, { image_caption: e.target.value })} />
                  </div>
                </div>

                {/* Anekdoter */}
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Anekdoter</div>
                  {sec.anekdoter.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                      <textarea
                        style={{ ...fieldStyle, minHeight: 50, flex: 1, resize: 'vertical' }}
                        value={a}
                        onChange={e => {
                          const next = [...sec.anekdoter];
                          next[i] = e.target.value;
                          update(idx, { anekdoter: next });
                        }}
                      />
                      <button style={S.pill('danger')} onClick={() => update(idx, { anekdoter: sec.anekdoter.filter((_, j) => j !== i) })}>✕</button>
                    </div>
                  ))}
                  <button style={S.pill('secondary')} onClick={() => update(idx, { anekdoter: [...sec.anekdoter, ''] })}>+ Legg til anekdote</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center', padding: '16px 20px', background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <button style={S.pill('primary')} onClick={save} disabled={saving}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13 13H3V3h7l3 3v7z"/><path d="M10 13V9H6v4"/><path d="M6 3v3h5"/></svg>
          {saving ? 'Lagrer…' : 'Lagre til Firebase'}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 500 }}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="2,8 6,12 14,4"/></svg>
            Lagret! Endringer vises etter neste sideoppdatering.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
// ─── Natur tab ────────────────────────────────────────────────────────────────
function NaturTab() {
  const [meta, setMeta] = useState<{ updatedAt: string; count: number } | null>(null);
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [obs, setObs] = useState<NatureObs[] | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [err, setErr] = useState('');
  useReportDirty(running); // don't let the user navigate away mid-refresh unwarned

  useEffect(() => {
    getNatureObsMetadata().then(m => { setMeta(m); setMetaLoaded(true); });
    loadNatureObs().then(o => setObs(applyAssessments(o ?? STATIC_NATURE_CACHE.obs)));
  }, []);

  const RED_LIST = /^(NT|VU|EN|CR|RE|DD)$/;
  const stats = obs ? {
    total: obs.length,
    redlisted: obs.filter(o => RED_LIST.test(o.redListCategory ?? '')).length,
    alien: obs.filter(o => o.alienCategory).length,
    withPhoto: obs.filter(o => o.photoUrl).length,
    perGroup: (Object.keys(NATURE_GROUPS) as NatureGroup[]).map(g => ({
      g, n: obs.filter(o => o.group === g).length,
    })),
  } : null;

  const refresh = async () => {
    if (!confirm('Dette henter alle observasjoner på nytt fra GBIF og beriker dem med navn, bilder og rødlistestatus. Det kan ta flere minutter. Fortsette?')) return;
    setRunning(true); setErr(''); setLog([]);
    const add = (l: string) => setLog(prev => [...prev, l]);
    try {
      const groups = Object.keys(NATURE_GROUPS) as NatureGroup[];
      const raw: { group: NatureGroup; obs: unknown[] }[] = [];
      for (const g of groups) {
        add(`Henter ${g} fra GBIF…`);
        const r = await fetchNatureGroup(g);
        add(`  → ${r.obs.length} observasjoner`);
        raw.push(r);
      }
      add('Bearbeider til artsliste…');
      let processed = processNatureData(raw);
      add(`${processed.length} arter. Henter norske navn og bilder fra iNaturalist…`);
      processed = await enrichWithINaturalist(processed);
      add('Henter rødliste- og fremmedartsstatus…');
      processed = await enrichWithAssessments(processed);
      add('Lagrer til Firebase…');
      await saveNatureObs(processed);
      setObs(applyAssessments(processed));
      const m = await getNatureObsMetadata();
      setMeta(m);
      add('Ferdig ✓');
    } catch (e: any) {
      setErr(e?.message || 'Ukjent feil under oppdatering');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={S.infoBox}>
        Naturdataene kommer fra GBIF (Artsdatabanken m.fl.) og vises i appens Natur-fane.
        Oppdater datasettet her når du vil ha med nye observasjoner.
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Datasett i bruk</div>
        {!metaLoaded ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>Sjekker Firebase…</p>
        ) : meta ? (
          <p style={{ margin: 0 }}>
            <strong>{meta.count} arter</strong> i Firebase · sist oppdatert {meta.updatedAt ? new Date(meta.updatedAt).toLocaleString('no') : 'ukjent'}
          </p>
        ) : (
          <p style={{ margin: 0 }}>
            Ingen data i Firebase — appen bruker den innebygde pakken
            (<strong>{STATIC_NATURE_CACHE.obs.length} arter</strong>, generert {new Date(STATIC_NATURE_CACHE.generatedAt).toLocaleDateString('no')}).
          </p>
        )}
        {stats && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {stats.perGroup.map(({ g, n }) => (
              <span key={g} style={{ fontSize: 12, fontWeight: 600, background: 'var(--card2)', border: '1px solid var(--line)', borderRadius: 99, padding: '4px 11px' }}>
                {g} {n}
              </span>
            ))}
            <span style={{ fontSize: 12, fontWeight: 700, background: 'rgba(192,57,43,.09)', color: '#c0392b', border: '1px solid rgba(192,57,43,.25)', borderRadius: 99, padding: '4px 11px' }}>
              Rødlistet {stats.redlisted}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, background: 'rgba(212,105,10,.09)', color: '#d4690a', border: '1px solid rgba(212,105,10,.25)', borderRadius: 99, padding: '4px 11px' }}>
              Fremmed {stats.alien}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, background: 'var(--card2)', border: '1px solid var(--line)', borderRadius: 99, padding: '4px 11px' }}>
              Med bilde {stats.withPhoto}/{stats.total}
            </span>
          </div>
        )}
      </div>

      <button style={{ ...S.pill('primary'), opacity: running ? 0.6 : 1 }} onClick={refresh} disabled={running}>
        {running ? 'Oppdaterer…' : 'Oppdater fra GBIF'}
      </button>
      {err && <p style={{ color: '#dc2626', marginTop: 10, fontWeight: 600 }}>{err}</p>}
      {log.length > 0 && (
        <pre style={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px', marginTop: 12, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: 'var(--ink2)' }}>
          {log.join('\n')}
        </pre>
      )}
    </div>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

const NAV_ICON: Record<Tab, React.ReactNode> = {
  poi: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  stedsnavn: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>,
  turer: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 21c-4-6 4-7 5-11 .8-3.2 5.5-2.8 3.5-7"/><circle cx="17" cy="3" r="1.4"/></svg>,
  kategorier: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/></svg>,
  garder: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10l9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/></svg>,
  tidslinje: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>,
  natur: <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21Q4 13 12 3q8 10 0 18z"/><path d="M12 3q-2 9 0 18"/></svg>,
};

const NAV_GROUPS: { title: string; items: { key: Tab; label: string; sub: string }[] }[] = [
  {
    title: 'Kartdata',
    items: [
      { key: 'poi', label: 'Steder', sub: 'Attraksjoner og punkter på kartet' },
      { key: 'stedsnavn', label: 'Stedsnavn', sub: 'Navneoppslag med forklaringer' },
      { key: 'turer', label: 'Turer', sub: 'Turruter med lengde og beskrivelse' },
      { key: 'kategorier', label: 'Kategorier', sub: 'Farger, ikoner og filtergrupper' },
    ],
  },
  {
    title: 'Historie',
    items: [
      { key: 'garder', label: 'Gårder', sub: 'Gårdshistorie i Historie-fanen' },
      { key: 'tidslinje', label: 'Tidslinje', sub: 'Epoker, havnivå og koblede steder' },
    ],
  },
  {
    title: 'Natur',
    items: [
      { key: 'natur', label: 'Naturdata', sub: 'GBIF-observasjoner og rødliste' },
    ],
  },
];

const SECTION_TITLE: Record<Tab, string> = {
  poi: 'Steder', stedsnavn: 'Stedsnavn', turer: 'Turer',
  kategorier: 'Kategorier', garder: 'Gårder', tidslinje: 'Tidslinje', natur: 'Naturdata',
};

function useIsNarrow(bp = 900): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(`(max-width: ${bp}px)`).matches);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const h = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [bp]);
  return narrow;
}

export function AdminPage() {
  const [user, setUser] = useState<User | null | undefined>(
    isFirebaseConfigured ? undefined : null
  );
  const [tab, setTab] = useState<Tab>('poi');
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [counts, setCounts] = useState<Partial<Record<Tab, number>>>({});
  const narrow = useIsNarrow();

  const reportDirty = React.useCallback((d: boolean) => {
    dirtyRef.current = d;
    setDirty(d);
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const unsub = onAuthStateChanged(auth, u => setUser(u));
    return unsub;
  }, []);

  // Warn before the browser tab closes with unsaved edits
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // Section counters for the sidebar (Firestore when available, local fallback otherwise)
  useEffect(() => {
    if (!isFirebaseConfigured || !user) return;
    let alive = true;
    (['poi', 'stedsnavn', 'turer'] as GeoTab[]).forEach(g => {
      getDoc(doc(db, COL, DOC[g])).then(snap => {
        if (!alive) return;
        const raw = snap.exists()
          ? (snap.data().json ? JSON.parse(snap.data().json) : snap.data())
          : FALLBACK[g];
        setCounts(c => ({ ...c, [g]: (raw as GeoCollection).features?.length }));
      }).catch(() => { if (alive) setCounts(c => ({ ...c, [g]: FALLBACK[g].features.length })); });
    });
    loadCatCfg().then(cfg => { if (alive) setCounts(c => ({ ...c, kategorier: Object.keys(cfg).length })); });
    loadFarmData().then(f => { if (alive) setCounts(c => ({ ...c, garder: f.length })); });
    loadTimelineSections().then(ts => { if (alive) setCounts(c => ({ ...c, tidslinje: ts.length })); });
    getNatureObsMetadata().then(m => {
      if (alive) setCounts(c => ({ ...c, natur: m?.count ?? STATIC_NATURE_CACHE.obs.length }));
    });
    return () => { alive = false; };
  }, [user]);

  const switchTab = (t: Tab) => {
    if (t === tab) return;
    if (dirtyRef.current && !confirm('Du har ulagrede endringer som går tapt hvis du bytter seksjon. Bytte likevel?')) return;
    reportDirty(false);
    setTab(t);
  };

  if (!isFirebaseConfigured) {
    return (
      <div style={S.notConfigured}>
        <div style={{ maxWidth: 420, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Firebase ikke konfigurert</div>
          <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
            Legg til <code>VITE_FIREBASE_*</code>-variabler i <code>.env</code> for å aktivere admin-siden.
            Se <code>.env.example</code> for detaljer.
          </p>
          <a href="/" style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 14 }}>← Tilbake til kart</a>
        </div>
      </div>
    );
  }

  if (user === undefined) return null;
  if (!user) return <LoginForm onLogin={setUser} />;

  const sideW = narrow ? 62 : 234;
  const initial = (user.email ?? '?')[0].toUpperCase();

  return (
    <DirtyCtx.Provider value={reportDirty}>
      <div style={{ ...S.page, display: 'grid', gridTemplateColumns: `${sideW}px 1fr`, height: '100vh', overflow: 'hidden' }}>
        {/* ── Sidebar ── */}
        <aside style={{ background: 'var(--sidebar)', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflowY: 'auto', minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: narrow ? '16px 0 10px' : '16px 16px 10px', justifyContent: narrow ? 'center' : 'flex-start' }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, background: 'var(--accent)', flexShrink: 0 }}>
              <svg viewBox="0 0 16 16" width="17" height="17" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 1C5.2 1 3 3.2 3 6c0 3.8 5 9 5 9s5-5.2 5-9c0-2.8-2.2-5-5-5z"/>
                <circle cx="8" cy="6" r="1.5"/>
              </svg>
            </span>
            {!narrow && (
              <span>
                <b style={{ display: 'block', fontSize: 15, letterSpacing: '-.01em' }}>Veierland</b>
                <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600 }}>Admin</span>
              </span>
            )}
          </div>

          <nav style={{ padding: '2px 8px 8px', display: 'flex', flexDirection: 'column' }}>
            {NAV_GROUPS.map(grp => (
              <React.Fragment key={grp.title}>
                {!narrow && (
                  <h6 style={{ margin: '13px 10px 5px', fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{grp.title}</h6>
                )}
                {narrow && <div style={{ height: 10 }} />}
                {grp.items.map(it => {
                  const on = tab === it.key;
                  return (
                    <button key={it.key} onClick={() => switchTab(it.key)} title={it.label}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                        padding: narrow ? '11px 0' : '8px 11px', justifyContent: narrow ? 'center' : 'flex-start',
                        borderRadius: 10, border: 'none', font: 'inherit', fontWeight: 600, fontSize: 13.5,
                        cursor: 'pointer', textAlign: 'left', marginBottom: 1,
                        background: on ? 'color-mix(in srgb, var(--accent) 13%, transparent)' : 'transparent',
                        color: on ? 'var(--accent)' : 'var(--ink)',
                      }}>
                      <span style={{ color: on ? 'var(--accent)' : 'var(--muted)', display: 'flex', flexShrink: 0 }}>{NAV_ICON[it.key]}</span>
                      {!narrow && <span style={{ flex: 1 }}>{it.label}</span>}
                      {!narrow && counts[it.key] !== undefined && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, borderRadius: 99, padding: '1px 8px',
                          background: on ? 'var(--card)' : 'var(--card2)',
                          border: '1px solid var(--line)',
                          color: on ? 'var(--accent)' : 'var(--muted)',
                        }}>{counts[it.key]}</span>
                      )}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </nav>

          <div style={{ marginTop: 'auto', borderTop: '1px solid var(--line)', padding: narrow ? '10px 0' : '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <a href="/" title="Til kartet" style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: narrow ? '8px 0' : '7px 10px',
              justifyContent: narrow ? 'center' : 'flex-start',
              borderRadius: 9, fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none',
            }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              {!narrow && 'Til kartet'}
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: narrow ? '0' : '2px 10px 4px', justifyContent: narrow ? 'center' : 'flex-start' }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'color-mix(in srgb, var(--accent) 16%, var(--card))', color: 'var(--accent)', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{initial}</span>
              {!narrow && (
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={user.email ?? ''}>
                  {user.email}
                </span>
              )}
              {!narrow && (
                <button onClick={() => signOut(auth)} title="Logg ut" style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'grid' }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
                </button>
              )}
            </div>
            {narrow && (
              <button onClick={() => signOut(auth)} title="Logg ut" style={{ border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', padding: 8, borderRadius: 8, display: 'grid', justifyContent: 'center' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
              </button>
            )}
          </div>
        </aside>

        {/* ── Main ── */}
        <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 24px', background: 'var(--card)', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-.01em' }}>{SECTION_TITLE[tab]}</h2>
            <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 500 }}>
              {NAV_GROUPS.flatMap(g => g.items).find(i => i.key === tab)?.sub}
            </span>
            {dirty && (
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: 'var(--accent)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />
                Ulagrede endringer
              </span>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <div style={{ padding: '22px 24px 48px', maxWidth: 860 }}>
              {tab === 'poi' && <PoiTab />}
              {tab === 'stedsnavn' && <StedsnavnTab />}
              {tab === 'turer' && <TurerTab />}
              {tab === 'kategorier' && <CategoryConfigTab />}
              {tab === 'garder' && <GarderTab />}
              {tab === 'tidslinje' && <TidslinjeTab />}
              {tab === 'natur' && <NaturTab />}
            </div>
          </div>
        </main>
      </div>
    </DirtyCtx.Provider>
  );
}
