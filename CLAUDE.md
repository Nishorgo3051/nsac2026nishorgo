# NSAC 2026 - working rules

NASA Space Apps Challenge, 14-15 November 2026. Chosen challenge: **Dancing with the SARs**.
The team lead is a non-technical student: explain in plain English and lead with a short dated to-do list.

## The rule that shapes everything

BASIS, the Bangladesh organiser, allows building before the event, but the project must be
**rebuilt from scratch during the hackathon**. So:

- Everything here is a rehearsal. Keep it private.
- Never paste this code into the event build.
- Prefer approaches that can be rebuilt cold in 48 hours.

## Layout

- `sar-flood/` - the main project. Stage 1 only: flood extent from radar. Resource coordination is a separate, later module.
- `nodir-hishab/` - paused erosion demo. Its `data/` folder holds 782 MB of Landsat imagery and stays out of git.
- `shakti-map/` - finished and published. **It has its own git history**, so the root repo ignores it.
- `build-logs/` - the Codex build log from Shakti Map.

Keep those three as siblings: `shakti-map/scripts/01_districts.mjs` reads `../../nodir-hishab/data/raw/boundaries/`.

## Running Python

Use the environment that already exists; do not install into the system Python:

    sar-flood\run.cmd test_flood_extent.py

That sets `PYTHONDONTWRITEBYTECODE=1`, which sidesteps a Windows path-length problem.

## Honesty rules for this project

- Never say a validation passed unless it actually ran. **Both flood validations are still pending.**
- The method finds **open water only**. Flooded villages and crops are missed, so every area is a lower bound. Say so wherever numbers appear.
- Keep `detects="open_water_only"` on every output polygon, so the caveat travels with the data.

## Sign-ins the user must do personally

- A Google Earth Engine project, needed by both scripts: code.earthengine.google.com/register
- A NASA Earthdata account, needed for NISAR: urs.earthdata.nasa.gov

Never create accounts for them and never handle their passwords.

## Git

The user authorised this repo on 20 Sep 2026. Commit small local changes freely.
**Ask before adding a remote or pushing anywhere public.** Never commit `nodir-hishab/data/`, API keys or tokens.

## Known open items

- Both validations unrun, waiting on the two sign-ins above.
- `nodir-hishab` still has the closed-ring bug that empties upazila outlines. The working fix is in `shakti-map/scripts/01_districts.mjs`.
- The old WellSphere repo leaked Mapbox and NASA keys: rotate them and make that repo private.
