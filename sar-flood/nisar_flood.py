"""
nisar_flood.py - the same flood-extent method as flood_extent.py, fed by NISAR L-band radar.

STATUS: stretch goal. Built on 19 Sep 2026 at the team's request BEFORE the Sentinel-1 version had
been validated, which skips the original "prove Sentinel-1 first" rule. Treat its numbers as
experimental until both sensors have been run on the same flood and compared.

WHY A SEPARATE FILE
  NISAR is not in Google Earth Engine. So the images are streamed from NASA's Alaska Satellite
  Facility (ASF) and steps 3-7 run on this computer with numpy, instead of on Google's servers.
  The two exclusion masks (permanent water, steep slopes) use the same datasets as the Sentinel-1
  version, but are read straight from their public buckets, so this file needs NO Earth Engine
  sign-in (see public_masks). Steps 8-9 and the output file are shared with
  flood_extent.py, so the downstream module reads both the same way (sensor = "NISAR L-band HH").

HOW TO RUN
  1. pip install -r requirements.txt
  2. A free NASA Earthdata account: https://urs.earthdata.nasa.gov
     Then set EARTHDATA_USERNAME and EARTHDATA_PASSWORD, or put them in a .netrc file.
     If neither is set, earthaccess asks for them in the terminal.
     Nothing else needs an account: the water and terrain files are open data.
  3. python nisar_flood.py        (the defaults reproduce the July 2026 Chattogram test)

WHAT IS DIFFERENT FROM SENTINEL-1 - read before comparing numbers
  - Wavelength: L-band (24 cm) instead of C-band (5.5 cm). L-band reaches further through leaves
    and crops, so double bounce from flooded vegetation is STRONGER. The open-water-only
    limitation (flood_extent.LIMITATION) matters even more here.
  - Channel: HH (horizontal out, horizontal back). At L-band, HH gives the strongest water/land
    contrast and is the usual choice for flood mapping. It is not a twin of Sentinel-1's VH.
  - Units: NISAR's GCOV product arrives already terrain-corrected, as gamma-0 in LINEAR power,
    not dB. We convert: dB = 10 * log10(power).
  - Thresholds are NOT calibrated for L-band. The 1.25 fallback was tuned on Sentinel-1.
  - Size: each file is 2-9 GB. We never download one whole: h5py reads only the chunks that
    cover the area, typically a few hundred MB for a district.
  - History: public data starts 17 Jun 2026, with a permanent gap from 27 Jul to 10 Aug 2026.
"""

import json
import urllib.parse
import urllib.request
import warnings

import earthaccess
import geopandas as gpd
import h5py
import numpy as np
import rasterio
from numpy.lib.stride_tricks import sliding_window_view
from rasterio import features
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

import flood_extent as fe

# ---------------------------------------------------------------------------
# SETTINGS. The defaults reproduce the NISAR test: south Chattogram, July 2026.
# Shared method settings (speckle radius, masks, patch size, pixel size) live in flood_extent.py.
# ---------------------------------------------------------------------------
AOI_PATH = fe.HERE / "aoi" / "chattogram_south.geojson"   # Satkania, Lohagara, Chandanaish, Banshkhali
AOI_NAME = "South_Chattogram"
SENSOR = "NISAR L-band HH"

# July 2026 Chattogram floods: rain began 5 Jul, 412 mm fell on 7 Jul (the heaviest in 43 years),
# and by 12 Jul water covered 59 upazilas in 7 districts. This AOI's four upazilas were among the
# worst hit. NISAR track 69 passed at 23:21 UTC (05:21 next morning in Bangladesh) on 30 Jun and
# 12 Jul in the same 40 MHz dual-pol mode. Frame 13 covers 93-99% of the area and frame 12 fills
# the rest (checked in the ASF catalogue on 19 Sep 2026).
BEFORE = ("2026-06-29", "2026-07-02")   # catches 30 Jun 2026: before the rain began
DURING = ("2026-07-11", "2026-07-14")   # catches 12 Jul 2026: widespread flooding
DIRECTION = "ASCENDING"
TRACK = 69                  # NISAR's word for the relative orbit: same track = same viewing angle
POLARIZATION = "HHHH"       # the GCOV dataset name for HH power
BRIGHT_DB = -3.0            # see detect(): pixels brighter than this before the flood are skipped
OTSU_RANGE = (0.5, 3.5)     # L-band contrast is larger than C-band, so the histogram is wider
PLAUSIBLE = (1.1, 3.0)

GRID = "/science/LSAR/GCOV/grids/frequencyA"     # where GCOV keeps the main-band images
SEARCH_URL = "https://api.daac.asf.alaska.edu/services/search/param"

# The two mask datasets, as public files instead of Earth Engine (see public_masks).
# JRC Global Surface Water v1.4: ten-degree tiles named after their top-left corner.
JRC_URL = ("https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/"
           "occurrence_{lon}_{lat}v1_4_2021.tif")
# Copernicus DEM GLO-30: one tile per degree, open data on AWS, no account needed.
DEM_URL = ("https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")
SLOPE_SCALE_M = 90          # measure slope over this distance: see public_masks for why not 20 m


def h5_size(entry):
    """Size of the .h5 file in a catalogue record. Records normally list every file in the product
    separately; a few give one plain number instead, so handle both rather than crashing."""
    if isinstance(entry, dict):
        return next((value.get("bytes", 0) for name, value in entry.items()
                     if name.endswith(".h5") and isinstance(value, dict)), 0)
    return entry or 0


def find_granules(area, start, end):
    """
    STEP 1: ask ASF's public catalogue which NISAR GCOV files cover the area in a date window.
    Searching needs no login. Keeps files on one track and direction that contain HH, one per
    frame and date. A frame is one tile along the track; two neighbouring frames may be needed.
    """
    query = urllib.parse.urlencode({
        "dataset": "NISAR", "processingLevel": "GCOV", "intersectsWith": area.envelope.wkt,
        "start": f"{start}T00:00:00Z", "end": f"{end}T00:00:00Z", "output": "geojson",
    })
    with urllib.request.urlopen(f"{SEARCH_URL}?{query}", timeout=120) as response:
        results = json.load(response)["features"]
    best = {}
    for item in results:
        p = item["properties"]
        # The file name encodes the mode, e.g. ..._069_A_013_4005_DHDH_... : DHDH = dual-pol H,
        # QPDH = quad-pol. DV.. modes are V-only and have no HH, so they can't be compared.
        mode = p["fileID"].split("_")[9]
        if p["flightDirection"] != DIRECTION or int(p["pathNumber"]) != TRACK or mode[:2] not in ("DH", "QP"):
            continue
        size = h5_size(p["bytes"])
        key = (p["startTime"][:10], p["frameNumber"])
        if key not in best or size > best[key]["size"]:     # duplicate products: keep the fuller one
            best[key] = {"url": p["url"], "date": p["startTime"][:10], "frame": p["frameNumber"], "size": size}
    if not best:
        raise SystemExit(
            f"No NISAR GCOV files with HH on track {TRACK} ({DIRECTION}) between {start} and {end}. "
            "Check the dates in ASF Vertex, and remember the 27 Jul - 10 Aug 2026 data gap."
        )
    return sorted(best.values(), key=lambda g: (g["date"], g["frame"]))


def target_grid(area):
    """A fixed SCALE_M-metre grid over the area in its local UTM zone. Every NISAR frame and both
    Earth Engine masks are resampled onto this one grid, so their pixels line up exactly."""
    series = gpd.GeoSeries([area], crs=4326)
    crs = series.estimate_utm_crs()
    left, bottom, right, top = series.to_crs(crs).total_bounds
    width = int(np.ceil((right - left) / fe.SCALE_M))
    height = int(np.ceil((top - bottom) / fe.SCALE_M))
    return crs, Affine(fe.SCALE_M, 0, left, 0, -fe.SCALE_M, top), width, height


def read_window(file_obj, bounds_lonlat):
    """
    Read only the part of one NISAR GCOV file that covers the area.
    Returns (HH power array, its transform, its CRS), or None if the file doesn't overlap.

    Inside the HDF5 file (NISAR's product layout):
      /science/LSAR/GCOV/grids/frequencyA/HHHH       HH power, gamma-0, linear units
      .../xCoordinates, .../yCoordinates             pixel-centre positions in metres (UTM)
      .../projection   attribute "epsg_code"         which UTM zone
    Slicing HHHH[r0:r1, c0:c1] makes h5py fetch only the chunks inside that window.
    """
    try:   # NISAR files are "cloud optimised": a page buffer turns many tiny remote reads into few big ones
        h5 = h5py.File(file_obj, "r", page_buf_size=16 * 2**20, rdcc_nbytes=4 * 2**20)
    except (OSError, ValueError):   # not a paged file (for example the local test file): open plainly
        file_obj.seek(0)
        h5 = h5py.File(file_obj, "r")
    with h5:
        grid = h5[GRID]
        if POLARIZATION not in grid:
            return None
        x, y = grid["xCoordinates"][:], grid["yCoordinates"][:]
        crs = CRS.from_epsg(int(np.ravel(grid["projection"].attrs["epsg_code"])[0]))
        left, bottom, right, top = transform_bounds("EPSG:4326", crs, *bounds_lonlat)
        cols = np.flatnonzero((x >= left) & (x <= right))
        rows = np.flatnonzero((y >= bottom) & (y <= top))
        if not cols.size or not rows.size:
            return None
        c0, c1, r0, r1 = cols[0], cols[-1] + 1, rows[0], rows[-1] + 1
        power = grid[POLARIZATION][r0:r1, c0:c1].astype("float32")
    dx, dy = x[1] - x[0], y[1] - y[0]
    transform = Affine(dx, 0, x[c0] - dx / 2, 0, dy, y[r0] - dy / 2)   # coordinates are pixel centres
    power[~(power > 0)] = np.nan     # fill values and zeros mean "no data"
    return power, transform, crs


def read_date(fs, granules, bounds_lonlat, grid):
    """STEP 2: stream every frame for one date and merge them onto the target grid.
    Resampling averages POWER (not dB), which is physically correct and also calms speckle a little."""
    crs, transform, width, height = grid
    merged = np.full((height, width), np.nan, "float32")
    for granule in granules:
        print(f"  frame {granule['frame']}, {granule['date']}: {granule['size'] / 1e9:.1f} GB file, reading only the area...")
        with fs.open(granule["url"], mode="rb", cache_type="blockcache", block_size=8 * 2**20) as remote:
            window = read_window(remote, bounds_lonlat)
        if window is None:
            continue
        power, src_transform, src_crs = window
        piece = np.full_like(merged, np.nan)
        reproject(power, piece, src_transform=src_transform, src_crs=src_crs, dst_transform=transform,
                  dst_crs=crs, resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan)
        merged = np.where(np.isnan(merged), piece, merged)
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(merged)     # linear power -> dB; no-data stays NaN


def jrc_tiles(bounds):
    """Which JRC water tiles the area touches. Each covers ten degrees and is named after its
    top-left corner, so occurrence_90E_30N holds 90-100 E and 20-30 N."""
    left, bottom, right, top = bounds
    for lat in range(int(np.ceil(bottom / 10)) * 10, int(np.ceil(top / 10)) * 10 + 1, 10):
        for lon in range(int(np.floor(left / 10)) * 10, int(np.floor(right / 10)) * 10 + 1, 10):
            yield JRC_URL.format(lon=f"{abs(lon)}{'E' if lon >= 0 else 'W'}",
                                 lat=f"{abs(lat)}{'N' if lat >= 0 else 'S'}")


def dem_tiles(bounds):
    """Which Copernicus DEM tiles the area touches: one per whole degree."""
    left, bottom, right, top = bounds
    for lat in range(int(np.floor(bottom)), int(np.floor(top)) + 1):
        for lon in range(int(np.floor(left)), int(np.floor(right)) + 1):
            yield DEM_URL.format(ns="N" if lat >= 0 else "S", lat=abs(lat),
                                 ew="E" if lon >= 0 else "W", lon=abs(lon))


def read_onto_grid(url, grid, bounds_lonlat, resampling):
    """
    Read only this area's window out of one public cloud GeoTIFF and put it on our own grid.
    Both files are internally tiled, so https fetches just the tiles that overlap the area:
    a few MB instead of the 70 MB (water) or 100 MB+ (terrain) whole tile.
    Returns None when a tile is missing or does not overlap, so one gap does not stop the run.
    """
    crs, transform, width, height = grid
    out = np.full((height, width), np.nan, "float32")
    name = url.rsplit("/", 1)[1]
    try:
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            with rasterio.open(f"/vsicurl/{url}") as src:
                window = from_bounds(*transform_bounds("EPSG:4326", src.crs, *bounds_lonlat),
                                     transform=src.transform)
                values = src.read(1, window=window, boundless=True, masked=True)
                # astype first: the water layer is whole numbers, which cannot hold "no data".
                reproject(values.astype("float32").filled(np.nan), out, src_crs=src.crs,
                          src_transform=src.window_transform(window),
                          dst_crs=crs, dst_transform=transform, resampling=resampling,
                          src_nodata=np.nan, dst_nodata=np.nan)
    except rasterio.errors.RasterioIOError as error:
        print(f"  skipped {name}: {error}")
        return None
    print(f"  read {name}")
    return out


def public_masks(grid, area):
    """
    STEP 5's masks, from open files that need no account at all:

      permanent water   JRC Global Surface Water v1.4 "occurrence", the SAME dataset and the same
                        PERMANENT_WATER_PCT cut-off that flood_extent.py asks Earth Engine for,
                        downloaded from the JRC's own public bucket instead.
      steep ground      slope worked out from the Copernicus DEM GLO-30.

    Why the slope is measured over SLOPE_SCALE_M metres and not over one 20 m pixel: the
    Sentinel-1 version uses HydroSHEDS slope, which is a roughly 90 m product, and Copernicus is a
    SURFACE model, so at 20 m every tree line and building edge looks like a cliff and would mask
    out real flooded ground. Averaging the terrain to 90 m first keeps the two sensors comparable.

    Also returns which pixels fall inside the area outline, since the grid is a rectangle round it.
    """
    crs, transform, width, height = grid

    print("Reading the JRC permanent-water layer (public, no login)...")
    occurrence = None
    for url in jrc_tiles(area.bounds):
        piece = read_onto_grid(url, grid, area.bounds, Resampling.max)
        if piece is not None:
            occurrence = piece if occurrence is None else np.where(np.isnan(occurrence), piece, occurrence)
    if occurrence is None:
        raise SystemExit("Could not read the JRC surface-water layer. Check the network and rerun.")
    occurrence[occurrence > 100] = np.nan     # 255 means "never observed"
    # Earth Engine's unmask(0) treats never-observed pixels as dry land, so do the same here.
    wet = np.nan_to_num(occurrence, nan=0.0) > fe.PERMANENT_WATER_PCT

    print(f"Reading the Copernicus DEM for slope, averaged to {SLOPE_SCALE_M} m (public, no login)...")
    step = max(1, round(SLOPE_SCALE_M / fe.SCALE_M))
    coarse_transform = transform * Affine.scale(step)
    coarse = (crs, coarse_transform, -(-width // step), -(-height // step))
    elevation = None
    for url in dem_tiles(area.bounds):
        piece = read_onto_grid(url, coarse, area.bounds, Resampling.average)
        if piece is not None:
            elevation = piece if elevation is None else np.where(np.isnan(elevation), piece, elevation)
    if elevation is None:
        raise SystemExit("Could not read the Copernicus DEM. Check the network and rerun.")

    flat = np.nan_to_num(elevation, nan=float(np.nanmin(elevation)))
    dy, dx = np.gradient(flat, fe.SCALE_M * step)
    coarse_slope = np.degrees(np.arctan(np.hypot(dx, dy))).astype("float32")
    slope = np.full((height, width), np.nan, "float32")
    reproject(coarse_slope, slope, src_crs=crs, src_transform=coarse_transform,
              dst_crs=crs, dst_transform=transform, resampling=Resampling.bilinear,
              src_nodata=np.nan, dst_nodata=np.nan)
    steep = np.nan_to_num(slope, nan=0.0) >= fe.MAX_SLOPE_DEG

    inside = features.geometry_mask([gpd.GeoSeries([area], crs=4326).to_crs(crs).iloc[0]],
                                    out_shape=(height, width), transform=transform, invert=True)
    usable = ~wet & ~steep & inside
    area_px = inside.sum()
    print(f"  masked out: {(wet & inside).sum() / area_px:.1%} permanent water, "
          f"{(steep & inside).sum() / area_px:.1%} steeper than {fe.MAX_SLOPE_DEG} degrees")
    return usable, inside


def focal_median(image, radius_px, block=256):
    """STEP 3 on this computer: median over a circle of radius_px pixels, like Earth Engine's
    focal_median. Worked through in strips of rows so memory stays small."""
    r = int(radius_px)
    dy, dx = np.mgrid[-r:r + 1, -r:r + 1]
    circle = dx**2 + dy**2 <= radius_px**2
    padded = np.pad(image, r, constant_values=np.nan)
    out = np.empty_like(image)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)   # windows with no data at all just stay NaN
        for top in range(0, image.shape[0], block):
            windows = sliding_window_view(padded[top:top + block + 2 * r], circle.shape)[..., circle]
            out[top:top + block] = np.nanmedian(windows, axis=-1)
    return out


def opening(flooded):
    """STEP 7a: shrink every patch by one pixel, then grow it back (see flood_extent.py step 7)."""
    shrunk = sliding_window_view(np.pad(flooded, 1, constant_values=True), (3, 3)).all(axis=(-2, -1))
    return sliding_window_view(np.pad(shrunk, 1, constant_values=False), (3, 3)).any(axis=(-2, -1))


def otsu_threshold(ratio):
    """STEP 6a: Otsu on this computer, with the same fallback rule as flood_extent.pick_threshold()."""
    values = ratio[np.isfinite(ratio)]
    if not values.size:
        return fe.DEFAULT_THRESHOLD, "no usable pixels for Otsu, so the Sentinel-1 default was borrowed"
    counts, edges = np.histogram(values, bins=300, range=OTSU_RANGE)
    value = fe.otsu((edges[:-1] + edges[1:]) / 2, counts)
    if not PLAUSIBLE[0] <= value <= PLAUSIBLE[1]:
        return fe.DEFAULT_THRESHOLD, (f"Otsu gave {value:.2f}, outside {PLAUSIBLE[0]}-{PLAUSIBLE[1]}, so the "
                                      "Sentinel-1 default was borrowed (NOT calibrated for L-band)")
    return value, "Otsu's method"


def detect(before_db, during_db, usable):
    """STEPS 3-7 on this computer, mirroring flood_extent.flood_mask(). Returns a 0/1 flood grid."""
    before = focal_median(before_db, fe.SPECKLE_RADIUS_M / fe.SCALE_M)
    during = focal_median(during_db, fe.SPECKLE_RADIUS_M / fe.SCALE_M)

    # STEP 4: the same UN-SPIDER ratio of dB values. Above 1 means the ground got darker.
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = during / before

    # STEP 5: skip permanent water, steep ground and anything outside the area (usable_mask).
    # Extra guard, L-band only: buildings can sit near or above 0 dB in HH, where a ratio of dB
    # values explodes (-3 / -0.2 = 15) or flips sign. Those are double-bounce places this method
    # can't judge anyway, so they are skipped rather than turned into fake floods.
    # ponytail: fixed -3 dB cut-off chosen by reasoning, not calibration; tune it after the first real run.
    ratio[~usable | ~(before < BRIGHT_DB)] = np.nan

    # STEP 6 - !! only OPEN water turns darker. Flooded crops, trees and streets are MISSED
    # (double bounce), and at L-band more so than at C-band. See flood_extent.LIMITATION. !!
    threshold, how = otsu_threshold(ratio)
    flooded = ratio > threshold          # NaN compares as False, so skipped pixels are never flood

    # STEP 7: opening, then drop patches under MIN_PATCH_PIXELS. sieve() also fills dry holes smaller
    # than that inside a flood patch: a small difference from the Earth Engine version.
    clean = features.sieve(opening(flooded).astype("uint8"), size=fe.MIN_PATCH_PIXELS, connectivity=8)
    return clean, before, during, threshold, how


def write_tif(path, array, grid):
    crs, transform, width, height = grid
    nodata = np.nan if array.dtype.kind == "f" else None
    with rasterio.open(path, "w", driver="GTiff", height=height, width=width, count=1, dtype=array.dtype,
                       crs=crs, transform=transform, nodata=nodata) as dst:
        dst.write(array, 1)


def main():
    fe.OUT_DIR.mkdir(exist_ok=True)
    # Shapely only: fe.load_aoi() also builds an Earth Engine geometry, which this file no longer needs.
    area = gpd.read_file(AOI_PATH).to_crs(4326).union_all()
    grid = target_grid(area)

    before_files, during_files = find_granules(area, *BEFORE), find_granules(area, *DURING)
    before_dates = sorted({g["date"] for g in before_files})
    during_dates = sorted({g["date"] for g in during_files})
    print(f"NISAR track {TRACK} ({DIRECTION.lower()}): baseline {before_dates}, flood {during_dates}")

    if not earthaccess.login().authenticated:
        raise SystemExit("NASA Earthdata login failed. Create a free account at https://urs.earthdata.nasa.gov, "
                         "then set EARTHDATA_USERNAME and EARTHDATA_PASSWORD (or a .netrc file) and rerun.")
    fs = earthaccess.get_fsspec_https_session()
    print("Streaming NISAR (only the chunks that cover the area)...")
    before_db = read_date(fs, before_files, area.bounds, grid)
    during_db = read_date(fs, during_files, area.bounds, grid)

    usable, inside = public_masks(grid, area)
    covered = (np.isfinite(before_db) & np.isfinite(during_db))[inside].mean()
    if covered < 0.95:
        print(f"WARNING: only {covered:.0%} of the area has NISAR data on both dates. "
              "The rest cannot be judged and is reported as not flooded.")

    clean, before_s, during_s, threshold, how = detect(before_db, during_db, usable)

    stem = f"{AOI_NAME}_nisar_flood_{during_dates[0]}"
    paths = {name: fe.OUT_DIR / f"{stem}_{name}.tif" for name in ("mask", "before", "during")}
    write_tif(paths["mask"], clean, grid)
    write_tif(paths["before"], before_s.astype("float32"), grid)
    write_tif(paths["during"], during_s.astype("float32"), grid)

    properties = {"aoi_name": AOI_NAME, "sensor": SENSOR, "acquisition_date": ",".join(during_dates),
                  "baseline_date": ",".join(before_dates), "threshold": round(threshold, 4)}
    fe.report(stem, paths["mask"], paths["before"], paths["during"], area, properties, how,
              f"{AOI_NAME}: NISAR track {TRACK} {DIRECTION.lower()}, HH")
    print("\nNISAR NOTE: thresholds are not calibrated for L-band yet. Before trusting these numbers, "
          "run flood_extent.py on the same flood and compare.")


if __name__ == "__main__":
    main()
