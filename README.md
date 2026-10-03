# Ingito (ইঙ্গিত): last-mile flood intelligence

**NASA radar shows where the water is. We get that map to the teams who need it, in the places where the network has already died.**

Team Ingito · NASA Space Apps Challenge 2026 · **Dancing with the SARs**

| Name | Role |
|---|---|
| Nishorgo Nirupom | Team Lead |
| Madeeha Obaidiyah | Lead Developer |
| Tabin Zaman | Documentary & Visual Media Lead |
| Alvan Zahedy | Software Engineer |

Built for humanitarian relief teams, and open to anyone who wants to install and use it.

"Ingito" (ইঙ্গিত) is Bangla for *a sign*. The satellite gives the first sign of where the water is; the person standing in it sends the next one back.

## What it does

The product has exactly three functions.

| | |
|---|---|
| **1. Flood layer** | Real Sentinel-1 radar turned into a flood layer that carries its own sensor, dates and limitations |
| **2. One pack file** | That layer plus terrain, roads, waterways and shelters in a single portable file |
| **3. Field view** | Answers where am I, which routes are under water, and where the nearest shelter is. Two one-tap field reports go the other way. |

## What is real

Everything below came out of the pipeline in this repository. None of it is placeholder data.

**Sensor**
- Sentinel-1 C-band VH, RTC gamma-0, 10 m, read through the Microsoft Planetary Computer STAC catalogue.
- No account is needed.

**Event:** Feni district, the August 2024 Bangladesh floods.

**Passes:** relative orbit 114, ascending. **9 Aug 2024** (baseline) against **21 Aug 2024** (flood): same track, same viewing geometry, twelve days apart.

**Result:** **21.7 km² of new open water in 1,159 patches**, 2.3% of the 929 km² district, at threshold 1.25.

**Pack:** one file, 6.7 MB. It holds:
- the flood layer;
- a Sentinel-2 photograph of the district (17 Dec 2023);
- the two radar passes;
- 2,293 road lines, 51 of them crossing detected water;
- 927 waterway lines;
- 86 named places;
- 278 shelter points;
- terrain;
- six upazila outlines.

Names are in Bangla and English wherever the map has them.

**Limitation**
- Radar-dark detection finds **open water only**. Water among rice, trees and houses bounces the signal twice and looks brighter, so it is missed.
- The area is therefore a **lower bound**, and it under-counts exactly where people live. That is why the field reports exist.
- No validated flood map exists for this event, so **no accuracy figure is claimed**.

**NISAR:** `sar-flood/nisar_flood.py` is a working NISAR L-band pipeline, run against real NISAR L2 GCOV granules (south Chattogram, 12 July 2026). It is an extension, clearly labelled, and the Feni demonstration does not depend on it.

## Run it

```bash
node ingito/serve.mjs          # then open http://localhost:8767/app/
```

Tap **Download this pack**, and the pack is stored on the device. Then prove the offline claim:
1. Stop the server, or switch the phone to airplane mode.
2. Reload the page. The app opens straight into the map with no network.

To hand a pack to another team, copy `ingito/packs/feni-2024-08-21.pack.json` to their device by any means. Then use **"Or open a pack file handed to you by another team"**.

## Prepare a pack

This is the only part that needs a network. There are no accounts, API keys or logins anywhere in the chain.

```bash
python sar-flood/s1_flood.py              # Sentinel-1 flood layer + provenance
python ingito/pipeline/fetch_context.py   # roads, rivers, places, shelters (OpenStreetMap)
python ingito/pipeline/fetch_imagery.py   # Sentinel-2 photo + the radar pictures
python ingito/pipeline/build_pack.py      # one pack file + the pack index
```

Python 3.12 with the packages in `sar-flood/requirements.txt`, plus Node.js.

The place, dates and names come from one config file per area in `areas/`; each script takes `--area areas/<id>.json`, which can be left out while there is only one. A new flood is a new config file, not a code change.

## Repository

- `areas/`: one config per area. `feni-2024-08.json` is the first.
- `ingito/`: the product, meaning the pack pipeline, the packs and the field app. Full details are in [`ingito/README.md`](ingito/README.md); every key of a pack is in [`ingito/PACK_FORMAT.md`](ingito/PACK_FORMAT.md).
- `sar-flood/`: the radar pipelines (`s1_flood.py` for Sentinel-1, `nisar_flood.py` for NISAR) and [`METHODOLOGY.md`](sar-flood/METHODOLOGY.md).
- Other folders hold earlier experiments.

## Credits

**Data**
- Sentinel-1 and Sentinel-2: ESA Copernicus, via the Microsoft Planetary Computer.
- Terrain: Copernicus DEM GLO-30 (ESA / Airbus).
- Permanent water: JRC Global Surface Water v1.4.
- Roads, waterways, places and shelters: © OpenStreetMap contributors, ODbL.
- Village names: GeoNames, CC BY 4.0.

**Typefaces:** Inter and Hind Siliguri, both under the SIL Open Font License.

**Method:** the UN-SPIDER Recommended Practice for SAR flood mapping.

**AI use:** code and documentation were written with Claude (Anthropic) for the team. Every AI tool and what it did is listed in [`docs/AI_USE.md`](docs/AI_USE.md).

**Licence:** Apache 2.0, see [`LICENSE`](LICENSE).
