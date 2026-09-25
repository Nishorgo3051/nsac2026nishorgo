> **How to use:** paste everything below the line into a coding agent (Claude Code, Codex or
> similar) opened in an empty folder. Give it the locked logo image, a computer with Python 3.12,
> Node.js and internet (the satellite data steps take about 15 minutes), and have a Bangla reader
> check the Bangla text at the end. This prompt describes the project; it contains no code from it.
>
> This is the **48-hour event build**. Everything planned for after the hackathon (Flutter apps,
> GeoPackage, a pack builder for any area, phone-to-phone transfer, photo reports) is in
> `the vision.md`, and is deliberately left out here.

---

# Build "Ingito (ইঙ্গিত)" — an offline satellite flood map for last-mile responders

Build this complete, working project from this specification alone. Build from scratch; do not copy
code from anywhere. Follow the spec exactly. Where it is silent, choose the simplest thing that works
and tell me what you chose. After each build step, run it and show proof before moving on.

## 0. Ground rules (non-negotiable)
- REAL DATA ONLY. Every number on screen comes from a pipeline run. No mock, placeholder or invented
  data, and no invented accuracy figures.
- Exactly three functions (section 1). No AI features, no dashboard, no login/accounts, no analytics,
  no other hazards, no second mode.
- Truly offline after one download: no map library, no CDN, no map tiles, no network fonts, no
  external services inside the app.
- No API keys or logins anywhere in the Sentinel-1 pipeline; every source below is open and
  anonymous. (Only the optional NISAR path in 3.1 needs a free NASA Earthdata login, kept in the
  user's own credentials file, never in the code or the repo.)
- The field app is a LOCAL application that works against a pack file, not a networked app with
  caching added afterwards. Only two things ever come from the network: the pack list and the pack
  download. Keep "from the network" and "from the pack" separate and obvious in the code.
- No demonstration place is hard-coded. The area, dates and sensor come from one config file per
  area (section 3.0); Feni is simply the first config.
- The name is "Ingito" in Latin script and "ইঙ্গিত" in Bangla, always spelled exactly ইঙ্গিত.
- Honesty about the radar's limits is part of the product (section 7).
- LF line endings. On Windows, write text files from Python with `newline="\n"`.

## 1. The product
Pitch: satellite radar shows where the water is; Ingito gets that map to the teams who need it, in
places where the network has already died. "Ingito" is Bangla for "a sign".

Ingito is an offline, satellite-derived geographic intelligence instrument for people entering
places where the routes and flood conditions are not known and the network cannot be relied on. It
is deliberately narrower than a disaster-management platform. This build is flood-first; the same
pack and field view are meant to carry other hazards later (erosion, cyclones, landslides).

Three functions, no fourth:
1. **FLOOD LAYER:** real Sentinel-1 radar turned into a flood layer that carries its own sensor,
   dates and limitations.
2. **ONE PACK FILE:** that layer plus a satellite photo, the two radar pictures, terrain, roads,
   waterways, places, shelters and upazila outlines, in ONE portable JSON file that can be handed to
   another team by cable, Bluetooth or memory card.
3. **FIELD VIEW:** an installable phone web app that answers "where am I, which routes are under
   water, where is the nearest shelter", plus two one-tap field reports going the other way
   ("Water here", "Road cut"), exported as GeoJSON.

Event: Feni district, Bangladesh, August 2024 floods. Rain began 19 Aug 2024; the flood reached Feni
on 21 Aug; the Gumti peaked on 23 Aug at 8.58 m (53 cm above danger level); Feni had the highest
district death toll (28). Reported flooded area: 201 km² (press reporting; its own date and method
are not stated).

One information journey everywhere: EARTH (the ground) → SIGNAL (measured from orbit) → INSIGHT
(worked out from the signal) → ACTION (what people record and do).

## 2. Stack and layout
Pipeline: Python 3.12 with geopandas, rasterio, shapely, numpy, Pillow, matplotlib.
Local server: Node.js, built-in modules only.
App: plain HTML/CSS/JS, classic scripts, no framework, no build step.

```
areas/
  feni-2024-08.json            one config per area: outlines, names, sensor, dates (section 3.0)
sar-flood/
  aoi/feni.geojson             district outline
  aoi/feni_upazilas.geojson    6 upazilas; properties adm3_name, area_sqkm
  ingest_s1.py                 Sentinel-1: scenes → the grid, in dB (sensor-specific)
  detect.py                    masks, speckle, ratio, threshold, clean, polygons (shared)
  s1_flood.py                  runs ingest_s1 + detect for one area config
  METHODOLOGY.md               the method and the validation record for each event
  requirements.txt
  out/                         outputs (gitignored)
ingito/
  PACK_FORMAT.md               every key of the pack, its version and the compatibility rules
  pipeline/fetch_context.py    OpenStreetMap + GeoNames context
  pipeline/fetch_imagery.py    Sentinel-2 photo + radar pictures
  pipeline/build_pack.py       assembles the one pack file + packs/index.json
  pipeline/embed_pack.py       inlines the pack for a single-page published build
  context/                     fetched context and imagery (kept between builds)
  packs/                       <pack_id>.pack.json + index.json
  app/                         index.html, app.js, sw.js, manifest.webmanifest, icons, fonts/
  serve.mjs                    local server
  README.md                    what is real, how to run, the limitations
```

Boundaries: Bangladesh admin boundaries from HDX (OCHA COD-AB, admin level 3). Feni district is the
union of its 6 upazilas (about 929.5 km²): Chhagalnaiya, Daganbhuiyan, Feni Sadar, Fulgazi,
Parashuram, Sonagazi.

## 3. Data pipeline (the only part that needs a network)
Run order: `s1_flood.py` → `fetch_context.py` → `fetch_imagery.py` → `build_pack.py`
(→ `embed_pack.py` only for a published single page).

### 3.0 One config per area
Every pipeline script takes `--area areas/<id>.json` and reads nothing place-specific from its own
code. The Feni config holds: id `feni-2024-08`; name "Feni district flood" / "ফেনী জেলার বন্যা";
the outline and upazila files; the admin block (district, division, both languages); the upazila
Bangla names and the fixed list of known name spellings (3.4); the sensor (`sentinel-1`); baseline
and flood dates, track and direction (3.1); the Sentinel-2 scene (3.3); and the event facts
(section 1). A new area is a new config file, not a code change.

### 3.1 s1_flood.py: the flood layer (UN-SPIDER recommended practice, computed locally)
Split the work in two so the sensor is a replaceable part:
- `ingest_s1.py` (sensor-specific): finds and reads the scenes onto the grid, in dB.
- `detect.py` (shared): masks, speckle, ratio, threshold, cleaning, polygons, per-upazila figures.

A later sensor then only needs a new ingest step.

OPTIONAL, only if time allows and only after a cross-check: NISAR (NASA-ISRO L-band) is the
preferred NASA sensor. A NISAR ingest reads L2 GCOV granules (HH, gamma-0 linear power → dB) from
ASF, reading only the area's chunks, and needs a free NASA Earthdata login. Tested target: south
Chattogram (Satkania, Lohagara, Chandanaish, Banshkhali), track 69 ascending, baseline 30 Jun 2026,
flood 12 Jul 2026. Before a NISAR pack is shown to anyone, run the Sentinel-1 path on the same area
and dates and write down where they agree and disagree. Label a layer "NISAR" only when it is NISAR
data. Never produce a synthetic "NISAR-like" result.
Source: Microsoft Planetary Computer STAC, collection `sentinel-1-rtc` (RTC gamma-0, 10 m, already
in UTM). POST `https://planetarycomputer.microsoft.com/api/stac/v1/search` with the district bbox and
a one-day datetime range. Sign each asset URL anonymously just before reading it:
`https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=<url-encoded href>`. Send a
descriptive User-Agent.

Settings: baseline 2024-08-09, flood 2024-08-21, relative orbit 114, ascending, polarisation VH.
Keep only items with `sat:orbit_state == "ascending"` and `sat:relative_orbit == 114`. Stop with a
clear error if there are none.
Expected scenes: `S1A_IW_GRDH_1SDV_20240809T120441` (baseline), `S1A_IW_GRDH_1SDV_20240821T120442`
(flood).

Steps:
1. Grid: 20 m pixels in the district's UTM zone (`estimate_utm_crs`), covering the district bounds.
2. Read only the district window from each scene (GDAL `/vsicurl`,
   `GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR`). Request `out_shape` at 20 m so overview levels are
   used, and scale the window transform to match the decimated read. Treat values <= 0 as no data.
   Reproject onto the grid with `Resampling.average` IN LINEAR POWER, mosaic the scenes, and only
   then convert to dB (10·log10). Never average dB values.
3. Masks, from open data with no login:
   - Permanent water: JRC Global Surface Water v1.4 "occurrence" tiles, 10° tiles named by their
     top-left corner:
     `https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_{lon}_{lat}v1_4_2021.tif`
     (for example `occurrence_90E_30Nv1_4_2021.tif`). Resample with max. Occurrence > 50 =
     permanent; 255 (never observed) = dry.
   - Steep ground: slope >= 5° from Copernicus DEM GLO-30 COG tiles, one per degree:
     `https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_N22_00_E091_00_DEM/Copernicus_DSM_COG_10_N22_00_E091_00_DEM.tif`.
     Average the terrain to 90 m BEFORE measuring slope: a surface model makes tree lines look like
     cliffs at 20 m. Resample the slope back to 20 m with bilinear.
   - Inside the district outline.

   usable = not permanent AND not steep AND inside. Warn if less than 95% of the district has data
   on both dates.
4. Speckle: NaN-aware focal median over a circle of radius 50 m (2.5 px).
5. Change ratio = during_dB / before_dB. Both are negative, so a ratio above 1 means the ground got
   darker. Set unusable pixels to NaN.
6. Threshold: Otsu on a 300-bin histogram over 0.5–3.0. If Otsu gives a value outside the plausible
   range 1.1–2.0, fall back to the UN-SPIDER default 1.25 and record why.
   `flooded = ratio > threshold`. Put a prominent comment above this line explaining double bounce
   (section 7).
7. Clean: 3×3 morphological opening, then a rasterio sieve that drops patches under 8 pixels
   (8-connectivity).
8. Polygonize (`rasterio.features.shapes`) to EPSG:4326. Measure area_km2 in UTM. Sort largest first.
9. Per upazila: intersect with the upazila polygons in EPSG:32646. For each upazila record name,
   flood_km2, upazila_km2 and share_pct, sorted by share.

Outputs in `out/`:
- `Feni_s1_flood_2024-08-21.geojson` (the flood polygons)
- a `.json` with the same stem (provenance)
- `_mask`, `_before` and `_during` `.tif` files (the before/during ones are the smoothed dB images)
- a `.png` figure: before / during / detected

Provenance JSON keys:
- hazard `"flood"`, aoi_name
- sensor `"Sentinel-1"`, sensor_detail `"Sentinel-1 C-band VH, RTC gamma-0"`, product, source
- scene_ids `{baseline: [...], flood: [...]}`, baseline_date, acquisition_date, track, direction,
  polarization, grid_m
- threshold, threshold_method, processed_on
- detects `"open_water_only"`, method (one sentence), limitations (double bounce; the area is a lower
  bound)
- not_ground_truth: "A satellite observation, not ground truth. No validated flood map exists for
  this event, so no accuracy figure is claimed."
- event `{name, rain_began, flood_arrived, river_peak, deaths_in_district,
  reported_flooded_km2: 201, reported_source}`
- totals `{flood_km2, patches, aoi_km2, data_coverage_pct}`
- by_upazila `[...]`

**EXPECTED RESULT, check against it:**
- Otsu returns 1.05, which is rejected, so the threshold is 1.25.
- 21.7 km² of new open water in 1,159 patches, 2.3% of 929 km². Largest patch 0.9 km².
- Masked out: 0.9% permanent water, 0.0% steep.
- By upazila: Fulgazi 5.1 km² (4.9%), Parashuram 4.4 (4.4%), Chhagalnaiya 5.1 (3.8%),
  Feni Sadar 4.1 (1.9%), Sonagazi 2.5 (1.1%), Daganbhuiyan 0.5 (0.4%).

### 3.2 fetch_context.py: roads, waterways, places, shelters
One Overpass query (POST `https://overpass-api.de/api/interpreter`, identifying User-Agent,
`out geom;`) over the district bbox:

```
way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified)$"]
way[waterway~"^(river|stream|canal|drain)$"]
nwr[amenity=school]; nwr[amenity=place_of_worship][religion=muslim]; nwr[amenity~"^(hospital|clinic)$"]
node[place~"^(city|town|suburb|village|hamlet)$"]
```

Round coordinates to 5 decimals.

Record shapes:
- roads `{kind, coords, name?, name_bn?, ref?}`
- waterways `{kind, coords, name?, name_bn?}`
- places `{kind, lon, lat, name?, name_bn?}` (named only)
- shelters `{kind: school|mosque|hospital|clinic, lon, lat, name?, name_bn?}`. Keep unnamed
  shelters. For a polygon, use the mean of its outline points.

Names:
- If the plain `name` tag contains Bangla script (U+0980–U+09FF), it is the Bangla name; otherwise
  it is the English name.
- `name:bn` and `name:en` override it.
- Never transliterate. Omit empty keys.

Villages from GeoNames (`https://download.geonames.org/export/dump/BD.zip`; cache it locally and keep
it out of git): feature class P inside the bbox. Drop an entry when:
- its lat AND lon both sit exactly on a whole arc-minute (old gazetteer rounding, up to 1 km off)
- it is within 2,500 m of an OSM city, 2,000 m of a town, or 800 m of any other OSM place
- it is within 500 m of a GeoNames village already kept

Take a Bangla name only from the alternate names written in Bangla script.

Output `context/feni_context.json`:
- aoi_name, fetched_on, roads, waterways, shelters, places
- attribution: "Roads, waterways, place names and shelter points: OpenStreetMap contributors, ODbL.
  Village names: GeoNames, CC BY 4.0"
- note: shelters are reference points, not a verified registry; no guarantee they are open, dry or
  reachable.

Reference counts (OSM changes over time, so expect small differences):
- 2,293 roads, 927 waterways
- 86 places (29 from OSM, 57 from GeoNames)
- 278 shelters (169 mosques, 73 schools, 36 hospitals and clinics)

### 3.3 fetch_imagery.py: the pictures
One plain lon/lat grid over the district bounds padded by 0.012°, with about 20 m pixels:
dlat = 20/110540, dlon = 20/(111320·cos(mid-latitude)).
- **optical.jpg:** Sentinel-2 L2A true colour (`visual` asset) of scene
  `S2A_MSIL2A_20231217T043151_R133_T46QCL_20231220T054932` (17 Dec 2023, 0.04% cloud), from the
  Planetary Computer item at `.../api/stac/v1/collections/sentinel-2-l2a/items/<id>` (signed as
  above). Window read at 20 m, reprojected bilinear onto the grid.
  Colour grade: stretch each band between its 1st and 99.5th percentile; gamma 0.72/0.72/0.82
  (R/G/B); saturation ×0.9. Save as JPEG, quality 80, progressive.
  This is a DRY-SEASON picture of the landscape, NOT of the flood, and the app says so.
- **radar_before.jpg** and **radar_during.jpg:** the smoothed dB tifs from `s1_flood.py`,
  reprojected bilinear onto the grid, clipped to −24…−7 dB, scaled ^0.9 to 0–255 grey. JPEG
  quality 74.
- **imagery.json:**
  - bounds, grid_m
  - optical `{file, date, time_utc, sensor "Sentinel-2A MSI", product "L2A true colour (TCI)",
    scene, cloud_cover, source, note}`
  - radar `{before {file, date}, during {file, date}, sensor, display_db, note}`

### 3.4 build_pack.py: ONE file
Read the latest `out/Feni_s1_flood_*.geojson` and its `.json`, plus the context, the imagery and the
upazila outlines. Refuse to run if the flood layer is missing: a pack may never contain an invented
layer.
- **Wet roads:** spatial join (intersects) of road lines × flood polygons, setting `road.wet` to true
  or false. Record `roads_crossing_water` (51 in the reference build) and `roads_note`: a flag does
  not mean impassable; an unflagged road is not confirmed open; radar cannot see water under trees or
  between buildings and knows nothing about depth or current.
- **Fill a missing spelling ONLY from the fixed list in the area config.** For Feni:
  Feni ফেনী, Daganbhuiyan দাগনভূঁইয়া, Parshuram পরশুরাম, Chhagalnaiya ছাগলনাইয়া, Fulgazi ফুলগাজী,
  Sonagazi সোনাগাজী, Basurhat বসুরহাট, Mirsarai মীরসরাই, Chauddagram চৌদ্দগ্রাম,
  Muhuriganj মুহুরীগঞ্জ, Baraiyarhat বারৈয়ারহাট, Muhuri River মুহুরী নদী,
  Selonia River সিলোনিয়া নদী, Kahua River কহুয়া নদী, Dakatia River ডাকাতিয়া নদী,
  Feni River ফেনী নদী.
  Upazila Bangla names: Feni Sadar ফেনী সদর, Fulgazi ফুলগাজী, Parashuram পরশুরাম,
  Chhagalnaiya ছাগলনাইয়া, Sonagazi সোনাগাজী, Daganbhuiyan দাগনভূঞা.
- **Terrain:** Copernicus DEM window reads → UTM 30 m grid → hillshade (azimuth 315°, altitude 45°)
  → reproject to lon/lat → greyscale JPEG (quality 80) as a data URI. Store elevation min/max
  (0–141 m), source, method, and limitations ("a surface model ... it is not a flood model").
- **Flood features:** outer rings only (holes dropped; the areas were measured before this), stored
  as `[{km2, rings}]`. Add `platform` ("Sentinel-1A", read from the flood scene ID) and
  `acquisition_time_utc` ("12:04", read from the scene timestamp).
- Embed every image as a base64 data URI so the pack stays one file.

Pack format (compact JSON, about 6.7 MB). Top-level keys:
- `format`: `"ingito.pack/1"`
- `pack_id`: `"feni-2024-08-21"`
- `name`: `"Feni district flood"`, `name_bn`: `"ফেনী জেলার বন্যা"`
- `admin`: `{district: "Feni", district_bn: "ফেনী", division: "Chattogram", division_bn: "চট্টগ্রাম"}`
- `hazard`: `{type: "flood", label: "Flood - open water seen by radar"}`
- `built_on` (date), `built_at` (ISO time to the second)
- `coverage`: `{bbox, area_km2, places: [upazila names]}`
- `observation`: `{...the provenance, unchanged..., platform, acquisition_time_utc, features,
  feature_count}`
- `context`: `{...the context file..., roads_crossing_water, roads_note}`
- `terrain`: `{bounds, elevation_m, source, product, method, limitations, image}`
- `imagery`: `{bounds, grid_m, optical: {..., image}, radar: {before: {date, image},
  during: {date, image}, ...}}`
- `areas`: `[{name, name_bn, km2, rings}]`
- `usage`: a sentence saying the pack needs no network once it is on the device

Two more top-level keys make the pack a documented, lasting file rather than a disposable cache:
- `datasets`: one entry per layer (flood, optical, radar, terrain, roads, waterways, places,
  shelters, areas), with `{id, role: "required"|"optional", title, title_bn, source, licence, date}`.
  Record each licence as the source itself publishes it; check it at the source, never guess.
- `processing`: `{pipeline_version, area_config, run_on}`.

Compatibility: the app opens format `ingito.pack/1`. A pack with a higher major version shows "This
pack was made by a newer version of Ingito" and is not opened. When the format changes, older
versions are migrated in code, never thrown away. Document every key in `ingito/PACK_FORMAT.md`.

Integrity: after writing the pack, compute the SHA-256 of the file's bytes. Record it in the index,
with a short fingerprint made of the first 8 hex characters grouped 4-4 (e.g. `3F9A-12C4`).

Also write `packs/index.json` (pretty-printed, LF):
`{packs: [{file, pack_id, name, hazard, sensor, acquisition_date, area_km2, size_mb, sha256,
fingerprint}]}`.

The hazard is data, not identity. Nothing in the format or the app is flood-specific beyond the
pack's own content.

### 3.5 embed_pack.py
Writes `app/pack-embed.js` containing `window.INGITO_PACK = {...};` (gitignored), for a single-page
published build.

## 4. serve.mjs (Node built-ins only)
- Serve the `ingito/` folder on 127.0.0.1:8767 (`PORT` overrides); open http://localhost:8767/app/.
- A directory path serves index.html. A path that escapes the root gets 403.
- index.html has NO doctype and no `<head>` of its own, so the same file can also be published as a
  page. The server wraps it with `<!doctype html><html lang="en"><head>` containing: meta charset
  utf-8; meta viewport `width=device-width, initial-scale=1, viewport-fit=cover`; meta theme-color
  `#0b3d32`; the manifest link; icon.svg; apple-touch-icon icon-192.png — then
  `</head><body> ... </body></html>`.
- Headers:
  - Content-Type, including woff2, webmanifest and geojson
  - Content-Length (drives the download progress)
  - `Cache-Control: no-store`
  - `Service-Worker-Allowed: /`

## 5. The app (app/index.html + app/app.js + app/sw.js)
Vanilla JS, one `<canvas>` map drawn by hand. index.html loads `pack-embed.js` (a harmless 404
locally), then `app.js`.

### 5.1 Loading and storage
- Boot:
  - Load the reports.
  - Theme: the stored choice, else `prefers-color-scheme`.
  - Language: the stored choice, else `bn` if any `navigator.languages` entry starts with "bn",
    else `en`.
  - Start the connectivity probe and register `sw.js`.
- Where the pack comes from, in order:
  1. Cache Storage (cache `ingito-pack-v1`, key `/__ingito_pack__`), unless an embedded pack with
     the same pack_id has a newer built_at.
  2. packs/index.json (try `../packs/index.json`, then `packs/index.json`): show the GATE.
  3. If there is no pack list but there is an embedded pack, use it (and cache it).

  A corrupt stored pack falls through to the gate and never locks the user out.
- Gate (full screen, river-deep background):
  - logo; INGITO / ইঙ্গিত; title "Satellite flood map that works with no signal"; sub-line.
  - One card per pack: name, size in MB, "hazard · sensor date", km², and a "Download this pack"
    button.
  - The download streams with a byte counter, "downloading 1.4 of 6.7 MB (21%)", then shows
    "storing the pack on this device…".
  - "Or open a pack file handed to you by another team" (file input, .json).
  - Every pack, downloaded or imported, is untrusted input. Validate it COMPLETELY before storing
    it, and store it only if every check passes:
    - size limit: refuse files over 100 MB
    - it parses as JSON; `format` is `ingito.pack/<major>` and the major version is supported
    - required keys exist with the right types: flood features are `{km2: number, rings: [[lon,
      lat], ...]}`, and every coordinate is a finite number inside the coverage bbox plus a small
      margin
    - every image is a `data:image/jpeg;base64,` or `data:image/png;base64,` URI, nothing else
    - a downloaded pack's SHA-256 equals the `sha256` in the index
    - an imported file's fingerprint is computed and shown ("Pack fingerprint 3F9A-12C4"), so two
      people can compare it with the sender's Source screen. SHA-256 needs `crypto.subtle`, which
      browsers allow only on https or localhost; where it is missing, say "fingerprint not
      available in this browser" instead of skipping the check silently.

    A failed check shows in words what was wrong, and the pack already on the device stays exactly
    as it was. A bad file must never replace a good pack.
  - After storing a pack, call `navigator.storage.persist()`, and show in Source whether the browser
    granted persistent storage.
- Record where the pack came from and show it in Source:
  - "this device (offline store)"
  - "embedded in this page[, stored on this device]"
  - "downloaded, not stored locally"
  - "file: <name>[, stored on this device]"
- localStorage keys: `ingito.reports.v1`, `ingito.theme.v2`, `ingito.lang.v1`,
  `ingito.hint.radar.v1`. Wrap every access in try/catch (private browsing throws).

### 5.2 Service worker (sw.js)
- Cache `ingito-shell-vN`; bump N on every change to the shell files.
- Install: cache `./`, index.html, app.js, sw.js, the fonts, the manifest and the icons with
  `Promise.allSettled` (one missing file must not break the install), then `skipWaiting`.
- Activate: delete other `ingito-shell-*` caches, then `clients.claim`.
- Fetch (GET only):
  - Requests with `?probe=` go straight to the network. On failure, reply 504 with the header
    `X-Ingito-Offline: 1`.
  - Everything else: cache first (`ignoreSearch`), then the network, then a plain-text 504
    "Offline, and this file is not stored on the device." with the same header.
- The service worker does NOT cache the pack; the app does that itself.

### 5.3 Connectivity chip (must never lie)
- `navigator.onLine` false → "Offline".
- Otherwise fetch `location.pathname + "?probe=<time>"` (no-store, 4 s timeout):
  - a real answer → "Online"
  - an error, or the `X-Ingito-Offline` header → "No link"
- Re-probe every 20 s and on the online/offline events.
- "Offline" and "No link" are shown BRIGHT (a sand chip on the dark bar): offline is the normal
  working state, not an error.

### 5.4 The map
- Projection: equirectangular, longitude × cos(centre latitude).
  - View = `{lon, lat, ppd}` (device pixels per degree of latitude); ppd clamped to 200…400,000.
  - Canvas at devicePixelRatio. Zoom about a point (the pinch centre or the cursor).
- Opens ON the water: the largest flood patch, 6 km across the shorter side, with the reticle on the
  point nearest the patch's middle that is inside it (sample a 20×20 grid over the patch's box).
  With no flood, fit the whole bbox.
- Gestures:
  - one finger pans; two fingers pinch
  - in Before/After, a drag that starts within 30 px of the divider moves it (clamped to 3–97%)
  - lifting one pinch finger continues as a pan
  - mouse wheel zooms ×1.25
  - any touch cancels running animations
- Draw order:
  1. ground `#0a2a22`
  2. Sentinel-2 photo
  3. terrain hillshade, soft-light blend (alpha 0.55 over the photo, 0.9 without it)
  4. veil `rgba(3,22,17,0.6)` over everything outside the upazila outlines (even-odd fill)
  5. graticule: lines `rgba(255,255,255,.12)`; step = the first of 1′, 2′, 5′, 10′, 15′, 30′ that
     is at least 110 CSS px; labels like 23°02′N
  6. upazila boundaries: a dark underline (2.6 px, `rgba(0,0,0,.45)`) with white dashes (6/5, .78)
  7. waterways: river 2.6 px, canal 1.7, other 1.1; `rgba(150,214,201,.9)`, dropping to .3 alpha
     over the photo when zoomed in
  8. roads: cream `#eae6d9` on a dark casing `rgba(6,22,17,.85)`. Widths: motorway 4, trunk 3.6,
     primary 3.1, secondary 2.5, tertiary 2, unclassified 1.2 (no casing, .72 alpha)
  9. flood polygons (SIGNAL)
  10. wet roads (INSIGHT)
  11. shelters
  12. labels
  13. field reports (ACTION)
  14. the GPS position
  15. the Before/After divider
  16. the scale bar

  Line widths ×0.6 when zoomed out.
- Declutter by metres per CSS pixel (mpp):
  - minor roads (unclassified) and minor water (stream, drain) only when mpp < 25
  - flood hatch style when mpp < 30
  - shelter names when mpp < 6
  - shelters as 13 px squares with a roof when mpp <= 40, else 6 px squares
  - place labels only when mpp <= city/town 400, suburb/village 45, hamlet 14
  - upazila names (caps, tracked) only when mpp > 40
  - canal names only when mpp <= 20
- Flood (SIGNAL), the only bright teal on the map:
  - Close up: a wash `#58b3a4` MULTIPLIED into the photo (or `rgba(94,224,204,.3)` with no photo),
    then a fine 45° hatch `rgba(205,252,243,.72)` pinned to the ground so it moves with the map,
    then a hard edge `#7ef0dc` 1.4 px.
  - Far out: solid `rgba(94,224,204,.92)` with a 1 px edge, so tiny patches never vanish.
- Wet roads (INSIGHT): a dark casing `#1b0507` (road width + 4) under red dashes `#ff5361` (5/4).
- Shelters: river-green `#1e7d6b` rounded square with a white edge, plus a white roof glyph when
  near.
- Labels: halo `rgba(4,22,17,.88)` 3.5 px, white text.
  - Placed in priority order: upazilas, towns, rivers (pale `#d9f5ee`, at points actually on
    screen), highway shields for refs like N1 or R1xx (dark `#0b3d32` box, cream text and edge),
    other places, shelters.
  - A label that would overlap one already placed is skipped.
  - Bangla labels are ×1.08 size with no letter-spacing.
- Reports (ACTION), drawn last, red `#e63946` with a white edge: a circle with a wave glyph = water
  here; a triangle with a broken-road glyph = road cut.
- The operator (GPS): a river-deep `#0b3d32` dot (radius 10) with a white 3 px ring and a cream
  `#eae6d9` core (radius 4), plus a faint accuracy circle. Never red and never solid, so it can't be
  mistaken for a report.
- Reticle: a CSS overlay (46 px) with four white ticks around an open centre and a tiny dot.
- Scale bar: bottom-left; the largest of 100 m … 50 km that fits in 120 px. Beside it, a small
  north arrow marked "N" (the map is always north-up and never rotates).
- Flood opacity: the Layers row "Water seen by radar" has a slider (20–100%, default 100%). It
  changes only how strongly the layer is drawn, never what it contains.
- IF TIME, tap to inspect: a tap (not a drag) glides the reticle to that point. If a shelter,
  report, road or river lies within 20 px of the tap, the card's first line names it (e.g.
  "Road N1", "School · shelter point, unverified").
- Before / After (the "lens"):
  - Replaces the photo with the radar pair: the flood-day picture everywhere, the baseline picture
    clipped to the left of the divider, both multiplied with tint `#d3efe8`.
  - Only the flood polygon EDGE (`#5ee0cc`) is drawn, on the flood-day side. Road, river and shelter
    symbols are hidden; names and upazila lines stay.
  - Turning it on animates the divider from 94% to 50% of the width (700 ms).
  - A white divider with a round handle and arrows. Date pills "9 Aug 2024 · before" and
    "21 Aug 2024 · flood day" sit beside the line, below the top controls, and never leave the
    screen.
  - A one-time hint bubble, "See the flood arrive: compare the radar from before and after", is
    remembered once seen.
- Motion: ease-in-out tweens on separate channels: "view" (a 520 ms glide, zooming in log space) and
  "split" (the reveal). No motion at all under `prefers-reduced-motion`.

### 5.5 Screen structure (phone: one column; grid rows bar / map / sheet / nav)
- Brand bar (river deep `#0b3d32`, sand text):
  - logo; wordmark "INGITO" (tracked caps) over "ইঙ্গিত"
  - EN | বাংলা segmented switch; a round light/dark button
  - second line: orbit icon + telemetry "21 AUG 2024 · 18:04 UTC+6 · SENTINEL-1A · C-BAND SAR" +
    the connectivity chip. The date comes first so truncation cuts the sensor, never the date.
    In Bangla: "২১ আগস্ট ২০২৪ · সন্ধ্যা ৬:০৪ · Sentinel-1A · C-band রাডার".
- The map, with floating controls:
  - top: a search pill and a Layers button
  - below that: a key chip ("Water seen by radar" with the hatched swatch; in Before/After,
    "Radar · dark = water") and the "Before / After" chip
  - bottom-right: Locate, +, −; bottom-left: the scale bar
- Insight card: overlaps the top edge of the map by about 0.8 rem, with rounded top corners. It is
  about the point under the reticle, or the GPS position when there is a fix.
  1. EARTH row (a button that opens Area):
     - "<Upazila> upazila · near <village within 4 km>", or "Outside the pack area"
     - second line: "You (GPS ±12 m) · 23.0123, 91.4567" or "Crosshair (no GPS) · ..."
  2. SATELLITE (tag with the hatched swatch): "Radar saw water here" (teal, bold) or
     "Radar saw no water here". This line is a button that opens the Source sheet (sensor, time,
     the observation's age, method, limits). The flood layer's information lives here, one tap
     away, never in a separate "mode".
  3. GROUND (tag with a red dot):
     - "N of your reports within 300 m" (red)
     - on water with no reports: "Nothing recorded here yet"
     - on dry ground: "Radar misses water under trees and between houses. Record what you see."
  4. Shelter: the nearest shelter NOT inside radar water, e.g. "1.2 km NE · school (unverified) ·
     <name>", with a small line "Nearest shelter outside the water radar saw". "(unverified)" comes
     before the name, so truncation never cuts the warning.

  Then two large buttons, "Water here" and "Road cut", each showing "N recorded".
- Bottom nav, four ways in: Alerts, Area, Reports (with a red count badge while reports exist),
  Source.
- Sheets:
  - rise over the lower 64% of the map; one open at a time
  - nav button pressed state; a close ×; Escape closes
  - while a sheet is open, the card collapses to just its two buttons
- Wide screens (>= 900 px): two columns, 26 rem + the map. The card and sheets sit in the left
  column; the map fills the right. Alerts is open on start.
- Short screens (<= 680 px tall): hide the key chip; tighten the card and controls (still >= 40 px).
- Narrow screens (<= 360 px): the card tags show their marks only (the words stay for screen
  readers).

### 5.6 Sheets
- **LAYERS:** four groups.
  - "Earth · the ground itself": Satellite photo (Sentinel-2 · 17 Dec 2023 · before the flood),
    Terrain relief (Copernicus DEM), Rivers and canals (OpenStreetMap), Roads (OpenStreetMap),
    Villages and places (OpenStreetMap, GeoNames), Shelter points (unverified), Upazila boundaries
    (Official upazila outlines)
  - "Signal · measured from orbit": Water seen by radar (Sentinel-1 radar · 21 Aug 2024)
  - "Insight · worked out from the signal": Roads through that water (Calculated from the radar
    layer)
  - "Field · seen by people": My field reports (Stored on this phone)

  Each row: an icon that IS its map mark on a scrap of map ground, the name, a source line with a
  count, and a `role="switch"` toggle. Footer: "Village roads, streams and small places appear as
  you zoom in." plus the attribution.
- **ALERTS:**
  - Title "Alerts from the satellite". Lead: "What Sentinel-1 radar saw on 21 Aug 2024, upazila by
    upazila. Most water first."
  - A district card: "21.7 km² of new open water, in 1,159 separate patches. 51 roads cross it."
  - Then one card per upazila, sorted by share, each with:
    - a severity WORD first, then a bar: Widespread (>= 3%, the only red one), Patchy (1–3%, teal),
      Little (< 1%, outlined)
    - the name, "Upazila · Feni district · Chattogram Division"
    - "21 Aug 2024, 18:04 UTC+6 · compared with 9 Aug 2024"
    - why it matters, e.g. "5.1 km² of land newly under open water: 4.9% of the upazila. 18 roads
      cross it."
    - the basis "Based on Sentinel-1 SAR · open water only"
    - a "View area" button
  - Footer: states the thresholds and says "It is not a forecast".
- **AREA:** a brief about one upazila (by default the one under the reticle, or the nearest):
  - location, centroid coordinates, km²
  - OVERVIEW, e.g. "Radar saw 5.1 km² of new open water in Fulgazi: 4.9% of the upazila, the
    highest share in the district."
  - CHANGE: a line plus two radar thumbnails (before / flood day), cropped to the upazila box + 5%
    and tinted; the flood-day one also shows the water edge; both show the dashed upazila outline
  - NEXT: "View on map" (glide to the upazila) and "Before / After" (glide, then turn the lens on)
  - collapsible "Satellite signal": platform · C-band SAR, VH · date, time; the limitation box
  - collapsible "Ground context": named places; roads crossing radar water; shelter points by kind,
    and how many stand in radar water; your reports here. Every line has a correct zero case.
- **REPORTS:**
  - "My field observations (N)", newest first. Each row: the type (red), #n, coordinates, upazila,
    local time, "GPS ± N m" or "placed at the crosshair", and a Delete button (>= 48 px).
  - Sync note: "Saved on this phone only. Nothing is sent automatically: export the file and hand it
    over when you have a connection."
  - "Export for handover" builds the GeoJSON and shows a "Save the file" download link
    (`ingito-field-reports.geojson`) AND a read-only textarea with the JSON to copy, in case
    downloads are blocked.
  - "Kept separate from the satellite layer and never merged into it."
  - "Delete all reports" sits far below Export. It needs a second tap at least 0.8 s after the first
    and disarms itself after 5 s.
- **SOURCE** ("Where this information comes from"):
  - sensor (Sentinel-1A C-band VH, RTC gamma-0); observed date and time + "N days ago"; baseline;
    detected km² and patches
  - a limitation box: "What this layer cannot see." + the limitation text
  - the not-ground-truth sentence
  - collapsible sections: How it was measured (product, threshold + how it was chosen, source,
    method); The event and our sanity check (text in section 7); Satellite photo (reference; "not a
    picture of the flood"); The two radar pictures; Terrain; Roads, rivers, places, shelters
    (attribution + shelter note + roads note)
  - an OPEN "This device" section: pack id and name, format version, fingerprint, build date,
    where it was loaded from, whether the browser granted persistent storage, the network state in
    words, and either "Everything in this pack works with no network." or "Not stored on this
    phone: opening it again will need a network."

### 5.7 Field reports
- Tapping "Water here" or "Road cut" places a report at the GPS fix if there is one, else at the
  crosshair. Shape:
  `{id, type: "water_here"|"road_cut", lon, lat (6 decimals), at (ISO time), accuracy_m or null,
  placed: "gps"|"crosshair", area: <upazila>, pack_id, hazard, source: "field observation",
  satellite: {sensor, observation_date, radar_saw_water: true|false}, note: "", exported_at: null}`.
  The `satellite` block records what the radar said at that exact point when the report was made,
  so a later reader can tell what the satellite saw apart from what the person saw.
  It is saved to localStorage, the phone vibrates 70 ms where supported, and any open sheet closes on
  a phone.
- Confirmation: a persistent box above the buttons, not a toast; it never times out. It goes away
  when its text is tapped, the map moves, or another report is made.
  - "WATER HERE #3 saved" + "at your GPS position" or "at the crosshair (no GPS)"
  - or "NOT SAVED · this browser refused storage"
  - an UNDO button; undoing shows "WATER HERE removed · N reports left on this device"

  The box is stored as its meaning, so switching language rewrites it.
- IF TIME, an optional note: the confirmation box offers "Add note", which opens one text field
  (up to 200 characters) saved into the report. It is never required before saving.
- Export state: exporting sets `exported_at` on every report included. The Reports list shows
  "exported <time>" or "not exported yet". The red nav badge counts only reports not yet exported.
  Never say "synced" or "sent": nothing leaves the phone except a file the operator saves or hands
  over.
- Export GeoJSON: a FeatureCollection with:
  - generator "Ingito field instrument", exported_at, pack_id
  - note "Human field observations. NOT satellite-derived. Each feature carries its own time and
    position."
  - Point features with properties `{id, observation, source: "field observation", recorded_at,
    accuracy_m, placed_by, area, hazard, pack_id, satellite, note, exported_at}`
- GPS: `watchPosition` (high accuracy, maximumAge 10 s, timeout 20 s); it works in airplane mode.
  Ask for location permission only when the operator taps Locate, never at startup. Until then the
  card's second line ends "tap ◎ to use GPS". If permission was granted before (Permissions API),
  start watching as soon as the pack opens.
- Locate glides to the fix. With no fix, it shows "No GPS fix yet" + why (still searching,
  permission refused, unavailable, or no GPS) + "Until there is one, the card and every report use
  the crosshair."

### 5.8 Search (offline)
- Index: upazilas (choosing one fits its box), places, the longest segment of each named river or
  canal (at its midpoint), and named shelters. Dedupe by kind + lower-cased name.
- Match against both scripts. Score = (0 for a prefix match, 1 for a contains match) × 10 + kind
  rank. Kind ranks: upazila 0, city/town 1, suburb/village 2, hamlet 3, river 4, canal 5,
  hospital/clinic 6, school 7, mosque 8.
- Show the top 7, each with its name and kind word. Enter picks the first. Choosing one glides there
  (3 km across for a point). With no match: "No place by that name in this pack".

### 5.9 Two languages
- Every string lives in one STRINGS object with `en` and `bn` written separately, not translated
  word for word.
- Bangla uses Bangla digits for everything a person reads as a number, with a thousands separator
  (১,১৫৯). Coordinates stay in Latin digits.
- Bangladeshi usage: পানি, not জল.
- Pass time in Bangla: a 12-hour clock with a time-of-day word, e.g. "সন্ধ্যা ৬:০৪". Words by hour:
  রাত (before 4), সকাল (before 12), দুপুর (before 15), বিকেল (before 18), সন্ধ্যা (before 20),
  রাত (after). English: "18:04 UTC+6".
- Scientific names (Sentinel-1, SAR, GeoJSON) stay in Latin script.
- Place names are never transliterated: show `name_bn` in Bangla when it exists, else the English
  name.
- Switching language rewrites everything at once: open sheets, the note box, map labels and
  aria-labels.
- No uppercase or letter-spacing on Bangla.
- Months: জানুয়ারি ... ডিসেম্বর.

Core pairs:
Water here / এখানে পানি · Road cut / রাস্তা বন্ধ · Alerts / সতর্কতা · Area / এলাকা ·
Reports / রিপোর্ট · Source / তথ্যসূত্র · Layers / লেয়ার · Before / After / আগে / পরে ·
Satellite / স্যাটেলাইট · Ground / মাঠ · Undo / বাতিল · Online / অনলাইন ·
No link / নেট পাচ্ছে না · Offline / অফলাইন · Widespread / বিস্তৃত · Patchy / বিক্ষিপ্ত ·
Little / সামান্য · Radar saw water here / রাডারে এখানে পানি ধরা পড়েছে ·
Radar saw no water here / রাডারে এখানে পানি ধরা পড়েনি · Water seen by radar / রাডারে দেখা পানি ·
Crosshair (no GPS) / নিশানা (জিপিএস নেই) · Download this pack / প্যাকটি নামিয়ে রাখুন ·
Satellite flood map that works with no signal / নেটওয়ার্ক ছাড়াই চলে এমন স্যাটেলাইট বন্যা-মানচিত্র ·
(unverified) / (যাচাই হয়নি) · upazila / উপজেলা · district / জেলা · Division / বিভাগ

A native Bangla speaker must review all the Bangla text.

### 5.10 Visual identity
- **LOCKED LOGO; do not redesign it.** A disc `#022a22` with a river running through its delta
  (teal gradient `#3f917a`→`#15604f`), cream land `#f5f4ed` and a red sun `#eb4331`. I will give you
  the image. Convert it to a clean SVG symbol (100×100 viewBox) and use it in the bar, the gate,
  icon.svg, and maskable PNG icons at 192 and 512 px (the mark at 84% on `#022a22`).
- Palette meanings:
  - River Deep `#0B3D32`: the brand bar, primary surfaces, primary buttons
  - River Green `#1E7D6B`: active states, shelters
  - Floodplain `#A7C4B7`
  - Delta Sand `#EAE6D9`
  - Sun Red `#E63946`: ATTENTION ONLY (wet roads, reports, a widespread alert, the report badge).
    Never decoration, and never alone: always paired with a shape or a word.
  - Signal teal `#5EE0CC`: what the radar measured
- Colour tokens:
  - Light: bg `#efebdf`, surface `#faf8f2`, surface-2 `#eae6d9`, ink `#0a2b23`, dim `#3d5a51`,
    line `#d6cfbd`, teal-ink `#12685a`, red-ink `#b21f2c`, action-bg `#0b3d32`, action-ink
    `#f4f1e6`, red-fill `#c8283a` (white text on it)
  - Dark: bg `#041a15`, surface `#0a2f27`, surface-2 `#0f3d33`, ink `#eeebe0`, dim `#a7c4b7`,
    line `#1d4d41`, teal-ink `#6fd6c4`, red-ink `#ff8a92`, action-bg `#a7c4b7`, action-ink
    `#062a22`

  Light and dark change the surfaces only; the map looks identical in both.
- Contrast (WCAG formula; measure and list the results): body text >= 12:1, dim text >= 6:1,
  teal/red text >= 6.2:1, report buttons >= 8:1. Tap targets >= 44 px. A visible 3 px focus ring in
  signal teal.
- Type: Inter for Latin and Hind Siliguri for Bangla. Store woff2 subsets in `app/fonts` with their
  OFL licence files. Use `@font-face` with `unicode-range`, and tabular numbers.
- Spacing 4/8/12/16/24 px; corner radii 6/10/16/pill. Subtle motion only: a sheet rising (180 ms),
  the glide, the reveal.
- Icons: one inline SVG sprite, 2 px stroke, round caps: water, road, shelter, pin, orbit, layers,
  source, reports, locate, sun, moon, search, alert, area, change, close, chevron, download, sync.
- Manifest: name "Ingito · ইঙ্গিত", short_name "Ingito", a description in both languages,
  start_url and scope `./`, display standalone, background and theme colour `#0b3d32`, icons (192
  and 512 maskable, plus the SVG).

### 5.11 Security
A pack may arrive as a file from another team. HTML-escape every string that comes from a pack
before it goes into the page. Never eval anything from a pack.

## 6. Acceptance checks (do all of them and report honestly)
1. The pipeline numbers match 3.1 and are close to 3.2.
2. The app runs with `node serve.mjs` and the console shows no errors.
3. Check at 320×568, 360×740, 375×812 and 1280×780, in English and Bangla, light and dark: no
   horizontal scroll, no overlapping text, no truncated warning words.
4. Every sheet opens, closes, and updates when the language switches. Search, the glide, the
   Before/After drag, pinch zoom, and reports (add, undo, delete, delete-all two-tap, export) all
   work.
5. Offline proof: download the pack, stop the server (or use airplane mode), then reload. The app
   opens straight onto the map; Source says "this device (offline store)"; reports persist; the chip
   shows Offline or No link.
6. The contrast ratios are measured and listed.
7. Opening a file that is not a pack, is cut short, or has been altered is refused with a clear
   reason, and the pack already on the device still opens afterwards.
8. On a real phone: airplane mode on, app opened from the home screen, map shown, a report made and
   exported.
9. On an ordinary low-end Android phone (2–3 GB RAM): note the time from tapping the icon to the map
   appearing, whether pan and zoom stay smooth, and any crash. Write the numbers down; do not tune
   only on a laptop.

## 7. Honesty rules (this wording must appear in the app)
- Radar detects OPEN WATER only. Water among rice, trees and houses bounces the signal twice (double
  bounce) and looks BRIGHTER, so it is missed. The area is a lower bound, and it under-counts
  exactly where people live. That is WHY the field reports exist.
- This is a satellite observation, not ground truth. No validated flood map exists for this event,
  so no accuracy figure is claimed.
- The sanity check (Source sheet): this layer detects 21.7 km², about 11% of the reported 201 km².
  The pattern matches the event: the northern upazilas, hit first by the flash flood off the Tripura
  hills, hold the most water. The amount does not match, for two stated reasons: the pass was taken
  on the day the flood arrived, two days before the peak, and open-water detection misses flooded
  villages and cropland.
- Shelters are OpenStreetMap reference points, not a verified registry; always label them
  "(unverified)".
- A road flagged as crossing water is not a claim that it is impassable, and an unflagged road is
  not confirmed open.
- The optical photo is from the dry season (17 Dec 2023), not from the flood.
- The severity words describe the measurement, not a forecast, and the thresholds are stated on
  screen.
- Words: never call the layer "flood extent". It is "water seen by radar" or "new open water"
  (OBSERVED). Roads crossing it are "worked out from the radar layer" (INFERRED). Keep that
  distinction in every label.
- No invented confidence or accuracy percentages. Uncertainty is told through real properties: the
  sensor, the observation's date and age, the method and its known blind spots.
- Every threshold in the code carries a comment saying why that value (for example, "UN-SPIDER
  default, used because Otsu fell outside 1.1–2.0"), so nobody mistakes a heuristic for a law.
- No telemetry and no automatic upload of anything: reports, positions or files.
- Known limitation (keep it, or fix it only if asked): a road that crosses water is drawn red along
  its whole length, not just the wet stretch.

## 8. Build order
1. The area config, boundary files, `ingest_s1.py` + `detect.py`; check the numbers.
2. `fetch_context.py` and `fetch_imagery.py`.
3. `build_pack.py` (with datasets, processing and the fingerprint) and `index.json`;
   `PACK_FORMAT.md`.
4. `serve.mjs`, the gate, pack validation and loading, and the canvas map (Earth and Signal).
5. The insight card, reports (with the satellite block and export state) and export.
6. The sheets: Source, Alerts, Reports, Layers (with the opacity slider), Area.
7. Search, Before/After, GPS (permission on Locate), the north arrow.
8. Bangla, responsive layout, service worker, manifest and icons, dark mode.
9. The acceptance checks, with results.

The cut line: this has to be rebuilt in 48 hours. If time runs short, drop these in this order and
say what was dropped: tap to inspect, report notes, the NISAR path, the Area thumbnails, dark mode,
terrain relief, search. Never drop: the real flood layer, the one-file pack and its validation,
offline opening, the insight card, the two report buttons, export, the Source sheet, or Bangla.
