# Ingito — last-mile disaster intelligence

**NASA radar shows where the water is. We get that map to the teams who need it, in the places
where the network has already died.**

Satellites observe hazards across whole countries. Agencies turn those observations into
intelligence. But there is a physical gap between that intelligence and the person who walks or
boats into the affected area — no network, no local knowledge, no way to reach anything stored
elsewhere. Ingito closes that gap in both directions: intelligence goes *in* as a portable pack,
and the field operator's own observations come *back out*.

"Ingito" (ইঙ্গিত) is Bangla for *a sign*: the signal that tells you what is happening and which way
to go. The satellite gives the first sign of where the water is; the person standing in it sends
the next one back.

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
ingito/
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

## Four layers of information, never merged

Everything in the instrument follows one journey — **Earth → Signal → Insight → Action** — and each
layer looks different on the map without a legend. Every meaning is carried by shape as well as
colour, so nothing depends on telling colours apart.

- **Earth — the ground itself.** The Sentinel-2 photograph, terrain relief, roads (cream with a
  dark edge, highway numbers as shields), rivers (pale teal, named), villages and towns (named),
  upazila boundaries (white dashes), shelters (green squares with a roof).
- **Signal — measured from orbit.** The radar flood layer. Close up it is a teal wash multiplied
  into the photograph, so the fields and village trees show through it as they would through
  shallow floodwater; over that, a fine hatch and a hard bright-teal edge, the cartographer's sign
  for "measured, not drawn". Far out it is solid teal, so the smallest patch still shows. Carries
  sensor, both dates, the pass time, method and limitations. Never described as ground truth.
- **Insight — worked out from the signal.** Roads that cross that water, drawn as red dashes on a
  dark casing, and the per-upazila figures behind the Alerts and Area sheets.
- **Action — seen and recorded by people.** What the operator recorded: red circles (water here)
  and red triangles (road cut). Stored separately and exported separately as GeoJSON marked
  `"source": "field observation"`. The operator's own position is a river-green dot with a cream
  core in a white ring — never red, never solid, so it cannot be mistaken for a report.

## Identity and design language

**A satellite intelligence system brought down to human scale.** The map is the product; the
interface is placed on top of the geography or directly under it. The map itself is the real
piece of Bangladesh: Feni from Sentinel-2 on a clear dry-season morning (17 Dec 2023) — the Muhuri
and Selonia rivers, the dark tree clusters of the village homesteads, the Tripura hills the flash
flood came down from — with the district bright, everything outside it dimmed, and the radar's
water laid on top.

- **The mark.** A river running through its delta, the land either side, and the sun — traced
  from the locked logo into a 7 KB vector (`app/icon.svg`), so it stays sharp from the brand bar
  to the home-screen icon.
- **The palette has meanings.** River deep `#0b3d32` for the brand bar, primary surfaces and
  trusted ground; river green `#1e7d6b` for active states; floodplain `#a7c4b7` and delta sand
  `#eae6d9` for reading surfaces; bright signal teal for what the radar measured.
- **Red means attention, nothing else.** Sun red `#e63946` appears only where something deserves
  it: a road through the water, a person's report, a widespread-water alert, reports still waiting
  to be handed over. Never as decoration and never alone — every red mark has its own shape, every
  alert its own word.
- **One screen on a phone.** A thin brand bar carrying the pass as telemetry
  (`21 AUG 2024 · 18:04 UTC+6 · SENTINEL-1A · C-BAND SAR`) and a connectivity chip that tells the
  truth; the map, with offline search, layers, the radar key and Before / After floating on it; one
  insight card; four ways in: Alerts, Area, Reports, Source.
- **The insight card** answers for the point under the reticle: where (upazila, nearest village,
  crosshair or GPS, coordinates); what the satellite saw and, beside it, what the ground has said;
  the nearest shelter outside the water the radar saw. Under it, the two report buttons, always one
  tap away. The instrument opens on the biggest body of water the radar found, so the card's first
  answer is "Radar saw water here".
- **Alerts** say, for each upazila, what happened, where, when, why it matters and what to do.
  Severity is a word first — widespread (3% or more of the upazila under open water), patchy
  (1–3%), little (under 1%) — and a bar second. The thresholds are stated on screen, and the sheet
  says plainly that it is not a forecast.
- **Area** is an intelligence brief about a real place: upazila, district, division and
  coordinates; an overview; the change between the two radar passes with both pictures side by
  side; then — folded away until asked for — the signal's details and what stands on the ground
  there; then what to do next.
- **See the flood arrive.** Before / After swaps the photograph for the two radar passes the flood
  layer was computed from; the line opens from the edge to the middle, and dragging it shows the
  water appear. Pinch to zoom anywhere.
- **Search works offline.** Every name in the pack — upazilas, towns, villages, rivers, named
  shelters — in both scripts. Choosing one glides the map there.
- **Two native languages.** English and বাংলা are written separately, not translated word for
  word, and the switch is always on screen. Bangla uses Bangla numerals, Bangladeshi usage (পানি)
  and local time words (সন্ধ্যা ৬:০৪); scientific names — Sentinel-1, SAR — stay as the world
  writes them. Place names are never transliterated by the app. A phone set to Bangla opens in
  Bangla.
- **Real places.** Villages come from OpenStreetMap and GeoNames. GeoNames positions rounded to the
  nearest arc-minute (up to a kilometre off) are dropped rather than drawn in the wrong place.
- **Two typefaces.** Inter for Latin, Hind Siliguri for Bangla, both stored with the app so they
  work offline. The brand name is always written ইঙ্গিত.
- **Light and dark, one tap.** Warm off-white and cream by day, deep river green by night; the
  Earth, the radar and the meaning of every mark are identical in both.
- **Measured contrast.** Body text 12:1 or better in both modes, dim text 6:1+, teal and red text
  6.2:1+, report buttons 10.7:1 (light) and 8.2:1 (dark).
- **Motion only where it explains** — a sheet rising, the before/after line opening, the map
  gliding to a chosen place — and none of it when the phone asks for reduced motion.
- **Never silent.** Each report shows a persistent confirmation with UNDO by the thumb, says
  whether it went to the GPS position or the crosshair, updates the count on its button and buzzes
  where the phone supports it. Deleting all reports takes two separate taps.
- **Honest about what is stored.** The Reports sheet says reports stay on this phone until they
  are exported; the Source sheet says whether the pack works offline and how old the observation
  is. The connectivity chip shows OFFLINE bright, as the normal working state, not as an error.
- **Installable**, with its own icon, and **checked at every size**: 320 × 568, 360 × 740,
  375 × 812 and 1280 × 780, in both languages and both modes. On a wide screen the card and
  sheets move into a column beside the map.

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
- Typefaces: Inter by Rasmus Andersson and Hind Siliguri by Indian Type Foundry, both under the
  SIL Open Font License (`app/fonts/OFL-Inter.txt`, `app/fonts/OFL-HindSiliguri.txt`).
- Method: UN-SPIDER Recommended Practice for SAR flood mapping.
