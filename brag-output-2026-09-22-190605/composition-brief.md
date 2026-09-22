# Hyperframes Composition Brief: Guidebook (working name)

## Objective
Create a short launch-style brag video for the Guidebook offline field client.

## Output
- Composition directory: `composition/`
- Rendered video: `brag.mp4`
- Format: landscape — 1920x1080
- Duration: 20 seconds

## Source Material
- Project root: `guidebook/` (app) and `sar-flood/` (pipeline) in the NSAC repository
- Primary files read: `guidebook/app/index.html`, `guidebook/app/app.js`,
  `guidebook/packs/chattogram-south/manifest.json`, `sar-flood/METHODOLOGY.md`
- Product name: Guidebook (placeholder name)
- Tagline / strongest claim: the region pack keeps working with no network, and it carries a real
  NISAR radar flood measurement
- Key UI or visual moment to recreate: the first-run region card with its three layer ticks, and the
  Earth-mode "What changed" readout over the flood map
- Copy that must appear verbatim (all of it real app or manifest text):
  - "Where are you operating?"
  - "South Chattogram flood region" / "1098.9 km²"
  - "Region outline" / "Terrain (hillshade)" / "NISAR surface change"
  - "Download region intelligence" / "region available offline"
  - "What changed" / "Flood pass 2026-07-12" / "Baseline pass 2026-06-30"
  - "Detects open water only. Flooded villages, crops and streets are missed."

## Creative Direction
- Tone preset: polished
- Creative direction: a quiet instrument film — evidence, not marketing
- Interpretation: four scenes, long holds, small mechanical motion. The video should feel like a
  readout updating, not an ad. No humour: this is a tool for people standing in water.
- Angle: every other flood map assumes you have a connection; this one assumes you don't. The
  network dies on screen and nothing breaks. It closes on what the instrument cannot see, because
  that is what makes the rest of it trustworthy.
- Hook: the ONLINE pill flipping to OFFLINE while the map carries on — "The network goes first."
- Outro / punchline: "An empty layer is honest. Invented water is not."
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Any dramatisation of the flood itself

## Visual Identity
- Background: `#0a0d0f` (panels `#12171a`, rules `#222b31`)
- Text: `#e6edf0`, muted `#8c9aa1`
- Accent: `#4cc9e6`; water `#60a5fa`; warning `#e3a33c`; ready `#63c98a`
- Display font: generic `monospace` (uppercase, letter-spaced) — the instrument voice. No webfont is
  loaded, matching the app, which ships no fonts so that it works offline.
- Body font: generic `sans-serif`
- Visual references from the project: the status pills, the first-run region card, the scale bar, the
  provenance readout

## Storyboard
`brag-plan.md` is the creative contract.

1. The network goes first — 4s — status bar, ONLINE flips to OFFLINE, headline holds
2. Download before you need it — 5s — region card, three layer ticks one by one, "region available offline"
3. What the radar saw — 6s — the real flood map, then the measurement counting up to 128.4 km²
4. What it cannot see — 5s — the limitation line, then the honesty line, then the wordmark

## Audio
- Audio role: sparse professional accents over intentional near-silence
- Audio arc: four quiet confirmations in twenty seconds, then nothing at all under the closing lines
- Music: none — intentional. The bundled tracks are upbeat corporate beds; scoring a flood-response
  instrument with them would undercut every honest claim in the video.
- Music treatment: n/a
- Music cue guidance: n/a — with no music there is no beat grid, so timing follows reading floors.
  Beat-locking and beat-grid snapping are deliberately not used here.
- Audio-reactive treatment: none (no music to react to)
- Audio-coupled moments:
  - Scene 1, 1.5s — the ONLINE to OFFLINE pill flip
  - Scene 2, 5.2 / 6.0 / 6.8s — three layer ticks arriving one at a time
  - Scene 2, 7.9s — the pack stored
  - Scene 3, 12.4s — the measurement settling
- SFX selection guidance: interface family only, low volume (0.26–0.35), matched to visible motion
- SFX analysis guidance: `assets/sfx/sfx-analysis.md` in the brag skill
- Exact SFX chosen: `switch_004` (pill flip), `click_002` copied to three separate files (the ticks,
  split so the compiler does not treat them as one duplicated media node), `bong_001` (pack stored),
  `select_008` (measurement)
- Audio files: copied into `composition/assets/sfx/`

## Hyperframes Instructions
Built against `hyperframes-core`: standalone root, one paused GSAP timeline registered at
`window.__timelines["brag"]`, four timed clips, audio elements with ids on their own track indices.

Deviations from the default checklist, stated rather than hidden:
- **No music, therefore no beat-lock and no beat-grid.** The plan documents this as a creative choice,
  not a missing asset.
- **No audio-reactive treatment**, for the same reason.
- Four scenes live in one file rather than four sub-compositions. `check` warns about this
  (`nested_structure_needs_subcomposition`, `timeline_track_too_dense`); for a 20-second piece one
  file is easier to read and revise than five.

## Gate
`npx hyperframes check` — 0 errors, 5 style warnings, 0 layout issues across 9 samples,
35/35 text checks pass WCAG AA.
