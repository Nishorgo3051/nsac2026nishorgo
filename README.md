# NSAC 2026

Work for the NASA Space Apps Challenge, 14-15 November 2026. Chosen challenge: **Dancing with the SARs**.

**Rule to remember:** BASIS allows building before the event, but the project must be rebuilt from scratch during the hackathon. Everything here is a rehearsal. Keep it private and never paste this code into the event build.

## Folders

| Folder | What it is | Status |
|---|---|---|
| `sar-flood/` | **The main project.** Stage 1 of the flood coordination tool: finds new open floodwater from Sentinel-1 (C-band) and NISAR (L-band), and writes GeoJSON polygons. | 5 of 5 local checks pass. Waiting on a Google Earth Engine sign-in and a NASA Earthdata account. Neither validation has run. |
| `nodir-hishab/` | Earlier river-erosion demo built on Landsat, including 782 MB of downloaded imagery. Kept for the erosion idea and its boundary files. | Paused. A known bug still empties the upazila outlines. |
| `shakti-map/` | Finished side project: a natural-energy planner for Bangladesh (sun, wind, biogas, cyclone-week test). | Done and published. Only the baseline commit exists. |
| `build-logs/` | The Codex build log, fix lists and backups from the Shakti Map build. | Reference only. |

## Published pages, both private

- Flood mapper write-up: https://claude.ai/artifact/BE6Wt1V6DFXaWwbjY8o45N
- Shakti Map app: https://claude.ai/artifact/Ag9ZbJRf5bEnTax7YBfQRS

## Running things

Python lives in a separate environment at `C:\Users\USER\.venvs\sar-flood`, so nothing needs installing again.

    cd sar-flood
    run.cmd test_flood_extent.py

The two scripts that need sign-ins are `flood_extent.py` (Sentinel-1) and `nisar_flood.py` (NISAR). See `sar-flood/METHODOLOGY.md` for the method and both validation plans.

Keep `sar-flood`, `nodir-hishab` and `shakti-map` as neighbours: Shakti Map reads boundary files from Nodir Hishab.

Conventions for anyone working here, including AI assistants, are in `CLAUDE.md`. The folder is a git repository, so mistakes can be undone.

## Next actions

1. Register the team on the Space Apps site, and get the BASIS ruling in writing.
2. Create an Earth Engine project and a NASA Earthdata account, then run both validations.
3. Read the full challenge statements when they land on 28 October.
4. Recruit someone for satellite and GIS work.
5. Rotate the Mapbox and NASA keys that leaked in the old WellSphere repo, and make that repo private.

