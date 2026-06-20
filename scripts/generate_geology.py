#!/usr/bin/env python3
"""
Last ned geodata fra NGU og Miljødirektoratet for Veierland.

Bruk:
  pip install geopandas requests shapely
  python scripts/generate_geology.py

Output:
  src/data/losmasser.geojson
  src/data/berggrunn.geojson
  src/data/naturtyper.geojson
  src/data/marin_grense.geojson
"""

import io
import json
import os
import sys
import tempfile
import zipfile

import requests
import geopandas as gpd
from shapely.geometry import mapping, shape

# ─── Clip til øygrense ───────────────────────────────────────────────────────

def load_clip_polygon():
    p = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'veierland_boundary.json')
    with open(p, encoding='utf-8') as f:
        return shape(json.load(f))

# ─── Nedlastings-URLer ───────────────────────────────────────────────────────

SHAPEFILES = {
    'losmasser': 'https://nedlasting.ngu.no/api/fileproxy/3de4ddf6-d6b8-4398-8222-f5c47791a757/1562fce0-4563-428a-8d86-7d0b7f051627',
    'berggrunn': 'https://nedlasting.ngu.no/api/fileproxy/7c39be66-77b6-4b74-b58d-53b6bee90067/1eafb1e6-e03f-4dc6-bd1a-062c9841bf91',
    'marin_grense': 'https://nedlasting.ngu.no/api/fileproxy/cf8ccec7-9505-4d84-94a9-eac9c69971d3/0b6a13b2-c79e-49ea-8c95-28d087a36292',
}

GEOJSON_ZIPS = {}  # naturtyper lastes separat under

# ─── Fargetabeller (substring-match på norsk navn, første treff vinner) ──────

LOSMASSE_COLORS = [
    ('marin',       '#4a90d9'),
    ('hav',         '#4a90d9'),
    ('strandavs',   '#f0d060'),
    ('strand',      '#f0d060'),
    ('elve',        '#e89040'),
    ('morene',      '#a07858'),
    ('myr',         '#5a8040'),
    ('torv',        '#5a8040'),
    ('fjell',       '#b0b0b0'),
    ('berg',        '#b0b0b0'),
    ('ur',          '#c0a890'),
    ('utfylt',      '#d0c8a8'),
    ('antropo',     '#d0c8a8'),
]

BERGGRUNN_COLORS = [
    ('gneis',       '#d4a0c8'),
    ('granitt',     '#d07878'),
    ('granodior',   '#c87080'),
    ('syenitt',     '#b06888'),
    ('dioritt',     '#986090'),
    ('gabbro',      '#806098'),
    ('kalkstein',   '#c8c8a0'),
    ('marmor',      '#d8d0b0'),
    ('kvartsitt',   '#d0c888'),
    ('skifer',      '#787890'),
    ('fyllitt',     '#686880'),
    ('amfibolitt',  '#607878'),
    ('sandstein',   '#d0b870'),
]

NATURTYPE_COLORS = [
    ('kystlynghei',         '#c8906a'),
    ('strandeng',           '#8fbe8f'),
    ('strandsump',          '#6090b0'),
    ('sanddyne',            '#e0d070'),
    ('tang',                '#6090a0'),
    ('ålegras',             '#3a9060'),
    ('edelløvskog',         '#40a040'),
    ('gråor',               '#50b050'),
    ('svartor',             '#309030'),
    ('kystgranskog',        '#207020'),
    ('kalkskog',            '#70b870'),
    ('rikere sump',         '#5070c0'),
    ('myr',                 '#7878b0'),
    ('kystmyr',             '#7878b0'),
    ('åpen grunnlendt',     '#c8b878'),
    ('ur',                  '#a09080'),
    ('nakent berg',         '#b0a090'),
    ('knaus',               '#c0b0a0'),
]

DEFAULT_COLOR = '#cccccc'


def color_for(name: str, table: list) -> str:
    nl = name.lower()
    for key, color in table:
        if key in nl:
            return color
    return DEFAULT_COLOR


# ─── Felles nedlasting ───────────────────────────────────────────────────────

def download(label: str, url: str) -> bytes:
    print(f'\nLaster ned {label}...')
    r = requests.get(url, timeout=300, stream=True)
    r.raise_for_status()
    total = int(r.headers.get('content-length', 0))
    chunks, done = [], 0
    for chunk in r.iter_content(256 * 1024):
        chunks.append(chunk)
        done += len(chunk)
        if total:
            print(f'  {done / total * 100:.0f}%', end='\r', flush=True)
    data = b''.join(chunks)
    print(f'  {len(data) / 1024 / 1024:.1f} MB')
    return data


# ─── Shapefile-laster og klipper ─────────────────────────────────────────────

def load_shp(zip_bytes: bytes, clip_poly, simplify=0.00005) -> gpd.GeoDataFrame:
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(tmp)
        shp = next(
            (os.path.join(r, f) for r, _, files in os.walk(tmp) for f in files if f.endswith('.shp')),
            None
        )
        if not shp:
            raise ValueError('Ingen .shp funnet i zip')
        gdf = gpd.read_file(shp)

    print(f'  CRS: {gdf.crs}  kolonner: {[c for c in gdf.columns if c != "geometry"]}')
    print(f'  {len(gdf)} features i Vestfold')

    gdf = gdf.to_crs('EPSG:4326')
    gdf = gdf[gdf.geometry.intersects(clip_poly)].copy()
    gdf['geometry'] = gdf.geometry.intersection(clip_poly)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    if simplify:
        gdf['geometry'] = gdf.geometry.simplify(simplify, preserve_topology=True)
        gdf = gdf[~gdf.geometry.is_empty].copy()
    print(f'  {len(gdf)} features på Veierland')
    return gdf


# ─── GeoJSON-zip-laster og klipper ───────────────────────────────────────────

def load_geojson_zip(zip_bytes: bytes, clip_poly, simplify=0.00005) -> gpd.GeoDataFrame:
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            print(f'  Filer i zip: {names[:10]}')
            zf.extractall(tmp)
        geojson_file = next(
            (os.path.join(r, f) for r, _, files in os.walk(tmp) for f in files if f.endswith('.geojson') or f.endswith('.json')),
            None
        )
        if not geojson_file:
            raise ValueError('Ingen .geojson funnet i zip')
        print(f'  Leser: {os.path.basename(geojson_file)}')
        gdf = gpd.read_file(geojson_file)

    print(f'  CRS: {gdf.crs}  kolonner: {[c for c in gdf.columns if c != "geometry"]}')
    print(f'  {len(gdf)} features totalt i fylket')

    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs('EPSG:4326')
    gdf = gdf[gdf.geometry.intersects(clip_poly)].copy()
    gdf['geometry'] = gdf.geometry.intersection(clip_poly)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    if simplify:
        gdf['geometry'] = gdf.geometry.simplify(simplify, preserve_topology=True)
        gdf = gdf[~gdf.geometry.is_empty].copy()
    print(f'  {len(gdf)} features på Veierland')
    return gdf


def best_field(gdf: gpd.GeoDataFrame, candidates: list) -> str | None:
    lower = {c.lower(): c for c in gdf.columns}
    return next((lower[c.lower()] for c in candidates if c.lower() in lower), None)


# ─── Konverterere per datasett ────────────────────────────────────────────────

def to_losmasser(gdf: gpd.GeoDataFrame) -> list[dict]:
    name_f = best_field(gdf, ['jorda_navn', 'losmtypnvn', 'losmtypenavn', 'typenavn', 'navn'])
    code_f = best_field(gdf, ['jordart', 'losmtype', 'typekode', 'kode'])
    print(f'  navn={name_f}  kode={code_f}')
    out = []
    for _, row in gdf.iterrows():
        try:
            name = str(row[name_f]).strip() if name_f else ''
            code = str(row[code_f]).strip() if code_f else ''
            out.append({'type': 'Feature', 'geometry': mapping(row.geometry), 'properties': {
                'type_no': name or code or 'Ukjent',
                'type_code': code,
                'color': color_for(name or code, LOSMASSE_COLORS),
            }})
        except Exception:
            continue
    return out


def rgb_to_hex(s: str) -> str | None:
    try:
        r, g, b = [int(x.strip()) for x in s.split(',')]
        return f'#{r:02x}{g:02x}{b:02x}'
    except Exception:
        return None


def to_berggrunn(gdf: gpd.GeoDataFrame) -> list[dict]:
    name_f = best_field(gdf, ['tegnforkla', 'hovedberg_', 'gb_gruppe', 'berggruppe', 'bergenhet', 'bergart', 'navn'])
    rgb_f  = best_field(gdf, ['rgbfargeko', 'rgb', 'rgbfarve'])
    print(f'  navn={name_f}  rgb={rgb_f}')
    out = []
    for _, row in gdf.iterrows():
        try:
            name  = str(row[name_f]).strip() if name_f else ''
            color = (rgb_to_hex(str(row[rgb_f])) if rgb_f else None) or color_for(name, BERGGRUNN_COLORS)
            out.append({'type': 'Feature', 'geometry': mapping(row.geometry), 'properties': {
                'type_no': name or 'Ukjent bergart',
                'color': color,
            }})
        except Exception:
            continue
    return out


def to_naturtyper(gdf: gpd.GeoDataFrame) -> list[dict]:
    name_f   = best_field(gdf, ['naturtype', 'naturtypena', 'nattype', 'navn', 'type'])
    tilst_f  = best_field(gdf, ['tilstand', 'tilstandsvu', 'kondisjon'])
    kvalit_f = best_field(gdf, ['lokalitetsk', 'lokalitetkv', 'kvalitet'])
    print(f'  navn={name_f}  tilstand={tilst_f}  kvalitet={kvalit_f}')
    out = []
    for _, row in gdf.iterrows():
        try:
            name   = str(row[name_f]).strip() if name_f else ''
            tilst  = str(row[tilst_f]).strip()  if tilst_f  else ''
            kvalit = str(row[kvalit_f]).strip() if kvalit_f else ''
            label  = name
            if tilst and tilst not in ('None', ''):
                label += f' · {tilst}'
            out.append({'type': 'Feature', 'geometry': mapping(row.geometry), 'properties': {
                'type_no': name or 'Ukjent naturtype',
                'tilstand': tilst,
                'kvalitet': kvalit,
                'label': label,
                'color': color_for(name, NATURTYPE_COLORS),
            }})
        except Exception:
            continue
    return out


def to_marin_grense(gdf: gpd.GeoDataFrame) -> list[dict]:
    # Marin grense er typisk punkter med høyde over havet der marine sedimenter slutter
    elev_f = best_field(gdf, ['hoyde', 'høyde', 'elevation', 'marin_gr', 'marine_li', 'maringren', 'hoh', 'z'])
    type_f = best_field(gdf, ['type', 'grensetype', 'sikkerhet', 'objtype'])
    print(f'  høyde={elev_f}  type={type_f}')
    print(f'  geometrityper: {gdf.geometry.geom_type.unique().tolist()}')
    out = []
    for _, row in gdf.iterrows():
        try:
            elev  = row[elev_f] if elev_f else None
            gtype = str(row[type_f]).strip() if type_f else ''
            try:
                elev_num = float(elev) if elev is not None else None
            except (TypeError, ValueError):
                elev_num = None
            label = f'Marin grense'
            if elev_num is not None:
                label += f': {elev_num:.0f} m.o.h.'
            out.append({'type': 'Feature', 'geometry': mapping(row.geometry), 'properties': {
                'type_no': label,
                'elev_m': elev_num,
                'grensetype': gtype,
                'color': '#2255cc',
            }})
        except Exception:
            continue
    return out


# ─── Lagre ───────────────────────────────────────────────────────────────────

def save(features: list[dict], path: str) -> None:
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': features}, f,
                  ensure_ascii=False, separators=(',', ':'))
    print(f'  → {path}  ({len(features)} features, {os.path.getsize(path) // 1024} KB)')


# ─── Main ────────────────────────────────────────────────────────────────────

def main() -> None:
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'src', 'data')
    os.makedirs(out_dir, exist_ok=True)
    clip = load_clip_polygon()
    print(f'Øygrense bbox: {clip.bounds}')

    handlers = {
        'losmasser':    to_losmasser,
        'berggrunn':    to_berggrunn,
        'marin_grense': to_marin_grense,
    }

    for name, url in SHAPEFILES.items():
        try:
            gdf = load_shp(download(name, url), clip)
            if gdf.empty:
                print(f'  ⚠ Ingen data for {name}')
                continue
            save(handlers[name](gdf), os.path.join(out_dir, f'{name}.geojson'))
        except Exception as e:
            print(f'  FEIL {name}: {e}', file=sys.stderr)
            import traceback; traceback.print_exc()

    # Naturtyper — hent via ArcGIS REST bbox-spørring mot Naturbase
    print('\nLaster naturtyper (NiN) via Naturbase REST...')
    try:
        bbox = clip.bounds  # (minx, miny, maxx, maxy)
        # Prøv NiN-naturtyper (kartleggingsprogram 2018+)
        NATURBASE_LAYERS = [
            ('NiN naturtyper',  'https://kart.miljodirektoratet.no/arcgis/rest/services/Natur_i_Norge/nin_naturtype_utvalgte_omrader/MapServer/0/query'),
            ('Utvalgte naturtyper', 'https://kart.miljodirektoratet.no/arcgis/rest/services/utvalgte_naturtyper/MapServer/0/query'),
            ('Naturtyper (eldre)', 'https://kart.miljodirektoratet.no/arcgis/rest/services/naturbase/MapServer/0/query'),
        ]
        naturtyper_done = False
        for label, base_url in NATURBASE_LAYERS:
            try:
                print(f'  Prøver {label}...')
                params = {
                    'where': '1=1',
                    'geometry': f'{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}',
                    'geometryType': 'esriGeometryEnvelope',
                    'inSR': '4326',
                    'outSR': '4326',
                    'spatialRel': 'esriSpatialRelIntersects',
                    'outFields': '*',
                    'f': 'geojson',
                    'resultRecordCount': 1000,
                }
                r = requests.get(base_url, params=params, timeout=30)
                r.raise_for_status()
                fc = r.json()
                feats = fc.get('features', [])
                print(f'    {len(feats)} features')
                if feats:
                    import geopandas as gpd2
                    gdf_nat = gpd.GeoDataFrame.from_features(feats, crs='EPSG:4326')
                    print(f'    kolonner: {[c for c in gdf_nat.columns if c != "geometry"]}')
                    save(to_naturtyper(gdf_nat), os.path.join(out_dir, 'naturtyper.geojson'))
                    naturtyper_done = True
                    break
            except Exception as e:
                print(f'    FEIL: {e}')
        if not naturtyper_done:
            print('  ⚠ Ingen NiN-naturtyper funnet på Veierland — området er trolig ikke kartlagt')
    except Exception as e:
        print(f'  FEIL naturtyper: {e}', file=sys.stderr)
        import traceback; traceback.print_exc()


if __name__ == '__main__':
    main()
