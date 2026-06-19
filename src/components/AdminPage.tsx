import { useState, useEffect, useRef } from 'react';

type Tab = 'poi' | 'stedsnavn' | 'turer';

interface GeoFeature {
  type: 'Feature';
  properties: Record<string, any>;
  geometry: { type: string; coordinates: any };
}
interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
  [k: string]: any;
}

const FILE: Record<Tab, string> = {
  poi: 'veierland_poi.json',
  stedsnavn: 'veierland_stedsnavn.json',
  turer: 'turkart.geojson',
};

const TAB_LABEL: Record<Tab, string> = {
  poi: 'Steder',
  stedsnavn: 'Stedsnavn',
  turer: 'Turer',
};

const POI_CATEGORIES = ['ferge','kultur','mat','friluft','info','havn','bad','bru','kulturminne','park'];

// ─── styles ──────────────────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)',
    fontFamily: 'inherit', fontSize: 14,
  } as React.CSSProperties,
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', background: 'var(--card)', borderBottom: '1px solid var(--line)',
    position: 'sticky' as const, top: 0, zIndex: 100,
  },
  h1: { margin: 0, fontSize: 17, fontWeight: 700 },
  logoutBtn: {
    background: 'none', border: '1px solid var(--line)', borderRadius: 8,
    color: 'var(--muted)', fontSize: 13, padding: '5px 12px', cursor: 'pointer',
  },
  tabs: {
    display: 'flex', gap: 0, padding: '0 20px',
    background: 'var(--card)', borderBottom: '1px solid var(--line)',
  },
  tab: (active: boolean): React.CSSProperties => ({
    padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
    fontWeight: active ? 600 : 400, fontSize: 14, color: active ? 'var(--accent)' : 'var(--muted)',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    marginBottom: -1,
  }),
  body: { padding: '20px', maxWidth: 820, margin: '0 auto' },
  fileActions: {
    display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  pill: (variant: 'primary' | 'secondary' | 'danger'): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
    cursor: 'pointer', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 5,
    background: variant === 'primary' ? 'var(--accent)' : variant === 'danger' ? '#e53e3e' : 'var(--card)',
    color: variant === 'secondary' ? 'var(--ink)' : '#fff',
    boxShadow: variant === 'secondary' ? '0 0 0 1px var(--line)' : 'none',
  }),
  saveBanner: {
    position: 'fixed' as const, bottom: 0, left: 0, right: 0,
    background: 'var(--card)', borderTop: '1px solid var(--line)',
    padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10,
    zIndex: 200,
  },
  featureRow: {
    background: 'var(--card)', border: '1px solid var(--line)',
    borderRadius: 10, marginBottom: 8, overflow: 'hidden',
  },
  featureHdr: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px', cursor: 'pointer', userSelect: 'none' as const,
    background: 'none', border: 'none', width: '100%', textAlign: 'left' as const,
    font: 'inherit', color: 'inherit',
  },
  featureName: { fontWeight: 600, fontSize: 14, flex: 1 },
  featureMeta: { fontSize: 12, color: 'var(--muted)' },
  chev: (open: boolean): React.CSSProperties => ({
    marginLeft: 'auto', transition: 'transform .2s',
    transform: open ? 'rotate(180deg)' : 'none', color: 'var(--muted)',
  }),
  editGrid: {
    padding: '14px 16px 16px',
    borderTop: '1px solid var(--line)',
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px',
  },
  fullSpan: { gridColumn: '1 / -1' } as React.CSSProperties,
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '.04em' },
  input: {
    width: '100%', boxSizing: 'border-box' as const,
    padding: '7px 10px', borderRadius: 7, border: '1px solid var(--line)',
    background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, font: 'inherit',
  },
  textarea: {
    width: '100%', boxSizing: 'border-box' as const,
    padding: '7px 10px', borderRadius: 7, border: '1px solid var(--line)',
    background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, font: 'inherit',
    resize: 'vertical' as const, minHeight: 72,
  },
  imgPreview: {
    marginTop: 6, borderRadius: 7, maxHeight: 120, maxWidth: '100%',
    border: '1px solid var(--line)', objectFit: 'cover' as const,
  },
  coordRow: { display: 'flex', gap: 10 },
  deleteBtn: {
    marginTop: 10, gridColumn: '1 / -1', padding: '7px 14px', borderRadius: 7,
    border: '1px solid #e53e3e', background: 'none', color: '#e53e3e', fontSize: 13,
    cursor: 'pointer', fontWeight: 500,
  },
  addBtn: {
    width: '100%', padding: '10px', borderRadius: 10, border: '2px dashed var(--line)',
    background: 'none', color: 'var(--muted)', fontSize: 14, cursor: 'pointer', marginBottom: 8,
  },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--muted)', marginBottom: 10, marginTop: 6, textTransform: 'uppercase' as const, letterSpacing: '.05em' },
  login: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg)',
  },
  loginCard: {
    background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 16,
    padding: '36px 32px', width: 320,
  },
  loginTitle: { fontSize: 22, fontWeight: 700, marginBottom: 20, textAlign: 'center' as const },
  loginInput: {
    width: '100%', boxSizing: 'border-box' as const,
    padding: '10px 12px', borderRadius: 9, border: '1px solid var(--line)',
    background: 'var(--bg)', color: 'var(--ink)', fontSize: 15, font: 'inherit', marginBottom: 12,
  },
  loginBtn: {
    width: '100%', padding: '11px', borderRadius: 9, border: 'none',
    background: 'var(--accent)', color: '#fff', fontSize: 15, fontWeight: 600,
    cursor: 'pointer', font: 'inherit',
  },
  error: { color: '#e53e3e', fontSize: 13, marginTop: 8, textAlign: 'center' as const },
  infoBox: {
    background: 'color-mix(in srgb, var(--accent) 8%, var(--card))',
    border: '1px solid color-mix(in srgb, var(--accent) 20%, transparent)',
    borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 13, color: 'var(--ink)',
  },
};

// ─── Login ───────────────────────────────────────────────────────────────────
function LoginForm({ onLogin }: { onLogin: (t: string) => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Feil'); }
      const { token } = await res.json();
      sessionStorage.setItem('vl-admin-token', token);
      onLogin(token);
    } catch (e: any) {
      setErr(e.message);
    } finally { setLoading(false); }
  };

  return (
    <div style={S.login}>
      <div style={S.loginCard}>
        <div style={S.loginTitle}>Admin</div>
        <form onSubmit={submit}>
          <input
            type="password" placeholder="Passord" autoFocus
            style={S.loginInput} value={pw} onChange={e => setPw(e.target.value)}
          />
          <button type="submit" style={S.loginBtn} disabled={loading}>
            {loading ? 'Logger inn…' : 'Logg inn'}
          </button>
          {err && <p style={S.error}>{err}</p>}
        </form>
      </div>
    </div>
  );
}

// ─── Field helpers ────────────────────────────────────────────────────────────
function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={full ? S.fullSpan : {}}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

// ─── POI feature editor ───────────────────────────────────────────────────────
function PoiEditor({
  feature, onChange, onDelete,
}: {
  feature: GeoFeature;
  onChange: (f: GeoFeature) => void;
  onDelete: () => void;
}) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates as [number, number];

  const setP = (key: string, val: any) =>
    onChange({ ...feature, properties: { ...p, [key]: val } });

  const setCoord = (which: 'lat' | 'lon', val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const coords: [number, number] = [...feature.geometry.coordinates] as [number, number];
    if (which === 'lon') coords[0] = num; else coords[1] = num;
    onChange({ ...feature, geometry: { ...feature.geometry, coordinates: coords } });
  };

  return (
    <div style={S.editGrid}>
      <Field label="Navn" full>
        <input style={S.input} value={p.navn ?? ''} onChange={e => setP('navn', e.target.value)} />
      </Field>

      <Field label="Kategori">
        <select style={S.input} value={p.kategori ?? ''} onChange={e => setP('kategori', e.target.value)}>
          {POI_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          {!POI_CATEGORIES.includes(p.kategori) && p.kategori && (
            <option value={p.kategori}>{p.kategori}</option>
          )}
        </select>
      </Field>

      <Field label="Verifisert">
        <select style={S.input} value={p.verifisert ? 'ja' : 'nei'} onChange={e => setP('verifisert', e.target.value === 'ja')}>
          <option value="ja">Ja</option>
          <option value="nei">Nei (omtrentlig)</option>
        </select>
      </Field>

      <Field label="Beskrivelse" full>
        <textarea style={S.textarea} value={p.beskrivelse ?? ''} onChange={e => setP('beskrivelse', e.target.value)} rows={3} />
      </Field>

      <Field label="Nettside (URL)" full>
        <input style={S.input} type="url" value={p.nettside ?? ''} onChange={e => setP('nettside', e.target.value)} placeholder="https://…" />
      </Field>

      <Field label="Bilde (URL)" full>
        <input style={S.input} type="url" value={p.bilde ?? ''} onChange={e => setP('bilde', e.target.value)} placeholder="https://…" />
        {p.bilde && <img src={p.bilde} alt="" style={S.imgPreview} onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
      </Field>

      <Field label="Bildekilde / lisens" full>
        <input style={S.input} value={p.bilde_lisens ?? ''} onChange={e => setP('bilde_lisens', e.target.value)} placeholder="f.eks. CC BY 2.0 – Navn Navnesen" />
      </Field>

      <Field label="Breddegrad (lat)">
        <input style={S.input} type="number" step="0.000001"
          value={lat} onChange={e => setCoord('lat', e.target.value)} />
      </Field>

      <Field label="Lengdegrad (lon)">
        <input style={S.input} type="number" step="0.000001"
          value={lon} onChange={e => setCoord('lon', e.target.value)} />
      </Field>

      <Field label="Koordinatkilde">
        <input style={S.input} value={p.koordinat_kilde ?? ''} onChange={e => setP('koordinat_kilde', e.target.value)} />
      </Field>

      <div style={{ ...S.fullSpan, display: 'flex', justifyContent: 'flex-end' }}>
        <button style={S.deleteBtn} onClick={onDelete}>Slett dette punktet</button>
      </div>
    </div>
  );
}

// ─── Stedsnavn editor ─────────────────────────────────────────────────────────
function StedsnavnEditor({
  feature, onChange, onDelete,
}: {
  feature: GeoFeature;
  onChange: (f: GeoFeature) => void;
  onDelete: () => void;
}) {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates as [number, number];

  const setP = (key: string, val: any) =>
    onChange({ ...feature, properties: { ...p, [key]: val } });

  const setCoord = (which: 'lat' | 'lon', val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const coords: [number, number] = [...feature.geometry.coordinates] as [number, number];
    if (which === 'lon') coords[0] = num; else coords[1] = num;
    onChange({ ...feature, geometry: { ...feature.geometry, coordinates: coords } });
  };

  return (
    <div style={S.editGrid}>
      <Field label="Navn" full>
        <input style={S.input} value={p.navn ?? ''} onChange={e => setP('navn', e.target.value)} />
      </Field>

      <Field label="Vis på kart">
        <select style={S.input} value={p.visibility === false ? 'nei' : 'ja'}
          onChange={e => setP('visibility', e.target.value !== 'nei')}>
          <option value="ja">Ja</option>
          <option value="nei">Nei (skjult)</option>
        </select>
      </Field>

      <Field label="Kategori">
        <input style={S.input} value={p.kategori ?? ''} onChange={e => setP('kategori', e.target.value)} />
      </Field>

      <Field label="Forklaring" full>
        <textarea style={S.textarea} value={p.forklaring ?? ''} onChange={e => setP('forklaring', e.target.value)} rows={4} />
      </Field>

      <Field label="Breddegrad (lat)">
        <input style={S.input} type="number" step="0.000001"
          value={lat} onChange={e => setCoord('lat', e.target.value)} />
      </Field>

      <Field label="Lengdegrad (lon)">
        <input style={S.input} type="number" step="0.000001"
          value={lon} onChange={e => setCoord('lon', e.target.value)} />
      </Field>

      <div style={{ ...S.fullSpan, display: 'flex', justifyContent: 'flex-end' }}>
        <button style={S.deleteBtn} onClick={onDelete}>Slett dette stedsnavnet</button>
      </div>
    </div>
  );
}

// ─── Collapsible feature row ──────────────────────────────────────────────────
function FeatureRow({
  feature, label, meta, children, onDelete,
}: {
  feature: GeoFeature;
  label: string;
  meta?: string;
  children: React.ReactNode;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={S.featureRow}>
      <button style={S.featureHdr} onClick={() => setOpen(o => !o)}>
        <span style={S.featureName}>{label}</span>
        {meta && <span style={S.featureMeta}>{meta}</span>}
        <span style={S.chev(open)}>▾</span>
      </button>
      {open && children}
    </div>
  );
}

// ─── File actions (download / upload) ────────────────────────────────────────
function FileActions({
  token, fileName, onUpload, dirty, onSave, saving,
}: {
  token: string;
  fileName: string;
  onUpload: (data: GeoCollection) => void;
  dirty: boolean;
  onSave: () => void;
  saving: boolean;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        onUpload(json);
      } catch { alert('Ugyldig JSON-fil'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div style={S.fileActions}>
      <a
        href={`/api/admin/geojson/${fileName}`}
        download={fileName}
        style={{ ...S.pill('secondary'), textDecoration: 'none' }}
        onClick={async e => {
          // Fetch with auth header since <a> can't set headers
          e.preventDefault();
          const res = await fetch(`/api/admin/geojson/${fileName}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = fileName; a.click();
          URL.revokeObjectURL(url);
        }}
      >
        ⬇ Last ned {fileName}
      </a>

      <button style={S.pill('secondary')} onClick={() => uploadRef.current?.click()}>
        ⬆ Last opp JSON
      </button>
      <input ref={uploadRef} type="file" accept=".json,.geojson" style={{ display: 'none' }} onChange={handleUpload} />

      {dirty && (
        <button style={S.pill('primary')} onClick={onSave} disabled={saving}>
          {saving ? 'Lagrer…' : '💾 Lagre endringer'}
        </button>
      )}
      {dirty && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Ulagrede endringer</span>}
    </div>
  );
}

// ─── POI Tab ─────────────────────────────────────────────────────────────────
function PoiTab({ token }: { token: string }) {
  const [data, setData] = useState<GeoCollection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/admin/geojson/veierland_poi.json', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).catch(e => setErr(e.message));
  }, [token]);

  const update = (idx: number, f: GeoFeature) => {
    if (!data) return;
    const features = [...data.features];
    features[idx] = f;
    setData({ ...data, features });
    setDirty(true);
  };

  const deleteFeature = (idx: number) => {
    if (!data || !confirm(`Slett "${data.features[idx].properties.navn}"?`)) return;
    const features = data.features.filter((_, i) => i !== idx);
    setData({ ...data, features });
    setDirty(true);
  };

  const addNew = () => {
    if (!data) return;
    const blank: GeoFeature = {
      type: 'Feature',
      properties: { navn: 'Nytt punkt', kategori: 'info', beskrivelse: '', verifisert: false, koordinat_kilde: 'manuelt' },
      geometry: { type: 'Point', coordinates: [10.350, 59.160] },
    };
    setData({ ...data, features: [...data.features, blank] });
    setDirty(true);
  };

  const save = async () => {
    if (!data) return;
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/admin/geojson/veierland_poi.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setDirty(false);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  if (!data) return <p style={{ color: 'var(--muted)' }}>{err || 'Laster…'}</p>;

  return (
    <>
      <FileActions token={token} fileName="veierland_poi.json" onUpload={d => { setData(d); setDirty(true); }} dirty={dirty} onSave={save} saving={saving} />
      {err && <p style={{ color: '#e53e3e', marginBottom: 12 }}>{err}</p>}
      <div style={S.infoBox}>
        {data.features.length} steder · Etter lagring vil kartet oppdateres automatisk (dev) eller ved neste bygg (produksjon).
      </div>
      {data.features.map((f, i) => (
        <FeatureRow
          key={i}
          feature={f}
          label={f.properties.navn ?? `Punkt ${i + 1}`}
          meta={f.properties.kategori}
          onDelete={() => deleteFeature(i)}
        >
          <PoiEditor feature={f} onChange={nf => update(i, nf)} onDelete={() => deleteFeature(i)} />
        </FeatureRow>
      ))}
      <button style={S.addBtn} onClick={addNew}>+ Legg til nytt punkt</button>
    </>
  );
}

// ─── Stedsnavn Tab ────────────────────────────────────────────────────────────
function StedsnavnTab({ token }: { token: string }) {
  const [data, setData] = useState<GeoCollection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/admin/geojson/veierland_stedsnavn.json', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).catch(e => setErr(e.message));
  }, [token]);

  const update = (idx: number, f: GeoFeature) => {
    if (!data) return;
    const features = [...data.features];
    features[idx] = f;
    setData({ ...data, features });
    setDirty(true);
  };

  const deleteFeature = (idx: number) => {
    if (!data || !confirm(`Slett "${data.features[idx].properties.navn}"?`)) return;
    const features = data.features.filter((_, i) => i !== idx);
    setData({ ...data, features });
    setDirty(true);
  };

  const addNew = () => {
    if (!data) return;
    const blank: GeoFeature = {
      type: 'Feature',
      properties: { navn: 'Nytt stedsnavn', forklaring: '', kategori: 'stedsnavn', visibility: true },
      geometry: { type: 'Point', coordinates: [10.350, 59.160] },
    };
    setData({ ...data, features: [...data.features, blank] });
    setDirty(true);
  };

  const save = async () => {
    if (!data) return;
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/admin/geojson/veierland_stedsnavn.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setDirty(false);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  if (!data) return <p style={{ color: 'var(--muted)' }}>{err || 'Laster…'}</p>;

  return (
    <>
      <FileActions token={token} fileName="veierland_stedsnavn.json" onUpload={d => { setData(d); setDirty(true); }} dirty={dirty} onSave={save} saving={saving} />
      {err && <p style={{ color: '#e53e3e', marginBottom: 12 }}>{err}</p>}
      <div style={S.infoBox}>
        {data.features.length} stedsnavn
      </div>
      {data.features.map((f, i) => (
        <FeatureRow
          key={i}
          feature={f}
          label={f.properties.navn ?? `Stedsnavn ${i + 1}`}
          meta={f.properties.visibility === false ? 'skjult' : undefined}
          onDelete={() => deleteFeature(i)}
        >
          <StedsnavnEditor feature={f} onChange={nf => update(i, nf)} onDelete={() => deleteFeature(i)} />
        </FeatureRow>
      ))}
      <button style={S.addBtn} onClick={addNew}>+ Legg til nytt stedsnavn</button>
    </>
  );
}

// ─── Turer Tab ────────────────────────────────────────────────────────────────
function TurerTab({ token }: { token: string }) {
  const [data, setData] = useState<GeoCollection | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/admin/geojson/turkart.geojson', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).catch(e => setErr(e.message));
  }, [token]);

  const save = async () => {
    if (!data) return;
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/admin/geojson/turkart.geojson', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setDirty(false);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  if (!data) return <p style={{ color: 'var(--muted)' }}>{err || 'Laster…'}</p>;

  return (
    <>
      <FileActions token={token} fileName="turkart.geojson" onUpload={d => { setData(d); setDirty(true); }} dirty={dirty} onSave={save} saving={saving} />
      {err && <p style={{ color: '#e53e3e', marginBottom: 12 }}>{err}</p>}
      <div style={S.infoBox}>
        {data.features.length} turrute(r) · GPS-koordinater redigeres best i QGIS, GPSBabel eller Google My Maps, og lastes deretter opp som ny GeoJSON.
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

// ─── Main AdminPage ───────────────────────────────────────────────────────────
export function AdminPage() {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem('vl-admin-token'));
  const [tab, setTab] = useState<Tab>('poi');

  const logout = () => {
    sessionStorage.removeItem('vl-admin-token');
    setToken(null);
  };

  if (!token) return <LoginForm onLogin={setToken} />;

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={S.h1}>Admin – Veierland kart</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>← Tilbake til kart</a>
          <button style={S.logoutBtn} onClick={logout}>Logg ut</button>
        </div>
      </div>

      <div style={S.tabs}>
        {(['poi', 'stedsnavn', 'turer'] as Tab[]).map(t => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      <div style={S.body}>
        {tab === 'poi' && <PoiTab token={token} />}
        {tab === 'stedsnavn' && <StedsnavnTab token={token} />}
        {tab === 'turer' && <TurerTab token={token} />}
      </div>
    </div>
  );
}
