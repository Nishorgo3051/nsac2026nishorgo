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
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

import geopandas as gpd

HERE = Path(__file__).resolve().parent
INGITO = HERE.parent
SAR = INGITO.parent / "sar-flood"
OUT_DIR = INGITO / "context"

AOI_FILE = SAR / "aoi" / "feni.geojson"
AOI_NAME = "feni"

OVERPASS = "https://overpass-api.de/api/interpreter"
# Overpass rejects anonymous scripts with HTTP 406, so identify the project honestly.
AGENT = {"User-Agent": "NSAC-SpaceApps-flood-pack/1.0 (student project, github.com/Nishorgo3051)"}
ATTRIBUTION = ("Roads, waterways, place names and shelter points: OpenStreetMap contributors, ODbL. "
               "Village names: GeoNames, CC BY 4.0")

# Road classes worth carrying. "unclassified" sounds unimportant, but in rural Bangladesh it is the
# ordinary village road - the route a boat team or a truck actually takes - so it stays. Footpaths
# and driveways are left out: they would multiply the file size without changing a routing decision.
ROAD_KINDS = ("motorway", "trunk", "primary", "secondary", "tertiary", "unclassified")
WATER_KINDS = ("river", "stream", "canal", "drain")
# Named places, so villages exist on the map as the places people call them, not as blank ground.
PLACE_KINDS = ("city", "town", "suburb", "village", "hamlet")
BANGLA_SCRIPT = re.compile("[ঀ-৿]")

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
    places = "|".join(PLACE_KINDS)
    return f"""[out:json][timeout:240];
(
  way[highway~"^({roads})$"]({bbox});
  way[waterway~"^({water})$"]({bbox});
  nwr[amenity=school]({bbox});
  nwr[amenity=place_of_worship][religion=muslim]({bbox});
  nwr[amenity~"^(hospital|clinic)$"]({bbox});
  node[place~"^({places})$"]({bbox});
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


def names(tags):
    """
    The English and the Bangla name, when the map has them. The instrument is bilingual, so it
    shows the Bangla name in Bangla and falls back to the English one only when nobody has mapped
    the Bangla yet - it never transliterates, because an invented spelling of a village name is
    worse than an honest English one. Keys are left out when empty, to keep the pack small.
    """
    name, bangla, english = tags.get("name", ""), tags.get("name:bn", ""), tags.get("name:en", "")
    # In Bangladesh the plain "name" is often already in Bangla script, so sort it by script.
    if BANGLA_SCRIPT.search(name):
        bangla = bangla or name
    elif name:
        english = english or name
    out = {}
    if english:
        out["name"] = english
    if bangla:
        out["name_bn"] = bangla
    return out


GEONAMES_URL = "https://download.geonames.org/export/dump/BD.zip"
GEONAMES_ZIP = OUT_DIR / "geonames" / "BD.zip"
# A GeoNames village this close to a mapped OSM place is the same place (a town spreads wider),
# and two GeoNames villages this close together are one village spelt two ways.
NEAR_OSM_M = {"city": 2500, "town": 2000}
NEAR_OSM_DEFAULT_M = 800
NEAR_EACH_OTHER_M = 500


def geonames_villages(bounds, osm_places):
    """
    Villages from GeoNames, because OpenStreetMap names only a few dozen places in the district and
    a village should exist on the map as the place people call it.

    ONLY PRECISELY PLACED VILLAGES ARE KEPT. Most GeoNames entries for rural Bangladesh come from an
    old gazetteer whose coordinates are rounded to the nearest minute of arc - up to a kilometre
    from the village itself. A name drawn a kilometre from its village is worse than no name, so
    any entry sitting exactly on a whole-minute grid point is dropped. English names only: the
    gazetteer has almost no Bangla spellings, and this pipeline never invents one.
    """
    import math
    import zipfile

    if not GEONAMES_ZIP.exists():
        GEONAMES_ZIP.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(GEONAMES_URL, headers=AGENT)
        with urllib.request.urlopen(request, timeout=120) as response:
            GEONAMES_ZIP.write_bytes(response.read())
    west, south, east, north = bounds
    rows = zipfile.ZipFile(GEONAMES_ZIP).read("BD.txt").decode("utf-8").splitlines()
    on_minute = lambda value: abs(value * 60 - round(value * 60)) < 1e-3
    metres = lambda a, b: math.hypot((a[0] - b[0]) * 102000, (a[1] - b[1]) * 110540)
    villages, rounded = [], 0
    for line in rows:
        f = line.split("	")
        lat, lon = float(f[4]), float(f[5])
        if f[6] != "P" or not (west <= lon <= east and south <= lat <= north):
            continue
        if on_minute(lat) and on_minute(lon):
            rounded += 1
            continue
        if any(metres((lon, lat), (p["lon"], p["lat"])) < NEAR_OSM_M.get(p["kind"], NEAR_OSM_DEFAULT_M)
               for p in osm_places):
            continue
        if any(metres((lon, lat), (v["lon"], v["lat"])) < NEAR_EACH_OTHER_M for v in villages):
            continue
        bangla = next((alt for alt in f[3].split(",") if BANGLA_SCRIPT.search(alt)), "")
        village = {"kind": "village", "lon": round(lon, PLACES), "lat": round(lat, PLACES), "name": f[2]}
        if bangla:
            village["name_bn"] = bangla
        villages.append(village)
    print(f"  GeoNames: {len(villages)} villages kept, {rounded} dropped for rounded coordinates")
    return villages


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

    roads, waterways, shelters, places = [], [], [], []
    for element in elements:
        tags = element.get("tags", {})
        if tags.get("highway") in ROAD_KINDS and element["type"] == "way":
            line = line_of(element)
            if len(line) > 1:
                road = {"kind": tags["highway"], "coords": line, **names(tags)}
                if tags.get("ref"):
                    road["ref"] = tags["ref"]          # "N1": how a driver names the highway
                roads.append(road)
        elif tags.get("waterway") in WATER_KINDS and element["type"] == "way":
            line = line_of(element)
            if len(line) > 1:
                waterways.append({"kind": tags["waterway"], "coords": line, **names(tags)})
        elif tags.get("place") in PLACE_KINDS and element["type"] == "node":
            named = names(tags)
            if named:
                places.append({"kind": tags["place"], "lon": round(element["lon"], PLACES),
                               "lat": round(element["lat"], PLACES), **named})
        else:
            kind = shelter_kind(tags)
            if not kind:
                continue
            point = point_of(element)
            if not point:
                continue
            # An unnamed school is still a building you can shelter in, so keep it and let the
            # instrument show the kind instead of inventing a name for it.
            shelters.append({"kind": kind, "lon": point[0], "lat": point[1], **names(tags)})

    places += geonames_villages(area.bounds, places)

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
        "places": places,
    }
    path = OUT_DIR / f"{AOI_NAME}_context.json"
    path.write_text(json.dumps(context, separators=(",", ":")), encoding="utf-8")

    kinds = {}
    for shelter in shelters:
        kinds[shelter["kind"]] = kinds.get(shelter["kind"], 0) + 1
    print(f"\nWrote context/{path.name} ({path.stat().st_size / 1024:.0f} KB)")
    print(f"  {len(roads)} road lines, {len(waterways)} waterway lines, {len(places)} named places")
    print(f"  Bangla names: {sum('name_bn' in p for p in places)} places, "
          f"{sum('name_bn' in w for w in waterways)} waterways, {sum('name_bn' in r for r in roads)} roads, "
          f"{sum('name_bn' in s for s in shelters)} shelters")
    print("  shelters: " + ", ".join(f"{count} {kind}" for kind, count in sorted(kinds.items())))


if __name__ == "__main__":
    main()
