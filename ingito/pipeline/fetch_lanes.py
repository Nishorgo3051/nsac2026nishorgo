"""
fetch_lanes.py - the village lanes and tracks, so a road route can find the shelter next door.

WHY THIS EXISTS
  fetch_context.py keeps the main and village roads (motorway down to "unclassified"). That is
  enough to draw the district, but not to route through it: in rural Bangladesh the mosque or
  school a family would walk to is usually on a lane OpenStreetMap tags "residential" or "track".
  Without those, the shortest road route to a shelter one kilometre away can be twenty.

WHY A SEPARATE FILE
  The roads already in a pack are left exactly as they are, so every figure worked out from them
  stays the same. The lanes are an addition, used for routing and drawn only close up.

WHY SIMPLIFIED
  A lane keeps every point where it meets another road or lane - that is what routing needs - and
  between those, only the points that move it more than TOLERANCE_M off a straight line. That
  roughly halves the file and changes no route.

HOW TO RUN (after fetch_context.py, before build_pack.py)
  python fetch_lanes.py --area ../../areas/<id>.json
  --area may be left out while areas/ holds one config.
  Writes ../context/<aoi>_lanes.json. Data: OpenStreetMap contributors, ODbL.
"""

import json
import time
from collections import Counter

import geopandas as gpd
from shapely.geometry import LineString

from fetch_context import AOI_FILE, AOI_NAME, ATTRIBUTION, OUT_DIR, PLACES, line_of, overpass

LANE_KINDS = ("residential", "living_street", "track")
TOLERANCE_M = 5


def simplify(lanes, roads):
    """Drop the points that only bend a lane slightly. Every junction stays: a point any other
    way also passes through, or one a lane passes twice."""
    uses = Counter(tuple(point) for line in lanes + roads for point in line)
    tolerance = TOLERANCE_M / 111320                  # metres to degrees, near enough for this
    out = []
    for line in lanes:
        kept = [line[0]]
        start = 0
        for i in range(1, len(line)):
            if i == len(line) - 1 or uses[tuple(line[i])] > 1:
                piece = LineString(line[start:i + 1]).simplify(tolerance, preserve_topology=False)
                kept += [[round(x, PLACES), round(y, PLACES)] for x, y in list(piece.coords)[1:]]
                start = i
        out.append(kept)
    return out


def main():
    bounds = gpd.read_file(AOI_FILE).to_crs(4326).union_all().bounds
    west, south, east, north = bounds
    print(f"Fetching lanes and tracks for {AOI_NAME} from OpenStreetMap...")
    elements = overpass(f"""[out:json][timeout:240];
way[highway~"^({'|'.join(LANE_KINDS)})$"]({south:.4f},{west:.4f},{north:.4f},{east:.4f});
out geom;""")
    lanes = [line for line in map(line_of, elements) if len(line) > 1]
    roads = json.loads((OUT_DIR / f"{AOI_NAME}_context.json").read_text(encoding="utf-8"))["roads"]
    before = sum(map(len, lanes))
    lanes = simplify(lanes, [road["coords"] for road in roads])
    path = OUT_DIR / f"{AOI_NAME}_lanes.json"
    path.write_text(json.dumps({"fetched_on": time.strftime("%Y-%m-%d"), "attribution": ATTRIBUTION,
                                "kinds": list(LANE_KINDS), "tolerance_m": TOLERANCE_M,
                                "lanes": [{"coords": line} for line in lanes]},
                               separators=(",", ":")), encoding="utf-8")
    print(f"Wrote context/{path.name}: {len(lanes)} lanes, {before} points kept as "
          f"{sum(map(len, lanes))} ({path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
