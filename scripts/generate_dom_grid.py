#!/usr/bin/env python3
"""
Generer src/data/dom_grid.json fra Kartverkets DOM (Digital OverflateModell).

DOM-en inkluderer trær og bygninger — det er den som trengs for å beregne
solskygge og le for vind (DTM-en er bar bakke og ser ikke skogbelter).

Bruk:
  pip install rasterio numpy
  python scripts/generate_dom_grid.py <dom.tif|mappe> [dtm.tif|mappe]

Oppgis også en DTM (bar bakke) lagres den som egen kanal (b64Ground).
Appen bruker da DTM som observatørhøyde (der mennesker faktisk står) og
DOM som hindringer — uten DTM står «observatøren» oppå trekronene og
skyggeberegningen blir gal i skogsområder.

DOM-fil lastes ned fra https://hoydedata.no :
  1. Zoom til Veierland
  2. «Last ned» → velg prosjekt med DOM (overflatemodell), GeoTIFF
  3. Pakk ut zip-fila et sted UTENFOR git-repoet (nedlastingen er typisk
     mange hundre MB–flere GB og skal ikke committes)
  4. Kjør dette skriptet med filen — eller mappen fliser ble pakket ut i —
     som argument. Flere fliser mosaikkeres automatisk ved sampling.

Output: src/data/dom_grid.json — et kompakt grid (15 m celler) med høyder
i desimeter som base64-kodet uint16, som appen bruker til sol/vind-laget.
"""

import base64
import glob
import json
import math
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

# --- Konfigurasjon -------------------------------------------------------

# Bounding box Veierland + litt buffer (WGS84) — samme som flood-skriptet
BBOX = (10.31, 59.12, 10.40, 59.21)  # (minLng, minLat, maxLng, maxLat)

CELL_M = 15  # oppløsning på gridet i meter

OUTPUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'dom_grid.json')

# -------------------------------------------------------------------------


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


def sample_tiles(tile_paths: list[str], lng_grid: np.ndarray, lat_grid: np.ndarray):
    """Sample each grid point from whichever tile covers it. Handles an
    arbitrary number of (possibly overlapping) tiles without loading a full
    mosaic into memory — only the sparse output grid is held in RAM."""
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


def sample_surface(src_path: str, lng_grid: np.ndarray, lat_grid: np.ndarray, label: str) -> np.ndarray:
    tile_paths = find_tiles(src_path)
    print(f"--- {label}: {src_path}")
    samples = sample_tiles(tile_paths, lng_grid, lat_grid)
    samples = np.nan_to_num(samples, nan=0.0)
    samples[samples < 0] = 0.0  # hav / støy under null
    land = int((samples > 0.2).sum())
    print(f"{label}: maks {samples.max():.1f} m · {land} celler over 0,2 m")
    if land < 500:
        print(f"ADVARSEL: nesten ingen landceller — dekker {label}-fila Veierland?")
    return samples


def to_b64_dm(samples: np.ndarray) -> str:
    # Desimeter som uint16 (0–6553,5 m holder i massevis)
    dm = np.clip(np.round(samples * 10), 0, 65535).astype('<u2')
    return base64.b64encode(dm.tobytes()).decode('ascii')


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    dom_path = sys.argv[1]
    dtm_path = sys.argv[2] if len(sys.argv) > 2 else None

    min_lng, min_lat, max_lng, max_lat = BBOX
    mid_lat = (min_lat + max_lat) / 2

    # Gridstørrelse i celler
    width_m = (max_lng - min_lng) * math.cos(math.radians(mid_lat)) * 111_320
    height_m = (max_lat - min_lat) * 111_320
    cols = max(2, round(width_m / CELL_M))
    rows = max(2, round(height_m / CELL_M))
    print(f"Grid: {cols} x {rows} celler ({CELL_M} m) = {cols * rows} punkter")

    # Målkoordinater (WGS84) for hver celle, radvis fra nordvest
    lngs = np.linspace(min_lng, max_lng, cols)
    lats = np.linspace(max_lat, min_lat, rows)  # nord -> sør
    lng_grid, lat_grid = np.meshgrid(lngs, lats)

    dom = sample_surface(dom_path, lng_grid, lat_grid, "DOM")

    out = {
        "empty": False,
        "minLng": min_lng, "minLat": min_lat,
        "maxLng": max_lng, "maxLat": max_lat,
        "cols": cols, "rows": rows,
        "cellM": CELL_M,
        "b64": to_b64_dm(dom),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Kartverket DOM (hoydedata.no)",
    }

    if dtm_path:
        dtm = sample_surface(dtm_path, lng_grid, lat_grid, "DTM")
        # DTM-nedlastinger fra hoydedata.no er ofte klippet til et lite område
        # (f.eks. bare Veierland). Der DTM mangler (0) men DOM har terreng,
        # fall tilbake til DOM som bakkenivå så fastlandet ikke feilaktig
        # framstår som 100 m med trekroner.
        no_dtm = (dtm <= 0.05) & (dom > 2.0)
        dtm = np.where(no_dtm, dom, dtm)
        print(f"DTM-fallback (DOM som bakke): {int(no_dtm.sum())} celler uten DTM-dekning")
        # DOM skal aldri ligge under DTM; klipp støy så kronehøyde >= 0
        dtm = np.minimum(dtm, dom)
        canopy = dom - dtm
        print(f"Kronehøyde (DOM-DTM): maks {canopy.max():.1f} m · "
              f"{int((canopy > 2).sum())} celler med >2 m vegetasjon/bygg")
        out["b64Ground"] = to_b64_dm(dtm)
        out["source"] = "Kartverket DOM + DTM (hoydedata.no)"

    with open(OUTPUT, 'w') as f:
        json.dump(out, f)
    print(f"Skrev {OUTPUT} ({os.path.getsize(OUTPUT) // 1024} kB)")


if __name__ == '__main__':
    main()
