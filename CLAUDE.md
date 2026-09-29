# NSAC 2026 - working rules

NASA Space Apps Challenge, 14-15 November 2026. Chosen challenge: **Dancing with the SARs**.
The team lead is a non-technical student: explain in plain English and lead with a short dated to-do list.

**Start here: read `HANDOVER.md`** (29 Sep 2026). It has the product state, the user's standing rules, the dates, the gaps against the spec, and the next steps. It takes precedence over the older parts of this file and of `README.md`.

## The rule that shapes everything

BASIS, the Bangladesh organiser, allows building before the event, but the project must be
**rebuilt from scratch during the hackathon**. So:

- Everything here is a rehearsal. Keep it private.
- Never paste this code into the event build.
- Prefer approaches that can be rebuilt cold in 48 hours.

## Layout

- `ingito/` - **the product** (Ingito, ইঙ্গিত): pack pipeline, pack file, offline field app. Spec for the event rebuild: `the rebuild prompt.md`; post-hackathon plan: `the vision.md`.
- `sar-flood/` - the radar pipelines Ingito uses: `s1_flood.py` (Sentinel-1, no login) and `nisar_flood.py` (NISAR extension).
- `brag-output-*`, `ingito-video-v3/`, `ingito-film/` - the videos, not in git. `brag-output-2026-09-28-005210/` is the frozen 1 Oct submission: never touch it.
- `nodir-hishab/` - paused erosion demo. Its `data/` folder holds 782 MB of Landsat imagery and stays out of git.
- `shakti-map/` - finished and published. **It has its own git history**, so the root repo ignores it.
- `build-logs/` - the Codex build log from Shakti Map.

Keep those three as siblings: `shakti-map/scripts/01_districts.mjs` reads `../../nodir-hishab/data/raw/boundaries/`.

## Running Python

Use the environment that already exists; do not install into the system Python:

    sar-flood\run.cmd test_flood_extent.py

That sets `PYTHONDONTWRITEBYTECODE=1`, which sidesteps a Windows path-length problem.

## Honesty rules for this project

- Never say a validation passed unless it actually ran. Feni (Sentinel-1) has only a qualitative sanity check, and no accuracy is claimed. The NISAR run's cross-check against Sentinel-1 has not been run.
- The method finds **open water only**. Flooded villages and crops are missed, so every area is a lower bound. Say so wherever numbers appear.
- Keep `detects="open_water_only"` on every output polygon, so the caveat travels with the data.

## Sign-ins the user must do personally

- A NASA Earthdata account, needed for NISAR only: urs.earthdata.nasa.gov. The user's credentials sit in `C:\Users\USER\_netrc`: never print or commit them.
- Earth Engine is needed only by the superseded `flood_extent.py`. `s1_flood.py` needs no login.

Never create accounts for them and never handle their passwords.

## Git

The user authorised this repo on 20 Sep 2026. Commit small local changes freely.
**Ask before adding a remote or pushing anywhere public.** Never commit `nodir-hishab/data/`, API keys or tokens.

## Known open items

- Ingito's gaps against the event spec are listed in `HANDOVER.md` §7.
- `nodir-hishab` still has the closed-ring bug that empties upazila outlines. The working fix is in `shakti-map/scripts/01_districts.mjs`.
- The old WellSphere repo leaked Mapbox and NASA keys: rotate them and make that repo private.
