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
- **Pack:** one file, 3.2 MB — the flood layer, 2,293 road lines (51 crossing detected water),
  927 waterway lines, 278 shelter points (169 mosques, 73 schools, 36 hospitals and clinics),
  terrain 0–141 m, and six upazila outlines.

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
python pipeline/fetch_context.py      # roads, waterways, shelters from OSM    (~15 s)
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
  pipeline/fetch_context.py   roads, waterways, shelters from OpenStreetMap
  pipeline/build_pack.py      assembles ONE pack file: hazard + context + terrain + provenance
  pipeline/embed_pack.py      inlines a pack for a published build
  packs/                      the built packs, one file each, plus index.json
  context/                    the fetched OSM context, kept between pack builds
  app/                        the field instrument (index.html, app.js, sw.js)
  serve.mjs                   local server for preparation and testing
../sar-flood/s1_flood.py      the Sentinel-1 pipeline that produces the flood layer
../sar-flood/nisar_flood.py   the NISAR L-band extension (see below)
```

## Three kinds of information, never merged

The instrument keeps these apart on screen, inside the pack and in the export:

- **Satellite observation** — the radar flood layer. Blue. Carries sensor, both dates, method and
  limitations. Never described as ground truth.
- **Geographic reference** — terrain, roads, waterways, shelters. Black lines, slate rivers, grey
  dashed boundaries, green squares.
- **Human field observation** — what the operator recorded. Magenta circles (water here) and
  triangles (road cut). Stored separately and exported separately as GeoJSON marked
  `"source": "field observation"`.

Every one of those meanings is carried by shape as well as colour, so nothing on the map depends
on telling colours apart. Roads crossing detected water are a *derived* product, so they are drawn
as a dashed casing, never in the satellite's blue.

## Design language

One screen, high contrast, no animation, readable in sunlight — and at night.

- **Day:** black on white. **Night:** amber on black with no white anywhere, because a bright
  screen at night destroys dark adaptation and turns the phone into a lamp. Every text pair was
  measured: day body text 10.9:1, report buttons 7.0:1, night text 11.5:1.
- **No animation is not no feedback.** Each report shows a persistent confirmation with an UNDO
  button, updates the count printed on its button, and buzzes where the phone supports it. Any
  single report can be deleted; deleting all of them takes two taps.
- **The readout is three fixed slots** — WHERE, WATER, SHELTER — that never move. The radar's
  limitation appears in the WATER slot exactly when it matters: on a spot the radar called dry.
- **Panels stop at 45% height,** so the crosshair and the readout are never covered.
- **Clutter scales with zoom.** Village roads and streams appear only when zoomed in; the flood
  layer, main roads, rivers, wet roads and shelters are always shown.
- **Text sizes are in rem,** so a reader's own enlarged-text setting is respected.
- **The connectivity chip tells the truth.** A radio being on is not a working link, so the
  instrument asks the network for something every 20 seconds: ONLINE only when an answer comes
  back, NO LINK when the radio is on but nothing answers, OFFLINE when the radio is off.

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
- Terrain: Copernicus DEM GLO-30 (ESA / Airbus).
- Permanent water mask: JRC Global Surface Water v1.4 (European Commission JRC).
- Roads, waterways, shelter points: © OpenStreetMap contributors, ODbL.
- Method: UN-SPIDER Recommended Practice for SAR flood mapping.
