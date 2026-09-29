# Ingito: session handover (29 Sep 2026)

## For Nishorgo: how to start the next session

1. Open a new Claude Code session and choose the folder **`C:\Users\USER\NSAC`**.
   Don't use "No folder": the old session's memory is tied to its own scratch folder, so a new session can't see it. This file and `CLAUDE.md` carry everything it needs.
2. Paste this as your first message:

   > Read HANDOVER.md and CLAUDE.md. Tell me in plain words where the product stands and what you suggest doing next. Don't change anything yet.

---

## 1. Where things stand

- **The app works end to end, on real data:**
  - a Sentinel-1 radar flood map of Feni district, 21 Aug 2024;
  - packed into one 6.7 MB file;
  - opened by an offline field app in English and Bangla;
  - with two one-tap field reports ("water here", "road cut") that export as GeoJSON.
- **It is a rehearsal.** BASIS lets teams build before the event, but the project must be **rebuilt from scratch during the hackathon**. The event build is made from the spec in `the rebuild prompt.md`, not from this code.
- **App code last changed 25 Sep** (commit `f11bc8f`).
  - Local `main` is in sync with GitHub (`origin`, private repo `Nishorgo3051/nsac2026nishorgo`).
  - Everything since 25 Sep has been videos and documents, and none of it is in git (see §10).
- **Video 1 is frozen and ready to upload** (due 1 Oct, 11:59 PM Dhaka).

## 2. Rules that carry over

These are the user's words or long-standing decisions. Follow them exactly.

**Event rule**
- Everything in `NSAC` is practice. Keep it private. **"Never paste this code into the event build."**
- Prefer designs that can be rebuilt cold in 48 hours.
- Any product change that should reach the event must also be written into `the rebuild prompt.md`. That spec is what gets rebuilt.

**Product brief (fixed 22 Sep 2026)**
- Exactly three functions: **flood layer, one pack file, field view** (plus the two reports). There is no fourth.
- Real Sentinel-1 data. NISAR is an honest extension only, and the demo must not depend on it.
- Genuinely offline. No AI, no dashboard, no second mode, no extra hazards, no invented accuracy numbers.
- Flutter, GeoPackage, the pack builder, phone-to-phone transfer and photo reports belong to `the vision.md` (after the hackathon). **Don't start them unless the user asks explicitly.**

**Identity (locked 23 Sep 2026)**
- The logo is traced into `ingito/app/icon.svg`. Never redesign it.
- The brand name is always spelled **ইঙ্গিত** in Bangla.
- Palette:

  | Name | Hex |
  |---|---|
  | River Deep | `#0B3D32` |
  | River Green | `#1E7D6B` |
  | Floodplain | `#A7C4B7` |
  | Delta Sand | `#EAE6D9` |
  | Sun Red | `#E63946` |

  Bright signal teal is for radar water only.
- **Red means attention, only:** a road through water, a field report, a widespread alert, reports not yet handed over. Never decorative, and never the only cue.
- Type: Inter (Latin) and Hind Siliguri (Bangla), stored locally. Light and dark mode. No motion under reduced-motion.

**Honesty**
- Never alter any figure, date, sensor name, orbit number, threshold, area or source citation. If one looks wrong, say so and stop.
- The method finds **open water only**, so every area is a **lower bound**.
  - Keep `detects="open_water_only"` on every output polygon.
  - Call the layer "water seen by radar" or "new open water". Never call it "flood extent".
- Never say a validation passed unless it ran. No accuracy figure is claimed for Feni.
- Sentinel-1 made every processed flood image. Never label anything NISAR unless it is NISAR data.
- **Never invent, draft, paraphrase, or place a "sample" or "illustrative" version of any of the following, anywhere (code, comments, captions or placeholders):**
  - a quote from a responder, official, NGO or any third party;
  - an endorsement, partnership, pilot, deployment or letter of support;
  - a named person outside the four team members;
  - a user testimonial or field anecdote.

  An empty slot stays empty and fails the build.

**Security and git**
- Ask before adding a remote or pushing anywhere public. Commit small local changes freely.
- Never commit `nodir-hishab/data/`, API keys or tokens.
- Never create accounts for the user and never handle their passwords.
- The Earthdata password is in `C:\Users\USER\_netrc` (and `.netrc`). Never print or commit it. The user must never paste it in chat.
- Madeeha uses their own Earthdata account, never Nishorgo's.
- The user's email is for git authorship only. Commit with `-c user.name="NSAC team"` and the same email as the existing commits (`git log -1 --format=%ae`).
- Ask before republishing the shared demo artifact (§12).
- Don't scan personal folders (Documents, Downloads).

**Frozen submission:** never modify, re-render or delete `brag-output-2026-09-28-005210/` (details in §10).

**Talking to Nishorgo:** they are non-technical and often on a phone. Lead with where things stand in 2–3 sentences, then a short dated to-do list. No jargon. Use they/them for everyone: no pronouns were given.

## 3. Team (exact spellings)

| Name | Hackathon role | Startup role |
|---|---|---|
| Nishorgo Nirupom | Team Lead | Founder & CEO |
| Madeeha Obaidiyah | Lead Developer (holds the code handover) | CTO |
| Tabin Zaman | Documentary & Visual Media Lead | Creative Director |
| Alvan Zahedy | Software Engineer | Software Engineer |

- **Challenge:** "Dancing with the SARs" (NASA Space Apps 2026, theme "The Next Frontier").
- A new hire (late Sep 2026) was briefed with `Ingito-Onboarding-Brief.docx`.

## 4. Dates (Asia/Dhaka)

| When | What |
|---|---|
| **1 Oct, 11:59 PM** | Video 1, the prescreening video (≤240 s). Upload to YouTube, then paste the link in the Bangladesh Google Form (nasaspaceappsbd.com). |
| 28 Oct | Full challenge statements published. Re-read ours; it may change the spec. |
| 1 Nov, 6:30 PM *or* 13 Nov | Video 2, the 240 s local judging cut. The site and the guide disagree: confirm with the Local Lead. |
| **13–14 Nov** | The Bangladesh event, a day ahead of the global 14–15 Nov. The 48-hour rebuild happens here. |
| 14 Nov, 12:00 PM | Video 3, the 30 s global demo, with English subtitles. |

## 5. The product as built

The full description is in `ingito/README.md`; read it first.

**Flood layer** (`sar-flood/s1_flood.py`)
- Sentinel-1 C-band VH RTC from the Microsoft Planetary Computer. **No account needed.**
- Relative orbit 114 ascending: baseline **9 Aug 2024**, flood pass **21 Aug 2024**, 18:04 local.
- Method: UN-SPIDER dB ratio. Otsu gave 1.05, outside the plausible 1.1–2.0 band, so the UN-SPIDER default of **1.25** was used.
- Result: **21.7 km² of new open water in 1,159 patches** (2.3% of the 929 km² district).
- Sanity check against the reported ~201 km²: we find about 11%.
  - The pattern matches the event: the northern upazilas hold the most water.
  - The amount does not, for two stated reasons: the pass came on the day the flood arrived, and open-water detection misses flooded villages and cropland.
  - This is qualitative only; no accuracy is claimed.

**Pack**
- One file: `ingito/packs/feni-2024-08-21.pack.json`, format `ingito.pack/1`, 6.7 MB.
- It holds the flood layer, a Sentinel-2 photo (17 Dec 2023, dry season), both radar passes, roads (51 of them crossing water), waterways, places, shelters (OSM, unverified), terrain, upazila outlines and provenance.

**Field view** (`ingito/app/`)
- Canvas map with no map library, tiles or CDN.
- An insight card for the point under the reticle, and the Alerts, Area, Reports, Source and Layers sheets.
- Offline search, Before/After drag, GPS, and English/বাংলা.
- Storage: the pack sits in Cache Storage; reports sit in `localStorage` and export as GeoJSON marked `"source": "field observation"`.
- Offline was verified with the server stopped. The service worker still needs checking in real Chrome.

**NISAR extension** (`sar-flood/nisar_flood.py`)
- Real run: south Chattogram, 30 Jun vs 12 Jul 2026 (track 69), four granules.
- Result: **128.4 km²**.
- Not in the app. The Sentinel-1 cross-check has not been run: **do it only when the user asks**. If the two agree, it becomes a second demo area.

## 6. Code map and how to run

```
NSAC/
  HANDOVER.md, CLAUDE.md, README.md     start here (README's folder table predates Ingito)
  the rebuild prompt.md                 THE SPEC for the 48-h event build (§0 rules, §6 acceptance checks, §8 build order and cut line)
  the vision.md                         post-hackathon roadmap (Flutter, GeoPackage, pack builder, transfer...)
  BRIEF.md                              the older product brief
  sar-flood/
    s1_flood.py                         Sentinel-1 flood layer (Planetary Computer, no login)
    nisar_flood.py                      NISAR extension (needs Earthdata login via _netrc)
    flood_extent.py, test_flood_extent.py   older Earth Engine version, superseded by s1_flood.py
    aoi/                                Feni and south Chattogram boundaries
    out/                                pipeline outputs (git-ignored, this PC only)
  ingito/
    pipeline/fetch_context.py           OSM roads, waterways, places, shelters (+ GeoNames)
    pipeline/fetch_imagery.py           Sentinel-2 photo and the radar pictures
    pipeline/build_pack.py              assembles the one pack file + packs/index.json
    pipeline/embed_pack.py              inlines the pack for the published artifact build
    app/index.html, app.js (~2,500 lines), sw.js, manifest, fonts, icons
    serve.mjs                           local server, port 8767
  .claude/agents/ui-ux-reviewer.md      read-only UI/UX review agent: run it after any app change
  .claude/launch.json                   preview config "ingito"
```

**Run the app:** `node ingito/serve.mjs`, then open http://localhost:8767/app/. In Claude Code, use preview_start with the name `ingito`.

**Python:**
- Use `C:\Users\USER\.venvs\sar-flood\Scripts\python.exe`, or `sar-flood\run.cmd <script.py>`, which sets `PYTHONDONTWRITEBYTECODE=1`.
- Don't install anything into the system Python.

**Pipeline order:** `sar-flood/s1_flood.py` → `fetch_context.py` → `fetch_imagery.py` → `build_pack.py` → `embed_pack.py` (the last only when republishing the artifact).

## 7. Gaps between the practice app and the event spec

Each item below was checked in the code on 29 Sep. The spec (`the rebuild prompt.md`) asks for these, but the practice app doesn't have them yet.

| Spec item | Current app |
|---|---|
| §3.0 one config file per area, no hard-coded place | Feni is hard-coded in `ingito/pipeline/build_pack.py` (≈ lines 54–75) |
| Pack fingerprint and validation; refuse cut-short or altered files (acceptance check 7) | Only checks that `format` starts with `ingito.pack/` (`app.js` ≈ line 2140) |
| §5.7 satellite context stored with each report | Reports have no satellite block |
| §5.6 Layers sheet with an opacity slider | No slider |
| `PACK_FORMAT.md` | Missing |
| Acceptance check 8: a real phone in airplane mode, opened from the home screen, a report made and exported | Not done |
| Acceptance check 9: time-to-map and smoothness on a 2–3 GB RAM Android phone | Not done |
| Service worker registration in real Chrome | Not verified (the dev browser refused to register it) |

Not built, and not in the event spec either:
- an area picker (the app loads the one Feni pack);
- any automatic "change detected" trigger (see §8).

## 8. Open product questions (the user decides)

1. **The distribution trigger.** Nishorgo's answer for the video was that the system generates the pack when "a significant change is detected at or around the user's location", stores it offline-first on the device as a regional pack, and keeps it available without connectivity.
   - **No code does this today.** Packs are built by running the pipeline, and users tap download.
   - Choose one:
     - (a) call it planned;
     - (b) say "the team generates the pack";
     - (c) build it. Building it would need a preparation server watching new satellite passes, which is vision stage 3, not the 48-hour build.
   - The v3 video's slide stays blocked ("TO CONFIRM") until this is answered.
2. **Whether to add south Chattogram (NISAR, 2026)** as a second demo area, after the Sentinel-1 cross-check.
3. **Anything the 28 Oct challenge statement changes.**

## 9. Suggested next steps for product development

In order. Confirm with the user before starting any of them.

1. **Close the §7 gaps in the practice app,** smallest first:
   1. the config file per area;
   2. pack fingerprint and validation (acceptance check 7);
   3. the satellite block on reports;
   4. the opacity slider;
   5. `PACK_FORMAT.md`.

   The point is to prove that the spec is buildable, and to time it. Update `the rebuild prompt.md` if anything in it proves wrong.
2. **Real-device checks 8 and 9,** plus the service worker in Chrome. Nishorgo has to hold the phone; write the numbers down.
3. **A timed practice rebuild** from `the rebuild prompt.md` in an empty folder. Nishorgo keeps time. Record what was dropped at the cut line.
4. After 28 Oct: re-read the full challenge statement and adjust the spec.
5. Only if asked: the NISAR cross-check, or anything from `the vision.md`.

After any app change:
- run the `ui-ux-reviewer` agent;
- check 320×568, 360×740, 375×812 and 1280×780, in both languages and both modes;
- keep the measured contrast ratios.

Visible UI changes also make the app recordings in the videos out of date. Tell the user.

## 10. Videos and documents (context; none of this is in git)

| Folder / file | What it is | Status |
|---|---|---|
| `brag-output-2026-09-28-005210/` | **Video 1, FROZEN.** `ingito-240-seconds-720p.mp4`, 235 s | Upload by 1 Oct. **Never modify, re-render or delete.** Check it with `sha256sum -c ../ingito-video-v3/FROZEN_1OCT.sha256`, run from inside that folder (135 files). |
| `ingito-video-v3/` | Draft for local judging, 238.2 s | Blocked: 3 empty footage slots (see `FOOTAGE_BRIEF.md`) plus the trigger question. `tools/build_timeline.py final` refuses to render until they are filled. Read its `HANDOFF.md`. |
| `ingito-video-v3/Ingito-v3-Voiceover-Script.docx` | Script for the voice artist | Sent. When the recordings arrive, swap them in and re-time. Credit the artist by name only with their consent. |
| `ingito-film/` | A cinematic 3:40 film, real material only, no slots | Done: `ingito-film-720p.mp4`, a 1080p master, and `ingito-film-poster.jpg` (YouTube thumbnail). Music: "Eternal Hope", Kevin MacLeod, CC BY 4.0. Read its `HANDOFF.md`. |
| `brag-output-2026-09-26-213447/` | The earlier 3:31 film | Fallback only. |
| `Ingito-Onboarding-Brief.docx` | 16-page brief for the new hire | Done. |

**Video tooling**
- Hyperframes (`npx hyperframes check`, `snapshot`, `render --quality delivery`; about 14 min per render) and ffmpeg.
- Kokoro TTS: borrow the frozen folder's `.venv-tts` Python with `PYTHONDONTWRITEBYTECODE=1`, and never write into that folder.

**Music rules**
- Only CC BY or clearly licensed music, always credited.
- No copyrighted songs: the Bangladesh guide bans them, and YouTube Content ID flags them.
- AI use must be named on the credits card.

**No backup:** these folders exist only on this PC. Tell the user and suggest they copy them somewhere else. Don't add them to git: they are large, and the mp4s are git-ignored.

## 11. Windows gotchas on this PC

- **CRLF.** Python's `write_text` writes CRLF, but the repo is LF (`core.autocrlf=false`). Write with `newline="\n"`, and check staged files for `\r\n` before committing.
- **260-character paths** break Python on the long scratchpad path. Keep work in `NSAC` or use short temp paths.
- **Long bash heredocs fail.** Use the Write tool for big files.
- **GateGuard hooks** ask for stated facts before the first Bash, Write or Edit on each file, and before destructive commands. State them and retry.
- **Offline proof.** An artifact can't prove offline behaviour. Demo it from the local server or a real https host.

## 12. Links (all private unless noted)

- Live app demo: https://claude.ai/artifact/EpMDVyQZD9KALxwrZxbCzW. **Shared with anyone who has the link**, so ask before republishing.
- New-hire brief (web): https://claude.ai/artifact/Bp9kpXvqJ8Y95DvEdGLqHG
- Flood-mapper write-up: https://claude.ai/artifact/BE6Wt1V6DFXaWwbjY8o45N
- Sourced outside facts used in the videos:
  - 92% of Feni's towers were down (BTRC, via the Dhaka Tribune, 23 Aug 2024);
  - all six upazilas were cut off (Start Network, 24 Aug 2024).

## Still waiting on Nishorgo (not product code)

1. Upload Video 1 by **1 Oct, 11:59 PM**.
2. Answer the trigger question (a / b / c).
3. Footage for the v3 slots: Tabin (SLOT 1), Nishorgo (SLOT 2), the team (SLOT 3).
4. The Local Lead's OK on "concept only", and the Video 2 date.
5. The BASIS rebuild ruling **in writing**.
