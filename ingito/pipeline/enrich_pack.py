"""
Add to a built pack what build_pack.py does not make, each block carrying its own source, period,
units and method:

  rainfall    NASA GPM IMERG daily totals on the 0.1 degree grid, the cells whose centre lies in the
              area outline (the same rule as process_gpm.py, whose area means are checked here).
  population  WorldPop people under the pack's own radar water, by upazila (fetch_population.py's
              method), when the pack has none.
  imagery     a Sentinel-2 dry-season reference photo (fetch_imagery.py's grid and grade), when the
              pack has none. Radar pictures are never invented: a pack without them says why.
  event       verified facts from a JSON file (ingito/context/events/<pack_id>.json), merged into
              observation.event; fields the sources do not give stay absent.

    python enrich_pack.py PACK --aoi AOI.geojson --gpm-dir DIR --gpm-processed JSON [--worldpop TIF] [--photo]

Rewrites PACK in place (compact, as build_pack.py writes it). Re-index the packs afterwards.
"""
import argparse
import base64
import io
import json
import re
import urllib.request
from pathlib import Path

import h5py
import numpy as np
import rasterio
from PIL import Image
from rasterio import features
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import Window, from_bounds
from shapely import contains_xy
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

HERE = Path(__file__).resolve().parent
EVENTS = HERE.parent / "context" / "events"
AGENT = {"User-Agent": "NSAC-SpaceApps-flood-pack/1.0 (student project, github.com/Nishorgo3051)"}
SPLIT = 10            # as fetch_population.py: each 100 m square measured on a 10 x 10 sub-grid
GRID_M, PAD_DEG = 20, 0.012   # as fetch_imagery.py


def outline(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return unary_union([shape(f["geometry"]) for f in data["features"]])


def rainfall(aoi, gpm_dir, checked):
    """Per-cell daily totals. The area means must equal process_gpm.py's, or nothing is written."""
    days, cells = [], {}
    files = sorted(Path(gpm_dir).glob("3B-DAY-L.MS.MRG.3IMERG.*.nc4"))
    for path in files:
        with h5py.File(path, "r") as nc:                            # the daily files keep it all at the top
            lon, lat = nc["lon"][:], nc["lat"][:]
            values = nc["precipitation"][0]                       # (lon, lat), mm/day; -9999.9 = no data
            units = nc["precipitation"].attrs["units"][0]
            units = units.decode() if isinstance(units, bytes) else str(units)
        assert units == "mm/day", f"{path.name}: unexpected units {units!r}"
        lo, la = np.meshgrid(lon, lat, indexing="ij")
        inside = contains_xy(aoi, lo, la)
        day = re.search(r"\.(\d{8})-", path.name).group(1)
        days.append(f"{day[:4]}-{day[4:6]}-{day[6:]}")
        for i, j in zip(*np.nonzero(inside)):
            v = float(values[i, j])
            cells.setdefault((round(float(lon[i]), 2), round(float(lat[j]), 2)), []).append(
                round(v, 2) if np.isfinite(v) and v >= 0 else None)
    version = re.search(r"\.(V\d+\w)\.nc4$", files[0].name).group(1)
    mean = [round(float(np.mean([c[d] for c in cells.values() if c[d] is not None])), 2) for d in range(len(days))]
    peak = [round(float(np.max([c[d] for c in cells.values() if c[d] is not None])), 2) for d in range(len(days))]
    missing = sum(v is None for c in cells.values() for v in c)
    ref = {o["date"]: o for o in checked["daily_observations"]}
    for day, m in zip(days, mean):
        assert abs(ref[day]["mean"] - m) < 0.01, f"{day}: area mean {m} differs from process_gpm's {ref[day]['mean']}"
    totals = {k: round(sum(v for v in c if v is not None), 1) for k, c in cells.items()}
    return {
        "product": "NASA GPM IMERG Late Run, daily", "collection": checked["collection"],
        "version": version, "source": "NASA GES DISC (Goddard Earth Sciences Data and Information Services Center)",
        "grid_deg": 0.1, "period": [days[0], days[-1]], "days": days, "units": "mm/day",
        "quantity": "daily precipitation total (accumulation over each UTC day)",
        "cells": [[lon, lat, vals] for (lon, lat), vals in sorted(cells.items())],
        "area_mean": mean, "area_max": peak,
        "period_total_mean_mm": round(sum(mean), 1), "period_total_max_cell_mm": max(totals.values()),
        "method": (f"{len(cells)} cells of the 0.1 degree IMERG grid whose centre lies inside the area outline "
                   "(the rule process_gpm.py uses; its daily area means are reproduced exactly). Cell values "
                   "are the product's own daily totals; the period total is the sum of the daily totals."),
        "missing": (f"{missing} cell-days without a valid value; they are left out of the means and drawn "
                    "empty." if missing else "No cell-day in this period lacks a valid value."),
        "not_rate": ("The daily product gives day totals in mm, not a rate. Hourly rates need the half-hourly "
                     "IMERG product, which is not in this pack."),
        "limitations": ("A satellite and gauge-calibrated estimate, about 10 km per cell. It is rain that fell, "
                        "not flooded land, and says nothing about water arriving from upstream."),
    }


def population(pack, raster, year):
    """fetch_population.py's method, on the pack's own flood polygons and upazila outlines."""
    obs, areas = pack["observation"], pack["areas"]
    polys = [Polygon(f["rings"][0], f["rings"][1:]) for f in obs["features"]]
    parts = [Polygon(a["rings"][0], a["rings"][1:]) for a in areas]
    west, south, east, north = unary_union(parts).bounds
    with rasterio.open(raster) as src:
        top, left = src.index(west, north)
        bottom, right = src.index(east, south)
        window = Window(left, top, right - left + 1, bottom - top + 1)
        people = src.read(1, window=window, masked=True).filled(0).astype("float64")
        transform = src.window_transform(window)
    h, w = people.shape
    fine = features.rasterize(((p, 1) for p in polys), out_shape=(h * SPLIT, w * SPLIT),
                              transform=transform * Affine.scale(1 / SPLIT), dtype="uint8")
    share = fine.reshape(h, SPLIT, w, SPLIT).mean(axis=(1, 3))
    upazila = features.rasterize(((p, i) for i, p in enumerate(parts, 1)), out_shape=(h, w),
                                 transform=transform, dtype="uint8")
    row_lat = transform.f + transform.e * (np.arange(h) + 0.5)
    square_km2 = (abs(transform.a) * 111.32 * np.cos(np.radians(row_lat))) * (abs(transform.e) * 110.54)
    water_km2 = float((share * square_km2[:, None])[upazila > 0].sum())
    radar_km2 = float(obs["totals"]["flood_km2"])
    print(f"  water on the population grid {water_km2:.1f} km2, radar layer {radar_km2:.1f} km2")
    assert abs(water_km2 - radar_km2) <= 0.05 * radar_km2, "grids do not line up: nothing written"
    in_water = people * share
    rows = [{"name": a["name"], "people_in_water": int(round(in_water[upazila == i].sum())),
             "people_total": int(round(people[upazila == i].sum()))} for i, a in enumerate(areas, 1)]
    return {
        "year": year,
        "source": ("WorldPop (2025). Constrained estimates of 2015-2030 total number of people per grid square, "
                   "3 arc-seconds (about 100 m), R2025A v1. University of Southampton. DOI:10.5258/SOTON/WP00839. CC BY 4.0"),
        "product": Path(raster).name, "flood_layer": f"{pack['pack_id']} observation.features",
        "method": (f"Each 100 m square's people, times the share of that square under the water the radar saw "
                   f"(measured on a {SPLIT} x {SPLIT} sub-grid), summed by upazila. A square is counted in the "
                   "upazila holding its centre."),
        "limitations": ("A modelled estimate, not a headcount and not people confirmed affected: WorldPop spreads "
                        "census totals over squares with buildings. Radar misses water between houses and under "
                        "trees, where people live, so the real number is probably higher."),
        "people_in_water": int(round(in_water[upazila > 0].sum())),
        "people_total": int(round(people[upazila > 0].sum())),
        "by_upazila": rows,
    }


def fetch(url, data=None):
    body = json.dumps(data).encode() if data is not None else None
    headers = {**AGENT, **({"Content-Type": "application/json"} if body else {})}
    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=90) as r:
        return json.load(r)


def grade(rgb):
    """fetch_imagery.py's grade, unchanged."""
    valid = rgb.sum(axis=0) > 0
    out = np.zeros_like(rgb)
    for band in range(3):
        values = rgb[band][valid]
        low, high = np.percentile(values, [1, 99.5])
        out[band] = np.clip((rgb[band] - low) / (high - low), 0, 1)
    out = out ** np.array([0.72, 0.72, 0.82], "float32")[:, None, None]
    grey = out.mean(axis=0, keepdims=True)
    out = np.clip(grey + (out - grey) * 0.9, 0, 1)
    out[:, ~valid] = 0
    return (out * 255).round().astype("uint8")


def photo(aoi):
    """The clearest dry-season Sentinel-2 day over the area, mosaicked from that day's tiles."""
    west, south, east, north = aoi.bounds
    west, south, east, north = west - PAD_DEG, south - PAD_DEG, east + PAD_DEG, north + PAD_DEG
    dlat = GRID_M / 110540
    dlon = GRID_M / (111320 * np.cos(np.radians((south + north) / 2)))
    width, height = int(np.ceil((east - west) / dlon)), int(np.ceil((north - south) / dlat))
    transform = Affine(dlon, 0, west, 0, -dlat, north)
    bounds = (west, north - height * dlat, west + width * dlon, north)
    found = fetch("https://planetarycomputer.microsoft.com/api/stac/v1/search", {
        "collections": ["sentinel-2-l2a"], "bbox": list(bounds), "datetime": "2025-11-01/2026-03-31",
        "query": {"eo:cloud_cover": {"lt": 3}}, "limit": 100})["features"]
    by_day = {}
    for item in found:
        by_day.setdefault(item["properties"]["datetime"][:10], []).append(item)
    rgb = np.zeros((3, height, width), "float32")
    for day in sorted(by_day, key=lambda d: max(i["properties"]["eo:cloud_cover"] for i in by_day[d])):
        rgb[:] = 0
        for item in by_day[day]:
            href = fetch("https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=" + item["assets"]["visual"]["href"])["href"]
            with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"), rasterio.open("/vsicurl/" + href) as src:
                window = from_bounds(*transform_bounds("EPSG:4326", src.crs, *bounds), transform=src.transform)
                shrink = src.res[0] / GRID_M
                oh, ow = max(1, int(window.height * shrink)), max(1, int(window.width * shrink))
                data = src.read(window=window, out_shape=(3, oh, ow), boundless=True, fill_value=0)
                st = src.window_transform(window) * Affine.scale(window.width / ow, window.height / oh)
                tile = np.zeros_like(rgb)
                for b in range(3):
                    reproject(data[b].astype("float32"), tile[b], src_crs=src.crs, src_transform=st,
                              dst_crs="EPSG:4326", dst_transform=transform, resampling=Resampling.bilinear,
                              src_nodata=0, dst_nodata=0)
            empty = rgb.sum(axis=0) == 0
            rgb[:, empty] = tile[:, empty]
        coverage = float((rgb.sum(axis=0) > 0).mean())
        print(f"  Sentinel-2 {day}: {len(by_day[day])} tile(s), {coverage:.1%} of the grid")
        if coverage > 0.97:
            break
    else:
        raise SystemExit("No single clear dry-season day covers the area: no photo written.")
    buf = io.BytesIO()
    Image.fromarray(np.moveaxis(grade(rgb), 0, -1)).save(buf, "JPEG", quality=78, optimize=True, progressive=True)
    first = by_day[day][0]
    platform = first["properties"].get("platform", "sentinel-2")
    return {
        "bounds": [round(v, 6) for v in bounds], "grid_m": GRID_M,
        "optical": {
            "date": day, "time_utc": first["properties"]["datetime"][11:16],
            "sensor": f"Sentinel-2{platform[-1].upper()} MSI",
            "product": "L2A true colour (TCI)", "scene": " + ".join(i["id"] for i in by_day[day]),
            "cloud_cover": max(i["properties"]["eo:cloud_cover"] for i in by_day[day]),
            "source": "ESA Copernicus via Microsoft Planetary Computer (open catalogue, no account)",
            "note": ("Dry-season picture of the landscape, taken months before the flood and by a different "
                     "satellite. It is not a picture of the flood and not the radar observation."),
            "image": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(),
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pack", type=Path)
    ap.add_argument("--aoi", required=True)
    ap.add_argument("--gpm-dir", required=True)
    ap.add_argument("--gpm-processed", required=True)
    ap.add_argument("--worldpop")
    ap.add_argument("--photo", action="store_true")
    args = ap.parse_args()
    pack = json.loads(args.pack.read_text(encoding="utf-8"))
    aoi = outline(args.aoi)
    print(f"{pack['pack_id']}:")
    pack["rainfall"] = rainfall(aoi, args.gpm_dir, json.loads(Path(args.gpm_processed).read_text(encoding="utf-8")))
    print(f"  rainfall: {len(pack['rainfall']['cells'])} cells, {pack['rainfall']['period']}, "
          f"area mean total {pack['rainfall']['period_total_mean_mm']} mm")
    if "population" not in pack and args.worldpop:
        year = int(re.search(r"_(\d{4})_", Path(args.worldpop).name).group(1))
        pack["population"] = population(pack, args.worldpop, year)
        print(f"  population {year}: {pack['population']['people_in_water']:,} people in the radar's water")
    if "imagery" not in pack and args.photo:
        pack["imagery"] = photo(aoi)
    event_file = EVENTS / f"{pack['pack_id']}.json"
    if event_file.exists():
        event = json.loads(event_file.read_text(encoding="utf-8"))
        pack["observation"]["event"] = {**pack["observation"]["event"], **event.get("event", {})}
        pack["observation"].update(event.get("observation", {}))
        if "rainfall_coverage" in event:
            pack["rainfall"]["coverage_note"] = event["rainfall_coverage"]
        if "imagery_status" in event:
            pack.setdefault("imagery", {})["radar_status"] = event["imagery_status"]
        print(f"  event: merged {event_file.name}")
    args.pack.write_text(json.dumps(pack, separators=(",", ":")), encoding="utf-8", newline="\n")
    print(f"  written {args.pack.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
