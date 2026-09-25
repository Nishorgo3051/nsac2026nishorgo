# Ingito — where it goes after the hackathon

*The event build (`the rebuild prompt.md`) proves the idea in 48 hours. This page is the plan for
everything after it, for the pitch and for the team. Nothing here is built yet unless it says so.*

## What Ingito is

An offline, satellite-derived geographic intelligence instrument for people entering places where
the routes, the flood and the ground are not known, and where the network cannot be relied on. It
takes Earth-observation intelligence, packages it for one area, carries it into the field, and lets
the person holding the phone understand both the satellite picture and what they see around them.

It is deliberately narrower than a disaster-management platform. It has three centres of gravity
and no fourth:

- **The flood layer:** real radar observations turned into a map layer that always carries its
  sensor, its date and age, how it was processed, and what it cannot see.
- **The Ingito Pack:** one portable file with everything needed to use that layer with no network:
  the flood information, a basemap, roads, rivers, terrain, shelters, boundaries, sources and
  licences, processing history, and a fingerprint to check the file is intact.
- **Field View:** the phone app that answers where am I, what is around me, which routes cross the
  water, where shelter is, what the satellite says and how old that is. Two taps record what the
  satellite cannot see: "Water here" and "Road cut". Reports stay on the phone until someone
  deliberately exports them.

## What already works (September 2026)

- A real Sentinel-1 flood layer for Feni, August 2024: 21.7 km² of new open water in 1,159
  patches, checked against the documented event, with no accuracy figure claimed.
- A real NISAR L-band run for south Chattogram, July 2026: 128.4 km² from four real granules.
  Still to do: the cross-check against Sentinel-1.
- One pack file, an offline field app in English and Bangla, field reports exported as GeoJSON.

## The plan, in stages

**1. A field app built for ordinary Android phones.** Rebuild Field View in Flutter, with Android
as the reference device, iOS alongside, and an honest web version. Device features (storage,
location, files, transfer) sit behind clear interfaces, each with a real implementation per
platform, not faked on the web. Measure on low-end phones: start-up, opening a pack, map drawing,
search, memory, battery.

**2. Pack version 2.** A GeoPackage (a standard SQLite container for map data) inside an Ingito
Pack, with a versioned manifest: coverage, datasets, observations, processing versions, licences,
both languages, checksums. Map data stored as tiles with a spatial index, so a phone never loads a
whole district into memory. Version 1 packs are migrated, not thrown away. *To check first: how
well Flutter can draw GeoPackage map data offline on a phone.*

**3. A pack builder for any area.** Start on a map: search for a village, upazila or district, or
draw an area. The builder then:
- lists the real satellite passes available, with their sensor and date
- shows which layers are required and which are optional
- calculates the actual file size before anything is built
- shows real processing stages while it builds
- marks a pack "ready" only after it passes validation

This needs a preparation server, because radar processing is heavy.

**4. NISAR first, Sentinel-1 alongside.** Use NISAR wherever its products and a correct processing
chain are genuinely available. Use Sentinel-1 for more frequent revisits, as a fallback, and to
cross-check NISAR. The map always states which sensor it shows. Nothing is ever labelled NISAR
unless it is NISAR data.

**5. Better flood science.** Today's method finds open water only. Next:
- Flooded fields, trees and streets often turn *brighter* to radar ("double bounce"). Detect that
  too, and show it as a separate, clearly labelled class.
- Account for the radar's viewing angle, for terrain shadow and for water that is normally there.
- Keep what was directly observed apart from what was inferred.
- Validate against more Bangladesh flood events, and write down where the method is wrong as well
  as where it is right.

**6. Field reports, version 2.** Optional photo (compressed, with location and camera data stripped
unless kept on purpose), note and severity, never required before saving. Stored in a real local
database. A clear life cycle: saved → ready → exported. The app never says "synced" unless
something actually was.

**7. Phone-to-phone transfer.** Files first. Then native nearby transfer: Android's nearby
connections and iOS's peer-to-peer. A QR code carries only the pack's identity and fingerprint,
never the pack itself. Every received pack is checked before it is accepted, and a failed transfer
never replaces a good pack.

**8. Security and privacy.**
- Every imported pack is treated as untrusted and checked (structure, version, checksums, file
  paths, geometry).
- No hidden telemetry.
- Location and camera permissions are asked for only when needed.
- Field reports are encrypted on the device.
- No hard-coded credentials.

**9. Beyond floods.** The hazard is already a field in the pack, not the shape of the app. Riverbank
erosion, cyclone damage and landslides can use the same pack, the same field view and the same
reports, with a different sensor and method recorded in the pack.

## What Ingito will not become

A dashboard with a map in a corner. An AI product. A tool that shows confidence percentages it
cannot defend. A demo that dresses up one sensor's output as another's.
