# Ingito pack format: `ingito.pack/1`

A pack is **one file**, `<pack_id>.pack.json`: compact UTF-8 JSON, written by `pipeline/build_pack.py`.
Every picture inside it is a base64 data URI, so the file needs nothing else to work. The Feni
reference pack is 6.7 MB.

`?` after a key means it is present only when the source has a value. Coordinates are `[lon, lat]`
(WGS 84), rounded to 5 decimal places (about 1 m). Bounds are `[west, south, east, north]`.

## Top-level keys

| Key | Type | Meaning |
|---|---|---|
| `format` | string | `"ingito.pack/1"`: format name and major version |
| `pack_id` | string | `<area>-<acquisition date>`, e.g. `feni-2024-08-21` |
| `name`, `name_bn` | string | Pack name in English and Bangla, from the area config |
| `admin` | object | `{district, district_bn, division, division_bn}`, from the area config |
| `hazard` | object | `{type, label}`. The type is data (`"flood"`); nothing in the format is flood-specific |
| `built_on` | string | Build date, `YYYY-MM-DD` |
| `built_at` | string | Build time, local ISO to the second, so two builds on one day differ |
| `coverage` | object | `{bbox, area_km2, places}`: bounds of the outline, sum of the official part areas, part names sorted |
| `observation` | object | The satellite layer and its provenance (below) |
| `context` | object | Roads, waterways, shelters, places (below) |
| `terrain` | object | Hillshade picture and elevation range (below) |
| `imagery` | object? | Optical and radar pictures (below). Without it the app draws the map on a plain ground |
| `areas` | list | `[{name, name_bn, km2, rings}]`: the parts (upazilas). `name_bn` is `""` when the config does not list it |
| `usage` | string | One sentence: the pack needs no network once it is on the device |

`rings` everywhere is a list of outer rings, each `[[lon, lat], ...]`. Holes are dropped; every
area figure was measured on the full geometry before that.

## `observation`

Copied **verbatim** from the flood run's provenance file
(`sar-flood/out/<Area>_s1_flood_<date>.json`), then four keys are added by the builder.

From the flood run:
- `hazard`, `aoi_name`, `sensor`, `sensor_detail`, `product`, `source`
- `scene_ids`: `{baseline: [scene id], flood: [scene id]}`
- `baseline_date`, `acquisition_date` (`YYYY-MM-DD`), `track`, `direction`, `polarization`, `grid_m`
- `threshold`, `threshold_method` (says in words whether Otsu or the fallback was used)
- `processed_on`, `detects` (`"open_water_only"`), `method`, `limitations`, `not_ground_truth`
- `event`: copied from the area config, `{name, rain_began, flood_arrived, river_peak,
  deaths_in_district, reported_flooded_km2, reported_source}`
- `totals`: `{flood_km2, patches, aoi_km2, data_coverage_pct}`. `aoi_km2` is measured from the
  outline, so it can differ slightly from `coverage.area_km2`, which sums the official part areas
- `by_upazila`: `[{name, flood_km2, upazila_km2, share_pct}]`

Added by the builder:
- `platform` (e.g. `"Sentinel-1A"`) and `acquisition_time_utc` (`"HH:MM"`), read from the flood
  scene id
- `features`: `[{km2, rings}]`, one per flood patch
- `feature_count`

## `context`

- `aoi_name`, `fetched_on`, `attribution`, `note` (shelters are reference points, not a registry)
- `roads`: `[{kind, coords, name?, name_bn?, ref?, wet, wet_parts?}]`. `wet` is set by the builder:
  the road crosses detected open water. `wet_parts` (wet roads only) holds the stretches of the road
  that lie inside that water, as lists of `[lon, lat]`; the app draws only these in red. A pack
  without `wet_parts` (built before 3 Oct 2026) gets the whole road marked
- `waterways`: `[{kind, coords, name?, name_bn?}]`
- `shelters`: `[{kind, lon, lat, name?, name_bn?}]`, kind one of `school`, `mosque`, `hospital`,
  `clinic`
- `places`: `[{kind, lon, lat, name?, name_bn?}]`
- `roads_crossing_water` (count) and `roads_note` (what the flag does and does not mean)

A missing spelling is filled **only** from the area config's `known_names` list, never invented.

## `terrain`

`{bounds, elevation_m: {min, max}, source, product, method, limitations, image}`. The image is a
greyscale JPEG hillshade.

## `imagery`

- `bounds`, `grid_m`
- `optical`: `{date, time_utc, sensor, product, scene, cloud_cover, source, note, image}`
- `radar`: `{before: {date, image}, during: {date, image}, sensor, display_db: [low, high], note}`

## `packs/index.json`

Written by the builder, pretty-printed, LF. It lists the packs on the preparation machine; in the
field nothing reads it.

`{packs: [{file, pack_id, name, hazard, sensor, acquisition_date, area_km2, size_mb, sha256,
fingerprint}]}`

## Integrity

- `sha256` is the hash of the pack file's exact bytes.
- `fingerprint` is its first 8 hex characters, upper case, grouped 4-4 (e.g. `FE97-0B8A`), short
  enough to read aloud.
- Any rebuild changes both, because `built_at` is inside the file.

## Compatibility

- Adding a key is not a format change. Removing a key or changing what one means is, and raises
  the major version (`ingito.pack/2`).
- Spec, **not yet built**: the app refuses a higher major version with "This pack was made by a
  newer version of Ingito"; older versions are migrated in code, never thrown away; a cut-short or
  altered file is refused.
- **Today** the app checks that the file is readable JSON, that `format` starts with
  `ingito.pack/`, and that `observation`, `context`, `coverage`, `terrain` and `hazard` are present
  (`app/app.js`, `openPack`). It works out the fingerprint from the pack text it holds and shows it
  on the map's label (shown every time a pack opens) and in Source › This device. It compares the
  code with nothing: two phones are checked by people reading their codes aloud. Where the browser
  has no `crypto.subtle` (a page opened from a local file), no code is shown.
- A published build embeds the pack file's exact text (`window.INGITO_PACK_TEXT`, written by
  `pipeline/embed_pack.py`), so it shows the same code as `packs/index.json`.

## Not in the format yet

`datasets` (one entry per layer with its licence, checked at the source) and `processing`
(`{pipeline_version, area_config, run_on}`) from the spec, section 3.4.
