# Fix round 1 — findings from the coordinator's inspection

Base commit: 535229c. Keep the work order (docs/WORK_ORDER.md) as the spec. The proof command is unchanged: `node scripts/build_data.mjs && node --test tests/`.

## About the empty district outlines (coordinator's data bug)
- You were right: `data/districts.json` has empty `path` strings. `scripts/01_districts.mjs` ran Douglas–Peucker on closed rings (first vertex = last vertex), which collapses every outline.
- The coordinator has a fix ready and will apply it after this round. It regenerates `data/districts.json` with 64 real outlines, the same `{box, lat0, scale, width, height}` fields, and paths in a `0 0 {width} {height}` viewBox. The viewBox is currently `0 0 688.6 976`.
- **Don't edit `scripts/01_districts.mjs` or `data/districts.json`.** Implement finding 2 against the documented format. While a district's `path` is empty, draw its centre dot instead, so the page works both before and after the data fix.

## Findings to fix (all in your files)

### High
1. **Appliance table loses focus on every keystroke** (`web/app.js`, confirmed in a browser: `document.activeElement` becomes BODY after one `input` event). Each `input` event calls `render()`, which replaces `app.innerHTML`, destroying the field being edited. Fix: don't rebuild the whole page from text inputs. Either render the static shell once and update only the result sections, or re-render on `change` and update totals on `input` without replacing the table. Editing a number must keep focus and the caret. The essential checkbox, cattle count, autonomy and cyclone controls must keep working.
2. **Use the real district outlines** (`web/app.js`). Draw each district as `<path d="...">` from `SHAKTI_DATA.districts.districts[].path`, in `viewBox="0 0 {width} {height}"` from `SHAKTI_DATA.districts`. Use the centre-dot fallback above only when a path is empty. Place the pin and any dots with the same projection: `x = (lon − box.lonMin)·cos(lat0°)·scale`, `y = (box.latMax − lat)·scale`. Highlight the selected district. Make each district keyboard-reachable (`tabindex="0"`, Enter or Space selects) with an accessible name. The map must be readable on a phone: about 60 vh at most, keeping the aspect ratio.

### Medium
3. **Wind verdict shows raw keys** (`not-worth-it`, `marginal`, `promising`) in the wind and recommendation cards, in both languages. Show the work order's wording: "not worth it" / "marginal — measure first" / "promising — measure first". In Bangla: "লাভজনক নয়" / "সীমান্তরেখায় — আগে মেপে দেখুন" / "সম্ভাবনাময় — আগে মেপে দেখুন". Style the chip by verdict without putting series colours on text.
4. **Cyclone-week test**:
   - Format dates for people: "27 May 2024" / "২৭ মে ২০২৪". The verdict line currently prints `20240527`.
   - Show "what would fix it" only when `survived` is false.
   - Add a "show as table" view for the 8 days: date, sunlight, solar kWh, battery %, shortfall kWh, missing flag.
   - Label the battery chart's y-axis at 0 / 50 / 100 %.
   - Make each day's values readable on keyboard focus as well as hover, for example with a detail line that updates on focus or hover. A `title` attribute alone isn't enough.
5. **Narrow screens** (`web/index.html`). Confirmed at 360 px with a viewport meta: the appliance card's content is 363 px wide in a 334 px card. `body{overflow-x:hidden}` hides the clipping. Wrap every table in its own `overflow-x:auto` container and remove the body-level `overflow-x:hidden`.
6. **Honesty panel is missing constants**: list every exported constant with its value and meaning, including `PANEL_WATTS`, `AUTONOMY_DAYS` (default), `WIND_SHEAR_ALPHA`, `WIND_HUB_HEIGHT_M`, the wind thresholds, and the three biogas constants with their sources.
7. **Garbled Bangla cyclone names** (confirmed in a browser): the cyclone dropdown shows mojibake such as `à¦†à¦®à§à¦ªà¦¾à¦¨ (2020)` instead of আম্পান. `web/data.js` loads as a classic script, so it's decoded with the document's encoding, which isn't guaranteed to be UTF-8. `app.js` is a module, so it's always UTF-8. Fix in both places:
   - `scripts/build_data.mjs` writes `data.js` with every non-ASCII character escaped as `\uXXXX`, so the file is pure ASCII.
   - Add `charset="utf-8"` to the `data.js` script tag in `index.html`.
   - Add a test that `web/data.js` has no bytes above 0x7F and that the parsed Remal record's `bn` equals "রিমাল".
8. **Mixed digits in Bangla mode**: some numbers still print Latin digits — `12 × 400W`, `সমাধান: 1 দিন...`, the cyclone year `(2020)`, the day labels `23 … 30`, the constants line. Route every displayed number through the same locale formatter. Month keys like `JUL` also appear in Bangla mode for the design month; show localised month names.

### Low
9. `tests/build.test.mjs` checks only the sunlight climatology. Assert ≥ 30 points for sun, wind and temp.
10. The hero should show a compact live result for the selected place beside the wordmark, per the work order section 9: panels, battery kWh and the cyclone-week verdict. Right now it shows only the place name and coordinates.
11. Sunlight and wind charts: label each bar with a short month name, localised in Bangla mode, instead of the ambiguous single letters J F M A M J J A S O N D. Keep "show as table".

Report which findings you fixed, anything you couldn't, and the proof command output.
