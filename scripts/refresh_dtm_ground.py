#!/usr/bin/env python3
"""
Oppdaterer KUN DTM-kanalen (b64Ground) i src/data/dom_grid.json fra en ny
DTM-kilde, uten å røre DOM-kanalen (b64) — nyttig når man får en frisk/riktig
DTM-eksport fra hoydedata.no uten å måtte laste ned DOM (overflatemodell) på
nytt. Samples nøyaktig samme grid (bbox/cols/rows/cellM) som allerede ligger
i dom_grid.json, så filene forblir kompatible.

Bruk:
  python scripts/refresh_dtm_ground.py <dtm.tif|mappe>

Samme fallback-logikk som generate_dom_grid.py sin main(): der DTM mangler
dekning (<=0.05 m) men DOM har terreng (>2 m), brukes DOM som bakkenivå —
ellers ville fastland utenfor DTM-dekningen feilaktig fremstå som ren
trekrone-høyde over 0 m.
"""

import base64
import glob
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

try:
    import rasterio
    from rasterio.warp import transform as rio_transform
except ImportError:
    print("Mangler avhengigheter. Kjør:")
    print("  pip install rasterio numpy")
    sys.exit(1)

OUTPUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'dom_grid.json')


def find_tiles(src_path: str) -> list[str]:
    if os.path.isfile(src_path):
        return [src_path]
    tiles = sorted(
        p for p in glob.glob(os.path.join(src_path, '**', '*.tif'), recursive=True)
        if not p.lower().endswith('.ovr')
    )
    if not tiles:
        print(f"Fant ingen .tif-filer under {src_path}")
        sys.exit(1)
    return tiles


def sample_tiles(tile_paths: list[str], lng_grid: np.ndarray, lat_grid: np.ndarray) -> np.ndarray:
    n = lng_grid.size
    samples = np.zeros(n, dtype=np.float64)
    covered = np.zeros(n, dtype=bool)

    with rasterio.open(tile_paths[0]) as first:
        crs = first.crs
    print(f"CRS: {crs} · {len(tile_paths)} flis(er)")

    xs, ys = rio_transform('EPSG:4326', crs, lng_grid.ravel().tolist(), lat_grid.ravel().tolist())
    xs = np.asarray(xs)
    ys = np.asarray(ys)

    for i, path in enumerate(tile_paths):
        with rasterio.open(path) as src:
            b = src.bounds
            mask = (~covered) & (xs >= b.left) & (xs < b.right) & (ys > b.bottom) & (ys <= b.top)
            idx = np.nonzero(mask)[0]
            if idx.size == 0:
                continue
            vals = np.array([v[0] for v in src.sample(zip(xs[idx], ys[idx]))], dtype=np.float64)
            nodata = src.nodata
            if nodata is not None:
                vals[vals == nodata] = np.nan
            samples[idx] = vals
            covered[idx] = True
        if len(tile_paths) > 1 and ((i + 1) % 40 == 0 or i == len(tile_paths) - 1):
            print(f"  flis {i + 1}/{len(tile_paths)} · {covered.sum()}/{n} punkter dekket")

    uncovered = n - int(covered.sum())
    if uncovered > 0:
        print(f"NB: {uncovered} rutepunkter falt utenfor alle flisene (behandles som hav/0 m)")
    return samples


def decode_dm(b64: str, shape: tuple[int, int]) -> np.ndarray:
    arr = np.frombuffer(base64.b64decode(b64), dtype='<u2').astype(np.float64) / 10.0
    return arr.reshape(shape)


def to_b64_dm(samples: np.ndarray) -> str:
    dm = np.clip(np.round(samples * 10), 0, 65535).astype('<u2')
    return base64.b64encode(dm.tobytes()).decode('ascii')


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    dtm_path = sys.argv[1]

    with open(OUTPUT) as f:
        raw = json.load(f)

    cols, rows = raw['cols'], raw['rows']
    min_lng, min_lat, max_lng, max_lat = raw['minLng'], raw['minLat'], raw['maxLng'], raw['maxLat']

    lngs = np.linspace(min_lng, max_lng, cols)
    lats = np.linspace(max_lat, min_lat, rows)
    lng_grid, lat_grid = np.meshgrid(lngs, lats)

    old_ground = decode_dm(raw['b64Ground'], (rows, cols)) if raw.get('b64Ground') else None
    dom = decode_dm(raw['b64'], (rows, cols))

    tile_paths = find_tiles(dtm_path)
    print(f"--- DTM: {dtm_path}")
    dtm = sample_tiles(tile_paths, lng_grid, lat_grid).reshape(rows, cols)
    dtm = np.nan_to_num(dtm, nan=0.0)
    dtm[dtm < 0] = 0.0
    print(f"DTM (nytt): maks {dtm.max():.1f} m · {int((dtm > 0.2).sum())} celler over 0,2 m")

    no_dtm = (dtm <= 0.05) & (dom > 2.0)
    dtm = np.where(no_dtm, dom, dtm)
    print(f"DTM-fallback (DOM som bakke): {int(no_dtm.sum())} celler uten DTM-dekning")
    dtm = np.minimum(dtm, dom)
    canopy = dom - dtm
    print(f"Kronehøyde (DOM-DTM): maks {canopy.max():.1f} m · "
          f"{int((canopy > 2).sum())} celler med >2 m vegetasjon/bygg")

    if old_ground is not None:
        diff = np.abs(dtm - old_ground)
        changed = int((diff > 0.15).sum())
        print(f"Sammenlignet med forrige b64Ground: {changed} celler endret >0,15 m "
              f"(maks endring {diff.max():.1f} m, snitt {diff.mean():.2f} m)")

    raw['b64Ground'] = to_b64_dm(dtm.ravel())
    raw['source'] = 'Kartverket DOM + DTM (hoydedata.no)'
    raw['generatedAt'] = datetime.now(timezone.utc).isoformat()
    with open(OUTPUT, 'w') as f:
        json.dump(raw, f)
    print(f"Skrev {OUTPUT} ({os.path.getsize(OUTPUT) // 1024} kB)")


if __name__ == '__main__':
    main()
