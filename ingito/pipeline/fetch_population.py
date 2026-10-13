"""
fetch_population.py - about how many people live where the radar saw water, upazila by upazila.

WHAT THE NUMBER IS
  A modelled estimate, not a headcount. WorldPop spreads census-based totals over 100 m squares,
  only where there are buildings ("constrained"). Each square's people are counted in proportion
  to how much of that square lies under the water the radar saw. So "about 12,000 people" means:
  the people WorldPop puts in those squares, times the share of each square under that water.

WHY IT IS PROBABLY LOW
  Radar misses water between houses and under trees, which is where people live, so the water it
  saw lies more over fields than over homesteads. Read the figure as a floor, like the flood area.

HOW TO RUN (after s1_flood.py, before build_pack.py)
  python fetch_population.py --area ../../areas/<id>.json
  --area may be left out while areas/ holds one config.
  Downloads WorldPop's Bangladesh file once (about 53 MB) into ../context/population/, which git
  ignores, and writes ../context/population.json for build_pack.py.

ATTRIBUTION
  WorldPop, CC BY 4.0. The citation travels inside the pack and the instrument shows it.
"""

import argparse
import json
import shutil
import urllib.request
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio import features
from rasterio.transform import Affine
from rasterio.windows import Window

HERE = Path(__file__).resolve().parent
INGITO = HERE.parent
NSAC = INGITO.parent
SAR_OUT = NSAC / "sar-flood" / "out"
RASTER_DIR = INGITO / "context" / "population"
OUT_FILE = INGITO / "context" / "population.json"

# The year of the flood. R2025A is WorldPop's 2015-2030 release; "CN" is the constrained product.
YEAR = 2024
FILE = f"bgd_pop_{YEAR}_CN_100m_R2025A_v1.tif"
URL = ("https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/"
       f"{YEAR}/BGD/v1/100m/constrained/{FILE}")
SOURCE = ("WorldPop (2025). Constrained estimates of 2015-2030 total number of people per grid "
          "square, 3 arc-seconds (about 100 m), R2025A v1. University of Southampton. "
          "DOI:10.5258/SOTON/WP00839. CC BY 4.0")
# Each 100 m square is cut 10 x 10 to measure how much of it is under water: about 9 m, finer
# than the radar's 20 m grid, so the share is set by the radar, not by this grid.
SPLIT = 10


def load_area():
    """One config per area (areas/<id>.json): a new flood is a new file, not a code change."""
    configs = sorted((NSAC / "areas").glob("*.json"))
    parser = argparse.ArgumentParser()
    parser.add_argument("--area", type=Path, required=len(configs) != 1,
                        default=configs[0] if len(configs) == 1 else None)
    return json.loads(parser.parse_known_args()[0].area.read_text(encoding="utf-8"))


def download(path):
    """Fetch the country file once. Written under a .tif name until complete, so a cut-short
    download is never mistaken for the real file and git ignores it either way."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f"partial-{path.name}")
    print(f"Downloading {path.name} (about 53 MB) from WorldPop...")
    # The server sometimes drops a request with no answer, and is pickier without a User-Agent.
    for attempt in range(3):
        try:
            request = urllib.request.Request(URL, headers={"User-Agent": "ingito-pipeline"})
            with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as out:
                shutil.copyfileobj(response, out)
            break
        except OSError as error:
            print(f"  attempt {attempt + 1} failed: {error}")
    else:
        raise SystemExit("WorldPop could not be reached. Check the network and run again.")
    partial.replace(path)


def water_share(flood, transform, shape):
    """The share of each population square under radar water, measured on a finer grid."""
    height, width = shape
    fine = features.rasterize(((geometry, 1) for geometry in flood.geometry),
                              out_shape=(height * SPLIT, width * SPLIT),
                              transform=transform * Affine.scale(1 / SPLIT), dtype="uint8")
    return fine.reshape(height, SPLIT, width, SPLIT).mean(axis=(1, 3))


def main():
    area = load_area()
    raster = RASTER_DIR / FILE
    if not raster.exists():
        download(raster)
    found = sorted(SAR_OUT.glob(f"{area['aoi_name']}_s1_flood_*.geojson"))
    if not found:
        raise SystemExit(f"No flood layer in {SAR_OUT}. Run sar-flood/s1_flood.py first.")
    flood_path = found[-1]
    flood = gpd.read_file(flood_path).to_crs(4326)
    parts = gpd.read_file(NSAC / area["parts"]).to_crs(4326)
    west, south, east, north = parts.total_bounds

    with rasterio.open(raster) as src:
        top, left = src.index(west, north)
        bottom, right = src.index(east, south)
        window = Window(left, top, right - left + 1, bottom - top + 1)
        people = src.read(1, window=window, masked=True).filled(0).astype("float64")
        transform = src.window_transform(window)

    share = water_share(flood, transform, people.shape)
    # A square belongs to the upazila holding its centre: a square on a border is counted once.
    upazila = features.rasterize(((geometry, index) for index, geometry in enumerate(parts.geometry, 1)),
                                 out_shape=people.shape, transform=transform, dtype="uint8")

    # Check: the water measured on this grid must match the radar layer's own area.
    row_lat = transform.f + transform.e * (np.arange(people.shape[0]) + 0.5)
    square_km2 = (abs(transform.a) * 111.32 * np.cos(np.radians(row_lat))) * (abs(transform.e) * 110.54)
    water_km2 = float((share * square_km2[:, None])[upazila > 0].sum())
    radar_km2 = float(flood.area_km2.sum())
    print(f"Water on the population grid: {water_km2:.1f} km2 "
          f"(radar layer: {radar_km2:.1f} km2, {flood_path.name})")
    if abs(water_km2 - radar_km2) > 0.05 * radar_km2:
        raise SystemExit("The two grids do not line up: the counts would be wrong. Nothing written.")

    in_water = people * share
    rows = []
    for index, name in enumerate(parts.adm3_name, 1):
        here = upazila == index
        rows.append({"name": name, "people_in_water": int(round(in_water[here].sum()))})
        print(f"  {name:14} {rows[-1]['people_in_water']:>8,} of {people[here].sum():>10,.0f} people")
    total = int(round(in_water[upazila > 0].sum()))
    print(f"  {'district':14} {total:>8,} of {people[upazila > 0].sum():>10,.0f} people")

    block = {
        "year": YEAR,
        "source": SOURCE,
        "product": FILE,
        # The flood layer these figures were computed from. build_pack.py leaves them out of a pack
        # built from any other layer: a figure for another layer would be a wrong figure.
        "flood_layer": flood_path.name,
        "method": (f"Each 100 m square's people, times the share of that square under the water "
                   f"the radar saw (measured on a {SPLIT} x {SPLIT} sub-grid), summed by upazila. "
                   "A square is counted in the upazila holding its centre."),
        "limitations": ("A modelled estimate, not a headcount: WorldPop spreads census totals over "
                        "squares with buildings. Radar misses water between houses and under "
                        "trees, where people live, so the real number is probably higher."),
        "people_in_water": total,
        "by_upazila": rows,
    }
    OUT_FILE.write_text(json.dumps(block, indent=2, ensure_ascii=False) + "\n", encoding="utf-8",
                        newline="\n")
    print(f"\nWritten: context/{OUT_FILE.name}")


if __name__ == "__main__":
    main()
