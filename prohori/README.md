# Prohori — last-mile disaster intelligence

**NASA radar shows where the water is. We get that map to the teams who need it, in the places
where the network has already died.**

Satellites observe hazards across whole countries. Agencies turn those observations into
intelligence. But there is a physical gap between that intelligence and the person who walks or
boats into the affected area — no network, no local knowledge, no way to reach anything stored
elsewhere. Prohori closes that gap in both directions: intelligence goes *in* as a portable pack,
and the field operator's own observations come *back out*.

"Prohori" (প্রহরী) is Bengali for *sentinel*. The satellite is the sentinel above; this is the
sentinel on the ground.

The product has exactly three functions. There is no fourth.

| | |
|---|---|
| **1. Flood layer** | Real Sentinel-1 radar turned into a flood layer that carries its own sensor, dates and limitations |
| **2. One pack file** | That layer plus terrain, roads, waterways and shelters in a single portable file |
| **3. Field view** | The instrument: where am I, which routes are under water, where is the nearest shelter — and two one-tap field reports going the other way |

---

## What is real in this build

Everything below came out of the pipeline in this folder. None of it is placeholder data.

- **Sensor:** Sentinel-1 C-band VH, RTC (radiometrically terrain-corrected) gamma-0, 10 m, read
  through the Microsoft Planetary Computer STAC catalogue. **No account is needed** — the catalogue
  is open and asset URLs are signed anonymously, so anyone can reproduce this run on a clean
  machine.
- **Event:** Feni district, the August 2024 Bangladesh floods. Rain began 19 Aug; the flood reached
  Feni on 21 Aug; the Gumti peaked on 23 Aug at 8.58 m, 53 cm above danger level; Feni recorded the
  highest district death toll (28).
- **Passes:** relative orbit 114 ascending — **9 Aug 2024** (baseline) against **21 Aug 2024**
  (flood). Same track, same viewing geometry, twelve days apart.
- **Result:** **21.7 km² of new open water in 1,159 patches**, 2.3% of the 929 km² district,
  threshold 1.25.
- **By upazila:** Fulgazi 5.1 km² (4.9%), Parashuram 4.4 km² (4.4%), Chhagalnaiya 5.1 km² (3.8%),
  Feni Sadar 4.1 km² (1.9%), Sonagazi 2.5 km² (1.1%), Daganbhuiyan 0.5 km² (0.4%).
- **Pack:** one file, 6.7 MB — the flood layer, a Sentinel-2 photograph of the district
  (17 Dec 2023, 20 m), the two radar passes as pictures, 2,293 road lines (51 crossing detected
  water), 927 waterway lines, 86 named places (29 from OpenStreetMap, 57 villages from GeoNames),
  278 shelter points (169 mosques, 73 schools, 36 hospitals and clinics), terrain 0–141 m, and six
  upazila outlines — with Bangla and English names wherever the map has them.

### The sanity check, stated honestly

Reported flooded area for this event is about **201 km²** (press reporting; its own observation
date and method are not stated). We detect **21.7 km², about 11% of that**.

**The pattern matches the event.** The flash flood came off the Tripura hills into the north of the
district, and the three northern upazilas — Fulgazi, Parashuram, Chhagalnaiya — are exactly the
three with the most water in our result. Daganbhuiyan, furthest from that path, has the least.

**The magnitude does not match, for two stated reasons.** The 21 August pass caught the flood on
the day it *arrived*, two days before the river peak. And radar-dark detection finds open water
only, so flooded villages and flooded cropland are missed.

**No accuracy figure is claimed.** No validated flood map exists for this event, so there is
nothing to measure against. This is a qualitative plausibility check, not a score.

### The limitation that shapes the whole product

Dark-pixel detection finds **open water**: calm, smooth surfaces that reflect radar away from the
satellite. Where water stands among rice stems, trees or houses, the pulse bounces off the water
and then off the stem or wall and straight back — *double bounce* — so those places look
**brighter**, not darker, and this method misses them. The area reported is a lower bound, and it
under-counts exactly where people live.

That is not a bug to be patched with a model. It is why function 3 exists: the responder standing
in the water can record what the satellite could not see. The code comment stating this sits
directly above the thresholding operation in `../sar-flood/s1_flood.py`, and the same text travels
in the pack and appears in the instrument's Source panel.

---

## Install

Python 3.12 with geopandas, rasterio, numpy, matplotlib and shapely (see
`../sar-flood/requirements.txt`), plus Node.js for the local server.

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r ../sar-flood/requirements.txt
```

On Windows keep the virtual environment on a short path: the 260-character limit breaks `pip`
inside deep folders.

## Prepare a pack (needs a network — the only part that does)

```bash
python ../sar-flood/s1_flood.py       # Sentinel-1 flood layer + provenance   (~10 min)
python pipeline/fetch_context.py      # roads, rivers, places, shelters (OSM)  (~15 s)
python pipeline/fetch_imagery.py      # Sentinel-2 photo + the radar pictures  (~1 min)
python pipeline/build_pack.py         # one pack file + the pack index         (~1 min)
```

No accounts, no API keys and no logins anywhere in that chain.

## Run the field view

```bash
node serve.mjs                        # then open http://localhost:8767/app/
```

Tap **Download this pack** and it is stored on the device.

## Prove the offline claim

1. Open the app and download the pack.
2. Stop the server (Ctrl+C), or put the phone in airplane mode.
3. Reload the page.

The instrument opens straight into the map with no network: the shell comes from the service
worker and the pack from the device's own store. Verified in this build with the server stopped —
the startup reported `loaded from: this device (offline store)`, drew all 1,159 flood patches and
kept both field reports. The service worker itself still needs checking in Chrome: the embedded
browser used during development refuses to register one.

## Hand a pack to another team

Copy `packs/feni-2024-08-21.pack.json` to the other device by any means — cable, Bluetooth, memory
card, message — then use **"Or open a pack file handed to you by another team"**. No internet is
involved at any point.

---

## Files

```
prohori/
  pipeline/fetch_context.py   roads, waterways, places, shelters from OpenStreetMap, both scripts
  pipeline/fetch_imagery.py   the Sentinel-2 photograph and the two radar pictures, one grid
  pipeline/build_pack.py      assembles ONE pack file: hazard + context + terrain + provenance
  pipeline/embed_pack.py      inlines a pack for a published build
  packs/                      the built packs, one file each, plus index.json
  context/                    the fetched OSM context and imagery, kept between pack builds
  app/                        the field instrument (index.html, app.js, sw.js, fonts/)
  serve.mjs                   local server for preparation and testing
../sar-flood/s1_flood.py      the Sentinel-1 pipeline that produces the flood layer
../sar-flood/nisar_flood.py   the NISAR L-band extension (see below)
```

## Three kinds of information, never merged

The instrument keeps these apart on screen, inside the pack and in the export:

- **Satellite observation** — the radar flood layer. Close up it is a silty wash multiplied into the
  photograph, so the fields and village trees show through it as they would through shallow
  floodwater; over that, a fine cyan hatch and a bright edge, the cartographer's sign for
  "measured, not drawn". Far out it is solid cyan, so the smallest patch still shows. Carries sensor, both dates, the pass time, method and limitations. Never
  described as ground truth. Roads crossing that water are *derived* from it, so they are drawn in
  the same cyan, as dashes.
- **Geographic reference** — the Sentinel-2 photograph, terrain relief, roads (cream with a dark
  edge, highway numbers as shields), rivers (pale blue, named), villages and towns (named),
  upazila boundaries (white dashes), shelters (green squares with a roof).
- **Human field observation** — what the operator recorded, in the flag's red: circles (water
  here) and triangles (road cut). The operator's own position is a red ring round a white core.
  Stored separately and exported separately as GeoJSON marked `"source": "field observation"`.

Every one of those meanings is carried by shape as well as colour, so nothing on the map depends
on telling colours apart.

## Identity and design language

**A satellite instrument brought down to human scale.** The screen reads top to bottom like the
flag of Bangladesh, and like the two points of view it connects:

- **Orbit — the green band.** What the satellite saw, in the satellite's own voice: a key to the
  radar layer, and the pass as telemetry (`21 AUG 2024 · 18:04 UTC+6 · SENTINEL-1A · C-BAND SAR`).
- **Earth — the map.** The real piece of Bangladesh: Feni from Sentinel-2 on a clear dry-season
  morning (17 Dec 2023) — the Muhuri and Selonia rivers, the dark tree clusters of the village
  homesteads, the Tripura hills the flash flood came down from — with the district bright and
  everything outside it dimmed, a fine latitude/longitude grid, and the radar's water laid on top.
- **Ground — the red bar.** What the person standing there records. The largest things to touch.

The two views meet in the readout. The WATER slot always has two labelled lines: **ORBIT** (what
the radar saw) and **GROUND** (what has been recorded there — a count of nearby reports, "nothing
recorded here yet", or, on a spot the radar called dry, the radar's blind spot and an invitation to
record what you see).

- **See the flood arrive.** The Radar button swaps the photograph for the two radar passes the
  flood layer was computed from — 9 Aug on one side of a line, 21 Aug on the other. Drag the line
  and watch the water appear. That is the evidence behind the layer, shown as the satellite
  recorded it. Pinch to zoom anywhere.
- **Two native languages.** English and বাংলা are written separately, not translated word for
  word, and the switch is always on screen. Bangla uses Bangla numerals, Bangladeshi usage (পানি)
  and local time words (সন্ধ্যা ৬:০৪); scientific names — Sentinel-1, C-band — stay as the world
  writes them. Place names come from OpenStreetMap in whichever script was mapped, and are never
  transliterated by the app. A phone set to Bangla opens in Bangla.
- **Real places.** Villages come from OpenStreetMap and GeoNames. GeoNames positions rounded to the
  nearest arc-minute (up to a kilometre off) are dropped rather than drawn in the wrong place.
  Close up, rivers are the real rivers in the photograph; the drawn line steps back.
- **Installable.** Served from `serve.mjs` (or any web host), the instrument can be added to a
  phone's home screen: its own icon — the flag's disc crossed by an orbit — and full screen.
- **One typeface for both scripts.** Anek Bangla, designed for Bangla and Latin together, stored
  with the app so it works offline.
- **Light and dark, one tap.** The switch changes the instrument's surfaces only; the Earth, the
  radar and the meaning of every mark are identical in both. It follows the phone's setting until
  the operator chooses.
- **The flag's colours are the primary colours.** Flag green `#006a4e` for the orbit band and
  everything geographic; flag red `#f42a41` for the ground and the operator. Radar cyan is the
  one colour added, and it belongs to the satellite alone.
- **Measured contrast.** Body text 15:1 or better in both modes, dim text 7.6:1+, coloured text
  7.3:1+, labels on the flag green 6.6:1, report buttons 6.7:1.
- **No animation, but never silent.** Nothing fades or slides. Each report shows a persistent
  confirmation with UNDO directly above the report buttons, says whether it went to the GPS
  position or the crosshair, updates the count on its button and buzzes where the phone supports
  it. Deleting all reports takes two separate taps; a double tap does not count.
- **The first glance carries the job.** The instrument opens on the biggest body of water the radar
  found, reticle on it, so the first things read are "Flood water seen from orbit" and "Radar saw
  water here".
- **One screen.** Panels stop at 45% height; the readout stays at the top; the confirmation sits
  by the thumb. Checked on phones down to 320 × 568 in both languages: the reticle stays clear.
- **The connectivity chip tells the truth.** ONLINE only when the network actually answers, NO
  LINK when the radio is on but nothing answers, OFFLINE when the radio is off — shown bright, as
  the instrument's normal working state, not as an error.

Shelter points are reference locations from OpenStreetMap, not a verified shelter registry. A road
flagged as crossing detected water is not a claim that it is impassable, and an unflagged road is
not confirmed open.

## Hazard is data, not identity

`"hazard": {"type": "flood"}` is a field in the pack. An erosion, cyclone or landslide pack would
use the same format, the same loader, the same field-report mechanism and the same instrument, with
a different hazard type and a different sensor recorded in the observation block. Flood is the one
hazard implemented completely, and it is implemented completely on purpose.

## NISAR

NISAR is the intended direction for this product — L-band sees differently, and its revisit adds
observations Sentinel-1 cannot supply alone. `../sar-flood/nisar_flood.py` is a **real** working
pipeline: it has been run against real NISAR L2 GCOV granules (south Chattogram, 12 July 2026,
19.9 GB of files streamed down to the district window). It is an **extension**, clearly labelled,
and the demonstration above does not depend on it. The sensor name is metadata in the pack, so the
same instrument displays either source without a line of code changing.

## Attribution

- Sentinel-1 data: ESA Copernicus; RTC product via the Microsoft Planetary Computer.
- Sentinel-2 photograph (17 Dec 2023): ESA Copernicus; L2A true colour via the Microsoft Planetary
  Computer.
- Terrain: Copernicus DEM GLO-30 (ESA / Airbus).
- Permanent water mask: JRC Global Surface Water v1.4 (European Commission JRC).
- Roads, waterways, place names, shelter points: © OpenStreetMap contributors, ODbL.
- Village names: GeoNames (geonames.org), CC BY 4.0.
- Typeface: Anek Bangla by Ek Type, SIL Open Font License (`app/fonts/OFL.txt`).
- Method: UN-SPIDER Recommended Practice for SAR flood mapping.
