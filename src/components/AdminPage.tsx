import { useState, useEffect, useRef } from 'react';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../lib/firebase';
import { poiFallback, stedsnavnFallback, turkartFallback, GeoCollection } from '../lib/geodata';

type Tab = 'poi' | 'stedsnavn' | 'turer';

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

const POI_CATEGORIES = ['ferge','kultur','mat','friluft','info','havn','bad','bru','kulturminne','park','arkeologi','hvalfangst'];

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'inherit', fontSize: 14 } as React.CSSProperties,
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: 'var(--card)', borderBottom: '1px solid var(--line)', position: 'sticky' as const, top: 0, zIndex: 100 },
  h1: { margin: 0, fontSize: 17, fontWeight: 700 },
  tabs: { display: 'flex', padding: '0 20px', background: 'var(--card)', borderBottom: '1px solid var(--line)' },
  tab: (active: boolean): React.CSSProperties => ({ padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 14, color: active ? 'var(--accent)' : 'var(--muted)', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1 }),
  body: { padding: '20px', maxWidth: 820, margin: '0 auto' },
  pill: (v: 'primary' | 'secondary' | 'danger'): React.CSSProperties => ({ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, background: v === 'primary' ? 'var(--accent)' : v === 'danger' ? '#e53e3e' : 'var(--card)', color: v === 'secondary' ? 'var(--ink)' : '#fff', boxShadow: v === 'secondary' ? '0 0 0 1px var(--line)' : 'none' }),
  featureRow: { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8, overflow: 'hidden' },
  featureHdr: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', userSelect: 'none' as const, background: 'none', border: 'none', width: '100%', textAlign: 'left' as const, font: 'inherit', color: 'inherit' },
  chev: (open: boolean): React.CSSProperties => ({ marginLeft: 'auto', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none', color: 'var(--muted)' }),
  editGrid: { padding: '14px 16px 16px', borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' },
  fullSpan: { gridColumn: '1 / -1' } as React.CSSProperties,
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '.04em' },
  input: { width: '100%', boxSizing: 'border-box' as const, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, font: 'inherit' },
  textarea: { width: '100%', boxSizing: 'border-box' as const, padding: '7px 10px', borderRadius: 7, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, font: 'inherit', resize: 'vertical' as const, minHeight: 72 },
  imgPreview: { marginTop: 6, borderRadius: 7, maxHeight: 120, maxWidth: '100%', border: '1px solid var(--line)', objectFit: 'cover' as const },
  deleteBtn: { gridColumn: '1 / -1', padding: '7px 14px', borderRadius: 7, border: '1px solid #e53e3e', background: 'none', color: '#e53e3e', fontSize: 13, cursor: 'pointer', fontWeight: 500, justifySelf: 'end' } as React.CSSProperties,
  addBtn: { width: '100%', padding: '10px', borderRadius: 10, border: '2px dashed var(--line)', background: 'none', color: 'var(--muted)', fontSize: 14, cursor: 'pointer', marginBottom: 8 },
  fileActions: { display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' as const },
  infoBox: { background: 'color-mix(in srgb, var(--accent) 8%, var(--card))', border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 13 },
  login: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' },
  loginCard: { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16, padding: '36px 32px', width: 320 },
  loginTitle: { fontSize: 22, fontWeight: 700, marginBottom: 6, textAlign: 'center' as const },
  loginSub: { fontSize: 13, color: 'var(--muted)', textAlign: 'center' as const, marginBottom: 20 },
  loginInput: { width: '100%', boxSizing: 'border-box' as const, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 15, font: 'inherit', marginBottom: 10 },
  loginBtn: { width: '100%', padding: '11px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', font: 'inherit' },
  error: { color: '#e53e3e', fontSize: 13, marginTop: 8, textAlign: 'center' as const },
  notConfigured: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' },
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
    } catch (e: any) {
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

// ─── POI editor ──────────────────────────────────────────────────────────────
function PoiEditor({ feature, onChange, onDelete }: { feature: any; onChange: (f: any) => void; onDelete: () => void }) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates as [number, number];
  const setP = (k: string, v: any) => onChange({ ...feature, properties: { ...p, [k]: v } });
  const setCoord = (which: 'lat' | 'lon', v: string) => {
    const n = parseFloat(v); if (isNaN(n)) return;
    const c = [...feature.geometry.coordinates] as [number, number];
    if (which === 'lon') c[0] = n; else c[1] = n;
    onChange({ ...feature, geometry: { ...feature.geometry, coordinates: c } });
  };
  return (
    <div style={S.editGrid}>
      <Field label="Navn" full><input style={S.input} value={p.navn ?? ''} onChange={e => setP('navn', e.target.value)} /></Field>
      <Field label="Kategori">
        <select style={S.input} value={p.kategori ?? ''} onChange={e => setP('kategori', e.target.value)}>
          {POI_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          {!POI_CATEGORIES.includes(p.kategori) && p.kategori && <option value={p.kategori}>{p.kategori}</option>}
        </select>
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
      <Field label="Breddegrad (lat)"><input style={S.input} type="number" step="0.000001" value={lat} onChange={e => setCoord('lat', e.target.value)} /></Field>
      <Field label="Lengdegrad (lon)"><input style={S.input} type="number" step="0.000001" value={lon} onChange={e => setCoord('lon', e.target.value)} /></Field>
      <button style={S.deleteBtn} onClick={onDelete}>Slett dette stedsnavnet</button>
    </div>
  );
}

// ─── Collapsible feature row ──────────────────────────────────────────────────
function FeatureRow({ label, meta, children }: { label: string; meta?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={S.featureRow}>
      <button style={S.featureHdr} onClick={() => setOpen(o => !o)}>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{label}</span>
        {meta && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{meta}</span>}
        <span style={S.chev(open)}>▾</span>
      </button>
      {open && children}
    </div>
  );
}

// ─── File actions ─────────────────────────────────────────────────────────────
function FileActions({ tab, data, onUpload, dirty, onSave, saving }: {
  tab: Tab; data: GeoCollection | null; onUpload: (d: GeoCollection) => void;
  dirty: boolean; onSave: () => void; saving: boolean;
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
      {dirty && <button style={S.pill('primary')} onClick={onSave} disabled={saving}>{saving ? 'Lagrer…' : '💾 Lagre til Firebase'}</button>}
      {dirty && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Ulagrede endringer</span>}
    </div>
  );
}

// ─── Generic tab with Firestore data ─────────────────────────────────────────
function useTabData(tab: Tab) {
  const [data, setDataState] = useState<GeoCollection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    setDataState(null); setErr(''); setDirty(false); setSeeded(false);
    getDoc(doc(db, COL, DOC[tab])).then(snap => {
      setDataState(snap.exists() ? (snap.data() as GeoCollection) : FALLBACK[tab]);
      setSeeded(snap.exists());
    }).catch(e => { setErr(e.message); setDataState(FALLBACK[tab]); });
  }, [tab]);

  const setData = (d: GeoCollection) => { setDataState(d); setDirty(true); };

  const save = async () => {
    if (!data) return;
    setSaving(true); setErr('');
    try {
      await setDoc(doc(db, COL, DOC[tab]), data);
      setDirty(false); setSeeded(true);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return { data, setData, dirty, saving, save, err, seeded };
}

// ─── Steder tab ───────────────────────────────────────────────────────────────
function PoiTab() {
  const { data, setData, dirty, saving, save, err, seeded } = useTabData('poi');

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
    setData({ ...data, features: [...data.features, { type: 'Feature', properties: { navn: 'Nytt punkt', kategori: 'info', beskrivelse: '', verifisert: false, koordinat_kilde: 'manuelt' }, geometry: { type: 'Point', coordinates: [10.350, 59.160] } }] });
  };

  if (!data) return <p style={{ color: 'var(--muted)' }}>{err || 'Laster…'}</p>;
  return (
    <>
      <FileActions tab="poi" data={data} onUpload={setData} dirty={dirty} onSave={save} saving={saving} />
      {err && <p style={{ color: '#e53e3e', marginBottom: 12 }}>{err}</p>}
      {!seeded && <div style={{ ...S.infoBox, marginBottom: 16 }}>⚠️ Ingen data i Firebase ennå — viser lokal JSON. Trykk «Lagre til Firebase» for å laste opp.</div>}
      <div style={S.infoBox}>{data.features.length} steder</div>
      {data.features.map((f, i) => (
        <FeatureRow key={i} label={f.properties.navn ?? `Punkt ${i + 1}`} meta={f.properties.kategori}>
          <PoiEditor feature={f} onChange={nf => update(i, nf)} onDelete={() => del(i)} />
        </FeatureRow>
      ))}
      <button style={S.addBtn} onClick={addNew}>+ Legg til nytt punkt</button>
    </>
  );
}

// ─── Stedsnavn tab ────────────────────────────────────────────────────────────
function StedsnavnTab() {
  const { data, setData, dirty, saving, save, err, seeded } = useTabData('stedsnavn');

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
    setData({ ...data, features: [...data.features, { type: 'Feature', properties: { navn: 'Nytt stedsnavn', forklaring: '', kategori: 'stedsnavn', visibility: true }, geometry: { type: 'Point', coordinates: [10.350, 59.160] } }] });
  };

  if (!data) return <p style={{ color: 'var(--muted)' }}>{err || 'Laster…'}</p>;
  return (
    <>
      <FileActions tab="stedsnavn" data={data} onUpload={setData} dirty={dirty} onSave={save} saving={saving} />
      {err && <p style={{ color: '#e53e3e', marginBottom: 12 }}>{err}</p>}
      {!seeded && <div style={{ ...S.infoBox, marginBottom: 16 }}>⚠️ Ingen data i Firebase ennå — viser lokal JSON. Trykk «Lagre til Firebase» for å laste opp.</div>}
      <div style={S.infoBox}>{data.features.length} stedsnavn</div>
      {data.features.map((f, i) => (
        <FeatureRow key={i} label={f.properties.navn ?? `Stedsnavn ${i + 1}`} meta={f.properties.visibility === false ? 'skjult' : undefined}>
          <StedsnavnEditor feature={f} onChange={nf => update(i, nf)} onDelete={() => del(i)} />
        </FeatureRow>
      ))}
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
      <FileActions tab="turer" data={data} onUpload={setData} dirty={dirty} onSave={save} saving={saving} />
      {err && <p style={{ color: '#e53e3e', marginBottom: 12 }}>{err}</p>}
      {!seeded && <div style={{ ...S.infoBox, marginBottom: 16 }}>⚠️ Ingen data i Firebase ennå — viser lokal JSON. Trykk «Lagre til Firebase» for å laste opp.</div>}
      <div style={S.infoBox}>{data.features.length} turrute(r) · GPS-ruter redigeres best i QGIS, GPSBabel eller Google My Maps og lastes opp som ny GeoJSON.</div>
      {data.features.map((f, i) => (
        <div key={i} style={S.featureRow}>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{f.properties.navn ?? f.properties.id ?? `Rute ${i + 1}`}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{f.properties.km && `${f.properties.km} · `}{f.properties.tid && `${f.properties.tid} · `}{f.properties.vanskelighet}</div>
          </div>
        </div>
      ))}
    </>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function AdminPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('poi');

  useEffect(() => {
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

  if (user === undefined) return null; // loading
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
        {(['poi', 'stedsnavn', 'turer'] as Tab[]).map(t => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {t === 'poi' ? 'Steder' : t === 'stedsnavn' ? 'Stedsnavn' : 'Turer'}
          </button>
        ))}
      </div>
      <div style={S.body}>
        {tab === 'poi' && <PoiTab />}
        {tab === 'stedsnavn' && <StedsnavnTab />}
        {tab === 'turer' && <TurerTab />}
      </div>
    </div>
  );
}
