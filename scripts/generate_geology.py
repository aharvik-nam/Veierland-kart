#!/usr/bin/env python3
"""
Last ned NGU geologi-data for Veierland og konverter til GeoJSON.

Bruk:
  pip install geopandas requests shapely
  python scripts/generate_geology.py

Output:
  src/data/losmasser.geojson
  src/data/berggrunn.geojson
"""

import io
import json
import math
import os
import sys
import tempfile
import zipfile

import requests
import geopandas as gpd
from shapely.geometry import box, mapping

# ─── Veierland bbox (WGS84) ──────────────────────────────────────────────────

CLIP_BOX = box(10.370, 59.105, 10.450, 59.165)  # (lon_min, lat_min, lon_max, lat_max)

# ─── NGU nedlasting-URLer (Vestfold, EPSG:4258 Shapefile) ────────────────────
# Berggrunn N250 brukes istedenfor N50 siden N50 ikke dekker småøyer som Veierland

DATASETS = {
    'losmasser': 'https://nedlasting.ngu.no/api/fileproxy/3de4ddf6-d6b8-4398-8222-f5c47791a757/1562fce0-4563-428a-8d86-7d0b7f051627',
    'berggrunn': 'https://nedlasting.ngu.no/api/fileproxy/7c39be66-77b6-4b74-b58d-53b6bee90067/1eafb1e6-e03f-4dc6-bd1a-062c9841bf91',
}

# ─── Farger per løsmassetype (substring-match på norsk navn) ─────────────────

LOSMASSE_COLORS: list[tuple[str, str]] = [
    ('marin',          '#4a90d9'),   # Marin leire
    ('hav',            '#4a90d9'),   # Havavsetning
    ('strandavs',      '#f0d060'),   # Strandavsetning
    ('strand',         '#f0d060'),
    ('elve',           '#e89040'),   # Elveavsetning
    ('fluvial',        '#e89040'),
    ('morene',         '#a07858'),   # Moreneavsetning
    ('myr',            '#5a8040'),   # Myr/torv
    ('torv',           '#5a8040'),
    ('fjell',          '#b0b0b0'),   # Fjell i dagen
    ('berg',           '#b0b0b0'),
    ('ur',             '#c0a890'),   # Ur/skredmateriale
    ('skred',          '#c0a890'),
    ('utfylt',         '#d0c8a8'),   # Utfylt/planert
    ('antropogent',    '#d0c8a8'),
]

BERGGRUNN_COLORS: list[tuple[str, str]] = [
    ('gneis',          '#d4a0c8'),
    ('granitt',        '#d07878'),
    ('granodior',      '#c87080'),
    ('syenitt',        '#b06888'),
    ('dioritt',        '#986090'),
    ('gabbro',         '#806098'),
    ('kalkstein',      '#c8c8a0'),
    ('marmor',         '#d8d0b0'),
    ('kvartsitt',      '#d0c888'),
    ('skifer',         '#787890'),
    ('fyllitt',        '#686880'),
    ('grønnskifer',    '#5a8870'),
    ('amfibolitt',     '#607878'),
    ('sandstein',      '#d0b870'),
    ('konglomerat',    '#c0a868'),
]

DEFAULT_COLOR = '#cccccc'


def color_for(name: str, table: list[tuple[str, str]]) -> str:
    name_lower = name.lower()
    for key, color in table:
        if key in name_lower:
            return color
    return DEFAULT_COLOR


def download(name: str, url: str) -> bytes:
    print(f'\nLaster ned {name}...')
    r = requests.get(url, timeout=300, stream=True)
    r.raise_for_status()
    total = int(r.headers.get('content-length', 0))
    chunks = []
    done = 0
    for chunk in r.iter_content(256 * 1024):
        chunks.append(chunk)
        done += len(chunk)
        if total:
            print(f'  {done / total * 100:.0f}%', end='\r', flush=True)
    data = b''.join(chunks)
    print(f'  {len(data) / 1024 / 1024:.1f} MB lastet ned')
    return data


def load_clip(zip_bytes: bytes) -> gpd.GeoDataFrame:
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            zf.extractall(tmp)
        shp = None
        for root, _, files in os.walk(tmp):
            for f in files:
                if f.endswith('.shp'):
                    shp = os.path.join(root, f)
                    break
            if shp:
                break
        if not shp:
            raise ValueError('Ingen .shp-fil funnet i zip')
        gdf = gpd.read_file(shp)

    print(f'  CRS: {gdf.crs}  |  kolonner: {[c for c in gdf.columns if c != "geometry"]}')
    print(f'  {len(gdf)} features totalt i Vestfold')

    gdf = gdf.to_crs('EPSG:4326')
    gdf = gdf[gdf.geometry.intersects(CLIP_BOX)].copy()
    gdf['geometry'] = gdf.geometry.intersection(CLIP_BOX)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    gdf['geometry'] = gdf.geometry.simplify(0.00005, preserve_topology=True)
    gdf = gdf[~gdf.geometry.is_empty].copy()
    print(f'  {len(gdf)} features etter klipping til Veierland')
    return gdf


def best_field(gdf: gpd.GeoDataFrame, candidates: list[str]) -> str | None:
    lower = {c.lower(): c for c in gdf.columns}
    for cand in candidates:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


def to_features_losmasser(gdf: gpd.GeoDataFrame) -> list[dict]:
    name_field = best_field(gdf, [
        'jorda_navn', 'losmtypnvn', 'losmtypenavn',
        'typnavn', 'typenavn', 'navn',
    ])
    code_field = best_field(gdf, [
        'jordart', 'losmtype', 'typekode', 'kode',
    ])
    print(f'  Bruker navn-felt="{name_field}", kode-felt="{code_field}"')

    features = []
    for _, row in gdf.iterrows():
        try:
            geom = mapping(row.geometry)
        except Exception:
            continue
        name = str(row[name_field]).strip() if name_field else ''
        code = str(row[code_field]).strip() if code_field else ''
        color = color_for(name or code, LOSMASSE_COLORS)
        features.append({
            'type': 'Feature',
            'geometry': geom,
            'properties': {
                'type_no': name or code or 'Ukjent løsmassetype',
                'type_code': code,
                'color': color,
            },
        })
    return features


def rgb_to_hex(rgb_str: str) -> str | None:
    """Convert 'R,G,B' string from NGU to '#rrggbb'."""
    try:
        parts = [int(x.strip()) for x in rgb_str.split(',')]
        if len(parts) == 3:
            return '#{:02x}{:02x}{:02x}'.format(*parts)
    except Exception:
        pass
    return None


def to_features_berggrunn(gdf: gpd.GeoDataFrame) -> list[dict]:
    name_field = best_field(gdf, [
        'tegnforkla', 'hovedberg_', 'gb_gruppe', 'berggruppe',
        'bergenhet', 'bergart', 'navn', 'typnavn',
    ])
    rgb_field = best_field(gdf, ['rgbfargeko', 'rgb', 'rgbfarve'])
    print(f'  Bruker navn-felt="{name_field}", rgb-felt="{rgb_field}"')

    features = []
    for _, row in gdf.iterrows():
        try:
            geom = mapping(row.geometry)
        except Exception:
            continue
        name = str(row[name_field]).strip() if name_field else ''
        # Use NGU's own RGB color when available
        color = None
        if rgb_field:
            color = rgb_to_hex(str(row[rgb_field]))
        if not color:
            color = color_for(name, BERGGRUNN_COLORS)
        features.append({
            'type': 'Feature',
            'geometry': geom,
            'properties': {
                'type_no': name or 'Ukjent bergart',
                'color': color,
            },
        })
    return features


def save(features: list[dict], path: str) -> None:
    fc = {'type': 'FeatureCollection', 'features': features}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(fc, f, ensure_ascii=False, separators=(',', ':'))
    kb = os.path.getsize(path) // 1024
    print(f'  → {path}  ({len(features)} features, {kb} KB)')


def main() -> None:
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'src', 'data')
    os.makedirs(out_dir, exist_ok=True)

    for name, url in DATASETS.items():
        try:
            zip_bytes = download(name, url)
            gdf = load_clip(zip_bytes)
            if gdf.empty:
                print(f'  Ingen data for {name} i Veierland-bbox — sjekk koordinater')
                continue
            if name == 'losmasser':
                features = to_features_losmasser(gdf)
            else:
                features = to_features_berggrunn(gdf)
            save(features, os.path.join(out_dir, f'{name}.geojson'))
        except Exception as exc:
            print(f'  FEIL for {name}: {exc}', file=sys.stderr)
            import traceback; traceback.print_exc()


if __name__ == '__main__':
    main()
