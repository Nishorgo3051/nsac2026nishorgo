# NSAC 2026 — project brief

Current as of **22 September 2026**. Written to be pasted or uploaded into another tool so it has
accurate context. The "not true yet" section matters as much as the rest.

---

## 1. The event and the rules

- **NASA Space Apps Challenge 2026**, 14–15 November 2026. Team lead: nishorgo (Bangladesh).
- **Challenge chosen:** *Dancing with the SARs* (radar / SAR focus). The challenge statements are
  released **28 October 2026**, so all current work is practice and may need redirecting.
- **BASIS ruling (local organiser):** building beforehand is allowed, but the project must be
  **rebuilt from scratch during the 48 hours**. What gets carried in is knowledge, not code. This
  ruling should be obtained in writing.
- A previous project called **WellSphere is scrapped**. Its product concept, livability index, city
  scoring and dashboard structure are not to be reused.

## 2. Where the work lives

- **Folder:** `C:\Users\USER\NSAC` (Windows 11, git repo, branch `main`)
- **GitHub:** https://github.com/Nishorgo3051/nsac2026nishorgo — **private**, 135 files
- **Published demos** (private Claude artifacts, only the owner can open them):
  - Offline field client: https://claude.ai/artifact/TRjx1PzQr3gppZxTShPVXf
  - SAR flood mapper documentation page: https://claude.ai/artifact/BE6Wt1V6DFXaWwbjY8o45N

Three sub-projects in one repo:

| Folder | What it is | State |
|---|---|---|
| `sar-flood/` | Flood-extent detection from radar: Sentinel-1 and NISAR pipelines | NISAR run for real; Sentinel-1 not yet run |
| `guidebook/` | Offline Earth-intelligence field app + region-pack builder | Working, one link unverified |
| `nodir-hishab/` | Earlier riverbank-erosion demo (Landsat) | Practice work, paused |

`shakti-map/` (an energy-resource side app) has its own git history and is excluded from this repo.

## 3. The product being built

An **offline Earth-intelligence instrument** for disaster response. Working name **Guidebook**, which
is a placeholder awaiting a better name.

The idea: a responder downloads a **region pack** *before* losing connectivity. Afterwards the app
works with no network at all — real service worker, real browser cache, real files on the device.
Two modes:

- **Field Mode** — an instrument, not a dashboard. Where am I, what is around me, what changed.
- **Earth Intelligence Mode** — the satellite evidence and where it came from.

Hard constraints set by the team:

1. **NISAR must be visibly in the core workflow**, not mentioned on an About page.
2. **Nothing scientific may be fabricated.** No invented measurements, satellite passes, change
   values, accuracy percentages, flood boundaries or confidence figures. Fallback data must be
   labelled as such.
3. **The offline behaviour must be genuine** — not faked by hiding a connection indicator.
4. **The architecture must accept new sensors and new disaster types** without being hard-wired to
   floods or to NISAR.
5. AI is optional and only if genuinely useful. No "ask our AI anything about Earth" feature.

## 4. What actually works today

### The NISAR flood layer (run 22 September 2026, real data)

| | |
|---|---|
| Satellite / product | NISAR, L2 **GCOV**, HH channel, gamma-0 (L-band, 24 cm) |
| Source | NASA Earthdata / ASF DAAC. Not available in Google Earth Engine. |
| Area | Satkania, Lohagara, Chandanaish, Banshkhali upazilas, south Chattogram, 1,099 km² |
| Passes | Track 69 ascending, frames 12+13, same 40 MHz dual-pol mode |
| Dates | Baseline **30 June 2026**, flood **12 July 2026** |
| Data volume | 19.9 GB of files, of which about **460 MB** was actually read (windowed HDF5 reads) |
| Threshold | **1.175**, chosen by Otsu's method |
| **Result** | **128.4 km² of new open water in 2,186 patches = 11.7% of the area**, largest patch 9.7 km² |

By upazila (flood polygons intersected with the admin boundaries):

| Upazila | New open water | Share of upazila |
|---|---|---|
| Satkania | 56.4 km² | 20.4% |
| Chandanaish | 27.0 km² | 13.5% |
| Banshkhali | 36.1 km² | 10.0% |
| Lohagara | 8.9 km² | 3.4% |

The event: rain began 5 July 2026; 412 mm fell on 7 July, the heaviest in 43 years; by 12 July water
covered 59 upazilas in 7 districts and about 1.28 million people were affected.

### The method (both sensors)

Follows the **UN-SPIDER Recommended Practice** for SAR flood mapping:

1. Two images from the same orbit track, before and during.
2. Speckle smoothing: 50 m median filter.
3. Ratio of the two images **in dB** (during ÷ before). Above 1 means the ground got darker.
4. Threshold by **Otsu's method**, falling back to UN-SPIDER's 1.25 if Otsu gives an implausible value.
5. Exclusions: **permanent water** (JRC Global Surface Water v1.4 occurrence above 50%) and
   **slope of 5° or more**.
6. Cleanup: morphological opening, then drop patches under 8 pixels.
7. Vectorise to GeoJSON: one polygon per patch, with its area and both dates.

Analysis pixel size 20 m. NISAR-only extra guard: pixels brighter than **−3 dB** before the flood are
skipped, because a ratio of dB values breaks down near 0 dB. That cut-off was chosen by reasoning,
not calibration.

**No Google account is needed any more.** Both exclusion masks are read directly from public buckets:
the same JRC water dataset, and slope computed from **Copernicus DEM GLO-30** (averaged to 90 m first,
because a surface model at 20 m treats tree lines and buildings as cliffs). On this area the masks
removed 2.4% of pixels as permanent water and 17.8% as too steep.

### The offline app and region pack

Pack `chattogram-south`, 2.7 MB on disk, three layers all marked ready:

- **region** — upazila outlines and names (HDX admin level 3)
- **terrain** — hillshade from Copernicus DEM GLO-30, elevation −2 to 315 m
- **change** — the NISAR flood layer above

The app is plain HTML, CSS and JavaScript with **no map library and no CDN** (both would break
offline). The map is drawn on a canvas. Every layer carries its source, product, method and
limitations, shown in a provenance panel. A layer that has not been produced shows as **pending** and
nothing stands in for it.

Deliberately avoided: bulk-downloading map tiles from public tile servers, which breaks their terms of
use. Roads, rivers and emergency points will come from OpenStreetMap with attribution.

## 5. What is NOT true yet — do not claim these

- **The flood map is not validated.** The threshold is uncalibrated for L-band, no published km²
  figure exists for this event to compare against, and no cross-sensor check has been run.
- **Only OPEN water is detected.** Flooded crops, trees and streets between buildings often turn
  *brighter* to radar (the double-bounce effect) and are missed — more so at L-band than C-band. The
  reported area is a **lower bound**, and villages and towns are exactly where it under-counts.
- **The Sentinel-1 path has never been run.** The Feni August 2024 validation (reference figure:
  201 km²) is still outstanding. It needs either a Google/Earth Engine sign-in or an alternative
  C-band source.
- **The service worker is unverified.** It refuses to register in the embedded browser used for
  testing, although the file itself serves correctly. It must be tested in Chrome: load the app,
  download the region, stop the server, reload.
- **"No patches on steep slopes" is true by construction, not by independent check** — those pixels
  are excluded before thresholding, so their absence proves the mask ran, nothing more.

## 6. Useful technical facts

- **NISAR data availability:** public provisional products from 20 July 2026, covering acquisitions
  from 17 June 2026. There is a permanent data gap **27 July – 10 August 2026**. Files are 2–9 GB.
  GCOV data sits at `/science/LSAR/GCOV/grids/frequencyA` in HDF5, as linear power (dB = 10·log10).
- **Searching the ASF catalogue needs no login; downloading does** (a free NASA Earthdata account).
- **Copernicus DEM GLO-30 and JRC Global Surface Water are open** — no account, and window reads over
  HTTPS fetch only the bytes needed.
- **Competitive reality:** Copernicus GFM already provides free automated global Sentinel-1 flood
  extent, and UNOSAT and Google Flood Hub also exist. The defensible gap is **offline delivery to
  someone standing in the water**, not flood detection itself.
- **Windows gotchas hit repeatedly:** the 260-character path limit breaks virtualenvs and git clones
  in deep folders; PowerShell mangles quotes in native command arguments, so commit messages go
  through a file (`git commit -F`).

## 7. Open items

**Needs the team — nobody else can do these**

1. Test the app in Chrome and confirm it still works after the server is stopped.
2. Register the team on spaceappschallenge.org.
3. Get the BASIS rebuild ruling in writing.
4. Rotate the API keys that leaked in the old WellSphere repo, and make that repo private.
5. Recruit someone with a GIS or remote-sensing background.

**Next build steps**

1. Try NASA's OPERA RTC-S1 product (Sentinel-1 C-band via the same ASF login) to get the cross-sensor
   check and the Feni 2024 validation without any Google account. Coverage is not yet confirmed.
2. Show per-upazila flood figures when a place is tapped in Field Mode.
3. Add roads, rivers, hospitals and schools from OpenStreetMap to the pack (schools and mosques serve
   as cyclone shelters).
4. Propose a real product name to replace "Guidebook".
5. Build a second scenario that is neither a flood nor NISAR, to prove the architecture is not
   hard-wired to either.
