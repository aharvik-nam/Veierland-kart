import { useState, useEffect, useRef } from 'react';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../lib/firebase';
import { poiFallback, stedsnavnFallback, turkartFallback, GeoCollection } from '../lib/geodata';
import { DEFAULT_CAT_CFG, CatCfgMap, CatEntry, loadCatCfg, saveCatCfg } from '../lib/catcfg';
import { ICONS, ICON_LABELS } from '../lib/icons';

type Tab = 'poi' | 'stedsnavn' | 'turer' | 'kategorier';

const COL = 'geodata';
const DOC: Record<Tab, string> = {
  poi: 'veierland_poi',
  stedsnavn: 'veierland_stedsnavn',
  turer: 'turkart',
};
const FALLBACK: Record<Tab, GeoCollection> = {
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

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14 } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'var(--card)', borderBottom: '1px solid var(--line)', position: 'sticky' as const, top: 0, zIndex: 100 },
  h1: { margin: 0, fontSize: 17, fontWeight: 700 },
  tabs: { display: 'flex', padding: '0 20px', background: 'var(--card)', borderBottom: '1px solid var(--line)' },
  tab: (active: boolean): React.CSSProperties => ({ padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 14, color: active ? 'var(--accent)' : 'var(--muted)', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1 }),
  body: { padding: '20px', maxWidth: 820, margin: '0 auto' },
  pill: (v: 'primary' | 'secondary' | 'danger'): React.CSSProperties => ({ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, background: v === 'primary' ? 'var(--accent)' : v === 'danger' ? '#e53e3e' : 'var(--card)', color: v === 'secondary' ? 'var(--ink)' : '#fff', boxShadow: v === 'secondary' ? '0 0 0 1px var(--line)' : 'none' }),
  featureRow: { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 6, overflow: 'hidden' },
  featureHdr: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', userSelect: 'none' as const, background: 'none', border: 'none', flex: 1, textAlign: 'left' as const, font: 'inherit', color: 'inherit', minWidth: 0 },
  chev: (open: boolean): React.CSSProperties => ({ transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', color: 'var(--muted)', flexShrink: 0 }),
  editGrid: { padding: '14px 16px 16px', borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' },
  fullSpan: { gridColumn: '1 / -1' } as React.CSSProperties,
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '.04em' },
  input: { width: '100%', boxSizing: 'border-box' as const, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, font: 'inherit' },
  textarea: { width: '100%', boxSizing: 'border-box' as const, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, font: 'inherit', resize: 'vertical' as const, minHeight: 72 },
  imgPreview: { marginTop: 6, borderRadius: 7, maxHeight: 120, maxWidth: '100%', border: '1px solid var(--line)', objectFit: 'cover' as const },
  deleteBtn: { gridColumn: '1 / -1', padding: '7px 14px', borderRadius: 7, border: '1px solid #e53e3e', background: 'none', color: '#e53e3e', fontSize: 13, cursor: 'pointer', fontWeight: 500, justifySelf: 'end' } as React.CSSProperties,
  addBtn: { width: '100%', padding: '10px', borderRadius: 10, border: '2px dashed var(--line)', background: 'none', color: 'var(--muted)', fontSize: 14, cursor: 'pointer', marginTop: 8 },
  fileActions: { display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' as const },
  infoBox: { background: 'color-mix(in srgb, var(--accent) 8%, var(--card))', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 13 },
  login: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' },
  loginCard: { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '36px 32px', width: 320 },
  loginTitle: { fontSize: 22, fontWeight: 700, marginBottom: 6, textAlign: 'center' as const },
  loginSub: { fontSize: 13, color: 'var(--muted)', textAlign: 'center' as const, marginBottom: 20 },
  loginInput: { width: '100%', boxSizing: 'border-box' as const, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 15, font: 'inherit', marginBottom: 10 },
  loginBtn: { width: '100%', padding: '11px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', font: 'inherit' },
  error: { color: '#e53e3e', fontSize: 13, marginTop: 8, textAlign: 'center' as const },
  notConfigured: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' },
  // New styles
  toolbar: { display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' as const },
  searchInput: { flex: 1, minWidth: 160, boxSizing: 'border-box' as const, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, font: 'inherit' },
  selectInput: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, font: 'inherit', cursor: 'pointer' } as React.CSSProperties,
  groupHeader: { fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' as const, letterSpacing: '.08em', padding: '14px 0 5px', display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
  groupBadge: { background: 'var(--line)', borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 600 } as React.CSSProperties,
  moveBtn: { background: 'none', border: '1px solid var(--line)', borderRadius: 5, color: 'var(--muted)', width: 26, height: 26, cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 } as React.CSSProperties,
  catPanel: { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' } as React.CSSProperties,
  catPanelHdr: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', cursor: 'pointer', background: 'none', border: 'none', width: '100%', font: 'inherit', color: 'inherit', textAlign: 'left' as const },
  catBody: { padding: '4px 16px 16px' } as React.CSSProperties,
  catItem: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 } as React.CSSProperties,
  catInput: { flex: 1, padding: '6px 9px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, font: 'inherit' } as React.CSSProperties,
  catDelBtn: { background: 'none', border: '1px solid #e53e3e', borderRadius: 6, color: '#e53e3e', width: 28, height: 28, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0 } as React.CSSProperties,
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
        <div style={S.loginTitle}>Admin</div>
        <div style={S.loginSub}>Logg inn med Firebase-konto</div>
        <form onSubmit={submit}>
          <input type="email" placeholder="E-post" autoFocus style={S.loginInput} value={email} onChange={e => setEmail(e.target.value)} />
          <input type="password" placeholder="Passord" style={S.loginInput} value={pw} onChange={e => setPw(e.target.value)} />
          <button type="submit" style={S.loginBtn} disabled={loading}>{loading ? 'Logger inn…' : 'Logg inn'}</button>
          {err && <p style={S.error}>{err}</p>}
        </form>
      </div>
    </div>
  );
}

// ─── Data hooks ──────────────────────────────────────────────────────────────
function useTabData(tab: Tab) {
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
        next[k] = current[k] ?? { no: k, en: k, color: '#7c876f', icon: 'wc', group: '', showInFilter: true };
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
        <span style={{ fontWeight: 600, fontSize: 14 }}>Administrer kategorier</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cats.length} kategorier</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={S.catBody}>
          {cats.map((c, i) => (
            <div key={i} style={S.catItem}>
              <input style={S.catInput} value={c} onChange={e => rename(i, e.target.value)} />
              <button style={S.catDelBtn} onClick={() => remove(i)} title="Slett kategori">✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              style={{ ...S.catInput, flex: 1 }}
              placeholder="Ny kategori…"
              value={newCat}
              onChange={e => setNewCat(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
            />
            <button style={{ ...S.pill('secondary'), padding: '6px 14px' }} onClick={add}>+ Legg til</button>
          </div>
          <div style={{ marginTop: 12 }}>
            <button style={S.pill('primary')} onClick={() => onSave(cats)} disabled={saving}>
              {saving ? 'Lagrer…' : '💾 Lagre kategorier til Firebase'}
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
          <div style={{ fontSize: 11, color: '#e53e3e', marginTop: 2 }}>Velg minst én kategori</div>
        )}
      </Field>
      <Field label="Verifisert">
        <select style={S.input} value={p.verifisert ? 'ja' : 'nei'} onChange={e => setP('verifisert', e.target.value === 'ja')}>
          <option value="ja">Ja</option><option value="nei">Nei (omtrentlig)</option>
        </select>
      </Field>
      <Field label="Beskrivelse" full><textarea style={S.textarea} value={p.beskrivelse ?? ''} onChange={e => setP('beskrivelse', e.target.value)} rows={3} /></Field>
      <Field label="Nettside (URL)" full><input style={S.input} type="url" value={p.nettside ?? ''} onChange={e => setP('nettside', e.target.value)} placeholder="https://…" /></Field>
      <Field label="Bilde (URL)" full>
        <input style={S.input} type="url" value={p.bilde ?? ''} onChange={e => setP('bilde', e.target.value)} placeholder="https://…" />
        {p.bilde && <img src={p.bilde} alt="" style={S.imgPreview} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
      </Field>
      <Field label="Bildekilde / lisens" full><input style={S.input} value={p.bilde_lisens ?? ''} onChange={e => setP('bilde_lisens', e.target.value)} placeholder="CC BY 2.0 – Navn Navnesen" /></Field>
      <CoordPasteField onParse={setLatLon} />
      <Field label="Breddegrad (lat)"><input style={S.input} type="number" step="0.000001" value={lat} onChange={e => setCoord('lat', e.target.value)} /></Field>
      <Field label="Lengdegrad (lon)"><input style={S.input} type="number" step="0.000001" value={lon} onChange={e => setCoord('lon', e.target.value)} /></Field>
      <Field label="Koordinatkilde"><input style={S.input} value={p.koordinat_kilde ?? ''} onChange={e => setP('koordinat_kilde', e.target.value)} /></Field>
      <button style={S.deleteBtn} onClick={onDelete}>Slett dette punktet</button>
    </div>
  );
}

// ─── Stedsnavn editor ─────────────────────────────────────────────────────────
function StedsnavnEditor({ feature, onChange, onDelete }: { feature: any; onChange: (f: any) => void; onDelete: () => void }) {
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
    <div style={S.featureRow}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button style={S.featureHdr} onClick={() => setOpen(o => !o)}>
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          {meta && <span style={{ fontSize: 12, color: 'var(--muted)', flexShrink: 0 }}>{meta}</span>}
          <span style={S.chev(open)}>▾</span>
        </button>
        {showArrows && (
          <div style={{ display: 'flex', gap: 3, paddingRight: 10, flexShrink: 0 }}>
            <button
              style={{ ...S.moveBtn, opacity: onMoveUp ? 1 : 0.25 }}
              onClick={onMoveUp}
              disabled={!onMoveUp}
              title="Flytt opp"
            >↑</button>
            <button
              style={{ ...S.moveBtn, opacity: onMoveDown ? 1 : 0.25 }}
              onClick={onMoveDown}
              disabled={!onMoveDown}
              title="Flytt ned"
            >↓</button>
          </div>
        )}
      </div>
      {open && children}
    </div>
  );
}

// ─── File actions ─────────────────────────────────────────────────────────────
function FileActions({ tab, data, onUpload, dirty, onSave, saving, seeded }: {
  tab: Tab; data: GeoCollection | null; onUpload: (d: GeoCollection) => void;
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
      <button style={S.pill('secondary')} onClick={download}>⬇ Last ned JSON</button>
      <button style={S.pill('secondary')} onClick={() => uploadRef.current?.click()}>⬆ Last opp JSON</button>
      <input ref={uploadRef} type="file" accept=".json,.geojson" style={{ display: 'none' }} onChange={handleUpload} />
      {(dirty || !seeded) && (
        <button style={S.pill('primary')} onClick={onSave} disabled={saving}>
          {saving ? 'Lagrer…' : !seeded ? '⬆ Last opp til Firebase' : '💾 Lagre til Firebase'}
        </button>
      )}
      {dirty && seeded && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Ulagrede endringer</span>}
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
        <div style={{ ...S.infoBox, marginBottom: 16 }}>
          ⚠️ Ingen data i Firebase ennå — viser lokal JSON. Trykk «Last opp til Firebase» for å laste opp.
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

  if (!data) return <p style={{ color: 'var(--muted)' }}>{err || 'Laster…'}</p>;

  const filtered = data.features
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !searchQ || (f.properties.navn ?? '').toLowerCase().includes(searchQ.toLowerCase()));

  return (
    <>
      <FileActions tab="stedsnavn" data={data} onUpload={setData} dirty={dirty} onSave={save} saving={saving} seeded={seeded} />
      {err && <p style={{ color: '#e53e3e', marginBottom: 12 }}>{err}</p>}
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
          <StedsnavnEditor feature={f} onChange={nf => update(i, nf)} onDelete={() => del(i)} />
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
function TurerTab() {
  const { data, setData, dirty, saving, save, err, seeded } = useTabData('turer');

  if (!data) return <p style={{ color: 'var(--muted)' }}>{err || 'Laster…'}</p>;
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
        {data.features.length} turrute(r) · GPS-ruter redigeres best i QGIS, GPSBabel eller Google My Maps og lastes opp som ny GeoJSON.
      </div>
      {data.features.map((f, i) => (
        <div key={i} style={S.featureRow}>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{f.properties.navn ?? f.properties.id ?? `Rute ${i + 1}`}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {f.properties.km && `${f.properties.km} · `}
              {f.properties.tid && `${f.properties.tid} · `}
              {f.properties.vanskelighet}
            </div>
          </div>
        </div>
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
  const [newKey, setNewKey] = useState('');

  useEffect(() => {
    loadCatCfg().then(setCfg);
  }, []);

  const set = (key: string, field: keyof CatEntry, val: any) => {
    setCfg(prev => ({ ...prev, [key]: { ...prev[key], [field]: val } }));
    setSaved(false);
  };

  const addCategory = () => {
    const k = newKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!k || cfg[k]) return;
    setCfg(prev => ({ ...prev, [k]: { no: k, en: k, color: '#7c876f', icon: 'wc', group: '', showInFilter: true } }));
    setNewKey('');
    setSaved(false);
  };

  const removeCategory = (key: string) => {
    if (!confirm(`Slett kategorien «${key}»? POI-er som bruker den beholder verdien, men den vises ikke lenger i filteret.`)) return;
    setCfg(prev => { const next = { ...prev }; delete next[key]; return next; });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    await saveCatCfg(cfg);
    setSaving(false);
    setSaved(true);
  };

  const tdS: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle' };
  const thS: React.CSSProperties = { ...tdS, fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', textAlign: 'left', background: 'var(--bg)' };

  return (
    <>
      <div style={{ ...S.infoBox, marginBottom: 16 }}>
        Her styrer du hvilke kategorier som vises i filterpanelet på nettsiden, hva de heter på norsk/engelsk, farge og gruppering (Praktisk / Historisk). Kategorier med «Vis i filter» avhuket dukker opp som filterknapper.
      </div>

      <datalist id="group-suggestions">
        {[...new Set(Object.values(cfg).map(e => e.group).filter(Boolean))].map(g => (
          <option key={g} value={g} />
        ))}
      </datalist>

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
              <th style={thS}></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(cfg).map(([key, entry]) => (
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
                  <input
                    style={{ ...S.input, padding: '5px 8px' }}
                    list="group-suggestions"
                    placeholder="Ingen gruppe"
                    value={entry.group}
                    onChange={e => set(key, 'group', e.target.value)}
                  />
                </td>
                <td style={{ ...tdS, width: 90, textAlign: 'center' }}>
                  <input type="checkbox" checked={entry.showInFilter} onChange={e => set(key, 'showInFilter', e.target.checked)}
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

      <button style={S.pill('primary')} onClick={save} disabled={saving}>
        {saving ? 'Lagrer…' : saved ? '✓ Lagret' : '💾 Lagre til Firebase'}
      </button>
      {saved && <span style={{ fontSize: 12, color: '#38a169', marginLeft: 10 }}>Endringene er aktive etter neste sideoppdatering.</span>}
    </>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function AdminPage() {
  const [user, setUser] = useState<User | null | undefined>(
    isFirebaseConfigured ? undefined : null
  );
  const [tab, setTab] = useState<Tab>('poi');

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const unsub = onAuthStateChanged(auth, u => setUser(u));
    return unsub;
  }, []);

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

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={S.h1}>Admin – Veierland kart</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{user.email}</span>
          <a href="/" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>← Kart</a>
          <button style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--muted)', fontSize: 13, padding: '5px 12px', cursor: 'pointer' }} onClick={() => signOut(auth)}>Logg ut</button>
        </div>
      </div>
      <div style={S.tabs}>
        {(['poi', 'stedsnavn', 'turer', 'kategorier'] as Tab[]).map(t => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {t === 'poi' ? 'Steder' : t === 'stedsnavn' ? 'Stedsnavn' : t === 'turer' ? 'Turer' : 'Kategorier'}
          </button>
        ))}
      </div>
      <div style={S.body}>
        {tab === 'poi' && <PoiTab />}
        {tab === 'stedsnavn' && <StedsnavnTab />}
        {tab === 'turer' && <TurerTab />}
        {tab === 'kategorier' && <CategoryConfigTab />}
      </div>
    </div>
  );
}
