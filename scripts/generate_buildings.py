#!/usr/bin/env python3
"""
Last ned bygningsdata fra Kartverket Matrikkel for Veierland.

Bruk:
  pip install geopandas requests shapely pyproj
  python scripts/generate_buildings.py

Output:
  src/data/buildings.geojson
"""

import json
import os
import sys

import requests
import geopandas as gpd
from shapely.geometry import mapping, shape

# ─── Øygrense ────────────────────────────────────────────────────────────────

def load_clip_polygon():
    p = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'veierland_boundary.json')
    with open(p, encoding='utf-8') as f:
        return shape(json.load(f))

# ─── Bygningstype-koder → norsk navn ─────────────────────────────────────────

BYGNINGSTYPE = {
    111: 'Enebolig', 112: 'Enebolig m/hybel', 121: 'Tomannsbolig',
    122: 'Tomannsbolig', 123: 'Tomannsbolig', 124: 'Tomannsbolig',
    131: 'Rekkehus', 133: 'Rekkehus', 135: 'Rekkehus',
    136: 'Rekkehus', 141: 'Stor boligblokk', 142: 'Bofellesskap',
    143: 'Studenthjem', 144: 'Annen boligblokk',
    151: 'Våningshus', 152: 'Kårbolig',
    161: 'Hytte/fritidsbolig', 162: 'Helårsbolig brukt som fritid',
    163: 'Fritidsbolig', 171: 'Garasje/uthus til bolig',
    172: 'Garasje (frittstående)', 173: 'Naust/båthus/sjøbu',
    181: 'Driftsbygning', 182: 'Hus for dyr', 183: 'Korn/fôrlagring',
    193: 'Bolig m/nærings', 199: 'Annen bolig',
    211: 'Hotell', 212: 'Motell', 214: 'Pensjonat',
    216: 'Vandrerhjem', 219: 'Annet overnatting',
    221: 'Restaurant/kafe', 231: 'Butikk',
    239: 'Annen forretning', 241: 'Kontor',
    311: 'Barnehage', 312: 'Grunnskole', 313: 'Videregående',
    319: 'Annen skole', 321: 'Sykehus', 322: 'Legekontor',
    330: 'Museum/bibliotek', 411: 'Kraftstasjon',
    511: 'Landbruksbygg', 521: 'Fiskebygg',
    612: 'Veistasjoner', 613: 'Parkeringshus',
    629: 'Annet samferdsels', 641: 'Brygge/kai', 649: 'Havneanlegg',
    671: 'Telekommunikasjon', 672: 'Trafostasjon',
    719: 'Annet teknisk bygg', 721: 'Parkeringsanlegg',
    730: 'Idrettsbygg', 731: 'Idrettshall', 739: 'Annet idrett',
    819: 'Kirke/kapell', 830: 'Gravkapell',
    840: 'Forsvarbygg', 999: 'Ukjent/annet',
}

def bygningstype_label(code):
    try:
        return BYGNINGSTYPE.get(int(code), f'Bygg {code}')
    except (TypeError, ValueError):
        return 'Ukjent'

# ─── Farge etter byggeår ──────────────────────────────────────────────────────
# Gradient: mørk brun (gammelt) → blå/lilla (nytt)

def year_color(year):
    if year is None:
        return '#aaaaaa'
    if year < 1900:
        return '#6b3a1f'   # mørk brun
    if year < 1920:
        return '#9b5a2f'   # brun
    if year < 1940:
        return '#c87830'   # oransje-brun
    if year < 1950:
        return '#c8a030'   # gul-brun
    if year < 1960:
        return '#a0b030'   # gul-grønn
    if year < 1970:
        return '#60a040'   # grønn
    if year < 1980:
        return '#30a080'   # blå-grønn
    if year < 1990:
        return '#2080b0'   # blå
    if year < 2000:
        return '#3060c8'   # mellomblå
    if year < 2010:
        return '#5040d0'   # indigo
    return '#8030c0'       # lilla (nytt)

# ─── Hent fra WFS ────────────────────────────────────────────────────────────

WFS_URL = 'https://wfs.geonorge.no/skwms1/wfs.matrikkelen-bygning'

# Kandidater for byggeår-felt og typefeltnavn
YEAR_FIELDS  = ['byggeaar', 'byggeAar', 'bygg_aar', 'year_built', 'bygningsstatus']
TYPE_FIELDS  = ['bygningstype', 'bygningstype_kode', 'typeKode', 'type_kode']
STATUS_FIELDS = ['bygningsstatus', 'status']

def best_field(gdf, candidates):
    lower = {c.lower(): c for c in gdf.columns}
    return next((lower[c.lower()] for c in candidates if c.lower() in lower), None)


def fetch_via_wfs(clip_poly):
    b = clip_poly.bounds  # (minx, miny, maxx, maxy) i WGS84

    # WFS 2.0 med JSON-output
    params = {
        'SERVICE': 'WFS',
        'VERSION': '2.0.0',
        'REQUEST': 'GetFeature',
        'TYPENAMES': 'app:Bygning',
        'BBOX': f'{b[0]},{b[1]},{b[2]},{b[3]},EPSG:4326',
        'SRSNAME': 'EPSG:4326',
        'outputFormat': 'application/json',
        'COUNT': '5000',
    }

    print(f'  URL: {WFS_URL}')
    r = requests.get(WFS_URL, params=params, timeout=60)
    print(f'  HTTP {r.status_code}  Content-Type: {r.headers.get("Content-Type","?")}')

    if r.status_code != 200:
        raise ValueError(f'HTTP {r.status_code}: {r.text[:300]}')

    ct = r.headers.get('Content-Type', '')
    if 'json' in ct:
        fc = r.json()
        features = fc.get('features', [])
        if not features:
            raise ValueError(f'Tom GeoJSON respons. Keys: {list(fc.keys())}')
        gdf = gpd.GeoDataFrame.from_features(features, crs='EPSG:4326')
    else:
        # GML-respons — la geopandas/GDAL parse det
        import io, tempfile
        with tempfile.NamedTemporaryFile(suffix='.gml', delete=False) as f:
            f.write(r.content)
            fname = f.name
        gdf = gpd.read_file(fname)
        os.unlink(fname)
        if gdf.crs and gdf.crs.to_epsg() != 4326:
            gdf = gdf.to_crs('EPSG:4326')

    return gdf


def fetch_via_gpd_wfs(clip_poly):
    """Alternativ: la geopandas lese WFS direkte."""
    b = clip_poly.bounds
    url = (
        f'{WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature'
        f'&TYPENAMES=app:Bygning'
        f'&BBOX={b[0]},{b[1]},{b[2]},{b[3]},EPSG:4326'
        f'&SRSNAME=EPSG:4326&COUNT=5000'
    )
    print(f'  gpd.read_file: {url[:120]}...')
    gdf = gpd.read_file(url)
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs('EPSG:4326')
    return gdf


# ─── Konverter til GeoJSON-features ──────────────────────────────────────────

def to_buildings(gdf):
    year_f   = best_field(gdf, YEAR_FIELDS)
    type_f   = best_field(gdf, TYPE_FIELDS)
    status_f = best_field(gdf, STATUS_FIELDS)
    print(f'  byggeår={year_f}  type={type_f}  status={status_f}')

    out = []
    for _, row in gdf.iterrows():
        try:
            year_raw = row[year_f] if year_f else None
            try:
                year = int(year_raw) if year_raw not in (None, '', 'None') else None
            except (ValueError, TypeError):
                year = None
            # Ignorer åpenbart feil årstall
            if year is not None and (year < 1600 or year > 2030):
                year = None

            type_code = row[type_f] if type_f else None
            type_label = bygningstype_label(type_code)

            out.append({
                'type': 'Feature',
                'geometry': mapping(row.geometry),
                'properties': {
                    'byggeaar': year,
                    'type': type_label,
                    'type_kode': int(type_code) if type_code else None,
                    'color': year_color(year),
                },
            })
        except Exception:
            continue
    return out


# ─── Lagre ───────────────────────────────────────────────────────────────────

def save(features, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': features}, f,
                  ensure_ascii=False, separators=(',', ':'))
    kb = os.path.getsize(path) // 1024
    print(f'  → {path}  ({len(features)} bygg, {kb} KB)')


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    out_dir = os.path.join(os.path.dirname(__file__), '..', 'src', 'data')
    os.makedirs(out_dir, exist_ok=True)
    clip = load_clip_polygon()
    print(f'Øygrense bbox: {clip.bounds}')

    print('\nHenter bygningsdata fra Kartverket Matrikkel...')
    gdf = None
    for fn, label in [(fetch_via_wfs, 'JSON-params'), (fetch_via_gpd_wfs, 'gpd WFS')]:
        try:
            gdf = fn(clip)
            print(f'  ✓ {label}: {len(gdf)} features i bbox')
            print(f'  Kolonner: {[c for c in gdf.columns if c != "geometry"]}')
            break
        except Exception as e:
            print(f'  ✗ {label}: {e}')

    if gdf is None or gdf.empty:
        print('FEIL: Klarte ikke hente bygningsdata', file=sys.stderr)
        sys.exit(1)

    # Klipp til øygrensen
    if gdf.crs and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs('EPSG:4326')
    gdf = gdf[gdf.geometry.intersects(clip)].copy()
    print(f'  {len(gdf)} bygg på Veierland etter klipping')

    if gdf.empty:
        print('FEIL: Ingen bygg funnet på Veierland', file=sys.stderr)
        sys.exit(1)

    features = to_buildings(gdf)
    save(features, os.path.join(out_dir, 'buildings.geojson'))


if __name__ == '__main__':
    main()
