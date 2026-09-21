"""
build_pack.py - builds an offline REGION PACK.

A region pack is a small folder of finished, georeferenced files that the field app can load with
no network at all. Nothing in a pack is invented: every layer records where it came from, how it
was processed, and what it cannot tell you. Layers we have not produced yet are listed with
status "pending" rather than filled with plausible-looking data.

Run:   ..\\sar-flood\\run.cmd pack\\build_pack.py          (from the guidebook folder)

Layers in this first pack:
  region    outline and upazila names          already on disk (HDX admin boundaries)
  terrain   hillshade image + elevation range  Copernicus DEM GLO-30, public, no login needed
  change    NISAR surface change               PENDING: needs a free NASA Earthdata account

Why a hillshade rather than a normal street map: bulk-downloading tiles from public tile servers
breaks their terms of use, while a hillshade of the real terrain is both allowed and more useful
in the field. Roads, rivers and emergency points arrive in a later slice, from OpenStreetMap.
"""

import json
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from matplotlib import pyplot as plt
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

HERE = Path(__file__).resolve().parent
GUIDEBOOK = HERE.parent
AOI_DIR = GUIDEBOOK.parent / "sar-flood" / "aoi"

PACK_ID = "chattogram-south"
PACK_NAME = "South Chattogram flood region"
AOI_FILE = AOI_DIR / "chattogram_south.geojson"
PARTS_FILE = AOI_DIR / "chattogram_south_upazilas.geojson"
OUT = GUIDEBOOK / "packs" / PACK_ID

# Copernicus DEM GLO-30: one tile per degree, open data on AWS, no account needed.
DEM_URL = ("https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")
GRID_M = 30      # metres per pixel in the pack's own grid


def dem_tiles(bounds):
    """Every one-degree Copernicus tile the area touches."""
    left, bottom, right, top = bounds
    for lat in range(int(np.floor(bottom)), int(np.floor(top)) + 1):
        for lon in range(int(np.floor(left)), int(np.floor(right)) + 1):
            yield DEM_URL.format(ns="N" if lat >= 0 else "S", lat=abs(lat),
                                 ew="E" if lon >= 0 else "W", lon=abs(lon))


def read_dem(area):
    """
    Read just the area's window from each public DEM tile and merge them onto one metric grid.
    Reading a window of a cloud-optimised GeoTIFF over https fetches only the bytes needed,
    so this costs a few MB instead of whole tiles.
    """
    series = gpd.GeoSeries([area], crs=4326)
    crs = series.estimate_utm_crs()
    left, bottom, right, top = series.to_crs(crs).total_bounds
    width, height = int((right - left) // GRID_M), int((top - bottom) // GRID_M)
    transform = rasterio.transform.from_origin(left, top, GRID_M, GRID_M)
    merged = np.full((height, width), np.nan, "float32")

    for url in dem_tiles(area.bounds):
        name = url.rsplit("/", 1)[1][:44]
        try:
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
                with rasterio.open(f"/vsicurl/{url}") as src:
                    window = from_bounds(*transform_bounds("EPSG:4326", src.crs, *area.bounds),
                                         transform=src.transform)
                    elevation = src.read(1, window=window, masked=True).filled(np.nan).astype("float32")
                    piece = np.full_like(merged, np.nan)
                    reproject(elevation, piece, src_crs=src.crs,
                              src_transform=src.window_transform(window),
                              dst_crs=crs, dst_transform=transform,
                              resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
                    merged = np.where(np.isnan(merged), piece, merged)
            print(f"  read {name}")
        except rasterio.errors.RasterioIOError as error:
            print(f"  skipped {name}: {error}")
    if np.isnan(merged).all():
        raise SystemExit("No DEM data could be read. Check the network, then run again.")
    return merged, transform, crs


def hillshade(elevation, azimuth=315, altitude=45):
    """
    Standard hillshade: how brightly each slope would be lit by a low sun in the north-west.
    It is a picture of the real terrain, not a measurement, so the pack stores the elevation
    range separately for anyone who needs numbers.
    """
    filled = np.nan_to_num(elevation, nan=float(np.nanmin(elevation)))
    dy, dx = np.gradient(filled, GRID_M)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    sun_altitude, sun_azimuth = np.radians(altitude), np.radians(360 - azimuth + 90)
    shaded = (np.sin(sun_altitude) * np.cos(slope)
              + np.cos(sun_altitude) * np.sin(slope) * np.cos(sun_azimuth - aspect))
    return np.clip(shaded, 0, 1)


def to_lonlat(shaded, transform, crs):
    """
    Put the finished picture on a plain longitude/latitude grid. The hillshade has to be computed
    in metres to be correct, but the app draws the image as a simple rectangle, so the last step
    is a reprojection. Skipping it would tilt the terrain by about a third of a degree.
    """
    left, bottom, right, top = transform_bounds(
        crs, "EPSG:4326", *rasterio.transform.array_bounds(*shaded.shape, transform))
    height, width = shaded.shape
    target = rasterio.transform.from_bounds(left, bottom, right, top, width, height)
    out = np.full((height, width), np.nan, "float32")
    reproject(shaded, out, src_crs=crs, src_transform=transform, dst_crs="EPSG:4326",
              dst_transform=target, resampling=Resampling.bilinear,
              src_nodata=np.nan, dst_nodata=np.nan)
    return out, (left, bottom, right, top)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    area = gpd.read_file(AOI_FILE).to_crs(4326).union_all()
    parts = gpd.read_file(PARTS_FILE).to_crs(4326)

    # --- region layer: what this place is, from boundaries already on disk
    parts[["adm3_name", "area_sqkm", "geometry"]].to_file(OUT / "region.geojson", driver="GeoJSON")

    # --- terrain layer: real elevation, turned into one small image the app can draw offline
    print("Reading the public Copernicus DEM (only the area's window)...")
    elevation, transform, crs = read_dem(area)
    shaded, terrain_bounds = to_lonlat(hillshade(elevation), transform, crs)
    plt.imsave(OUT / "terrain.png", shaded, cmap="gray", vmin=0, vmax=1)
    low, high = float(np.nanmin(elevation)), float(np.nanmax(elevation))

    manifest = {
        "pack_id": PACK_ID,
        "name": PACK_NAME,
        "built_on": date.today().isoformat(),
        "coverage": {"bbox_lonlat": [round(v, 5) for v in area.bounds],
                     "area_km2": round(float(parts.area_sqkm.sum()), 1),
                     "places": sorted(parts.adm3_name)},
        "layers": [
            {"id": "region", "title": "Region outline", "kind": "vector", "file": "region.geojson",
             "source": "HDX Common Operational Datasets, Bangladesh admin level 3",
             "method": "Upazila outlines, unchanged",
             "limitations": "Administrative boundaries, not field-surveyed",
             "status": "ready"},
            {"id": "terrain", "title": "Terrain (hillshade)", "kind": "image", "file": "terrain.png",
             "bounds_lonlat": [round(v, 5) for v in terrain_bounds],
             "elevation_m": {"min": round(low, 1), "max": round(high, 1)},
             "source": "Copernicus DEM GLO-30 (ESA / Airbus), open data on AWS",
             "product": "COG, 1 arc-second", "grid_m": GRID_M,
             "method": "Window read of the public tiles, merged to UTM, hillshade at azimuth 315 and altitude 45 degrees",
             "limitations": "A surface model, so it includes buildings and trees and smooths low flat land. Not a flood model.",
             "status": "ready"},
            {"id": "change", "title": "NISAR surface change", "kind": "vector", "file": "change.geojson",
             "source": "NISAR L-band GCOV, NASA / ISRO, via NASA Earthdata (ASF DAAC)",
             "method": "See sar-flood/METHODOLOGY.md. Not yet produced.",
             "limitations": "Detects open water only: flooded villages and crops are missed.",
             "status": "pending: needs a free NASA Earthdata account to download the NISAR granules"},
        ],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    size_kb = sum(f.stat().st_size for f in OUT.iterdir()) / 1024
    print(f"\nPack '{PACK_ID}' written to {OUT}")
    print(f"  {manifest['coverage']['area_km2']} km2, {len(manifest['coverage']['places'])} upazilas, "
          f"elevation {low:.0f} to {high:.0f} m, {size_kb:.0f} KB on disk")
    for layer in manifest["layers"]:
        print(f"  {layer['status'].split(':')[0]:8s} {layer['id']:8s} {layer['title']}")


if __name__ == "__main__":
    main()
