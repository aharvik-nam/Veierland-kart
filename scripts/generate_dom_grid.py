#!/usr/bin/env python3
"""
Generer src/data/dom_grid.json fra Kartverkets DOM (Digital OverflateModell).

DOM-en inkluderer trær og bygninger — det er den som trengs for å beregne
solskygge og le for vind (DTM-en er bar bakke og ser ikke skogbelter).

Bruk:
  pip install rasterio numpy
  python scripts/generate_dom_grid.py <sti/til/dom.tif>

DOM-fil lastes ned fra https://hoydedata.no :
  1. Zoom til Veierland
  2. «Last ned» → velg prosjekt med DOM (overflatemodell), GeoTIFF
  3. Kjør dette skriptet med fila som argument

Output: src/data/dom_grid.json — et kompakt grid (15 m celler) med høyder
i desimeter som base64-kodet uint16, som appen bruker til sol/vind-laget.
"""

import base64
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


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src_path = sys.argv[1]

    min_lng, min_lat, max_lng, max_lat = BBOX
    mid_lat = (min_lat + max_lat) / 2

    # Gridstørrelse i celler
    width_m = (max_lng - min_lng) * math.cos(math.radians(mid_lat)) * 111_320
    height_m = (max_lat - min_lat) * 111_320
    cols = max(2, round(width_m / CELL_M))
    rows = max(2, round(height_m / CELL_M))
    print(f"Grid: {cols} x {rows} celler ({CELL_M} m) = {cols * rows} punkter")

    with rasterio.open(src_path) as src:
        print(f"Kilde: {src_path} · CRS {src.crs} · {src.width}x{src.height}")

        # Målkoordinater (WGS84) for hver celle, radvis fra nordvest
        lngs = np.linspace(min_lng, max_lng, cols)
        lats = np.linspace(max_lat, min_lat, rows)  # nord -> sør
        lng_grid, lat_grid = np.meshgrid(lngs, lats)

        xs, ys = rio_transform('EPSG:4326', src.crs,
                               lng_grid.ravel().tolist(), lat_grid.ravel().tolist())

        samples = np.array([v[0] for v in src.sample(zip(xs, ys))], dtype=np.float64)
        nodata = src.nodata
        if nodata is not None:
            samples[samples == nodata] = 0.0

    samples = np.nan_to_num(samples, nan=0.0)
    samples[samples < 0] = 0.0  # hav / støy under null

    land = int((samples > 0.2).sum())
    print(f"Høyder: maks {samples.max():.1f} m · {land} celler over 0,2 m")
    if land < 500:
        print("ADVARSEL: nesten ingen landceller — dekker DOM-fila Veierland?")

    # Desimeter som uint16 (0–6553,5 m holder i massevis)
    dm = np.clip(np.round(samples * 10), 0, 65535).astype('<u2')

    out = {
        "empty": False,
        "minLng": min_lng, "minLat": min_lat,
        "maxLng": max_lng, "maxLat": max_lat,
        "cols": cols, "rows": rows,
        "cellM": CELL_M,
        "b64": base64.b64encode(dm.tobytes()).decode('ascii'),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "Kartverket DOM (hoydedata.no)",
    }
    with open(OUTPUT, 'w') as f:
        json.dump(out, f)
    print(f"Skrev {OUTPUT} ({os.path.getsize(OUTPUT) // 1024} kB)")


if __name__ == '__main__':
    main()
