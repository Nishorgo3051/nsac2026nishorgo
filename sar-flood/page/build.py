"""
Builds the published page from mapper.src.html.

Run:  run.cmd page\\build.py        (from the sar-flood folder)

The template holds the writing and design; this script fills in the placeholders:
the current source code of each script, its line count, and the Feni upazila table
ordered north to south. Keeping it a script means the page can be rebuilt after any
code change, instead of the code and the page drifting apart.
"""

import html
from pathlib import Path

import geopandas as gpd

HERE = Path(__file__).parent
PROJECT = HERE.parent

# Reported flooded area per upazila, August 2024, from Wikipedia "August 2024 Bangladesh floods".
REPORTED_KM2 = {"Parashuram": 31, "Fulgazi": 35, "Chhagalnaiya": 37,
                "Feni Sadar": 33, "Daganbhuiyan": 16, "Sonagazi": 49}
EXPECTATION = {"Parashuram": "Hit first by the flash flood: clear new water",
               "Fulgazi": "Hit first by the flash flood: clear new water",
               "Chhagalnaiya": "Hit early: clear new water",
               "Feni Sadar": "Built-up: expect an under-count (double bounce)"}
SPELLING = {"Parashuram": "Parshuram"}     # the boundary file and the news spell this differently


def upazila_rows():
    """One table row per upazila, ordered north to south, with the Detected column still empty."""
    upazilas = gpd.read_file(PROJECT / "aoi" / "feni_upazilas.geojson")
    upazilas["lat"] = upazilas.to_crs(upazilas.estimate_utm_crs()).centroid.to_crs(4326).y
    rows = []
    for _, upazila in upazilas.sort_values("lat", ascending=False).iterrows():
        name = SPELLING.get(upazila.adm3_name, upazila.adm3_name)
        rows.append(f'        <tr><td>{name}</td><td class="num">{REPORTED_KM2[upazila.adm3_name]}</td>'
                    f'<td class="num pend">pending</td><td>{EXPECTATION.get(upazila.adm3_name, "")}</td></tr>')
    return "\n".join(rows)


def main():
    page = (HERE / "mapper.src.html").read_text(encoding="utf-8")
    fills = {"{{UPAZILA_ROWS}}": upazila_rows()}
    # (placeholder for the code, placeholder for its line count or None, file)
    for code_key, lines_key, filename in (("{{FLOOD_PY}}", "{{FLOOD_LINES}}", "flood_extent.py"),
                                          ("{{NISAR_PY}}", "{{NISAR_LINES}}", "nisar_flood.py"),
                                          ("{{TEST_PY}}", "{{TEST_LINES}}", "test_flood_extent.py"),
                                          ("{{REQ}}", None, "requirements.txt")):
        source = (PROJECT / filename).read_text(encoding="utf-8")
        fills[code_key] = html.escape(source if lines_key else source.strip())
        if lines_key:
            fills[lines_key] = str(source.count("\n"))
    for key, value in fills.items():
        if key not in page:
            raise SystemExit(f"The template no longer uses {key}. Update build.py or the template.")
        page = page.replace(key, value)
    left = [line for line in page.splitlines() if "{{" in line]
    if left:
        raise SystemExit(f"Unfilled placeholder in the template: {left[0].strip()[:80]}")
    out = HERE / "mapper.html"
    out.write_text(page, encoding="utf-8")
    print(f"built {out.name}, {len(page):,} characters")


if __name__ == "__main__":
    main()
