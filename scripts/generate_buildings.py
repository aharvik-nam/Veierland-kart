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

# INSPIRE BU Core 2D field mapping
YEAR_FIELDS   = ['dateOfConstruction', 'byggeaar', 'byggeAar', 'beginLifespanVersion']
TYPE_FIELDS   = ['currentUse', 'bygningstype', 'typeKode', 'buildingNature', 'CharacterString']
STATUS_FIELDS = ['conditionOfConstruction', 'bygningsstatus', 'status']

CONDITION_MAP = {
    'functional':        'Aktiv',
    'projected':         'Planlagt',
    'underconstruction': 'Under bygging',
    'ruin':              'Ruin',
    'demolished':        'Revet',
    'disused':           'Ikke i bruk',
}

def best_field(gdf, candidates):
    lower = {c.lower(): c for c in gdf.columns}
    return next((lower[c.lower()] for c in candidates if c.lower() in lower), None)


def bbox_utm33(clip_poly):
    from pyproj import Transformer
    t = Transformer.from_crs('EPSG:4326', 'EPSG:25833', always_xy=True)
    b = clip_poly.bounds
    x1, y1 = t.transform(b[0], b[1])
    x2, y2 = t.transform(b[2], b[3])
    return x1, y1, x2, y2


def try_wfs(base_url, typename, bbox_str, epsg, version='2.0.0'):
    key = 'TYPENAMES' if version == '2.0.0' else 'TYPENAME'
    params = {
        'SERVICE': 'WFS', 'VERSION': version, 'REQUEST': 'GetFeature',
        key: typename, 'BBOX': bbox_str, 'SRSNAME': epsg, 'COUNT': '5000',
    }
    r = requests.get(base_url, params=params, timeout=60)
    ct = r.headers.get('Content-Type', '')
    if 'exception' in ct.lower() or 'se_xml' in ct.lower():
        import re
        msg = re.search(r'<(?:[Ee]xception[Tt]ext|ServiceException)>([^<]+)', r.text)
        err = (msg.group(1) if msg else r.text[:200]).strip()
        raise ValueError(err)
    if 'json' in ct:
        fc = r.json()
        feats = fc.get('features', [])
        if not feats:
            raise ValueError('Tom JSON-respons')
        return gpd.GeoDataFrame.from_features(feats, crs=epsg)
    # GML / XML
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.gml', delete=False) as f:
        f.write(r.content); fname = f.name
    try:
        gdf = gpd.read_file(fname)
        if gdf.empty:
            raise ValueError('Tom GML-respons')
        return gdf
    finally:
        os.unlink(fname)


# Kjente WFS-endepunkter med bygningsdata
WFS_CANDIDATES = [
    # INSPIRE Building Core 2D (åpent, EU-standard)
    ('https://wfs.geonorge.no/skwms1/wfs.inspire-bu-core2d',
     ['bu-core2d:Building', 'BU.Building', 'Building']),
    # FKB-Bygning (detaljert, men krever partner-tilgang)
    ('https://wfs.geonorge.no/skwms1/wfs.fkb-bygning',
     ['app:Bygning', 'Bygning', 'app:BygningPunkt']),
    # Matrikkelen (annen URL-variant)
    ('https://wfs.geonorge.no/skwms1/wfs.matrikkelen',
     ['app:Bygning', 'app:BygningPunkt', 'Bygning']),
    # Kartverket topo (grunnriss)
    ('https://wfs.geonorge.no/skwms1/wfs.kartdata3',
     ['app:Bygning', 'Bygning']),
]


def fetch_buildings_wfs(clip_poly):
    x1, y1, x2, y2 = bbox_utm33(clip_poly)
    b = clip_poly.bounds
    bbox_25833 = f'{x1},{y1},{x2},{y2},EPSG:25833'
    bbox_4326  = f'{b[0]},{b[1]},{b[2]},{b[3]},EPSG:4326'

    for base_url, typenames in WFS_CANDIDATES:
        # GetCapabilities for å se hva som faktisk er tilgjengelig
        try:
            cap = requests.get(base_url, params={'SERVICE':'WFS','VERSION':'2.0.0','REQUEST':'GetCapabilities'}, timeout=15)
            import re
            avail = re.findall(r'<(?:Name|ows:Identifier)>([^<]+)</(?:Name|ows:Identifier)>', cap.text)
            print(f'\n  {base_url.split("/")[-1]}  →  {avail[:8] or "?"}')
            # Bruk kun kjente typenavn som faktisk finnes
            if avail:
                typenames = [t for t in typenames if any(t.split(':')[-1].lower() in a.lower() for a in avail)] or typenames
        except Exception:
            print(f'\n  {base_url.split("/")[-1]}  →  (GetCapabilities feilet)')

        for typename in typenames:
            for epsg, bx in [('EPSG:25833', bbox_25833), ('EPSG:4326', bbox_4326)]:
                print(f'    {typename} / {epsg} ... ', end='', flush=True)
                try:
                    gdf = try_wfs(base_url, typename, bx, epsg)
                    print(f'✓  {len(gdf)} features')
                    if gdf.crs and gdf.crs.to_epsg() != 4326:
                        gdf = gdf.to_crs('EPSG:4326')
                    return gdf
                except Exception as e:
                    print(f'✗  {str(e)[:80]}')

    raise ValueError('Ingen WFS-endepunkt returnerte data')


# ─── Konverter til GeoJSON-features ──────────────────────────────────────────

def parse_year(val):
    """Trekk ut årstall fra ISO-dato, rent tall, eller None."""
    if val is None or str(val).strip() in ('', 'None', 'nan'):
        return None
    s = str(val).strip()
    # ISO datetime: "2015-03-22T00:00:00" eller "2015-03-22"
    if len(s) >= 4 and s[:4].isdigit():
        y = int(s[:4])
        return y if 1600 < y <= 2030 else None
    return None


def to_buildings(gdf):
    year_f   = best_field(gdf, YEAR_FIELDS)
    type_f   = best_field(gdf, TYPE_FIELDS)
    status_f = best_field(gdf, STATUS_FIELDS)
    lifespan_f = best_field(gdf, ['beginLifespanVersion'])
    print(f'  year_f={year_f}  type_f={type_f}  status_f={status_f}  lifespan_f={lifespan_f}')

    # Vis eksempel-verdier for hvert felt
    for f in [year_f, type_f, status_f, lifespan_f]:
        if f and f in gdf.columns:
            sample = gdf[f].dropna().head(3).tolist()
            print(f'    {f}: {sample}')

    out = []
    for _, row in gdf.iterrows():
        try:
            # Årstall: prøv dedikert felt først, fall tilbake til beginLifespanVersion
            year = parse_year(row[year_f]) if year_f else None
            if year is None and lifespan_f:
                year = parse_year(row[lifespan_f])

            # Type/bruk
            type_raw = str(row[type_f]).strip() if type_f and row[type_f] not in (None, '') else ''
            type_label = bygningstype_label(type_raw) if type_raw.isdigit() else (type_raw or 'Bygg')

            # Status
            cond_raw = str(row[status_f]).strip().lower().replace(' ', '') if status_f else ''
            status_label = CONDITION_MAP.get(cond_raw, '')

            out.append({
                'type': 'Feature',
                'geometry': mapping(row.geometry),
                'properties': {
                    'byggeaar': year,
                    'type': type_label,
                    'status': status_label,
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

    print('\nHenter bygningsdata fra Kartverket WFS...')
    gdf = None
    try:
        gdf = fetch_buildings_wfs(clip)
        print(f'\n  Kolonner: {[c for c in gdf.columns if c != "geometry"]}')
    except Exception as e:
        print(f'\n  FEIL: {e}')

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
