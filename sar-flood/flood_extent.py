"""
flood_extent.py - Stage 1 of the flood coordination tool: where is the NEW floodwater?

Maps new open floodwater in an area from Sentinel-1 radar, following the UN-SPIDER
Recommended Practice "Flood Mapping and Damage Assessment Using Sentinel-1 SAR Data
in Google Earth Engine". This script ONLY maps the water. Deciding where resources go
is a separate, later module that reads this script's output file.

HOW TO RUN
  1. pip install -r requirements.txt
  2. earthengine authenticate      (once; opens a browser so you can sign in to Google)
  3. set EE_PROJECT=your-cloud-project-id   (a Google Cloud project registered for Earth Engine)
  4. python flood_extent.py        (the defaults below reproduce the Feni, August 2024 validation run)

OUTPUT CONTRACT (the promise the downstream module can rely on)
  out/<AOI_NAME>_flood_<flood date>.geojson
    A GeoJSON FeatureCollection in plain longitude/latitude (WGS84, EPSG:4326).
    One Feature per separate patch of new open water, largest first.
    Every Feature has these properties:
      aoi_name          str    name of the area analysed, e.g. "Feni"
      sensor            str    "Sentinel-1 C-band VH" or "NISAR L-band HH" (nisar_flood.py). Thresholds differ by sensor.
      acquisition_date  str    date(s) of the during-flood radar image, "YYYY-MM-DD" (UTC), comma-separated if several
      baseline_date     str    date(s) of the pre-flood radar image, same format
      area_km2          float  area of this patch, measured in metres (UTM), not in degrees
      threshold         float  the change threshold actually used (see step 6)
      detects           str    always "open_water_only". Read LIMITATION before trusting any total.
    An empty FeatureCollection means "no new open water found". It is not an error.
  out/<AOI_NAME>_flood_<flood date>.png
    A before / during / flood-mask picture, so the result can be demoed without GIS software.
"""

import os
import urllib.error
import urllib.request
from pathlib import Path

import ee
import geopandas as gpd
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from rasterio import features
from rasterio.plot import plotting_extent
from shapely.geometry import mapping, shape

# ---------------------------------------------------------------------------
# SETTINGS. The defaults reproduce the validation run: Feni district, August 2024.
# ---------------------------------------------------------------------------
HERE = Path(__file__).parent
AOI_PATH = HERE / "aoi" / "feni.geojson"   # any polygon GeoJSON works
AOI_NAME = "Feni"
SENSOR = "Sentinel-1 C-band VH"

# Date windows are [start, end): the end date itself is NOT included.
# Sentinel-1A passed over Feni on relative orbit 114 (ascending) on 28 Jul, 9 Aug,
# 21 Aug and 2 Sep 2024 (checked in the ASF catalogue). Rain started 19 Aug, the
# flood started 21 Aug, and the Gumti river peaked on 23 Aug.
BEFORE = ("2024-08-05", "2024-08-12")   # catches 9 Aug 2024: same monsoon, before the flood
DURING = ("2024-08-20", "2024-08-24")   # catches 21 Aug 2024: first pass after the flood began

PASS = "ASCENDING"       # "ASCENDING" or "DESCENDING". Must be the same for both dates. See step 1.
RELATIVE_ORBIT = 114     # pin the exact orbit track; None = any track on that pass (a warning prints if they differ)

SPECKLE_RADIUS_M = 50       # step 3: smoothing radius in metres
PERMANENT_WATER_PCT = 50    # step 5: water seen more than this % of the time since 1984 counts as permanent
MAX_SLOPE_DEG = 5           # UN-SPIDER: floods don't sit on slopes steeper than this
THRESHOLD = "otsu"          # step 6: "otsu" to compute it from the image, or a number such as 1.25
DEFAULT_THRESHOLD = 1.25    # UN-SPIDER's default, used if Otsu returns something implausible
MIN_PATCH_PIXELS = 8        # step 7: UN-SPIDER drops water patches smaller than this
SCALE_M = 20                # pixel size for the analysis and download, in metres

# Published flooded area for this exact event, to sanity-check the result. None for a new area.
REPORTED_KM2 = 201
REPORTED_SOURCE = "Wikipedia 'August 2024 Bangladesh floods', sum of Feni upazila figures"

OUT_DIR = HERE / "out"
NODATA = -9999

LIMITATION = """\
LIMITATION - read before using these numbers:
  This method finds only OPEN water: calm surfaces that turn DARK to radar.
  Flooded crops still standing above the water, flooded trees, and flooded streets
  between buildings often turn BRIGHTER instead, because the radar pulse bounces off
  the water, then off the stem or wall, and straight back to the satellite
  ("double bounce"). Those areas are MISSED, not falsely flagged.
  So the area reported here is a LOWER BOUND, and flooded towns and villages
  (exactly where people are) are the places most likely to be under-counted."""


def init_earth_engine():
    """Connect to Google Earth Engine, or explain how to sign in."""
    try:
        ee.Initialize(project=os.environ.get("EE_PROJECT"))
    except Exception as error:
        raise SystemExit(
            f"Could not connect to Earth Engine ({error}).\n"
            "  1. Run once:  earthengine authenticate\n"
            "  2. Then set your project:  set EE_PROJECT=your-cloud-project-id\n"
            "     (free for non-commercial use: https://code.earthengine.google.com/register)"
        )


def load_aoi(path):
    """Read the area of interest as one shape, both locally (shapely) and for Earth Engine."""
    area = gpd.read_file(path).to_crs(4326).union_all()
    return area, ee.Geometry(mapping(area))


def sentinel1_image(aoi, start, end):
    """
    STEP 1 + 2: fetch Sentinel-1 radar images for a date window and merge them into one picture.

    What Sentinel-1 is: a satellite that sends its own microwave pulses to the ground and
    measures how much energy bounces back ("backscatter"). Clouds and night don't matter,
    which is why it works in the monsoon when normal cameras see only cloud.

    Earth Engine's COPERNICUS/S1_GRD collection is already cleaned up for us: thermal noise
    removed, brightness calibrated, and each pixel moved to its true map position using an
    elevation model. Values are in decibels (dB), a log scale. Typical VH values:
    fields and villages around -12 to -20 dB, calm water around -22 to -28 dB (darker).

    Why VH: the satellite transmits a Vertical pulse and listens for the Horizontal echo.
    Only rough or leafy surfaces scramble the pulse enough to send much energy back in the
    other orientation. Calm water scrambles almost nothing, so it is very dark in VH.
    UN-SPIDER's practice uses VH by default.

    Why one fixed pass direction (and ideally one orbit track): ascending and descending
    passes look at the ground from opposite sides. Hills cast shadows the other way and
    slopes change brightness, so comparing across them creates fake "changes". The same
    relative orbit means the exact same viewing angle both times.

    In 2024 only Sentinel-1A was flying (1B failed in Dec 2021), so a given track repeats
    only every 12 days. That is why the date windows above are chosen carefully.

    STRETCH GOAL - swapping in NISAR (do NOT attempt until this Sentinel-1 version is validated):
      NISAR L-band data is public via ASF DAAC (python package `asf_search`, or the ASF Vertex
      website), but it is NOT in Earth Engine and is far less turnkey than this collection.
      - Files are large HDF5 products. The GCOV/RTC products are geocoded, but values come as
        linear power, not dB, so you must convert them (10 * log10) yourself.
      - Check what terrain/radiometric correction each product level already has; don't assume.
        Mosaicking, clipping and resampling have to be done locally (rasterio), not by Earth Engine.
      - L-band's longer wavelength sees further through crops and trees, so double bounce from
        flooded vegetation is stronger. Thresholds tuned for Sentinel-1 (C-band) will not transfer.
      - The public archive starts 17 Jun 2026, with a permanent data gap from 27 Jul to 10 Aug 2026.
    """
    collection = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(aoi)
        .filterDate(start, end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))  # the normal land-imaging mode
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
        .filter(ee.Filter.eq("orbitProperties_pass", PASS))
        .filter(ee.Filter.eq("resolution_meters", 10))
    )
    if RELATIVE_ORBIT is not None:
        collection = collection.filter(ee.Filter.eq("relativeOrbitNumber_start", RELATIVE_ORBIT))
    collection = collection.select("VH")

    dates = sorted(set(
        collection.aggregate_array("system:time_start")
        .map(lambda t: ee.Date(t).format("YYYY-MM-dd")).getInfo()
    ))
    orbits = sorted(set(collection.aggregate_array("relativeOrbitNumber_start").getInfo()))
    if not dates:
        raise SystemExit(
            f"No Sentinel-1 {PASS} VH images of this area between {start} and {end} "
            f"(orbit {RELATIVE_ORBIT}). Widen the window, change PASS, or set RELATIVE_ORBIT = None."
        )
    # A satellite pass is cut into neighbouring frames; mosaic() stitches them into one picture.
    return collection.mosaic().clip(aoi), dates, orbits


def otsu(bin_centers, counts):
    """
    Otsu's method: given a histogram with two humps (here "unchanged" and "got much darker"),
    find the cut point that makes each side as internally similar as possible.
    Returns the value at the cut; everything ABOVE it goes in the upper class.
    """
    x = np.asarray(bin_centers, float)
    n = np.asarray(counts, float)
    below = np.cumsum(n)                      # how many pixels fall at or below each cut
    above = below[-1] - below
    sum_below = np.cumsum(n * x)
    mean_below = sum_below / np.maximum(below, 1e-12)
    mean_above = (sum_below[-1] - sum_below) / np.maximum(above, 1e-12)
    separation = below * above * (mean_below - mean_above) ** 2
    return float(x[np.argmax(separation)])


def pick_threshold(ratio, aoi):
    """STEP 6a: choose the threshold with Otsu, falling back to UN-SPIDER's 1.25 if Otsu looks wrong."""
    if THRESHOLD != "otsu":
        return float(THRESHOLD), "fixed in settings"
    # Earth Engine counts pixels into 200 bins between 0.5 and 2.5; we do the Otsu maths here.
    histogram = ratio.reduceRegion(
        reducer=ee.Reducer.fixedHistogram(0.5, 2.5, 200),
        geometry=aoi, scale=SCALE_M * 2, maxPixels=1e9, bestEffort=True,
    ).get("ratio").getInfo()
    if not histogram:
        return DEFAULT_THRESHOLD, "Otsu had no pixels to work with, so UN-SPIDER default used"
    bins = np.array(histogram)                # rows of [bin start, pixel count]
    value = otsu(bins[:, 0] + 0.005, bins[:, 1])  # +0.005 = half a bin width, i.e. bin centre
    # Otsu assumes two humps. If only a little land flooded there is really one hump,
    # and Otsu slices through its middle, which would flag huge areas. Catch that.
    if not 1.1 <= value <= 2.0:
        return DEFAULT_THRESHOLD, f"Otsu gave {value:.2f}, outside the plausible 1.1-2.0, so UN-SPIDER default used"
    return value, "Otsu's method"


def flood_mask(before, during, aoi):
    """STEPS 3-7: turn the two radar pictures into a clean 0/1 map of NEW open water."""

    # STEP 3 - speckle. Every radar pixel is the sum of many tiny echoes that randomly add up
    # or cancel out, so raw radar looks grainy ("salt and pepper"). A median over a 50 m
    # circle smooths the grain while keeping edges, like riverbanks, sharper than an average would.
    before_smooth = before.focal_median(SPECKLE_RADIUS_M, "circle", "meters")
    during_smooth = during.focal_median(SPECKLE_RADIUS_M, "circle", "meters")

    # STEP 4 - change. UN-SPIDER divides the "during" image by the "before" image, both in dB.
    # Both numbers are NEGATIVE, so the ratio goes ABOVE 1 when the ground got DARKER:
    #   field before -15 dB, flooded during -22 dB  ->  -22 / -15 = 1.47   (big drop: water?)
    #   field before -15 dB, unchanged at -15 dB    ->  -15 / -15 = 1.00   (no change)
    ratio = during_smooth.divide(before_smooth).rename("ratio")

    # STEP 5 - remove PERMANENT water. Rivers, ponds and the sea are dark in both pictures, but
    # wind and waves make their darkness flicker, which can look like "change". We only want NEW
    # water, so we blank out anywhere the JRC Global Surface Water dataset (37 years of Landsat)
    # saw water more than PERMANENT_WATER_PCT % of the time. Skipping this gives garbage.
    occurrence = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").unmask(0)
    ratio = ratio.updateMask(occurrence.lte(PERMANENT_WATER_PCT))

    # UN-SPIDER also removes steep ground: the radar "shadow" behind a hill is as dark as water,
    # and floodwater doesn't sit on slopes anyway. Relevant here: Feni borders the Tripura hills.
    slope = ee.Terrain.slope(ee.Image("WWF/HydroSHEDS/03VFDEM"))
    ratio = ratio.updateMask(slope.lt(MAX_SLOPE_DEG))

    # STEP 6 - threshold: mark pixels whose darkening ratio is above the cut point as flooded.
    #
    # !! LIMITATION - THIS STEP ONLY SEES OPEN WATER !!
    # We are looking for pixels that got DARKER. Flooded vegetation and flooded buildings usually
    # get BRIGHTER instead (the pulse bounces water -> stem/wall -> satellite: "double bounce").
    # Those floods are MISSED by this threshold. They are not falsely flagged; the opposite
    # failure from what people usually assume. Treat every area below as a LOWER BOUND.
    threshold, how = pick_threshold(ratio, aoi)
    flooded = ratio.gt(threshold).unmask(0).clip(aoi)
    # Fix the pixel grid so "1 pixel" in the next steps always means SCALE_M metres.
    flooded = flooded.reproject(crs="EPSG:4326", scale=SCALE_M)

    # STEP 7 - clean up. "Opening" = shrink every patch by one pixel, then grow it back by one.
    # Lone pixels vanish on the shrink and have nothing to grow back from; real patches keep
    # their shape. Then UN-SPIDER's rule: drop any patch smaller than MIN_PATCH_PIXELS pixels.
    opened = flooded.focal_min(1, "square", "pixels").focal_max(1, "square", "pixels")
    patch_size = opened.selfMask().connectedPixelCount(MIN_PATCH_PIXELS, True)
    clean = opened.updateMask(patch_size.gte(MIN_PATCH_PIXELS)).unmask(0).clip(aoi)
    return clean.toByte(), before_smooth, during_smooth, threshold, how


def download(image, aoi, scale, path):
    """Save an Earth Engine image as a GeoTIFF on disk.
    ponytail: direct download caps out around 48 MB per request, fine for a district at 20 m.
    For a whole division, raise SCALE_M or switch to Export.image.toDrive."""
    url = image.getDownloadURL({"region": aoi.bounds(), "scale": scale, "crs": "EPSG:4326", "format": "GEO_TIFF"})
    try:
        urllib.request.urlretrieve(url, path)
    except urllib.error.HTTPError as error:
        raise SystemExit(
            f"Earth Engine refused the download ({error.code}): {error.read(400).decode(errors='replace')}\n"
            "Usually the area is too big for one request: raise SCALE_M, or switch to Export.image.toDrive."
        )


def mask_to_polygons(tif_path, properties):
    """
    STEP 8: turn the 0/1 flood picture into polygons, one per separate patch of water,
    and measure each one. Areas are measured after switching to the local UTM projection,
    because a "square degree" is not a fixed size on the ground.
    """
    with rasterio.open(tif_path) as src:
        mask, crs = src.read(1), src.crs
        patches = [shape(geom) for geom, _ in features.shapes(mask, mask=mask == 1, transform=src.transform)]
    columns = ["aoi_name", "sensor", "acquisition_date", "baseline_date", "area_km2", "threshold", "detects"]
    if not patches:
        return gpd.GeoDataFrame(columns=columns, geometry=[], crs=4326)
    polygons = gpd.GeoDataFrame(geometry=patches, crs=crs).to_crs(4326)   # the contract is always lon/lat
    polygons["area_km2"] = (polygons.to_crs(polygons.estimate_utm_crs()).area / 1e6).round(4)
    for key, value in properties.items():
        polygons[key] = value
    polygons["detects"] = "open_water_only"
    return polygons[columns + ["geometry"]].sort_values("area_km2", ascending=False, ignore_index=True)


def save_figure(before_tif, during_tif, mask_tif, area, title, path):
    """STEP 9: before / during / result, side by side, for demos."""
    fig, axes = plt.subplots(1, 3, figsize=(15, 7), sharex=True, sharey=True)
    panels = [(before_tif, "Before (dB)"), (during_tif, "During (dB)"), (during_tif, "New open water (blue)")]
    for ax, (tif, label) in zip(axes, panels):
        with rasterio.open(tif) as src:
            db = src.read(1).astype(float)
            db[db == NODATA] = np.nan
            # -25 dB (water) shows black, -5 dB (bright buildings) shows white
            ax.imshow(db, cmap="gray", vmin=-25, vmax=-5, extent=plotting_extent(src))
        ax.set_title(label)
    with rasterio.open(mask_tif) as src:
        water = np.where(src.read(1) == 1, 1.0, np.nan)
        axes[2].imshow(water, cmap="winter", vmin=0, vmax=1, extent=plotting_extent(src), interpolation="nearest")
        crs = src.crs
    for ax in axes:
        gpd.GeoSeries([area], crs=4326).to_crs(crs).boundary.plot(ax=ax, color="gold", linewidth=0.8)
        ax.set_xlabel("longitude" if crs.is_geographic else "easting (m)")
    axes[0].set_ylabel("latitude" if crs.is_geographic else "northing (m)")
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def km2(shapely_geom):
    series = gpd.GeoSeries([shapely_geom], crs=4326)
    return float(series.to_crs(series.estimate_utm_crs()).area.iloc[0] / 1e6)


def main():
    init_earth_engine()
    OUT_DIR.mkdir(exist_ok=True)
    area, aoi = load_aoi(AOI_PATH)

    before, before_dates, before_orbits = sentinel1_image(aoi, *BEFORE)
    during, during_dates, during_orbits = sentinel1_image(aoi, *DURING)
    if before_orbits != during_orbits:
        print(f"WARNING: before uses orbit(s) {before_orbits} but during uses {during_orbits}. Different "
              "viewing angles can create fake changes. Set RELATIVE_ORBIT to one shared track.")

    mask, before_smooth, during_smooth, threshold, how = flood_mask(before, during, aoi)

    stem = f"{AOI_NAME}_flood_{during_dates[0]}"
    mask_tif, before_tif, during_tif = (OUT_DIR / f"{stem}_{n}.tif" for n in ("mask", "before", "during"))
    print("Downloading results from Earth Engine...")
    download(mask, aoi, SCALE_M, mask_tif)
    download(before_smooth.unmask(NODATA), aoi, SCALE_M * 3, before_tif)   # coarser: only for the picture
    download(during_smooth.unmask(NODATA), aoi, SCALE_M * 3, during_tif)

    properties = {"aoi_name": AOI_NAME, "sensor": SENSOR, "acquisition_date": ",".join(during_dates),
                  "baseline_date": ",".join(before_dates), "threshold": round(threshold, 4)}
    report(stem, mask_tif, before_tif, during_tif, area, properties, how,
           f"{AOI_NAME}: Sentinel-1 {PASS.lower()} orbit {during_orbits}", REPORTED_KM2, REPORTED_SOURCE)


def report(stem, mask_tif, before_tif, during_tif, area, properties, how, title, reported_km2=None, reported_source=""):
    """Steps 8-9 plus the printed summary. Shared by flood_extent.py and nisar_flood.py so both
    sensors produce exactly the same output contract."""
    polygons = mask_to_polygons(mask_tif, properties)
    geojson_path = OUT_DIR / f"{stem}.geojson"
    geojson_path.write_text(polygons.to_json(drop_id=True), encoding="utf-8")
    before, during = properties["baseline_date"], properties["acquisition_date"]
    # Swapping the two date windows by mistake is easy, and the result then looks empty rather than
    # wrong, which is confusing. Dates are ISO text, so plain comparison orders them correctly.
    if min(during.split(",")) <= max(before.split(",")):
        print(f"WARNING: the flood image ({during}) is not later than the baseline ({before}). "
              "Check the BEFORE and DURING windows in the settings.")
    save_figure(before_tif, during_tif, mask_tif, area, f"{title}, {before} vs {during}", OUT_DIR / f"{stem}.png")

    total, aoi_km2 = float(polygons["area_km2"].sum()), km2(area)
    print(f"\n=== New open water: {properties['aoi_name']} ({properties['sensor']}) ===")
    print(f"Baseline image: {before}   Flood image: {during}   (dates in UTC)")
    print(f"Threshold: {properties['threshold']:.3f} ({how})")
    print(f"Detected: {total:.1f} km2 in {len(polygons)} patches = {100 * total / aoi_km2:.1f}% of the {aoi_km2:.0f} km2 area")
    if len(polygons):
        print(f"Largest patch: {polygons['area_km2'].iloc[0]:.1f} km2")
    if reported_km2:
        print(f"Reported for this event: {reported_km2} km2 ({reported_source}). "
              f"Detected / reported = {total / reported_km2:.2f}")
    print(f"Saved: {geojson_path.name}, {stem}.png")
    print("\n" + LIMITATION)
    return polygons


if __name__ == "__main__":
    main()
