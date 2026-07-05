#!/usr/bin/env python3
"""
Bygg src/data/dom_grid.json fra flood-konturene (avledet fra Kartverkets DTM).

Dette er en terreng-fallback (bar bakke, ingen trær) som gjør at sol/skygge-
og vind-laget fungerer uten manuell nedlasting. For full presisjon med trær
og bygninger, kjør heller scripts/generate_dom_grid.py mot en DOM-GeoTIFF fra
hoydedata.no — den overskriver samme fil.

Bruk:  python scripts/generate_dtm_grid_from_flood.py
"""

import base64
import json
import math
import os
import struct

from shapely.geometry import shape, Point
from shapely.prepared import prep

ROOT = os.path.join(os.path.dirname(__file__), '..')
FLOOD = os.path.join(ROOT, 'src', 'data', 'sea_level_flood.geojson')
OUTPUT = os.path.join(ROOT, 'src', 'data', 'dom_grid.json')

# Samme bbox som DOM-skriptet
BBOX = (10.31, 59.12, 10.40, 59.21)
CELL_M = 15
ABOVE_MAX = 55.0  # antatt høyde for punkter over høyeste kontur


def main() -> None:
    data = json.load(open(FLOOD))
    # Hver flood-kontur T dekker areal med høyde <= T. Bygg (T, prepared geom),
    # sortert stigende, så første treff gir øvre grense for høyden.
    layers = []
    for f in data['features']:
        t = f['properties'].get('threshold_m')
        if t is None:
            continue
        layers.append((float(t), prep(shape(f['geometry']))))
    layers.sort(key=lambda x: x[0])
    thresholds = [t for t, _ in layers]
    print(f"{len(layers)} konturer: {thresholds}")

    min_lng, min_lat, max_lng, max_lat = BBOX
    mid_lat = (min_lat + max_lat) / 2
    cols = max(2, round((max_lng - min_lng) * math.cos(math.radians(mid_lat)) * 111_320 / CELL_M))
    rows = max(2, round((max_lat - min_lat) * 111_320 / CELL_M))
    print(f"Grid: {cols} x {rows} = {cols * rows} celler")

    vals = []
    land = 0
    for r in range(rows):
        lat = max_lat - (max_lat - min_lat) * r / (rows - 1)  # nord -> sør
        for c in range(cols):
            lng = min_lng + (max_lng - min_lng) * c / (cols - 1)
            p = Point(lng, lat)
            h = ABOVE_MAX  # over høyeste kontur til motbevist
            for t, geom in layers:
                if geom.contains(p):
                    # Høyde ligger mellom forrige og denne konturen — bruk midtpunkt
                    h = max(0.0, t - 0.5)
                    break
            if h > 0.6:
                land += 1
            vals.append(min(65535, int(round(h * 10))))
        if r % 40 == 0:
            print(f"  rad {r}/{rows}")

    print(f"Landceller (>0,6 m): {land}")
    buf = struct.pack(f'<{len(vals)}H', *vals)
    out = {
        "empty": False,
        "minLng": min_lng, "minLat": min_lat, "maxLng": max_lng, "maxLat": max_lat,
        "cols": cols, "rows": rows, "cellM": CELL_M,
        "b64": base64.b64encode(buf).decode('ascii'),
        "generatedAt": "flood-fallback",
        "source": "Kartverket DTM (via flood-konturer)",
    }
    json.dump(out, open(OUTPUT, 'w'))
    print(f"Skrev {OUTPUT} ({os.path.getsize(OUTPUT) // 1024} kB)")


if __name__ == '__main__':
    main()
