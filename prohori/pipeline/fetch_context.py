"""
fetch_context.py - the geography a field team needs once the network is gone.

WHY THIS EXISTS
  A flood layer on its own does not help anybody standing in water. The three questions a
  responder actually asks are: where am I, which routes are under water, and where is the nearest
  shelter. Answering those needs roads, waterways and shelter points INSIDE the pack, on the
  device. So this script downloads them once, while there is still a connection, and freezes them
  into a file the field instrument reads locally.

WHY NOT A MAP SERVICE
  Live map tiles are not an option: they need a network in exactly the situation where there is
  none, and bulk-downloading tiles from public tile servers breaks their terms of use. Vector
  features from OpenStreetMap can be stored, are small, and the instrument can draw them itself.

WHY SCHOOLS AND MOSQUES
  In Bangladesh the buildings people shelter in during a flood are usually the local school or the
  local mosque - they are the tallest and sturdiest structures in a village, and many schools are
  built as designated flood or cyclone shelters. Hospitals and clinics are included for the same
  practical reason. These are REFERENCE POINTS, not a verified shelter registry: the instrument
  says so, because a school existing does not prove it is open, dry or reachable.

ATTRIBUTION
  Data from OpenStreetMap contributors, ODbL. The attribution string travels inside the pack and
  is displayed by the instrument.

HOW TO RUN
  python fetch_context.py           (no account needed)
  Writes ../context/<aoi>_context.json
"""

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

import geopandas as gpd

HERE = Path(__file__).resolve().parent
PROHORI = HERE.parent
SAR = PROHORI.parent / "sar-flood"
OUT_DIR = PROHORI / "context"

AOI_FILE = SAR / "aoi" / "feni.geojson"
AOI_NAME = "feni"

OVERPASS = "https://overpass-api.de/api/interpreter"
# Overpass rejects anonymous scripts with HTTP 406, so identify the project honestly.
AGENT = {"User-Agent": "NSAC-SpaceApps-flood-pack/1.0 (student project, github.com/Nishorgo3051)"}
ATTRIBUTION = "Roads, waterways and shelter points: OpenStreetMap contributors, ODbL"

# Road classes worth carrying. "unclassified" sounds unimportant, but in rural Bangladesh it is the
# ordinary village road - the route a boat team or a truck actually takes - so it stays. Footpaths
# and driveways are left out: they would multiply the file size without changing a routing decision.
ROAD_KINDS = ("motorway", "trunk", "primary", "secondary", "tertiary", "unclassified")
WATER_KINDS = ("river", "stream", "canal", "drain")

# How precisely to keep each line. Five decimal places is about one metre, far finer than anybody
# needs on a phone screen, and it roughly halves the file against full precision.
PLACES = 5


def overpass(query):
    """One POST to Overpass. Timing is printed so a slow or failing run is visible."""
    data = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(OVERPASS, data=data, headers=AGENT)
    started = time.time()
    with urllib.request.urlopen(request, timeout=300) as response:
        raw = response.read()
    print(f"  Overpass returned {len(raw) / 1024:.0f} KB in {time.time() - started:.0f}s")
    return json.loads(raw)["elements"]


def build_query(bounds):
    """
    Everything in one query rather than five. Each extra round trip is another chance to fail
    halfway and leave a half-built pack, and Overpass is a shared free service.
    """
    west, south, east, north = bounds
    bbox = f"{south:.4f},{west:.4f},{north:.4f},{east:.4f}"
    roads = "|".join(ROAD_KINDS)
    water = "|".join(WATER_KINDS)
    return f"""[out:json][timeout:240];
(
  way[highway~"^({roads})$"]({bbox});
  way[waterway~"^({water})$"]({bbox});
  nwr[amenity=school]({bbox});
  nwr[amenity=place_of_worship][religion=muslim]({bbox});
  nwr[amenity~"^(hospital|clinic)$"]({bbox});
);
out geom;"""


def line_of(element):
    """A way's shape as [[lon, lat], ...], rounded. Overpass calls this list 'geometry'."""
    points = element.get("geometry") or []
    return [[round(p["lon"], PLACES), round(p["lat"], PLACES)]
            for p in points if p and p.get("lon") is not None]


def point_of(element):
    """One coordinate for a shelter. A school mapped as a building is a polygon, so take the middle
    of its outline; a school mapped as a single point already has one."""
    if element["type"] == "node":
        return [round(element["lon"], PLACES), round(element["lat"], PLACES)]
    points = element.get("geometry") or []
    lons = [p["lon"] for p in points if p and p.get("lon") is not None]
    lats = [p["lat"] for p in points if p and p.get("lat") is not None]
    if not lons:
        return None
    return [round(sum(lons) / len(lons), PLACES), round(sum(lats) / len(lats), PLACES)]


def shelter_kind(tags):
    """Group the OSM tags into the four kinds the instrument draws and labels."""
    amenity = tags.get("amenity")
    if amenity == "school":
        return "school"
    if amenity == "place_of_worship":
        return "mosque"
    if amenity in ("hospital", "clinic"):
        return amenity
    return None


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    area = gpd.read_file(AOI_FILE).to_crs(4326).union_all()
    print(f"Fetching field context for {AOI_NAME} from OpenStreetMap...")
    elements = overpass(build_query(area.bounds))

    roads, waterways, shelters = [], [], []
    for element in elements:
        tags = element.get("tags", {})
        if tags.get("highway") in ROAD_KINDS and element["type"] == "way":
            line = line_of(element)
            if len(line) > 1:
                roads.append({"kind": tags["highway"], "coords": line})
        elif tags.get("waterway") in WATER_KINDS and element["type"] == "way":
            line = line_of(element)
            if len(line) > 1:
                waterways.append({"kind": tags["waterway"], "coords": line})
        else:
            kind = shelter_kind(tags)
            if not kind:
                continue
            point = point_of(element)
            if not point:
                continue
            # An unnamed school is still a building you can shelter in, so keep it and let the
            # instrument show the kind instead of inventing a name for it.
            shelters.append({"kind": kind, "name": tags.get("name", ""),
                             "lon": point[0], "lat": point[1]})

    context = {
        "aoi_name": AOI_NAME,
        "fetched_on": time.strftime("%Y-%m-%d"),
        "attribution": ATTRIBUTION,
        "note": ("Shelter points are reference locations from OpenStreetMap, not a verified shelter "
                 "registry. A school on this map is a building that is commonly used as a shelter; "
                 "that is not a guarantee it is open, dry or reachable."),
        "roads": roads,
        "waterways": waterways,
        "shelters": shelters,
    }
    path = OUT_DIR / f"{AOI_NAME}_context.json"
    path.write_text(json.dumps(context, separators=(",", ":")), encoding="utf-8")

    kinds = {}
    for shelter in shelters:
        kinds[shelter["kind"]] = kinds.get(shelter["kind"], 0) + 1
    print(f"\nWrote context/{path.name} ({path.stat().st_size / 1024:.0f} KB)")
    print(f"  {len(roads)} road lines, {len(waterways)} waterway lines")
    print("  shelters: " + ", ".join(f"{count} {kind}" for kind, count in sorted(kinds.items())))


if __name__ == "__main__":
    main()
