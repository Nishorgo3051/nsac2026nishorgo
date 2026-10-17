# Field UI simplification: what moved

Branch `ui-simplify`, from `298797e`. Nothing was removed: every control below still works and is
reachable. App code only; no pack was rebuilt (file code stays `2BA5-82C2`).

## Where each control went

| Control | Was | Now |
|---|---|---|
| Observation date | Telemetry line in the bar, cut short on narrow screens | Bar, always: "Radar saw this: 21 Aug 2024, 18:04 UTC+6" |
| "Conditions may have changed since this observation." | Label screen, only past 3 days | Bar, always, at any age |
| File code | Label screen and Source sheet | Bar, always (small); still in Source |
| EN / বাংলা | Bar | Bar (unchanged, 48 px buttons) |
| Light / dark | Bar | More |
| Online / offline chip | Bar | More, in its header |
| Brand wordmark INGITO ইঙ্গিত | Bar | First-run screen only; the logo stays in the bar |
| Map label (radar date, age, covers, shows, code) | Covered the map on every pack open until "Open the map" | More › the pack's name; opens the same label |
| Search a place | Over the map | More, at the top |
| Layers (10 switches, Print) | Button over the map | More › Layers |
| Before / After | Chip over the map | More › Before / After; while on, its chip stays on the map as the way out |
| One-time "See the flood arrive" hint | Over the map | Gone (Before / After itself stays) |
| Locate, zoom + / − | Map edge, 44 px (40 px on short phones) | Map edge, 48 px |
| Radar key (legend) | Over the map | Over the map (unchanged; hidden on short phones as before) |
| Place line (upazila, village, GPS or crosshair, coordinates) | Card; tapping it opened Area | Card, plain text; Area is in More |
| Nearest shelter | Card, straight-line distance; tapping it drew a route | Card, distance BY ROAD with direction once the road network is built (straight line until then); plain text |
| Road route | Tap the shelter line | **Route** button (primary) |
| Water here | Card button | **Water here** button (primary, unchanged) |
| Road cut | Card button | **Road cut** button (primary, unchanged) |
| Save pack as a file | Packs sheet | **Share pack** button (primary), and still in More › Packs |
| Undo after a report | Box above the buttons, until the next tap or map move | Same (no timer, as approved) |
| Alerts tab (per-upazila figures) | Bottom bar | More › Alerts |
| Area tab | Bottom bar | More › Area |
| Reports tab (list, delete, export, SMS, paste texted reports) | Bottom bar, with red count | More › My field observations; the red count is on the More button |
| Text my reports (SMS) | Reports sheet | More (directly) and Reports sheet |
| Print this map | Layers sheet | More (directly) and Layers sheet |
| Source tab | Bottom bar | More › Source |
| Packs tab (save, open another, make a smaller pack) | Bottom bar | More › Packs |

## New strings awaiting approval

| Key | English | Bangla |
|---|---|---|
| `more` | More | আরও |
| `sharePack` | Share pack | প্যাক শেয়ার করুন |
| `routeBy` | 1.5 km by road, N · mosque (unverified) · name | রাস্তায় ১.৫ কিমি, উত্তরে · মসজিদ (যাচাই হয়নি) · name |
| `routeNoLink` | No road in this pack links here to a shelter outside radar water | এই প্যাকের কোনো রাস্তা এখান থেকে রাডারে দেখা পানির বাইরের কোনো আশ্রয়ে যায় না |
| `routeClear` and the two route notes | Tap to remove. (was "Tap to clear.") | unchanged: সরাতে চাপুন। |

`routeBy` is built from pieces the app already had ("রাস্তায় …", the direction words); it still needs a
Bangla reader's OK.

## Real-phone checklist

Use the github.io address, on a cheap Android, after this branch is published there.

1. On mobile data, open the address. Note the seconds until the map shows.
2. Tap Download this pack. Note the seconds.
3. Read the bar: date, the red caution and the file code `2BA5-82C2`.
4. Read the shelter line: it should say "… km by road, …" within a few seconds.
5. Tap Route; tap it again to remove the route.
6. Tap Water here, then Undo. Tap Road cut.
7. Add Ingito to the home screen from the browser menu.
8. Switch on airplane mode. Close the browser completely.
9. Restart the phone (cold reboot). Open Ingito from the home screen, still in airplane mode.
10. The map, the bar and the shelter line must all appear. The More header should say Offline.
11. Tap Route, Water here and Road cut again.
12. More › Print this map: choose Save as PDF and open the PDF.
13. Switch airplane mode off, keep mobile data off: More › Text my reports. The messages app should open with one line per report.
14. Tap Share pack. Send the file to a second phone with Quick Share or Bluetooth.
15. On the second phone: open Ingito, More › Packs › Open another pack, pick the file. Both phones must show the same file code.
16. Switch to বাংলা and repeat steps 3 to 5.

## What could not be done without breaking a constraint

The Alerts and Area sheets still show km², shares and patch counts. They are now behind More, not
merged into the Source sheet, because merging them would be the broad refactor the brief rules out.
Two notes still contain the word "dry": the pack's own note on the photo ("Dry-season picture…") and
the shelter note ("…not a guarantee it is open, dry or reachable"), with its Bangla mirror. Both
are pack contents or translate them, and both deny the claim rather than make it, so they stay.
Two gradients remain: the hatched swatch that is the map's own symbol for radar water, and the
locked logo. Before / After is still a view you switch into and out of, because removing it would
remove a feature; it now lives in More. Typing remains in More (search, pasting texted reports)
but nowhere in the field flow. Offline was tested by stopping the server, since the test browser
has no airplane mode; a real phone in airplane mode is still to do. Printing, saving files and
opening the messages app stay blocked inside the claude.ai preview; they work at the github.io
address.
