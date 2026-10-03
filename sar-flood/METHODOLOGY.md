# Flood-extent detection: methodology

## For the Space Apps submission (paste-ready)

We map new open floodwater with Sentinel-1 radar, which sees through monsoon cloud, following the UN-SPIDER Recommended Practice for SAR flood mapping in Google Earth Engine. For a chosen area we compare a pre-flood and a during-flood VH radar image taken from the same orbit track, smooth radar speckle with a 50 m median filter, and flag pixels whose backscatter dropped sharply, using a threshold chosen automatically by Otsu's method (with UN-SPIDER's default of 1.25 as a fallback). We then remove permanent rivers and ponds using the JRC Global Surface Water dataset, remove steep slopes where radar shadow can mimic water, clean away isolated pixels, and export each flooded patch as a polygon with its area and image date. The method detects only open water: flooded crops, trees and built-up streets often turn brighter to radar rather than darker (the "double bounce" effect), so they are missed, which makes our flooded area a lower bound that most likely under-counts flooding in villages and towns. The same pipeline also runs on NISAR L-band radar (GCOV product, HH channel) streamed from NASA's Alaska Satellite Facility, reading only the area of interest from each multi-gigabyte file; this NISAR path is experimental until it has been checked against Sentinel-1 on the same flood.

VALIDATION SENTENCE: the Feni run is done — see "Result of the Feni run" below for the sentence that is now supported by evidence, and for exactly what it does and does not claim.

## Validation plan: Feni district, August 2024 floods

Status: **RUN on 22 Sep 2026, with real Sentinel-1 data and no Google account** — by `s1_flood.py`, not `flood_extent.py`. The Earth Engine version still needs a Google sign-in the team does not have, so the pipeline was rebuilt on Sentinel-1 **RTC** products (radiometrically terrain-corrected gamma-0, 10 m) read from the open Microsoft Planetary Computer STAC catalogue: no account, anonymous asset signing, reproducible by anyone on a clean machine. `flood_extent.py` stays in the repo as the Earth Engine implementation of the identical method, still unrun. Results and the plausibility assessment are at the end of this section.

- Images: Sentinel-1A, ascending, relative orbit 114. Baseline **9 Aug 2024**, flood **21 Aug 2024**. Dates were checked in the ASF catalogue on 19 Sep 2026.
- Event facts: rain began 19 Aug, the flood began 21 Aug, and the Gumti peaked 23 Aug at 8.58 m, 53 cm above danger level. Feni had the highest death toll (28). Source: Wikipedia, "August 2024 Bangladesh floods".
- Reference areas for Feni: 201 km² in total. By upazila: Sonagazi 49, Chhagalnaiya 37, Fulgazi 35, Feni Sadar 33, Parshuram 31, Daganbhuiyan 16. Same source; its own image date and method aren't stated.
- Regional reference: UNOSAT found about 8,100 km² flooded within about 140,000 km² analysed. They used Sentinel-1 images from 18–26 Aug and 28 Aug–4 Sep 2024, processed by machine learning.

What would count as plausible:
1. The total is the same order of magnitude as 201 km². The reference date may differ from 21 Aug, so an exact match isn't expected.
2. The pattern matches how the flood moved. Parshuram, Fulgazi and Chhagalnaiya in the north were hit first by the flash flood from the Tripura hills, so they should show clear new water on 21 Aug.
3. Built-up Feni Sadar should come out under the reference. Double bounce predicts this, so it is a check on the limitation, not a failure.
4. There are no big patches on the Tripura hill slopes (the slope mask) and none along the permanent river channels (the JRC mask).

### Result of the Feni run, 22 Sep 2026

| | |
|---|---|
| Source | Sentinel-1 C-band VH, RTC gamma-0, 10 m, via the Microsoft Planetary Computer STAC catalogue (no account) |
| Scenes | `S1A_IW_GRDH_1SDV_20240809T120441` (baseline) and `S1A_IW_GRDH_1SDV_20240821T120442` (flood) |
| Track | Relative orbit 114, ascending, both dates |
| Observation dates | Baseline **2024-08-09**, flood **2024-08-21** |
| Masked out | 0.9% permanent water, 0.0% steeper than 5° (Feni is flat coastal plain) |
| Threshold | **1.25** — Otsu returned 1.05, outside the plausible 1.1–2.0 range, so UN-SPIDER's default was used |
| **Detected** | **21.7 km² of new open water in 1,159 patches** = 2.3% of the 929 km² district; largest patch 0.9 km² |

By upazila:

| Upazila | New open water | Share of upazila |
|---|---|---|
| Fulgazi | 5.1 km² | 4.9% |
| Parashuram | 4.4 km² | 4.4% |
| Chhagalnaiya | 5.1 km² | 3.8% |
| Feni Sadar | 4.1 km² | 1.9% |
| Sonagazi | 2.5 km² | 1.1% |
| Daganbhuiyan | 0.5 km² | 0.4% |

**Against the four checks above:**

1. **Order of magnitude — does not match, and the reason is known.** 21.7 km² against a reported
   201 km² is 11%. Two stated causes: the 21 August pass caught the flood on the day it *arrived*,
   two days before the Gumti peaked on 23 August, so we imaged the leading edge rather than the
   peak; and open-water detection misses flooded villages and cropland entirely. Both push the
   figure down, and both are properties of the observation rather than errors in it. The next
   same-track pass was 2 September, by which time water had receded, so no pass exists at the peak.
2. **Pattern — matches.** Fulgazi, Parashuram and Chhagalnaiya, the northern upazilas struck first
   by the flash flood off the Tripura hills, are the top three by share. Daganbhuiyan, furthest
   from that path, is last. This is the check that actually validates the geography, and it passes.
3. **Built-up Feni Sadar comes out low** (1.9%), below the three rural northern upazilas. That is
   what double bounce predicts, so it supports the stated limitation rather than contradicting it.
4. **Masks behaved.** Only 0.9% of the district was excluded as permanent water and none as steep,
   which is correct for flat coastal plain, so the masks are not quietly removing the flood.

**No accuracy figure is claimed.** The 201 km² reference is press reporting whose own observation
date and method are unstated, so it cannot serve as ground truth; no validated flood map exists for
this event. This is a qualitative plausibility check and nothing more.

**VALIDATION SENTENCE (usable now):** "Our Sentinel-1 pipeline was run on the August 2024 Feni
flood, comparing the 9 August baseline with the 21 August flood pass on the same orbit track. It
detected 21.7 km² of new open water, concentrated in the northern upazilas that the flash flood
reached first — a spatial pattern consistent with the documented event. The total is about 11% of
the ~201 km² reported for the event, because the available pass predates the flood peak by two days
and because radar-dark detection misses flooded vegetation and built-up areas. No accuracy figure
is claimed: no validated flood map exists for this event."

## NISAR (L-band) version: `nisar_flood.py`

Status: **experimental.** It was built on 19 Sep 2026 at the team's request, before the Sentinel-1 version had been validated. What has actually been tested:
- The live ASF catalogue search: it picks the right files.
- Reading a window from a file laid out like NISAR GCOV. This used a synthetic local file.
- The local detection steps.

**Run for real on 22 Sep 2026.** Four real granules were streamed from ASF and both masks were read from their public buckets; the numbers are in the results table below. Still not done: the cross-sensor check against Sentinel-1, which needs the Earth Engine sign-in.

How it differs from the Sentinel-1 path:
- **Processing location.** NISAR isn't in Earth Engine, so steps 3–7 run locally with numpy. The two exclusion masks are read straight from public buckets instead of Earth Engine, so the NISAR path needs no Google sign-in: permanent water comes from the *same* dataset as the Sentinel-1 path (JRC Global Surface Water v1.4 occurrence, same 50% cut-off), and slope is worked out from the Copernicus DEM GLO-30 rather than HydroSHEDS. Because Copernicus is a surface model that treats tree lines and buildings as cliffs at 20 m, the terrain is averaged to 90 m — HydroSHEDS' own scale — before the slope is measured. On the July 2026 test area this masked 2.4% of pixels as permanent water and 17.8% as steeper than 5°.
- **The data.** L-band HH, as GCOV gamma-0 in linear power, converted to dB. Only the chunks covering the area are read from each 2–9 GB file.
- **Thresholds.** They aren't calibrated for L-band; the 1.25 fallback is borrowed from Sentinel-1.
- **An extra guard.** Pixels brighter than −3 dB before the flood are skipped, because a ratio of dB values breaks down near 0 dB. This cut-off was chosen by reasoning, not calibration.
- **A small cleaning difference.** `sieve()` also fills dry holes smaller than 8 pixels inside flood patches.

### NISAR test: south Chattogram, July 2026 floods
- **Area:** Satkania, Lohagara, Chandanaish and Banshkhali upazilas, 1,099 km². They were named among the worst hit.
- **Event:**
  - Rain began 5 Jul 2026, and 412 mm fell on 7 Jul, the heaviest in 43 years.
  - By 12 Jul, water covered 59 upazilas in 7 districts.
  - About 1.28 million people were affected. Sources: Prothom Alo, Wikipedia "2026 Chittagong floods", Mappr.
- **Passes:** NISAR track 69, ascending, 23:21 UTC (05:21 the next morning in Bangladesh).
  - Baseline: **30 Jun 2026**. Flood: **12 Jul 2026**.
  - Both use the same 40 MHz dual-pol mode (DHDH).
  - Frames 12 and 13 are needed together, about 20 GB of files in total, of which only the area is read.
- **Reference:** no published flooded km² for this event has been found yet. Plausibility therefore rests on:
  1. Clear new water in all four upazilas on 12 Jul.
  2. **A cross-sensor check:** run `flood_extent.py` (Sentinel-1) on the same area and dates. Both Sentinel-1A and 1C fly in 2026.
  3. No patches on the hill slopes east of Satkania.
  4. At least 95% data coverage on both dates. The script prints a warning if it's lower.

**Result of the run on 22 Sep 2026** — output `out/South_Chattogram_nisar_flood_2026-07-12.geojson`:

| | |
|---|---|
| New open water | **Withheld until checked.** The area figures stay unpublished until the Sentinel-1 cross-check (check 2 below) has been run. |
| Largest patch | 9.7 km² |
| Threshold | **1.175**, chosen by Otsu — not the borrowed 1.25 fallback |
| Data | 4 granules, 19.9 GB of files, of which about 460 MB was actually transferred |
| Masked out | 2.4% permanent water, 17.8% steeper than 5° |

By upazila: withheld for the same reason, since the per-upazila areas add up to the total.

Against the four checks above:
1. **Met.** All four upazilas show new open water. Whether the ranking matches the damage reports has *not* been checked: no per-upazila published figures for this event have been found.
2. **Not done.** The Sentinel-1 cross-check still needs the Earth Engine sign-in.
3. **True by construction, not independently confirmed.** Pixels steeper than 5° are dropped before thresholding, so no patch *can* land on the Satkania hills. That is the mask working, not evidence about the hills.
4. **Met.** The script warns below 95% coverage on both dates and printed no warning.

This is a real measurement of real NISAR data. It is **not** a validated flood map: the threshold is uncalibrated for L-band, there is no published km² for this event to compare against, and open-water-only detection means the true flooded area is larger — most of all in the villages, which is where people are.
