# Fix round 2 — coordinator's inspection of round 1

Base commit 535229c. The spec (docs/WORK_ORDER.md) and the proof command (`node scripts/build_data.mjs && node --test tests/`) are unchanged.

## Data note (unchanged)
The coordinator re-applies the district-outline data fix after this round. It verified your path rendering with the real outlines in place: 64 district paths render, and the map is 304 × 431 px at 360 px wide. **Don't edit `scripts/01_districts.mjs` or `data/districts.json`.**

## Verified fixed in a browser
- Focus stays in the appliance inputs while typing (about 20 ms per keystroke).
- No mojibake.
- Localised wind verdicts.
- Human-readable cyclone dates.
- The cyclone table and the focus/hover detail line.
- Localised month labels.
- ASCII `data.js` with a test.

## Remaining findings

### High
1. **An uncaught exception on every keystroke in the appliance table**, confirmed in the console: `InvalidStateError: Failed to execute 'setSelectionRange' on 'HTMLInputElement': The input element's type ('number') does not support selection` (app.js line 24).
   - Cause: `field.setSelectionRange?.(focus.start, focus.end)`. Optional chaining doesn't stop a throw.
   - Fix: restore the selection only for input types that support it (text, search, tel, url, password), or wrap the call in try/catch. Number inputs just need focus.
   - Typing must produce no console errors.

### Medium
2. **Honesty panel constants** (round 1 finding 6, not done). The panel still lists only 3 constants. List every exported constant with its value (through the locale formatter) and a short meaning:
   - `PERFORMANCE_RATIO`, `PANEL_WATTS`, `BATTERY_DEPTH`, `BATTERY_EFFICIENCY`
   - `AUTONOMY_DAYS` (the default)
   - `DUNG_KG_PER_COW_DAY` with the ScienceDirect link
   - `BIOGAS_M3_PER_KG_DUNG` with the Daily Star/IDCOL link
   - `KWH_ELECTRIC_PER_M3_BIOGAS`, labelled as a conservative assumption
   - `WIND_SHEAR_ALPHA`, `WIND_HUB_HEIGHT_M`, and the wind verdict thresholds 4.0 and 5.0 m/s
3. **Hero live result** (round 1 finding 10, not done). Beside the wordmark, show a compact live summary for the selected place and building, in both languages:
   - solar: panels × 400 W and kWp
   - battery kWh
   - the cyclone-week verdict: ✓ or ✗, with the cyclone name
   It must update whenever the state changes.
4. **Years print with grouping.** The cyclone dropdown shows `রিমাল (২,০২৪)` / `(2,024)`. Format years (and any other year display) with `useGrouping: false`.
5. **The sunlight and wind "show as table" views aren't wrapped.** At 360 px, opening the sunlight table widens the page to 447 px (the card's content is 434 px in a 334 px card; confirmed). Wrap them in `.table-wrap` and use the localised month names as headers instead of JAN…DEC.

### Low
6. **The battery chart's 0/50/100 % labels stretch** because they sit inside an SVG with `preserveAspectRatio="none"`. Move the labels outside the stretched SVG (for example, an HTML axis column beside it) or draw the chart without non-uniform scaling.
7. **The map implies a wind value.** Districts use the wind series colour (`.district{fill:var(--wind)}`). Use a neutral fill (a tint derived from the rule/ink tokens) with a visible stroke. Highlight the selected district without a series colour, for example a stronger ink stroke plus a darker neutral fill. Keep the pin in the critical colour.

Report which findings you fixed, anything you couldn't, and the proof command output.
