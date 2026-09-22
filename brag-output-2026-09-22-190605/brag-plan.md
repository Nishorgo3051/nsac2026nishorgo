# Brag Plan: Guidebook (working name)

## What is this app?
An offline field instrument for flood response: you download a region pack before you lose
connectivity, and afterwards a real map carrying a real NISAR radar flood measurement keeps working
with no network at all.

## The angle
Every other flood map assumes you have a connection. This one assumes you don't. The video is a
quiet instrument film: the network dies, and nothing on screen breaks. It ends on the thing that
makes it trustworthy rather than impressive — the app states what it *cannot* see.

No jokes. This is a tool for people standing in water. Restraint is the creative direction.

## Hook (first 2-3 seconds)
The real status bar, with the **ONLINE** pill flipping to **OFFLINE** — and the map underneath
carrying on. Four words: *"The network goes first."*

## Key moments (the middle)
- The three pack layers ticking ready one by one: **Region outline**, **Terrain (hillshade)**,
  **NISAR surface change** — then `region available offline`.
- The map itself: real Copernicus hillshade with the real NISAR flood polygons in blue, and none of
  them on the hill ridges (the slope mask doing its job).
- The measurement counting up: **128.4 km²**, **11.7%**, **2,186 patches**, with the two pass dates.

## Outro / punchline
The app's own limitation line, then the principle behind it:
*"An empty layer is honest. Invented water is not."*

## User flow worth showing
Entry → key action → result:
1. Open the app: "Where are you operating?" with the region card.
2. Tap **DOWNLOAD REGION INTELLIGENCE** → three layers store → `region available offline`.
3. Network drops → the map still draws → switch to **Earth** → the NISAR numbers are there.

## Tone
- Preset: **polished**
- Creative direction: a quiet instrument film — evidence, not marketing
- Interpretation: four scenes, long holds, no flourish. Motion is mechanical and small, like a
  readout updating. Every number on screen is one we actually measured; nothing is dramatised.

## Format: landscape — 1920x1080
## Duration: 20s

## Visual identity (from the project)
- Background: `#0a0d0f` (panels `#12171a`, rules `#222b31`)
- Accent: `#4cc9e6` (instrument cyan); flood water `#60a5fa`; warning amber `#e3a33c`; ready green `#63c98a`
- Text: `#e6edf0`, muted `#8c9aa1`
- Display font: ui-monospace / Cascadia Mono / Consolas — uppercase, letter-spaced, the instrument voice
- Body font: system sans (Segoe UI / Roboto)
- Strongest visual element: the hillshade map with blue flood polygons over it, framed by the
  status pills and the scale bar

## Share copy (draft)
We built a field map that keeps working when the network doesn't — carrying a real NISAR
measurement: 128.4 km² of new open water in south Chattogram, from two radar passes twelve days
apart.

## Audio direction
- Role: **sparse professional accents over intentional near-silence**
- Music: **none.** The five bundled tracks are upbeat corporate beds ("happy beats business moves");
  scoring a flood-response instrument with them would undercut every honest claim the video makes.
  Silence is the creative choice here, not a missing asset.
- Music treatment: n/a
- Music cue guidance: n/a — no music, so no beat grid. Timing follows reading floors, not tempo.
- Audio-reactive treatment: none
- SFX posture: sparse, motion-matched, quiet. Interface family only — a soft tick per layer that
  turns ready, one low confirm when the pack is stored, one dry accent as the measurement lands.
  Nothing on the limitation scene; it should land in silence.
- Audio-coupled moments: the three layer ticks arriving one by one; the count-up of 128.4 km².
- Restraint rule: no swells, no risers, no impact hits on the flood map. Sound may confirm an
  action; it may never dramatise the flood.

## Storyboard

### Scene 1 — The network goes first — 4s
The real status bar across the top: `GUIDEBOOK`, the FIELD/EARTH switch, and the pills
`ONLINE · PACK READY · NO FIX`. At 1.5s the ONLINE pill flips to amber `OFFLINE`. Nothing else
changes — that is the point. Headline holds bottom-left: **"The network goes first."**
Sequential/interaction: yes — the pill state change is the only motion, a hard swap, no animation flourish.
Audio intent: near silence; one quiet interface tick on the pill flip.
Audio-coupled idea: the pill flip.
Music: none.
Transition mood: soft → Scene 2

### Scene 2 — Download before you need it — 5s
The real first-run card: **"Where are you operating?"** with `South Chattogram flood region`,
`1098.9 KM²`, and the places `Banshkhali, Chandanaish, Lohagara, Satkania`. Three layer rows tick
ready one by one, roughly 0.8s apart: `✓ Region outline`, `✓ Terrain (hillshade)`,
`✓ NISAR surface change`. Then the button `DOWNLOAD REGION INTELLIGENCE` and, under it,
`region available offline`.
Sequential/interaction: yes — three ticks appear one at a time, then a simulated press on the button.
Audio intent: quiet competence; each tick confirms, the final line settles.
Audio-coupled idea: tick per layer, one low confirm on `region available offline`.
Music: none.
Transition mood: clean → Scene 3

### Scene 3 — What the radar saw — 6s
The map fills the frame: real Copernicus hillshade, cyan upazila outlines, and the real NISAR flood
polygons in blue (asset: `assets/map-flood.png`, rendered from the pack itself). Hold it for a beat
with only the scale bar. Then the WHAT CHANGED readout slides in at right and counts up:
**128.4 km²** new open water, **11.7%** of the region, **2,186** patches — with
`Flood pass 2026-07-12` and `Baseline pass 2026-06-30` above them.
Small caption: *"L-band radar sees through monsoon cloud."*
Sequential/interaction: yes — the three figures arrive in order, each holding ~0.9s; the km² figure
counts up rather than cutting in.
Audio intent: one dry accent as the km² figure settles, then silence under the map.
Audio-coupled idea: the count-up.
Music: none.
Transition mood: soft → Scene 4

### Scene 4 — What it cannot see — 5s
Dark frame. The app's own limitation text, in the muted colour it uses in the product:
*"Detects open water only. Flooded villages, crops and streets are missed."*
Hold. Then the line that earns the video, in full-strength ink:
**"An empty layer is honest. Invented water is not."**
Final frame: the wordmark `GUIDEBOOK` with `works with the network off` beneath it, and small print:
`NISAR L-band GCOV · NASA / ISRO · via ASF DAAC`.
Sequential/interaction: none — two held lines, nothing moves but the type settling.
Audio intent: complete silence. The claim should not be sold.
Audio-coupled idea: none.
Music: none.
Transition mood: hold to black

**Music mood for this video:** none — intentional silence.
**Audio summary:** Four quiet interface cues in twenty seconds — a pill flip, three layer ticks and
one measurement accent — over otherwise empty air, so the instrument sounds like an instrument and
the closing honesty line lands with nothing underneath it.

## Source material notes
- Every string on screen is copied from the running app (`guidebook/app/index.html`, `app.js`) or from
  the pack manifest — no invented UI copy.
- Every number is from the real pipeline run on 22 Sep 2026
  (`South_Chattogram_nisar_flood_2026-07-12.geojson`).
- The map images were rendered from the actual pack files (`terrain.png`, `region.geojson`,
  `change.geojson`): 2,186 real flood patches over 4 real upazila outlines. Nothing drawn by hand.
- Nothing secret appears: no file paths, tokens, accounts, emails or personal data.
