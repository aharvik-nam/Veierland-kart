#!/usr/bin/env python3
"""
Generer sea_level_flood.geojson fra Kartverkets DTM (Digital Terrengmodell).

Bruk:
  pip install rasterio numpy shapely
  python scripts/generate_flood.py <sti/til/dtm.tif>

DTM-fil lastes ned fra https://hoydedata.no — se README under for steg.
Output: src/data/sea_level_flood.geojson (erstatter eksisterende fil)

Genererer konturer for 1–15 meter over dagens havnivå.
"""

import json
import sys
import os
import numpy as np

try:
    import rasterio
    from rasterio.crs import CRS
    from rasterio.warp import calculate_default_transform, reproject, Resampling
    from rasterio.features import shapes
    from rasterio.mask import mask as rio_mask
    import rasterio.transform
    from shapely.geometry import shape, mapping, box
    from shapely.ops import unary_union
except ImportError:
    print("Mangler avhengigheter. Kjør:")
    print("  pip install rasterio numpy shapely")
    sys.exit(1)

# --- Konfigurasjon -------------------------------------------------------

# Bounding box for Veierland + buffer (WGS84)
VEIERLAND_BBOX = (10.31, 59.12, 10.40, 59.21)  # (minLng, minLat, maxLng, maxLat)

# Nivåer som skal genereres (meter over dagens havnivå)
THRESHOLDS = list(range(1, 16))  # 1, 2, 3, ... 15

# Forenkling av polygoner – lavere = mer presis, høyere = mindre fil
# 0.000015° ≈ 1–2m nøyaktighet, god for historiske visualiseringer
SIMPLIFY_TOLERANCE = 0.000015

OUTPUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'sea_level_flood.geojson')

# -------------------------------------------------------------------------


def reproject_to_wgs84(src_path: str) -> tuple:
    """Les DTM og reprosjiser til WGS84. Returnerer (data, transform, nodata)."""
    wgs84 = CRS.from_epsg(4326)

    with rasterio.open(src_path) as src:
        print(f"  Inndata CRS: {src.crs}")
        print(f"  Inndata oppløsning: {src.res[0]:.2f}m x {src.res[1]:.2f}m")
        print(f"  Inndata dimensjoner: {src.width} x {src.height} px")

        if src.crs == wgs84:
            data = src.read(1)
            return data, src.transform, src.nodata, src.crs

        # Beregn ny transform i WGS84
        transform, width, height = calculate_default_transform(
            src.crs, wgs84, src.width, src.height, *src.bounds
        )
        data_wgs84 = np.empty((height, width), dtype=np.float32)
        nodata = src.nodata if src.nodata is not None else -9999.0

        reproject(
            source=rasterio.band(src, 1),
            destination=data_wgs84,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=transform,
            dst_crs=wgs84,
            resampling=Resampling.bilinear,
            src_nodata=nodata,
            dst_nodata=nodata,
        )

    return data_wgs84, transform, nodata, wgs84


def clip_to_bbox(data: np.ndarray, transform, bbox: tuple) -> tuple:
    """Klipp data til bounding box (minLng, minLat, maxLng, maxLat)."""
    minLng, minLat, maxLng, maxLat = bbox

    # Konverter bbox til pikselkoordinater
    row_min, col_min = rasterio.transform.rowcol(transform, minLng, maxLat)
    row_max, col_max = rasterio.transform.rowcol(transform, maxLng, minLat)

    # Klamp til gyldige verdier
    row_min = max(0, row_min)
    col_min = max(0, col_min)
    row_max = min(data.shape[0], row_max)
    col_max = min(data.shape[1], col_max)

    clipped = data[row_min:row_max, col_min:col_max]
    new_transform = rasterio.transform.from_bounds(
        minLng, minLat, maxLng, maxLat,
        col_max - col_min, row_max - row_min
    )
    return clipped, new_transform


def generate_flood_polygons(data: np.ndarray, transform, nodata, threshold: int) -> object | None:
    """Generer én samlet polygon for alt land under threshold meter."""
    valid = (data != nodata) & np.isfinite(data)
    flooded = valid & (data <= threshold) & (data > -50)  # utelat dyp sjøbunn

    if not flooded.any():
        return None

    flooded_u8 = flooded.astype(np.uint8)
    polys = [
        shape(geom)
        for geom, val in shapes(flooded_u8, mask=flooded_u8, transform=transform)
        if val == 1
    ]

    if not polys:
        return None

    merged = unary_union(polys)
    simplified = merged.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
    return simplified


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\nEKSEMPEL:")
        print("  python scripts/generate_flood.py ~/Downloads/dtm1_33_126_126.tif")
        sys.exit(1)

    dtm_path = sys.argv[1]
    if not os.path.exists(dtm_path):
        print(f"Finner ikke filen: {dtm_path}")
        sys.exit(1)

    output_path = os.path.abspath(OUTPUT)

    print(f"Leser DTM: {dtm_path}")
    data, transform, nodata, crs = reproject_to_wgs84(dtm_path)
    print(f"  → Reprosjisert til WGS84: {data.shape[1]} x {data.shape[0]} px")

    print(f"\nKlipper til Veierland-område {VEIERLAND_BBOX}...")
    data, transform = clip_to_bbox(data, transform, VEIERLAND_BBOX)
    print(f"  → Klippet: {data.shape[1]} x {data.shape[0]} px")

    valid_elev = data[data > -50]
    print(f"\nHøydespenn i området: {valid_elev.min():.1f}m – {valid_elev.max():.1f}m")

    features = []
    print(f"\nGenererer flomkonturer for {THRESHOLDS[0]}–{THRESHOLDS[-1]}m:")

    for threshold in THRESHOLDS:
        geom = generate_flood_polygons(data, transform, nodata if nodata is not None else -9999.0, threshold)
        if geom is None:
            print(f"  {threshold:2d}m → ingen flomområder")
            continue
        features.append({
            "type": "Feature",
            "properties": {"threshold_m": threshold},
            "geometry": mapping(geom),
        })
        area_km2 = geom.area * 111.32 * 111.32 * 0.7  # grov WGS84-approks
        print(f"  {threshold:2d}m → {area_km2:.3f} km² oversvømt")

    geojson = {"type": "FeatureCollection", "features": features}

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, separators=(',', ':'))

    size_kb = os.path.getsize(output_path) / 1024
    print(f"\n✓ Lagret til {output_path}")
    print(f"  {len(features)} konturer, filstørrelse: {size_kb:.0f} KB")
    print("\nNeste steg:")
    print("  Erstatt filen i repoet og kjør git push")


if __name__ == '__main__':
    main()
