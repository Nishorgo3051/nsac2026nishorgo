"""
fetch_imagery.py - the real piece of Bangladesh the instrument shows, as pictures.

WHAT THIS MAKES
  Three images on ONE longitude/latitude grid, so they line up with each other and with every line
  in the pack:

    optical.jpg        Sentinel-2 true colour, 17 Dec 2023. What the land looks like from orbit on
                       a clear dry-season morning: rivers, fields, the dark tree clusters of the
                       village homesteads, the hills of Tripura to the north-east. It is NOT a
                       picture of the flood - it is the landscape the flood happened to.
    radar_before.jpg   Sentinel-1 radar, 9 Aug 2024, twelve days before the flood reached Feni.
    radar_during.jpg   Sentinel-1 radar, 21 Aug 2024, the day it arrived.

  Radar sees smooth water as dark, so flipping between the two radar pictures shows the water
  arriving. The instrument lets the operator drag between them. That is the evidence behind the
  flood layer, shown as the satellite recorded it rather than as a coloured blob.

WHY SENTINEL-2 FROM THE DRY SEASON
  Monsoon skies over Bangladesh are cloudy almost every day, and an optical satellite cannot see
  through cloud. December is clear. Scene S2A 17 Dec 2023 has 0.04% cloud over the district. The
  pack says in words that this picture is from before the flood, so nobody mistakes it for the
  flood day.

NO ACCOUNT NEEDED
  Microsoft Planetary Computer's open catalogue, with anonymous signing, same as s1_flood.py.

HOW TO RUN
  python fetch_imagery.py --area ../../areas/<id>.json      after s1_flood.py (it reuses that
  run's radar pictures). --area may be left out while areas/ holds one config.
  Writes ../context/imagery/
"""

import argparse
import json
import urllib.request
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from affine import Affine
from PIL import Image
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

HERE = Path(__file__).resolve().parent
INGITO = HERE.parent
SAR = INGITO.parent / "sar-flood"
OUT = INGITO / "context" / "imagery"


def load_area():
    """One config per area (areas/<id>.json): a new flood is a new file, not a code change."""
    configs = sorted((INGITO.parent / "areas").glob("*.json"))
    parser = argparse.ArgumentParser()
    parser.add_argument("--area", type=Path, required=len(configs) != 1,
                        default=configs[0] if len(configs) == 1 else None)
    return json.loads(parser.parse_known_args()[0].area.read_text(encoding="utf-8"))


AREA = load_area()
AOI_FILE = INGITO.parent / AREA["outline"]

OPTICAL_ID = AREA["optical"]["scene"]
OPTICAL_DATE = AREA["optical"]["date"]
_RUN = SAR / "out" / f"{AREA['aoi_name']}_s1_flood_{AREA['flood_date']}"
RADAR = {"before": (AREA["baseline_date"], Path(f"{_RUN}_before.tif")),
         "during": (AREA["flood_date"], Path(f"{_RUN}_during.tif"))}

STAC_ITEM = "https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a/items/"
SIGN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/sign?href="
AGENT = {"User-Agent": "NSAC-SpaceApps-flood-pack/1.0 (student project, github.com/Nishorgo3051)"}

GRID_M = 20            # one pixel is about 20 m: sharp at street scale, and a few MB for a district
PAD_DEG = 0.012        # a kilometre of context beyond the district edge
# Radar display range in dB. Water sits near -22 dB, fields and villages -15 to -8. Clipping here
# keeps both readable; the numbers the flood layer was computed from are untouched.
RADAR_DB = (-24.0, -7.0)


def grid(area):
    """A plain longitude/latitude grid over the district with square-ish 20 m pixels."""
    west, south, east, north = area.bounds
    west, south, east, north = west - PAD_DEG, south - PAD_DEG, east + PAD_DEG, north + PAD_DEG
    dlat = GRID_M / 110540
    dlon = GRID_M / (111320 * np.cos(np.radians((south + north) / 2)))
    width, height = int(np.ceil((east - west) / dlon)), int(np.ceil((north - south) / dlat))
    transform = Affine(dlon, 0, west, 0, -dlat, north)
    bounds = (west, north - height * dlat, west + width * dlon, north)
    return transform, width, height, bounds


def sign(href):
    with urllib.request.urlopen(urllib.request.Request(SIGN_URL + href, headers=AGENT), timeout=60) as r:
        return json.load(r)["href"]


def read_optical(transform, width, height, bounds):
    """Read only the district from the scene's true-colour image, at our grid size, onto our grid."""
    with urllib.request.urlopen(urllib.request.Request(STAC_ITEM + OPTICAL_ID, headers=AGENT),
                                timeout=60) as r:
        item = json.load(r)
    href = sign(item["assets"]["visual"]["href"])
    rgb = np.zeros((3, height, width), "float32")
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open("/vsicurl/" + href) as src:
            window = from_bounds(*transform_bounds("EPSG:4326", src.crs, *bounds), transform=src.transform)
            shrink = src.res[0] / GRID_M                    # 10 m source: read the half-size overview
            out_h, out_w = max(1, int(window.height * shrink)), max(1, int(window.width * shrink))
            data = src.read(window=window, out_shape=(3, out_h, out_w), boundless=True, fill_value=0)
            src_transform = src.window_transform(window) * Affine.scale(window.width / out_w,
                                                                        window.height / out_h)
            for band in range(3):
                reproject(data[band].astype("float32"), rgb[band], src_crs=src.crs,
                          src_transform=src_transform, dst_crs="EPSG:4326", dst_transform=transform,
                          resampling=Resampling.bilinear, src_nodata=0, dst_nodata=0)
    return rgb, item


def grade(rgb):
    """
    A restrained colour grade, the same kind a printed atlas gets: stretch each band between its
    own 1st and 99.5th percentile (dry-season haze lifts the blacks and tints everything blue),
    lift the midtones a little, and ease the saturation back so the instrument's own colours - the
    radar cyan and the field red - stay the loudest things on screen.
    """
    valid = rgb.sum(axis=0) > 0
    out = np.zeros_like(rgb)
    for band in range(3):
        values = rgb[band][valid]
        low, high = np.percentile(values, [1, 99.5])
        out[band] = np.clip((rgb[band] - low) / (high - low), 0, 1)
    # Lift the shadows so village tree clusters read as trees, not holes, and lift blue less:
    # winter haze scatters blue light into every shadow and turns the trees slate-coloured.
    out = out ** np.array([0.72, 0.72, 0.82], "float32")[:, None, None]
    grey = out.mean(axis=0, keepdims=True)
    out = np.clip(grey + (out - grey) * 0.9, 0, 1)
    out[:, ~valid] = 0
    return (out * 255).round().astype("uint8")


def read_radar(path, transform, width, height):
    """The pipeline's own radar picture (dB, UTM) moved onto the shared grid and scaled to 0-255."""
    db = np.full((height, width), np.nan, "float32")
    with rasterio.open(path) as src:
        reproject(src.read(1), db, src_crs=src.crs, src_transform=src.transform,
                  dst_crs="EPSG:4326", dst_transform=transform, resampling=Resampling.bilinear,
                  src_nodata=np.nan, dst_nodata=np.nan)
    low, high = RADAR_DB
    scaled = np.clip((db - low) / (high - low), 0, 1) ** 0.9
    return np.where(np.isnan(db), 0, scaled * 255).round().astype("uint8")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    area = gpd.read_file(AOI_FILE).to_crs(4326).union_all()
    transform, width, height, bounds = grid(area)
    print(f"Grid: {width} x {height} pixels at about {GRID_M} m")

    print(f"Reading Sentinel-2 {OPTICAL_ID[:24]}... (true colour, {OPTICAL_DATE})")
    rgb, item = read_optical(transform, width, height, bounds)
    Image.fromarray(np.moveaxis(grade(rgb), 0, -1)).save(
        OUT / "optical.jpg", quality=80, optimize=True, progressive=True)

    for name, (day, path) in RADAR.items():
        print(f"Reading Sentinel-1 {name} ({day}) from the flood run...")
        Image.fromarray(read_radar(path, transform, width, height), mode="L").save(
            OUT / f"radar_{name}.jpg", quality=74, optimize=True, progressive=True)

    meta = {
        "bounds": [round(v, 6) for v in bounds],
        "grid_m": GRID_M,
        "optical": {
            "file": "optical.jpg", "date": OPTICAL_DATE,
            "time_utc": item["properties"]["datetime"][11:16],
            "sensor": "Sentinel-2A MSI", "product": "L2A true colour (TCI)", "scene": OPTICAL_ID,
            "cloud_cover": item["properties"]["eo:cloud_cover"],
            "source": "ESA Copernicus via Microsoft Planetary Computer (open catalogue, no account)",
            "note": ("Dry-season picture of the landscape, taken before the flood. It is not a "
                     "picture of the flood."),
        },
        "radar": {
            "before": {"file": "radar_before.jpg", "date": RADAR["before"][0]},
            "during": {"file": "radar_during.jpg", "date": RADAR["during"][0]},
            "sensor": "Sentinel-1A C-band SAR, VH, RTC gamma-0",
            "display_db": list(RADAR_DB),
            "note": ("Radar sees smooth water as dark. These are the same passes the flood layer "
                     "was computed from, scaled for display only."),
        },
    }
    (OUT / "imagery.json").write_text(json.dumps(meta, indent=2), encoding="utf-8", newline="\n")
    for path in sorted(OUT.glob("*.jpg")):
        print(f"  {path.name}: {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
