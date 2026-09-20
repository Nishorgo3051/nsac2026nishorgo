# Shakti Map — Codex build log

- Repo: `shakti-map/` (scratch workspace). Git baseline `535229c`, created with the user's authorization.
- Spec: `docs/WORK_ORDER.md` (sha256 435fae84…). **Unreviewed spec**: the user asked for codex-build directly, and no plan review was run.
- Roles: host/planner Claude; builder Codex (codex-cli 0.147.0, CLI default model, unresolved); inspector Claude.
- Proof command: `node scripts/build_data.mjs && node --test tests/`

## Round 0 — initial build (Codex)
- Runner artifacts: `claudex-s36rhf_d`. Status completed, 439.7 s.
- Codex created:
  - `scripts/build_data.mjs`
  - `web/index.html`, `web/app.js`, `web/calc.js`, `web/data.js` (generated)
  - `tests/calc.test.mjs`, `tests/build.test.mjs`, `tests/index.js`
- Codex's reported deviation: district paths were empty, so it drew centre dots. This was confirmed as a host data bug.
- Codex stderr: repeated `codex_models_manager` cache warnings (missing `supports_parallel_tool_calls`). This is likely a CLI/model metadata version mismatch; the build still completed.

## Host inspection of round 0 (Claude)
- **Proof**, run independently: 6 of 6 tests pass. `data.js` holds 64 districts, 9 cyclones and the climatology period.
- **Formulas** in `calc.js` were checked against the work order and hand calculations. The cyclone simulation matches a hand-worked 3-day case (battery 0.6 → 0 with a 0.4 shortfall → 1.6).
- **Browser checks** (local `python -m http.server 8123`):
  - No console errors.
  - Focus is lost after typing in the appliance table: `activeElement` becomes BODY after one input event.
  - The wind verdict shows raw keys.
  - Cyclone names are mojibake (a classic-script encoding problem).
  - At 360 px, with a viewport meta injected for the test, the appliance card overflows (363 > 334).
  - Dark-mode tokens resolve correctly.
- **Host edit** (authorship Claude): `scripts/01_districts.mjs` Douglas–Peucker on closed rings collapsed every outline. It now splits rings at the farthest vertex. `data/districts.json` and `web/data.js` were regenerated (193 KB, 16,117 vertices). Proof is still 6 of 6. Codex must review this change.
- **Side finding, outside this build:** the same closed-ring bug broke the upazila outlines in `nodir-hishab` (2 points each).

## Round 1 — fix round (Codex, resumed)
- Feedback file: `fix-round-1.md`, with 11 findings (2 high, 6 medium, 3 low).
- First resume attempt: the runner refused with "Checkout changed since the previous build". The host's `districts.json` fix changed the snapshot, and there's no override flag.
- Disposition: host edits backed up to `host-edits/`; `scripts/01_districts.mjs` and `data/districts.json` restored to the baseline; `web/data.js` regenerated to match Codex's snapshot; resume relaunched. The host re-applies the districts fix after Codex's round. Codex then inspects that host change (builder claude, inspector codex), and Claude inspects Codex's round.
- Round 1 result: artifacts `claudex-g_l7uii_`, completed in 447.8 s. Codex changed `scripts/build_data.mjs`, `web/index.html`, `web/app.js`, `web/data.js` and `tests/build.test.mjs`. `calc.js` and `calc.test.mjs` are unchanged (same sha).
- Host re-applied the districts fix from `host-edits/` and rebuilt the data. Proof run independently: 6 of 6 pass; `data.js` has 0 non-ASCII bytes; Remal's `bn` is রিমাল; 0 empty paths; `data.js` is 300 KB.
- Claude's code inspection of round 1:
  - Fixed: #2 (real paths with dot fallback, keyboard), #3 (verdict labels), #4 (dates, conditional fix, week table, focus/hover detail, y labels), #5 (appliance and week tables wrapped; body overflow removed), #7 (ASCII data + charset + test), #9 (tests for all climatologies), #11 (localised months).
  - Partly fixed: #1. Codex restores focus after a full re-render instead of avoiding the re-render.
  - Not fixed: #6 (honesty constants) and #10 (hero live result).
  - New: years are formatted with grouping ("2,024"); the sun/wind tables have no overflow wrapper; SVG y-labels sit inside `preserveAspectRatio="none"`, so they stretch; the map fill uses the wind series colour.
- Browser verification of round 1, with real outlines re-applied:
  - Working: 64 district paths render; no mojibake; focus kept while typing; 20 ms re-render per keystroke; map 304×431 px at 360 px.
  - Confirmed: an uncaught `InvalidStateError` from `setSelectionRange` on number inputs at every keystroke; the cyclone option shows "রিমাল (২,০২৪)"; opening the sun table at 360 px widens the page to 447 px.
- Disposition: a second resumed fix round (`fix-round-2.md`, 7 findings). Before resuming, the host edits were restored to the baseline again and `data.js` was regenerated, so every file matches the round-1 snapshot hashes. The districts fix is re-applied afterwards.
- Fix-round budget: 2. Anything left after round 2 is either fixed by the host and inspected by Codex, or reported.

## Round 2 — failed (Codex)
- Artifacts: `claudex-v6zlm3nt`. Status failed, exit 1, after 199 s. Empty snapshot, no reply.
- Cause: the Codex account hit its usage limit ("You've hit your usage limit… try again at Oct 1st, 2026 6:18 PM").
- Problems before the cutoff:
  - `apply_patch` failed three times on long minified lines in `web/app.js`.
  - Windows sandbox error `CreateProcessWithLogonW failed: 267`.
  - A PowerShell `Substring` error.
  - A command timeout.
  - Codex then edited `web/app.js` and `web/index.html` with PowerShell string replacements.
- State left behind: `web/app.js` and `web/index.html` differ from the round-1 snapshot. These are partial, unreviewed round-2 edits, backed up to `round2-partial/`.
- Consequence: neither the Codex builder nor the Codex cross-inspector is available until 1 Oct 2026. The runner can't resume from a failed result.
- **User decision (15 Sep):** Claude finishes now (host takeover).
  - Disclosed gap: Codex can't independently inspect Claude's edits (the districts data fix and the round-2 fixes) until the limit resets on 1 Oct 2026.
  - Claude reviews Codex's partial round-2 edits before building on them.
- Claude's review of Codex's partial round-2 edits (`round2-partial/`):
  - Correct and kept: `year()` without grouping (#4); the `setSelectionRange` guard for selectable types only (#1); the live summary in the header (#3); the neutral map fill with an ink-stroke selection (#7).
  - Not applied: #2 (honesty constants), #5 (sun/wind table wrap + localised headers), #6 (battery y-labels stretched).
- **Host takeover edits (authorship: Claude), not reviewed by Codex:**
  - `web/app.js` rewritten from minified one-liners into readable functions, keeping round 1 and the kept partial round-2 behaviour.
  - Added: #2 full constants table with sources; #5 wrapped, localised month tables; #6 an HTML y-axis outside the stretched SVG with a non-scaling battery line; the digits in the biogas assumption line localised.
  - Also added: focus restore for districts, selects and buttons; `documentElement.lang`; a theme toggle that respects the system theme; clamping for autonomy (1–5) and cattle (0–200); a "District centre" option when the place isn't a sample; shortfall markers moved inside the chart.
  - `web/index.html` CSS reformatted for readability, with the same tokens, plus the `.linewrap`, `.yaxis`, `.constants`, `.num` and `.ok` styles.

## Verification of the host takeover (Claude)
- Proof: `node --check web/app.js` passes; `node scripts/build_data.mjs && node --test tests/` gives 6 of 6.
- Browser checks (local `http.server`), all driven by in-page JS:
  - The map draws 64 district paths; no mojibake; years are ungrouped ("রিমাল (২০২৪)", "Remal (2024)").
  - Focus stays in the count and watts inputs while editing. A window `error` listener caught no errors. The earlier `InvalidStateError` in the console came from the old minified file (line 24, col 332).
  - Cattle 30 gives 300 kg, 12 m³ and 18 kWh (matches the constants). Focus stays on the cattle input.
  - Pressing Enter on a district selects it (Barguna); focus stays on that district; the place select shows "District centre: Barguna".
  - Detail lines: sun focus shows "জুল: ৪.০৯ kWh/m²"; wind hover shows "জুন: ৫.১১ m/s"; week focus shows the date, sunlight, solar kWh, battery % and shortfall.
  - English mode: localised verdict chip, month names, cyclone name and year; `documentElement.lang` is `en`; the constants table has 11 rows in both languages.
  - At 360 px (viewport meta injected, as the host adds it at publish): no page overflow even with the sun, wind and week tables open; the map is 304×431 px; the y-axis labels are about 67 px apart.
  - Dark mode: system dark gives background #121816. The theme toggle first switches to light, then back to dark. The district fill uses the dark rule token.
- A failing case, found with `calc.js` against the bundled data: clinic, Kutubdia, Hamoon, autonomy 1 runs out on 24 Oct 2023, and the fix is 2 days (also Hatiya/Sandwip with Bulbul, Midhili and Remal).
- Screenshots aren't reliable in this pane (blank or timeout) because the window isn't in front. Visual review is limited to measured layout.
- Failing path in the browser (clinic, Kutubdia, Hamoon, autonomy 1):
  - Bangla verdict "✗ বিদ্যুৎ শেষ হয়েছে ২৪ অক্টোবর, ২০২৩"; fix line "সমাধান: ২ দিনের স্বয়ংসম্পূর্ণতা"; 1 shortfall marker; the header shows ✗ হামুন.
  - English: "✗ Power ran out on 24 October 2023" and "What would fix it: 2 days of autonomy".
  - With autonomy 2 the week survives and the fix line is hidden. Typing 9 days clamps to 5. No window errors.

## Result
- Published privately as an artifact, version 1: https://claude.ai/artifact/Ag9ZbJRf5bEnTax7YBfQRS (index.html + app.js + calc.js + data.js).
- Authorship:
  - Codex: `calc.js`, the tests and `build_data.mjs` (rounds 0–1), plus the partial round-2 edits Claude kept.
  - Claude: the districts data fix and the `app.js`/`index.html` rewrite with the round-2 fixes.
- Residual gaps:
  - Codex hasn't inspected any Claude-authored change; its usage limit runs until 1 Oct 2026.
  - No pixel-level visual review (screenshots unavailable).
  - The tests cover `calc.js` and the data build only; UI behaviour was checked manually in the browser, not by automated tests.
  - Nothing is committed beyond the baseline `535229c`; there's no user authorization for further commits.
