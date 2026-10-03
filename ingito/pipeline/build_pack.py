"""
build_pack.py - assembles ONE portable disaster package for one area at one observation state.

WHAT A PACK IS
  A pack is a single file. It holds the satellite hazard observation, that observation's full
  provenance, the terrain, the roads and waterways, the shelter reference points and the
  administrative outlines - everything the field instrument needs with no network at all.
  One file, because a field team shares intelligence by handing over a file: over a cable, over
  Bluetooth, on a memory card, or by dropping it into another responder's phone. A folder of
  loose files does not survive that.

WHY THE PACK CARRIES PROVENANCE, NOT JUST GEOMETRY
  The instrument must never present a radar observation as ground truth. So the sensor, both
  acquisition dates, the processing method and the physical limitation of the method all travel
  inside the pack, attached to the layer they describe, and the instrument shows them on demand.
  If the pack cannot say where a layer came from, the layer does not belong in the pack.

WHY THE HAZARD IS A FIELD AND NOT THE FORMAT
  "hazard": {"type": "flood"} is data. A riverbank-erosion pack or a cyclone-damage pack would use
  the same format, the same pack loader and the same field-report mechanism, with a different
  hazard type and a different sensor recorded in the observation block. Nothing in the format or
  the instrument is specific to water. Flood is simply the hazard implemented completely.

WHAT IS DELIBERATELY NOT IN A PACK
  No map tiles (they need a network, and their terms of use forbid bulk download), no live service
  URLs, no accounts, no analytics. If it cannot be read off the device with the radio switched
  off, it does not belong here.

HOW TO RUN
  1. python ../../sar-flood/s1_flood.py        produces the flood layer and its provenance
  2. python fetch_context.py                   produces the roads, waterways and shelters
  3. python build_pack.py                      writes ../packs/<pack-id>.pack.json
  Every step takes --area ../../areas/<id>.json; it may be left out while areas/ holds one config.

Dependencies: geopandas, rasterio, numpy, Pillow (see ../../sar-flood/requirements.txt).
"""

import argparse
import base64
import hashlib
import io
import json
from datetime import date, datetime
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from PIL import Image
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds

HERE = Path(__file__).resolve().parent
INGITO = HERE.parent
NSAC = INGITO.parent
SAR_OUT = NSAC / "sar-flood" / "out"
PACKS = INGITO / "packs"


def load_area():
    """
    The area this run is for. Everything place-specific - outlines, names, admin, dates - lives in
    one config per area (areas/<id>.json), so a new flood is a new file, not a code change.
    """
    configs = sorted((NSAC / "areas").glob("*.json"))
    parser = argparse.ArgumentParser()
    parser.add_argument("--area", type=Path, required=len(configs) != 1,
                        default=configs[0] if len(configs) == 1 else None)
    return json.loads(parser.parse_known_args()[0].area.read_text(encoding="utf-8"))


AREA = load_area()
# Which observation to package. The glob keeps this honest: if the pipeline has not been run there
# is nothing to package, and the script says so instead of inventing a layer.
HAZARD_GLOB = f"{AREA['aoi_name']}_s1_flood_*.geojson"
CONTEXT_FILE = INGITO / "context" / f"{AREA['aoi_name'].lower()}_context.json"
PARTS_FILE = NSAC / AREA["parts"]
AOI_FILE = NSAC / AREA["outline"]
IMAGERY_DIR = INGITO / "context" / "imagery"

# The pack is bilingual, so the places it names need both spellings. The area config lists the
# official upazila names (parts_bn) and the standard names of the area's rivers and towns
# (known_names). Only names we are sure of are listed: anything else keeps the one spelling the
# map gives it, rather than an invented one.
HAZARD_TYPE = "flood"
HAZARD_LABEL = "Flood - open water seen by radar"

# Copernicus DEM GLO-30: open data on AWS, one tile per degree, no account needed.
DEM_URL = ("https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")
DEM_GRID_M = 30
PLACES = 5          # about one metre: finer than a phone screen can show


def dem_tiles(bounds):
    """Every one-degree Copernicus tile the area touches."""
    left, bottom, right, top = bounds
    for lat in range(int(np.floor(bottom)), int(np.floor(top)) + 1):
        for lon in range(int(np.floor(left)), int(np.floor(right)) + 1):
            yield DEM_URL.format(ns="N" if lat >= 0 else "S", lat=abs(lat),
                                 ew="E" if lon >= 0 else "W", lon=abs(lon))


def read_dem(area):
    """
    Read only this area's window from each public DEM tile and merge onto one metric grid.
    Window reads of a cloud-optimised GeoTIFF fetch only the bytes needed, so the terrain for a
    district costs a few MB rather than whole tiles.
    """
    series = gpd.GeoSeries([area], crs=4326)
    crs = series.estimate_utm_crs()
    left, bottom, right, top = series.to_crs(crs).total_bounds
    width, height = int((right - left) // DEM_GRID_M), int((top - bottom) // DEM_GRID_M)
    transform = rasterio.transform.from_origin(left, top, DEM_GRID_M, DEM_GRID_M)
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
        raise SystemExit("No DEM data could be read. Check the network and run again.")
    return merged, transform, crs


def hillshade(elevation, azimuth=315, altitude=45):
    """
    Standard hillshade: how brightly each slope would be lit by a low sun in the north-west.
    Terrain matters in the field for one blunt reason - water runs downhill and collects in the low
    ground - so the instrument shows the shape of the land rather than raw numbers. The elevation
    RANGE is stored separately for anyone who needs the numbers.
    """
    filled = np.nan_to_num(elevation, nan=float(np.nanmin(elevation)))
    dy, dx = np.gradient(filled, DEM_GRID_M)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, dy)
    sun_altitude, sun_azimuth = np.radians(altitude), np.radians(360 - azimuth + 90)
    shaded = (np.sin(sun_altitude) * np.cos(slope)
              + np.cos(sun_altitude) * np.sin(slope) * np.cos(sun_azimuth - aspect))
    return np.clip(shaded, 0, 1)


def to_lonlat(shaded, transform, crs):
    """
    Put the finished picture on a plain longitude/latitude grid. Hillshade has to be computed in
    metres to be correct, but the instrument draws the image as a simple rectangle, so the last
    step is a reprojection. Skipping it would tilt the terrain by about a third of a degree.
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


def rings_of(geometry):
    """
    Outer rings only, rounded, as plain coordinate lists.

    Holes are dropped deliberately. A hole in a flood patch is a dry island a few pixels across;
    drawing it costs bytes and screen pixels and changes no decision a responder makes. Every area
    figure in the provenance block was computed from the full geometry BEFORE this simplification,
    so the reported numbers are unaffected by it.
    """
    parts = geometry.geoms if geometry.geom_type.startswith("Multi") else [geometry]
    rings = []
    for part in parts:
        if part.is_empty:
            continue
        coords = [[round(x, PLACES), round(y, PLACES)] for x, y in part.exterior.coords]
        if len(coords) > 2:
            rings.append(coords)
    return rings


def mark_wet_roads(context, geojson_path):
    """
    Flag the road lines that cross detected open water.

    This is the second question a field team asks - which routes are under water - and it is
    answered here rather than in the browser because doing it properly needs real geometry: 2,293
    road lines against thousands of flood polygons is a spatial join, not a loop over points.

    What the flag means, exactly: this road crosses an area where the radar saw open water on the
    observation date. It does NOT mean the road is impassable, and an unflagged road is NOT
    confirmed open - the satellite cannot see water under trees or between buildings, and it knows
    nothing about depth, current or whether a culvert has been washed out. The instrument words it
    that way on screen, and this is exactly why a responder can file a "road cut" report.
    """
    from shapely.geometry import LineString

    flood = gpd.read_file(geojson_path).to_crs(4326)
    if flood.empty:
        for road in context["roads"]:
            road["wet"] = False
        return 0
    lines = gpd.GeoDataFrame(
        geometry=[LineString(road["coords"]) for road in context["roads"]], crs=4326)
    hit = gpd.sjoin(lines, flood[["geometry"]], how="inner", predicate="intersects")
    wet_rows = set(hit.index)
    for index, road in enumerate(context["roads"]):
        road["wet"] = index in wet_rows
    return len(wet_rows)


def complete_names(items):
    """Fill in the missing spelling of a place when it is one of the names we are sure of."""
    to_bn = dict(AREA["known_names"])
    to_en = {bn: en for en, bn in AREA["known_names"]}
    for item in items:
        if item.get("name") and not item.get("name_bn") and item["name"] in to_bn:
            item["name_bn"] = to_bn[item["name"]]
        if item.get("name_bn") and not item.get("name") and item["name_bn"] in to_en:
            item["name"] = to_en[item["name_bn"]]


def data_uri(path, mime="image/jpeg"):
    """Embed a picture in the pack. Base64 costs a third in size and keeps the pack ONE file."""
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def imagery_block():
    """The real landscape and the radar evidence, from fetch_imagery.py. Optional: a pack without
    pictures still works, it just shows the map on a plain ground."""
    meta_path = IMAGERY_DIR / "imagery.json"
    if not meta_path.exists():
        print("  no imagery (run fetch_imagery.py to add the satellite pictures)")
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["optical"]["image"] = data_uri(IMAGERY_DIR / meta["optical"].pop("file"))
    for when in ("before", "during"):
        meta["radar"][when]["image"] = data_uri(IMAGERY_DIR / meta["radar"][when].pop("file"))
    return meta


def observation_block():
    """The satellite hazard layer, plus everything needed to judge it."""
    found = sorted(SAR_OUT.glob(HAZARD_GLOB))
    if not found:
        raise SystemExit(
            f"No hazard layer in {SAR_OUT}. Run sar-flood/s1_flood.py first - a pack is not "
            "allowed to contain an invented layer.")
    geojson_path = found[-1]
    provenance_path = geojson_path.with_suffix(".json")
    if not provenance_path.exists():
        raise SystemExit(f"{geojson_path.name} has no matching provenance file. Re-run s1_flood.py.")

    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    patches = gpd.read_file(geojson_path).to_crs(4326)
    features = []
    for geometry, km2 in zip(patches.geometry, patches.area_km2):
        rings = rings_of(geometry)
        if rings:
            features.append({"km2": round(float(km2), 3), "rings": rings})

    block = dict(provenance)                 # provenance travels verbatim, nothing rewritten
    # When the satellite passed, read from the scene name (S1A_..._20240821T120442_...), so the
    # instrument can say "Sentinel-1A, 18:04 Bangladesh time" rather than just a date.
    flood_scene = (provenance.get("scene_ids") or {}).get("flood", [""])[0]
    if flood_scene.startswith("S1") and "T" in flood_scene:
        stamp = flood_scene.split("_")[4]
        block["platform"] = "Sentinel-1" + flood_scene[2]
        block["acquisition_time_utc"] = f"{stamp[9:11]}:{stamp[11:13]}"
    block["features"] = features
    block["feature_count"] = len(features)
    return block, geojson_path.name


def main():
    PACKS.mkdir(parents=True, exist_ok=True)
    area = gpd.read_file(AOI_FILE).to_crs(4326).union_all()
    parts = gpd.read_file(PARTS_FILE).to_crs(4326)

    print("Packing the satellite observation...")
    observation, source_name = observation_block()
    print(f"  {source_name}: {observation['feature_count']} patches, "
          f"{observation['totals']['flood_km2']} km2, {observation['sensor']} "
          f"{observation['acquisition_date']}")

    print("Packing the field context (roads, waterways, shelters)...")
    if not CONTEXT_FILE.exists():
        raise SystemExit(f"No {CONTEXT_FILE.name}. Run fetch_context.py first.")
    context = json.loads(CONTEXT_FILE.read_text(encoding="utf-8"))
    for key in ("roads", "waterways", "shelters", "places"):
        complete_names(context.get(key, []))
    wet = mark_wet_roads(context, sorted(SAR_OUT.glob(HAZARD_GLOB))[-1])
    context["roads_crossing_water"] = wet
    context["roads_note"] = ("A road is flagged when it crosses an area where the radar saw open "
                             "water on the observation date. That is not a statement that the road "
                             "is impassable, and an unflagged road is not confirmed open: radar "
                             "cannot see water under trees or between buildings, and it knows "
                             "nothing about depth or current.")
    print(f"  {len(context['roads'])} roads ({wet} crossing detected water), "
          f"{len(context['waterways'])} waterways, {len(context['shelters'])} shelter points")

    print("Packing the terrain from the public Copernicus DEM...")
    elevation, transform, crs = read_dem(area)
    shaded, bounds = to_lonlat(hillshade(elevation), transform, crs)
    buffer = io.BytesIO()
    Image.fromarray((np.nan_to_num(shaded, nan=1.0) * 255).round().astype("uint8"), mode="L").save(
        buffer, format="JPEG", quality=80, optimize=True)
    terrain = {
        "bounds": [round(v, PLACES) for v in bounds],
        "elevation_m": {"min": round(float(np.nanmin(elevation)), 1),
                        "max": round(float(np.nanmax(elevation)), 1)},
        "source": "Copernicus DEM GLO-30 (ESA / Airbus), open data on AWS",
        "product": "COG, 1 arc-second",
        "method": (f"Window read of the public tiles, merged to UTM, hillshade at azimuth 315 and "
                   f"altitude 45 degrees, {DEM_GRID_M} m grid"),
        "limitations": ("A surface model: it includes buildings and trees and it smooths low flat "
                        "land. It shows the shape of the ground. It is not a flood model."),
        # The picture is embedded so the pack stays one file. Base64 costs about a third in size
        # and buys a package a responder can hand to somebody else with no network involved.
        "image": "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii"),
    }

    print("Packing the satellite pictures...")
    imagery = imagery_block()

    areas = [{"name": name, "name_bn": AREA["parts_bn"].get(name, ""), "km2": round(float(km2), 1),
              "rings": rings_of(geometry)}
             for name, km2, geometry in zip(parts.adm3_name, parts.area_sqkm, parts.geometry)]

    pack = {
        "format": "ingito.pack/1",
        "pack_id": f"{AREA['aoi_name'].lower()}-{observation['acquisition_date']}",
        "name": AREA["name"],
        "name_bn": AREA["name_bn"],
        # Where the pack sits in Bangladesh's administration, so a place can be named the way
        # people say it: upazila, district, division.
        "admin": AREA["admin"],
        "hazard": {"type": HAZARD_TYPE, "label": HAZARD_LABEL},
        "built_on": date.today().isoformat(),
        # To the second, so an instrument can tell two builds from the same day apart.
        "built_at": datetime.now().isoformat(timespec="seconds"),
        "coverage": {"bbox": [round(v, PLACES) for v in area.bounds],
                     "area_km2": round(float(parts.area_sqkm.sum()), 1),
                     "places": sorted(parts.adm3_name)},
        "observation": observation,
        "context": context,
        "terrain": terrain,
        **({"imagery": imagery} if imagery else {}),
        "areas": areas,
        "usage": ("Prepared while online, then carried into the field. Once this file is on the "
                  "device the instrument needs no network: no tiles, no services, no accounts."),
    }

    path = PACKS / f"{pack['pack_id']}.pack.json"
    path.write_text(json.dumps(pack, separators=(",", ":")), encoding="utf-8")
    size_mb = path.stat().st_size / 1024 / 1024

    # A tiny index so the instrument can list what is available on the preparation machine. In the
    # field nothing reads this: the pack is already on the device, or it arrives as a file from
    # another responder.
    #
    # Each entry carries the SHA-256 of the pack's exact bytes, and a short fingerprint (the first
    # 8 hex characters, 3F9A-12C4) that two people can read aloud to each other. A pack handed over
    # on a memory card can then be checked: cut short or altered by one byte, the hash no longer
    # matches the one the preparation machine published.
    index = []
    for existing in sorted(PACKS.glob("*.pack.json")):
        raw = existing.read_bytes()
        head = json.loads(raw)
        digest = hashlib.sha256(raw).hexdigest()
        index.append({"file": existing.name, "pack_id": head["pack_id"], "name": head["name"],
                      "hazard": head["hazard"]["type"], "sensor": head["observation"]["sensor"],
                      "acquisition_date": head["observation"]["acquisition_date"],
                      "area_km2": head["coverage"]["area_km2"],
                      "size_mb": round(len(raw) / 1024 / 1024, 1),
                      "sha256": digest, "fingerprint": f"{digest[:4]}-{digest[4:8]}".upper()})
    # newline="\n": on Windows write_text would otherwise turn every line ending into CRLF.
    (PACKS / "index.json").write_text(json.dumps({"packs": index}, indent=2), encoding="utf-8", newline="\n")
    fingerprint = next(entry["fingerprint"] for entry in index if entry["file"] == path.name)
    print(f"\nPack written: packs/{path.name}  ({size_mb:.1f} MB, one file, fingerprint {fingerprint})")
    print(f"  hazard      {observation['sensor']} {observation['acquisition_date']}, "
          f"{observation['totals']['flood_km2']} km2 open water, "
          f"{observation['feature_count']} patches")
    print(f"  terrain     {terrain['elevation_m']['min']} to {terrain['elevation_m']['max']} m")
    print(f"  context     {len(context['roads'])} roads, {len(context['waterways'])} waterways, "
          f"{len(context['shelters'])} shelters")
    print(f"  areas       {', '.join(pack['coverage']['places'])}")
    print("\nCarry this one file to the field device. Nothing else is needed.")


if __name__ == "__main__":
    main()
