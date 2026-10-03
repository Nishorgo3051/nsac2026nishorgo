"""
s1_flood.py - the flood layer that the field instrument actually carries.

WHAT THIS IS
  It turns real Sentinel-1 radar observations into a flood-extent layer for one district, then
  hands that layer to the pack builder so a field team can take it into an area with no network.
  This is the implemented, demonstrable source for the product. Radar is used because it sees
  through monsoon cloud, which is exactly when Bangladesh floods.

WHY THIS FILE EXISTS ALONGSIDE flood_extent.py
  flood_extent.py runs the same method on Google Earth Engine, which needs a Google sign-in our
  team does not have. This file uses Sentinel-1 RTC (radiometrically terrain-corrected gamma-0)
  through the Microsoft Planetary Computer STAC catalogue, which needs NO ACCOUNT AT ALL: the
  catalogue is open and asset URLs are signed by an anonymous endpoint. Anyone judging this project
  can reproduce the run on a clean machine with no credentials. That reproducibility is the reason
  this is the source we demonstrate.

WHY RTC RATHER THAN PLAIN GRD
  A plain GRD product is still in radar geometry: it has no map projection, only ground-control
  points, so every pixel must be geocoded before it means anything on a map. RTC products are
  already projected (UTM, 10 m) and corrected for terrain, so a before/after comparison is not
  contaminated by the viewing geometry changing between passes.

SENSOR IS METADATA, NOT IDENTITY
  The pack format records which sensor produced the layer. This file writes "Sentinel-1", the
  NISAR extension (nisar_flood.py) writes "NISAR", and the field instrument displays whatever the
  pack says. Nothing about the instrument is hard-coded to one satellite, or to floods.

HOW TO RUN
  1. pip install -r requirements.txt
  2. python s1_flood.py --area ../areas/<id>.json      (no login, no keys, no account)
     The area config holds the outline, dates and track; --area may be left out while areas/
     holds one config. The event below is the first config, areas/feni-2024-08.json.

  Outputs into out/:
    Feni_s1_flood_<date>.geojson   the flood polygons the pack carries
    Feni_s1_flood_<date>.json      provenance: sensor, dates, method, limitations, per-upazila areas
    Feni_s1_flood_<date>_*.tif     mask plus the two smoothed dB images, for inspection
    Feni_s1_flood_<date>.png       a before / during / detected figure

THE EVENT
  Feni district, the August 2024 Bangladesh floods. Rain began 19 Aug 2024, the flood arrived on
  21 Aug, and the Gumti peaked on 23 Aug at 8.58 m, 53 cm above danger level. Feni recorded the
  highest district death toll (28). Reported flooded area used for the sanity check: 201 km2
  (see METHODOLOGY.md for the source and its caveats).
  Sentinel-1 passed over on 9 Aug (before any of it) and on 21 Aug (the day the flood arrived),
  both on relative orbit 114, ascending - same track, same geometry, twelve days apart.
"""

import argparse
import json
import urllib.parse
import urllib.request
from datetime import date as _date
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio import features
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

import flood_extent as fe
# The local (numpy) half of the method already exists for the NISAR extension: the same speckle
# filter, the same morphology, the same grid builder and the same credential-free masks. Importing
# it keeps one implementation of each step instead of two that can silently drift apart.
import nisar_flood as nf

# ---------------------------------------------------------------------------
# SETTINGS. WHAT gets processed - the place, the dates, the track - comes from the area config.
# The method settings shared with the other sensors (speckle radius, mask thresholds, patch size,
# pixel size) stay in flood_extent.py so the three paths cannot disagree about the method.
# ---------------------------------------------------------------------------
NSAC = Path(__file__).resolve().parent.parent


def load_area():
    """One config per area (areas/<id>.json): a new flood is a new file, not a code change."""
    configs = sorted((NSAC / "areas").glob("*.json"))
    parser = argparse.ArgumentParser()
    parser.add_argument("--area", type=Path, required=len(configs) != 1,
                        default=configs[0] if len(configs) == 1 else None)
    return json.loads(parser.parse_known_args()[0].area.read_text(encoding="utf-8"))


AREA = load_area()
AOI_PATH = NSAC / AREA["outline"]
PARTS_PATH = NSAC / AREA["parts"]
AOI_NAME = AREA["aoi_name"]
HAZARD = "flood"

SENSOR = "Sentinel-1"
SENSOR_DETAIL = "Sentinel-1 C-band VH, RTC gamma-0"
PRODUCT = "Sentinel-1 RTC (radiometrically terrain corrected), 10 m"
SOURCE = ("ESA Copernicus Sentinel-1, RTC product read from the Microsoft Planetary Computer "
          "STAC catalogue (open catalogue, anonymous signing, no account required)")

BEFORE = AREA["baseline_date"]      # baseline pass: before the rain started
DURING = AREA["flood_date"]         # flood pass
TRACK = AREA["track"]               # relative orbit. The same track means the same viewing geometry.
DIRECTION = AREA["direction"]
POLARIZATION = "vh"         # VH is the usual choice for open water: smooth water returns very little

COLLECTION = "sentinel-1-rtc"
STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SIGN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/sign?href="
AGENT = {"User-Agent": "NSAC-SpaceApps-flood-pack/1.0", "Content-Type": "application/json"}

OTSU_RANGE = (0.5, 3.0)     # the histogram window Otsu searches, for C-band dB ratios
PLAUSIBLE = (1.1, 2.0)      # a threshold outside this is not believable for C-band; fall back

# The sanity-check reference. This is a REPORTED figure from coverage of the event, not ground
# truth: its own observation date and method are not stated. It is here to answer "is our result
# the right order of magnitude", and nothing more. It must never become an accuracy score.
REPORTED_KM2 = AREA["event"]["reported_flooded_km2"]
REPORTED_SOURCE = AREA["event"]["reported_source"]


def search_items(day):
    """
    STEP 1: ask the open STAC catalogue which Sentinel-1 RTC scenes cover the district on one day.
    No login: the search endpoint is public and asset URLs are signed by an anonymous service.
    Scenes are kept only if they are on our track and direction, so the before and after images
    are taken from the same point in the sky. Comparing across tracks would compare viewing
    geometries, not water.
    """
    area = gpd.read_file(AOI_PATH).to_crs(4326).union_all()
    body = json.dumps({"collections": [COLLECTION], "bbox": list(area.bounds),
                       "datetime": f"{day}T00:00:00Z/{day}T23:59:59Z", "limit": 50}).encode()
    request = urllib.request.Request(STAC_SEARCH, data=body, headers=AGENT)
    with urllib.request.urlopen(request, timeout=180) as response:
        items = json.load(response)["features"]

    keep = []
    for item in items:
        p = item["properties"]
        if p.get("sat:orbit_state") != DIRECTION:
            continue
        if TRACK and int(p.get("sat:relative_orbit", -1)) != TRACK:
            continue
        keep.append(item)
    if not keep:
        raise SystemExit(
            f"No Sentinel-1 RTC scene over {AOI_NAME} on {day} for track {TRACK} {DIRECTION}. "
            "Check the date, or set \"track\": null in the area config to accept any track (and "
            "accept that the viewing geometry then differs between the two dates).")
    return keep


def sign(href):
    """Turn a catalogue asset URL into a readable one. The signing service is free and anonymous;
    signatures expire after about an hour, which is why we sign immediately before reading."""
    request = urllib.request.Request(SIGN_URL + urllib.parse.quote(href, safe=""), headers=AGENT)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)["href"]


def read_date(items, area, grid):
    """
    STEP 2: read just this district out of each scene and put it on our own grid, in dB.

    Two decisions worth understanding:

    * Only the district is read, not the scene, AND only at the resolution we actually analyse at.
      These files are tens of thousands of pixels across at 10 m. Asking for the district window
      at full resolution pulls about 84 MB per scene over a phone-tethered connection, and the
      first thing the method does is resample it to SCALE_M anyway. The files carry pyramid
      overviews, so requesting the window at our own grid size lets the server hand back the
      pre-decimated level: same result, roughly a quarter of the bytes.

    * Scenes are averaged in POWER and converted to dB at the very end. Averaging decibels would be
      averaging logarithms, which is not physically meaningful and biases the result. Averaging
      power first is correct, and it calms speckle slightly as a side effect.
    """
    crs, transform, width, height = grid
    stack = np.full((height, width), np.nan, "float32")
    used = []
    for item in items:
        href = item["assets"][POLARIZATION]["href"]
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            with rasterio.open("/vsicurl/" + sign(href)) as src:
                bounds = transform_bounds("EPSG:4326", src.crs, *area.bounds)
                window = from_bounds(*bounds, transform=src.transform)
                # Ask for the window at our own grid size so the server can serve an overview
                # level instead of full 10 m detail we would immediately average away.
                shrink = src.res[0] / fe.SCALE_M
                out_h = max(1, int(window.height * shrink))
                out_w = max(1, int(window.width * shrink))
                power = src.read(1, window=window, out_shape=(out_h, out_w),
                                 boundless=True, masked=True)
                power = power.astype("float32").filled(np.nan)
                power[~(power > 0)] = np.nan      # zeros and fill values mean "no data", not "black"
                # A decimated read needs its own transform: the window's transform stretched by
                # however much the read shrank it, or every pixel lands in the wrong place.
                src_transform = src.window_transform(window) * Affine.scale(
                    window.width / out_w, window.height / out_h)
                piece = np.full_like(stack, np.nan)
                reproject(power, piece, src_crs=src.crs, src_transform=src_transform,
                          dst_crs=crs, dst_transform=transform,
                          resampling=Resampling.average,     # power averaging: see the docstring
                          src_nodata=np.nan, dst_nodata=np.nan)
        stack = np.where(np.isnan(stack), piece, stack)
        used.append(item["id"])
        print(f"  read {item['id'][:55]}")
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(stack), used         # linear gamma-0 power -> dB


def pick_threshold(ratio):
    """
    STEP 6a: choose the threshold from this image pair with Otsu's method - the value that best
    splits the histogram into two groups - instead of hard-coding one. A number tuned on one flood
    tends to be wrong on the next. UN-SPIDER's 1.25 is kept only as a fallback for when Otsu
    returns something implausible, which happens when an image pair contains almost no flooding and
    the histogram has no two groups to separate.
    """
    values = ratio[np.isfinite(ratio)]
    if not values.size:
        return fe.DEFAULT_THRESHOLD, "no usable pixels for Otsu, so the UN-SPIDER default was used"
    counts, edges = np.histogram(values, bins=300, range=OTSU_RANGE)
    value = fe.otsu((edges[:-1] + edges[1:]) / 2, counts)
    if not PLAUSIBLE[0] <= value <= PLAUSIBLE[1]:
        return fe.DEFAULT_THRESHOLD, (f"Otsu gave {value:.2f}, outside the plausible "
                                      f"{PLAUSIBLE[0]}-{PLAUSIBLE[1]} range, so the UN-SPIDER "
                                      "default of 1.25 was used instead")
    return float(value), "Otsu's method on this image pair"


def detect(before_db, during_db, usable):
    """
    STEPS 3-7: from two radar images to a flood mask. Mirrors flood_extent.flood_mask() so the
    Earth Engine version and this one stay comparable.
    """
    # STEP 3: speckle. Radar images are grainy by nature (interference between returns), and the
    # grain would read as thousands of tiny flood patches. A median over a 50 m circle removes the
    # grain while leaving edges where they are.
    before = nf.focal_median(before_db, fe.SPECKLE_RADIUS_M / fe.SCALE_M)
    during = nf.focal_median(during_db, fe.SPECKLE_RADIUS_M / fe.SCALE_M)

    # STEP 4: the UN-SPIDER change ratio. Both images are negative numbers in dB, so dividing the
    # flood image by the baseline gives a value above 1 exactly where the ground became DARKER to
    # radar - the signature of new smooth water.
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = during / before

    # STEP 5: exclude places where the test cannot mean what we need it to mean: permanent rivers
    # and ponds (already water in the baseline), steep ground (radar shadow imitates water), and
    # everything outside the district.
    ratio[~usable] = np.nan

    # -------------------------------------------------------------------------------------------
    # STEP 6 - THE SCIENTIFIC LIMITATION OF THIS WHOLE PRODUCT. READ BEFORE TRUSTING THE OUTPUT.
    #
    # The comparison on the next line thresholds that ratio, which means everything this layer
    # reports is "the ground became darker to radar". That finds OPEN WATER: calm, smooth surfaces
    # that reflect the radar pulse away from the satellite and therefore look dark.
    #
    # It does NOT find all flooding. Where water stands among rice stems, trees or houses, the
    # pulse bounces off the water surface and then off the vertical stem or wall and straight back
    # to the satellite. That is double-bounce scattering, and it makes flooded vegetation and
    # flooded built-up areas appear BRIGHTER than before, not darker. Those places fail this test
    # and are reported as NOT flooded.
    #
    # So the area this layer reports is a LOWER BOUND, and what it under-counts is flooded
    # villages, flooded towns and flooded cropland - exactly where people are. This is not a defect
    # to hide or to paper over with a model: it is a physical property of radar, and it is the
    # reason the field instrument lets a responder standing in the water record what the satellite
    # could not see. Satellite observation and field observation complete each other.
    # -------------------------------------------------------------------------------------------
    threshold, how = pick_threshold(ratio)
    flooded = ratio > threshold      # NaN compares False, so masked pixels can never become flood

    # STEP 7: clean up. Opening removes single-pixel speckle survivors; then patches smaller than
    # MIN_PATCH_PIXELS are dropped, because a flood is a connected sheet of water, not confetti.
    clean = features.sieve(nf.opening(flooded).astype("uint8"),
                           size=fe.MIN_PATCH_PIXELS, connectivity=8)
    return clean, before, during, threshold, how


def per_upazila(polygons):
    """
    The field instrument tells a responder which upazila they are standing in, so the pack carries
    flooded area per upazila as well as the total. It is also the honest way to sanity-check the
    result: reporting of this event is per upazila, so a single total cannot be compared with it.
    """
    parts = gpd.read_file(PARTS_PATH).to_crs(32646)
    flood = polygons.to_crs(32646)
    rows = []
    for name, geometry, own_km2 in zip(parts.adm3_name, parts.geometry, parts.area_sqkm):
        km2 = float(flood.intersection(geometry).area.sum()) / 1e6
        rows.append({"name": name, "flood_km2": round(km2, 1),
                     "upazila_km2": round(float(own_km2), 1),
                     "share_pct": round(100 * km2 / float(own_km2), 1)})
    return sorted(rows, key=lambda row: -row["share_pct"])


def main():
    if AREA["sensor"] != "sentinel-1":
        raise SystemExit(f"{AREA['id']} is a {AREA['sensor']} area; this script reads Sentinel-1 only.")
    fe.OUT_DIR.mkdir(exist_ok=True)
    # Shapely only: the Earth Engine half of fe.load_aoi() is not needed here and would want a login.
    area = gpd.read_file(AOI_PATH).to_crs(4326).union_all()
    grid = nf.target_grid(area)
    print(f"{AOI_NAME}: grid {grid[2]} x {grid[3]} at {fe.SCALE_M} m, {grid[0]}")

    print(f"Baseline pass {BEFORE} (Sentinel-1 RTC, track {TRACK} {DIRECTION}):")
    before_db, before_ids = read_date(search_items(BEFORE), area, grid)
    print(f"Flood pass {DURING}:")
    during_db, during_ids = read_date(search_items(DURING), area, grid)

    usable, inside = nf.public_masks(grid, area)
    covered = (np.isfinite(before_db) & np.isfinite(during_db))[inside].mean()
    if covered < 0.95:
        print(f"WARNING: only {covered:.0%} of {AOI_NAME} has radar data on both dates. The rest "
              "cannot be judged and is reported as not flooded.")

    clean, before_s, during_s, threshold, how = detect(before_db, during_db, usable)

    stem = f"{AOI_NAME}_s1_flood_{DURING}"
    paths = {name: fe.OUT_DIR / f"{stem}_{name}.tif" for name in ("mask", "before", "during")}
    nf.write_tif(paths["mask"], clean, grid)
    nf.write_tif(paths["before"], before_s.astype("float32"), grid)
    nf.write_tif(paths["during"], during_s.astype("float32"), grid)

    properties = {"aoi_name": AOI_NAME, "sensor": SENSOR, "acquisition_date": DURING,
                  "baseline_date": BEFORE, "threshold": round(float(threshold), 4)}
    polygons = fe.report(stem, paths["mask"], paths["before"], paths["during"], area, properties,
                         how, f"{AOI_NAME}: Sentinel-1 RTC {DIRECTION} track {TRACK}, VH",
                         REPORTED_KM2, REPORTED_SOURCE)

    rows = per_upazila(polygons)
    print("\nBy upazila (flood polygons intersected with the admin boundaries):")
    for row in rows:
        print(f"  {row['name']:14s} {row['flood_km2']:6.1f} km2   {row['share_pct']:5.1f}% of the upazila")

    # Provenance travels WITH the layer. The field instrument reads this and shows the sensor, the
    # dates, the age of the observation and the limitation, so nobody in the field can mistake a
    # radar observation for ground truth.
    provenance = {
        "hazard": HAZARD,
        "aoi_name": AOI_NAME,
        "sensor": SENSOR,
        "sensor_detail": SENSOR_DETAIL,
        "product": PRODUCT,
        "source": SOURCE,
        "scene_ids": {"baseline": before_ids, "flood": during_ids},
        "baseline_date": BEFORE,
        "acquisition_date": DURING,
        "track": TRACK,
        "direction": DIRECTION,
        "polarization": POLARIZATION.upper(),
        "grid_m": fe.SCALE_M,
        "threshold": round(float(threshold), 4),
        "threshold_method": how,
        "processed_on": _date.today().isoformat(),
        "detects": "open_water_only",
        "method": ("Speckle filtered with a 50 m median, ratio of the two dates in dB, threshold by "
                   "Otsu's method, permanent water (JRC Global Surface Water v1.4, over 50% "
                   "occurrence) and slopes of 5 degrees or more excluded, patches under 8 pixels "
                   "dropped. Follows the UN-SPIDER recommended practice for SAR flood mapping."),
        "limitations": ("Detects open water only. Flooded vegetation, flooded cropland and flooded "
                        "buildings can return MORE radar energy than dry ground (double bounce), so "
                        "this method misses them rather than flagging them. The flooded area is "
                        "therefore a lower bound, and it under-counts exactly where people live."),
        "not_ground_truth": ("A satellite observation, not ground truth. No validated flood map "
                             "exists for this event, so no accuracy figure is claimed."),
        "event": AREA["event"],
        "totals": {"flood_km2": round(float(polygons.area_km2.sum()), 1),
                   "patches": int(len(polygons)),
                   "aoi_km2": round(fe.km2(area), 1),
                   "data_coverage_pct": round(100 * float(covered), 1)},
        "by_upazila": rows,
    }
    (fe.OUT_DIR / f"{stem}.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")
    print(f"\nWrote {stem}.json - the provenance the pack and the field instrument read")


if __name__ == "__main__":
    main()
