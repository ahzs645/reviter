# Reviter

Reviter is a local-only Revit inspection and experimental geometry conversion library with a browser studio and a Node extraction command. A local `.rvt`, `.rfa`, `.rte`, or `.rft` file can be opened from the browser file picker and converted in a dedicated Web Worker, or processed directly into an open format from the command line. The application has no file upload route, account system, telemetry, or remote conversion service.

Live client-only application: **https://projects.ahmadjalil.com/reviter/**

Every push to `main` is tested, built as a static Vite application, and deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml). The Pages build is separate from the existing Vinext/Cloudflare build but reuses the same React interface, converter library, Web Workers, and WebAssembly decoders.

Most of what is known about the format was arrived at by measuring, and that
record — what was probed, what the controls said, what was tried and rejected —
lives in [`docs/`](docs/README.md) rather than here. This file describes what
Reviter does now.

## Extract geometry from an RVT

The converter reads the Revit release from the file's own `BasicFileInfo`
stream, so the direct API and Node command do not require a separate metadata
pass or a hard-coded release:

```sh
npm ci
npm run extract -- model.rvt --out model.glb
```

The output extension selects GLB, OBJ, DXF, SVG, IFC proxy, Pascal scene, or
JSON audit output. All formats use the same locally recovered scene as the
browser; no model data is uploaded. Use a paired export to verify a model element
by element when one is available:

```sh
node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc
```

## Open a recovered model in Pascal

[Pascal](https://github.com/pascalorg/editor) is an open-source local-first
building editor whose scene is a graph of typed building nodes, not a mesh. The
Pascal export writes those nodes straight out of what the RVT states — a wall's
location line and thickness from its own plane triples, a door's host wall from
`InsertableInst.m_hostId`, a storey from `Element.m_assocLevelId` — so nothing is
re-derived from a mesh or defaulted:

```sh
npm run extract -- model.rvt --out model.pascal.json
```

Load it in Pascal through the settings panel's **Save & Load → Load Build**. The
same export is the **Pascal** button in the browser studio.

Against the paired Autodesk GLB export of the supplied building, the exported
Pascal scene agrees to 99.65% of its surface and 99.16% of the reference's, at
0.5 m voxels — the recovery it is written from scores 99.98% both ways, and the
gap is Pascal's vocabulary: openings not cut out of walls, joins not mitered, and
pitched roofs flattened to a plate.

`--extras all` additionally carries every remaining element — mullions, railings,
furniture — as Pascal `block` solids, which needs an editor built from the Pascal
repository rather than the current npm release. [Exporting to
Pascal](docs/pascal-scene-export.md) is the full record: the coordinate and
storey-stacking mapping, the per-category table, what does not cross, and the
measurements behind it.

## Development

```bash
npm install
npm run dev
npm test
npm run test:pages
```

`scripts/browser-check.mjs` is the manual end-to-end check that the built bundle really converts a Revit file in a browser tab. It serves `dist-pages` locally, drives Chromium through the same file input a person uses, and reports the rendered conversion summary plus a screenshot. It needs a local Revit file, so it stays out of `npm test`.

```bash
npm run build:pages
node scripts/browser-check.mjs dist-pages /path/to/model.rvt shot.png /path/to/reference.ifc
```

Build it with the default base path for that check; a bundle built for GitHub Pages requests its assets from `/reviter/` and will not boot under the local root server. Passing the matching IFC export also pairs it in the same tab, which is how the [paired regression workflow](docs/unbc-paired-export-harness-2026-07-28.md#paired-regression-workflow) was verified: on 2026-07-28 the 67 MB sample model converted in about 25 seconds and its 80 MB IFC paired to 41,312 typed elements, both without leaving the browser.

The raw SVF extraction remains in ignored `work/` storage. **No reference derivative is bundled any more.** A 25.6 MB GLB of one building used to ship in the repository and be offered to whichever file matched it, which meant every clone carried a derivative of someone's project and every other RVT found the feature permanently disabled. The comparison is worth keeping — a conversion by Revit's own tooling is the best yardstick there is for judging a recovery — so the capability stayed and the asset went: pair your own GLB or glTF from disk, exactly as a paired IFC export is already supplied. It is read in the browser through an object URL and never uploaded, it works for any model, and nothing about a particular building is compiled in. The deployment now ships only the small glTF runtime loader.

The [Autodesk capture pipeline](tools/autodesk/README.md) makes that reference
workflow repeatable: capture a loaded Autodesk 3D view, retain its complete raw
SVF bundle, then run `npm run autodesk:convert -- capture.tar --out work/autodesk/model`
to produce a GLB with geometry checks, fragment IDs, checksums, and validation
reports. Install its separate local dependencies with `npm run autodesk:setup`.

### Google Colab build

Run `python3 scripts/prepare_reviter_colab_bundle.py` to snapshot the current tracked and untracked build inputs into `My Drive/Reviter`. The generated `reviter_pages_build_colab.ipynb` follows the same Drive-backed pattern as CBCTer: it mounts Drive, verifies the source and Autodesk-model checksums, extracts the active workspace to `/content`, runs the Pages validation build there, and saves the artifact, summary, and build log under `My Drive/Reviter/reviter-outputs`.

The storage and compute responsibilities are intentionally separate:

1. Google Drive is the persistent handoff. It keeps the source archive, manifest, recovered Autodesk GLB, notebook, logs, summaries, and finished artifacts.
2. A Colab VM is disposable compute. It verifies the archive, extracts it to fast `/content`, installs dependencies, runs type/lint/Pages checks, and creates `dist-pages.tar.gz`.
3. The result is copied back to Drive before the CLI releases the VM. The deployed browser app serves the unpacked artifact; it does not fetch authenticated Drive URLs at runtime.

The installed Colab CLI can run the same pathway without manually executing notebook cells. `--upload` and `--download` are repeatable, `--open` shows the attached runtime in the browser, and `--gpu L4` requests the Pro high-memory L4 pool. CLI-created `empty.ipynb` sessions can appear as **Unknown notebook** in Colab's session dialog; the named CLI session and endpoint are still authoritative.

```bash
colab --auth=oauth2 run \
  --gpu L4 \
  --session reviter-pages-l4 \
  --open \
  --timeout 1800 \
  --upload "$HOME/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Reviter/reviter-build/reviter-source.tar.gz=/content/reviter-source.tar.gz" \
  --upload "$HOME/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Reviter/reviter-build/reviter-source-manifest.json=/content/reviter-source-manifest.json" \
  --download "/content/reviter-output.tar.gz=$HOME/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Reviter/reviter-outputs/reviter-output.tar.gz" \
  scripts/launch_reviter_colab_build.py
```

`scripts/run_reviter_colab_build.py` writes a machine-readable summary containing every step's return code and duration plus the finished artifact's byte count and SHA-256. The CLI attempts requested downloads even when the remote script fails, so partial logs can still be recovered, and it tears down the runtime unless `--keep` was explicitly requested.

## Local utility workspace

The [UNBC campus map review](docs/unbc-campus-map-review.md) records the reviewed
circulation, split levels, stairs, public access decisions, interface workflow
and unresolved geometry checks.

The Revit picker accepts **one model and one room annotations JSON together**,
in either order. You can also drop both files onto the app. After conversion,
Reviter opens **Building directory** and imports the room file automatically.
The folder button in the narrow model header opens the same picker. A room JSON
can also be selected by itself when its matching model is already open.

In **Building directory**, choose a floor and use **Show this floor in 3D**.
Choose **Campus map** or **All buildings** to combine mapped buildings by
campus storey. A reviewed `campusStoreys` group in the room directory can place
several native Revit levels in one view; ungrouped levels keep their own views.
**Previous level** and **Next level** step through
these views; building buttons focus the map without leaving campus
scope. Room selection keeps its building metadata, reviewed geometry and
actual slab height. The same combined level can be shown in 3D. Missing source
plans remain visible in source coverage, and local building crossings do not
imply a complete route through the campus.
Storey grouping is display metadata: room level IDs, source boundaries, native
heights, door reviews and stair links remain intact on import and export.
The viewer frames its room footprint and cuts away geometry above the selected
level, with a slider for cut height. Room, hallway, and staircase colors match
the map; enclosed holes remain open. On split levels, room surfaces use the
recovered slab beneath the label when a slab matches; otherwise they use the
recorded room level and show that the match needs review. These surfaces are
imported boundary annotations, not recovered native room volumes. Click a
colored surface or select **Room in 3D**, then **Focus selected room** or
**Edit room on map** to inspect and edit its outline. **Restore full model**
removes the cutaway and returns to the campus view.

In a narrow browser panel, use **Floors → Open floor review → Building directory**.
Imported annotations and review selections remain available when switching
between the floor workspace and the model. In the model, **Info → Zoom to object**
focuses the selection; **Section**, **Measure**, and **Comment** are available in
the tools beside the viewport. Use **Report → Export comments** to keep feedback.
Use **Expand map** for a full map with building and floor selectors and the
current route summary. **Show room review** restores the room list and editors.
Completed building checks also retain door matches for faster floor switching;
editing the navigation data clears those cached results.

The **Floors → Building directory** view opens a local version 1
`reviter-room-annotations` JSON, such as `UNBC.rooms.json`. Search by room
number, name, or survey sheet, choose a building and floor, and select a room
to inspect its boundary and recovered door connections. Hallways are
highlighted; low-confidence boundaries use dashed outlines. **Start here**
and a second room display a grid route through hallway polygons and matched
Revit door openings. Missing or ambiguous door matches leave access unresolved.
The room file must use model feet and levels present in the open RVT; its
alignment should be checked because older annotation files carry no model
fingerprint. Routes and distances are approximate. Routes can change floors
through a matched native staircase or an explicitly reviewed staircase link.

Atrium and hallway labels on the same floor and matched slab elevation display
as combined areas in the map and colored 3D view. Their union removes internal
label seams while retaining voids, private-room footprints, real gaps, and the
original source records. The selected-area panel shows area/floor identities,
source drawings, slab matches, recovered doors, and related atrium floor records.
**Associate area metadata** saves an area name, notes, and model element IDs;
**Export rooms with edits** preserves them in `areaMetadata` alongside the
unchanged room records. Grouped display areas do not establish new route links.
**Recover crosswalks** fills missing atrium walkway records from native slabs
attached to the selected level. Other atrium floors supply a search footprint;
their geometry is never copied to another storey. Recovery retains slab holes
and subtracts existing annotations, walls and columns, with precise native door
openings. Added records retain the building and native slab identity without
inventing room numbers or drawing records. They appear in the map and colored
3D view; export the room file to preserve them. Door and landing alignment still
require review.
Reported area relationships remain visible across split-level slab heights;
the inspector shows their height change and preserves the need to review the
stair or ramp transition. Same-level metadata alone does not flatten a step.
For a named area, **Walkability → Void / drop · no floor** saves
`walkability: "void"` and review notes on its source records. Voids remain
selectable with a hatched map outline, mask overlapping route polygons, cannot
be route endpoints, and omit colored 3D floor meshes. Export preserves this review.
Explicit `navigation.openLinks` use registered opening coordinates and a source
hash. Each opening is checked against current boundaries, drawing walls, native
wall footprints, columns, and other areas before contributing a route. These
links have their own identities and do not create Revit door IDs.
**Connected circulation** highlights atrium/hallway areas joined by recovered
doors in both the map and colored 3D view. The inspector lists those openings
and lets you select the adjoining area. Area metadata can record circulation
doors as usually open or usually closed (user reported); this observation is
exported with the annotations and does not assert a current door position or
change route permissions. Source outlines and native door identities remain.
The map supports zoom buttons, cursor-centered wheel/trackpad zoom, drag to pan,
and keyboard +/−, arrow keys and Home. **Whole floor** resets the view.
The wall-source line distinguishes registered drawing segments from native
wall footprints at the model cut. Missing native walls or slab matches remain
visible as level-association review items instead of borrowing another storey.

**Edit boundary** exposes draggable corners, arrow-key adjustments, edge
insertion by double-click, and corner removal by Alt-click or Delete.
Self-intersecting outlines and edits that exclude the label point are rejected.
Export the annotations to retain changes and their original provenance; edits
stay in the directory session until exported. **Restore imported boundary**
restores the imported record (and its shared hallway aliases).

For annotation files with a verified `boundaryReference`, **Rebuild floor
boundaries** traces vector wall faces and recovered Revit door footprints.
The saved DWG anchors and matching source hash recover the original survey
registration; drawings with residual errors above 0.1 foot are rejected.
Connected corridor labels share an outer boundary with holes for enclosed
rooms and columns, so routes can follow the entire corridor without crossing
those interiors. The **Walls** overlay shows the boundary evidence, and the
sidebar reports separate hallway networks. Missing barriers or implausible
area changes retain the imported polygon for review. No connection is
added across walls or floor voids. **Connect hallway gaps** can trace a missing
passage across recovered slabs and precise door openings, avoiding private
rooms and columns. Its dashed blue strip is an inferred route footprint,
whose full hallway width remains for review. The network count tests actual
routes between hallway labels, so touching outlines alone do not imply access.

**Adjoining buildings** shows the other side of a precise native doorway between
two building directories. **Building connections → View connection** focuses both
spaces and displays their local crossing; **Open Building** switches to the
adjoining map while keeping the doorway in view. **Door #** inspects both source
records and the native host. The colored 3D view includes the adjoining room and
a purple doorway marker. Connections require matching floor heights and precise
opening evidence; local paths retain private-space and reported void masks.
They do not establish onward campus routes or assert a current door position.

**Building checks → Check all buildings** runs boundary, anchor, overlap,
survey alignment, hallway access, door, and staircase checks on every supplied
building floor. Select a result to show its flagged rooms, or export the checks.
Changes to boundaries or reviewed connections invalidate the previous results.
**Doors and staircases** shows recovered openings and their room connections.
Precise openings extend through their persisted host wall while retaining the
door width. Ambiguous openings can be reviewed by choosing two nearby rooms;
remote rooms cannot be joined. Stair links require native assembly and tread
evidence at both floor elevations. Missing or ambiguous flights remain flagged;
overlapping staircase entrances on different floors can be explicitly reviewed.
Reviewed door and stair links persist in the exported annotation file. Route
instructions include staircase transitions and buttons to view each floor leg.

To attach a reference from an already decoded survey drawing:

```sh
node --experimental-strip-types scripts/register-room-boundaries.ts \
  rooms.json entities.json catalog.json rooms.with-walls.json
```

Audit every supplied building and model level with the same door matching and
routing used by the directory:

```bash
node --experimental-strip-types scripts/audit-room-directory.ts \
  rooms.with-walls.json plan-geometry.json catalog.json work/building-audit
```

`plan-geometry.json` is a local conversion-result cache containing `levels`,
`elementBounds`, and `nativeAssociatedLevelRelations`. Include
`nativeHostRelations` and `nativeStairAssemblies` with tread geometry to check
door depth and stair connections. The report uses the live Building directory
check engine and includes
per-floor SVG overlays, room issue CSV, survey coverage gaps, polygon overlap
and anchor checks, perimeter alignment candidates, destination access, and
hallway route networks. It treats overlapping hallway regions as intentional connections.
A passing raster route does not independently establish physical wall clearance;
access restrictions and elevator routing are not included.

Area connections are shown for named destinations as well as hallways and
atriums. `areaRelationships` preserves user-reported access separately from
recovered doorway links; these reports highlight related areas without creating
route openings through walls. Export rooms with edits to retain them.
Click a door marker for its model ID, host, location and connected or candidate
spaces, including in the expanded map. Double-click the map to pin its model
coordinates and identify the area under that location. Map selection preserves
the current zoom and pan; Focus room and Whole floor explicitly reset the view.
Check all buildings reports drawing-wall coverage, native walls and slab matches
alongside destination routes and unresolved openings. Registered drawing walls
provide 2D context; they do not establish a missing native 3D level association.


The catalog supplies the DWG hash and named sheet bounds. Import the resulting
JSON alongside its matching RVT, rebuild a floor, then export to preserve the
wall reference, room holes, shared hallway identities, and edits. All building
data stays local and is not bundled in the app.

The browser studio also includes personal tools that never upload or attach
local identity data to the model export:

- a folder-based `.rfa` library index with embedded previews, PartAtom family
  types and parameters, adjacent `_cat.txt` catalogs, manufacturer/dimension/
  voltage search, and explicit OmniClass-number resolution;
- a shared-parameter manager that detects encodings, validates, merges,
  deduplicates, compares by GUID, reports renames/datatype changes/regrouping,
  and downloads a merged Revit text file;
- the merged 9,543-row vanilla and food-service OmniClass editions as a
  searchable, on-demand classification browser;
- full `BasicFileInfo` worksharing metadata in a local-only inspector, including
  username and saved paths; those sensitive fields are filtered from JSON
  reports;
- embedded PNG and legacy indexed-BMP preview extraction from local DWG files;
  and
- UTF-8, UTF-16LE/BE, Windows-1251, and Windows-1252 text decoding.

## What is reliable

- OLE/CFB container validation and stream inventory
- `BasicFileInfo` metadata, including Revit version, build, locale, and document identity
- embedded Revit thumbnail extraction
- `PartAtom` family metadata, including category, taxonomy, design-file links, family types, and parameter values
- dependency-free parsing and writing of Revit shared-parameter files, family type catalogs, and OmniClass taxonomy files
- truncated-gzip partition decompression
- `Global/ElemTable` framing and native Revit element-ID inventory
- optional IFC reference parsing and geometry measurement with `web-ifc`
- paired regression gates for element identity, extents, topology, and typed semantics
- Revit 2027 nested duplicated-bounds record detection, with native element IDs, record codes, field counts, and axis-aligned bounds in feet
- native Revit `BuiltInCategory` recovery straight from the partition stream, so walls, doors, curtain panels, mullions, railings, columns, floors, ceilings, stairs, and ramps are named from the RVT itself rather than inferred from a paired IFC
- evidence-backed display classification for walls, doors, panels, frames, columns, railings, slabs/roofs, coverings, windows, stairs, and ramps in the supplied 2027 model
- a standards-aware Revit `Material` schema adapter for reader-supported releases (real-file extraction and element assignment are not wired yet)
- open-format export of recovered geometry to GLB, OBJ, DXF, SVG, IFC solid proxies, and JSON audit data, with the decoded Revit category carried through the proxy name, description, and audit report
- export of the recovered building to [Pascal](https://github.com/pascalorg/editor) as editable typed nodes — walls with their own location line and thickness, doors on their persisted host wall, floors from their own sketch loops — validated against Pascal's own schemas
- browser-generated per-element JSON manifests with recovered IDs, categories, type links, parameters, bounds, display state, and geometry provenance

## What is experimental

Revit's element-instance wire format is proprietary and is not fully decoded by the supplied open-source readers. Reviter selects decoders by the `BasicFileInfo` release rather than applying a byte pattern universally. In the supplied Revit 2027 model, a strict nested record signature contains the native element ID plus two identical six-`f64` axis-aligned bounds blocks. The old Revit 2023 `ArcWall` six-coordinate interpretation is retained only as a bounds hypothesis in tests; it is disabled as production profile geometry because its coordinate semantics have not been proven.

### Native category tokens

Element categories are decoded, and they are the first typed BIM data Reviter reads without a paired reference file. Revit writes each element's `BuiltInCategory` into the partition stream as a fixed 18-byte token — the field tag `04 00`, a `u32` discriminator, the negative 64-bit category id, and an `ff ff ff ff` terminator. The token carries no element id, so ownership is resolved after the scan: the owner is the nearest preceding 64-bit value that the same pass proved to be a real native element id. Elements whose own token is not recoverable inherit a category from a record-code consensus, and a consensus is only published once a code cluster clears one of three support/purity floors — 8 elements at 70%, 4 at 85%, or 3 at 100%. Support and purity trade against each other because a single flat floor of 8 was tuned on the clusters that dominate by count and silently excluded the tail: a building holds a dozen ramps and a couple of dozen ceilings, so those clusters could never reach 8 directly resolved members however unanimous they were. Inheritance is not a minor path — in a 2026-07-28 run on the supplied model, **23,462 of the 39,159 categorised elements (60%) were inherited rather than read from their own token**.

Every assignment is reported with its evidence. In that run the consensus was decisive rather than marginal — curtain panels 98.7%, mullions 96.0%, walls 97.6%, doors 92.2% — and the category counts line up with the paired IFC export's product types (Revit mullions against `IfcMember`, curtain panels against `IfcPlate`, railings against `IfcRailing`, floors against `IfcSlab`, ceilings against `IfcCovering`, ramps against `IfcRamp`). Category ids that the paired export does not corroborate keep their numeric label instead of being guessed at from Revit's much larger category enumeration.

A 2027 envelope is not an element's native shape. Reviter therefore records geometry fidelity independently from semantic type. The IFC4 Reference View exporter writes the recovered per-element tessellation when available, uses a bounds solid only as an explicit fallback, maps independently decoded native categories to IFC classes, and attaches `Reviter_Recovery` properties stating whether each body is native, reconstructed, or approximate. Persisted levels, types, material assignments, parameters, identities, and proven door/window host relationships are carried into the IFC when available; missing evidence is left unknown rather than synthesized.

## Decoder compatibility

| Revit release | Native evidence | Rendered geometry | Categories | Materials |
| --- | --- | --- | --- | --- |
| 2018 and older | none: not claimed, no sample available | diagnostic coordinate scan, labelled as such in the studio | not decoded | not decoded |
| 2019–2023 | the same decoders, reading 32-bit element ids and a 12-byte object header where the file's schema declares them ([details](docs/older-release-decoding-2026-09-25.md#10-revit-2019-to-2023-2026-09-27)) | native face meshes, family-document forms, polymeshes, rebuilt walls and envelope fallback; 441 of the 444 elements Autodesk's 2025 capture draws with triangles, on the 2019 and 2023 RAC samples as on the 2025 file (same element ids) | each element's own `ElementHeader`; equal to the 2025 file's | native definitions and assignments; every material Autodesk lists that the file holds has its name and colour, and its transparency to Autodesk's rounding |
| 2024–2025 | the 2027 record decoders, reading the file's own class indices through a name-based translation ([details](docs/older-release-decoding-2026-09-25.md)) | native face meshes, family-document forms, polymeshes, rebuilt walls and envelope fallback; 99.3–100% of Autodesk-drawn elements displayed on three sample projects | each element's own `ElementHeader`; agrees with Autodesk on every displayed element | native definitions and assignments; name, colour and transparency exact for every material Autodesk lists |
| 2026 | the same path as 2024–2025 | as 2024–2025; Autodesk's 2026 RAC basic and structural samples convert with native geometry, types, parameters and levels | as 2024–2025 | as 2024–2025; no Autodesk capture of a 2026 file to score against |
| 2027 | nested duplicated bounds, native element ID, `ElementHeader` and record classification | native face meshes, rebuilt walls and envelope fallback; 99.9% of Autodesk-drawn elements displayed, 99.95% of those within 0.5 ft of Autodesk's box | `ElementHeader` and `BuiltInCategory` tokens, IFC- and Autodesk-corroborated | native definitions and assignments; name, colour and transparency exact |
| unknown | no release-specific decoder | diagnostic fallback only | attempted; reports zero when the token is absent | no claim |

The category decoder is not gated on the release, because it is self-validating: a file that carries no category tokens simply reports none, and the previous record-code classification stays in place. Its building-scale rules are verified against the supplied Revit 2027 project, **and against no second building**. The Revitless toolkit contributes one real Revit 2014 `.rfa` fixture, which now verifies legacy release detection, PartAtom metadata, and the component-scale diagnostic path; it does not validate project geometry rules. Every building threshold and classification rule in Reviter is therefore still fitted on one building, and every figure quoted anywhere in this file or in [`docs/`](docs/README.md) is an observation from a dated run on that building rather than a standing fact. [`docs/validating-on-a-second-building.md`](docs/validating-on-a-second-building.md) records what that has cost so far, rule by rule, the harness that now makes the problem testable on any model rather than on this one, and what to look at first on a second file.

Two independent things are gated by release, and it is worth not confusing them. Reviter's **own** decoders are chosen per release by `decoderPlanForVersion`, and the element-bounds, identity, category-ownership, and material decoders that carry the supplied model read the 2027 record layouts, which 2024–2026 files share once their class indices are translated by name (`revit-class-tags.ts`). The **optional** standards-aware reader is a separate, vendored Rust/WASM library (`lib/rvt-wasm`, from `rvt-rs`) that declares 2016–2026, and that range is load-bearing rather than stale: on the supplied 2027 file its `quickSummary` succeeds and reports the release and 10,481 schema classes, but `openRvtBytesWithDiagnostics` traps inside the WebAssembly module, and it traps on the 2024 Snowdon sample too, inside its declared range. The two are independent, which is why a message about the optional reader must never be written as a verdict on the file — `reader-support.ts` holds the range once so the four places that used to repeat it cannot drift apart.

### What one building's thresholds actually decide

A threshold fitted to one model is a hypothesis about all models, and the ones here are applied with a bare `continue`. Measured on the supplied project on 2026-07-30:

- **Wrapper detection is category-checked, not record-code-only.** The curtain-wall container fingerprint (`recordCode 30`, field count 8–10) used to run ahead of the decoded category and win. It claimed 1,840 records — every one of which carried a decoded category, so the byte pattern was never breaking a tie, it was overruling evidence. 1,809 are `Walls`, and a curtain wall is a Wall, so the rule was right about the overwhelming majority; the other 31 are 14 Curtain Wall Mullions, 9 Curtain Grids Wall and 8 Curtain Wall Panels — the very children a wrapper exists to reveal. The fingerprint now stands alone only where no category decoded, and those 31 elements are back in the scene.
- **Storeys come from the file, not from a histogram.** `levels` used to be the 8 most populated 0.5 ft elevation buckets, sorted by population, capped at 8 — and the supplied model returned exactly 8, so the cap was binding. Revit persists `Element.m_assocLevelId`, which this model carries 37,503 times, and those relations resolve to 18 level ids of which 12 clear the 20-member floor: −7.2, −3.3, 0, 3.3, 9.8, 14.4, 19.4, 24.3, 30.0, 34.1, 40.0 and 44.0 ft, each with the level's own element id. Each elevation is its members' **median** base height, so one misparsed envelope cannot move a storey. The histogram remains as a fallback for files whose relations do not decode, now uncapped.
- **Limits that bind are reported.** `MAX_TREADS`, `MAX_CURVES_PER_ELEMENT`, `MAX_QUAD_SPAN_FEET`, `MAX_HALF_THICKNESS_FEET` and `MAX_COORDINATE` are ordinary-building envelopes that discard geometry silently, so a monumental stair or a site-scale plane would go missing with the run still reporting success. They are unchanged — re-tuning them without a second building would only move the fitting — but `limit-census.ts` now counts every rejection and `stats.fittedLimitsReached` plus a conversion warning name any limit that bound. The supplied model reaches none of them, which is exactly why they were invisible.

## Element types and names

A Revit element does not carry its family or type name. It carries the element id of a **type element**, and that type element holds the name. Both decoders work off the same record framing — element id at `+0`, a zero word at `+4`, a per-record stamp at `+8`, class discriminators at `+16` and `+22`, and an `ff ff ff ff` null-field marker at `+18`.

In records whose second discriminator is `0x0c93` — walls, curtain walls, and openings — the type id follows the `0x116f` field slot: skip its `[u32 n][n × (u32, u16)]` index list, then take the 64-bit value beginning where the following zero run ends. Jumping to the *end* of the run rather than assuming a fixed pad is what makes this work on curtain walls, which otherwise return the type id shifted by a byte. The type record then stores its name behind the `0x1104` slot as `ff ff ff ff 04 11 [u32 charCount][UTF-16LE]`.

**Verification** against the paired IFC export, whose product names have the form `Family:Type:ElementId`: the type reference is correct for **8,009 of 8,013** predictions — **99.95%** — and following it through to the name reproduces the IFC type string for **5,619 elements with no disagreements**.

Selecting an element in the viewer now shows its type name, its type element id, and its decoded parameters.

Scope: this covers system families, whose type records live in the same partition. Loadable families — mullions, columns, furniture — keep their type names inside family-document blobs elsewhere and are not decoded.

## Element parameters

An element's instance parameters are a flat table of `(BuiltInParameter id, value)` pairs:

```text
[u32 count] [count x ( i64 negative parameter id, f64 value in feet )]
```

The table carries no element id. Ownership comes from the anchor in front of it, where the element restates its own id — `ff ff ff ff 10 03 01 00 00 00 [u64 element id]`. Which anchor is used matters: resolving by "nearest preceding record start" instead lets the type-reference slot inside an element steal ownership, collapsing the assignment and misfiling most wall tables onto ids the IFC export has never heard of.

**Verification.** Over the 6,278 walls that have both a decoded table and an IFC swept-solid depth, the value stored under parameter `-1001101` reproduces that depth to within 1e-6 ft on **6,272 of them — 99.9%**. The next best parameter matches 2.3%. That single check confirms the table framing, the f64-in-feet encoding, and the element join at once.

Parameter names come from the `BuiltInParameter` values published in Autodesk's Revit 2026 API documentation, and are corroborating evidence rather than part of the decode: every one of the 25 parameter ids the decoder finds in the supplied project resolves except a single `-65536`, which is a framing artefact rather than a parameter, and the names that land beside the verified height are `WALL_USER_HEIGHT_PARAM` "Unconnected Height", `WALL_BASE_OFFSET` "Base Offset", and `WALL_TOP_OFFSET` "Top Offset" — exactly the company a wall height should keep. Four of the 25 are absent from the published enum — `-1001101`, `-1001111`, `-1001115` and `-1001116` — and a [second table in the same SDK](docs/revit-enumeration-tables.md) names all four: `-1001101` is `wallHeightParam`, a double whose measurement spec is `length`, and `-1001111` is `wallBaseOffsetComputed`. They carry no label because Revit does not surface them. That the id whose value matches a wall's extrusion depth is called *wall height* and typed as a *length* corroborates the decode from a direction the paired export cannot.

That second table also supplies what the published documentation does not: the enumerator for a parameter id, so every decoded parameter now carries `WALL_USER_HEIGHT_PARAM` beside its label and a consumer can join on the identifier that survives a release change or a localised install; and the label Revit itself prints for a category, which is not always the humanised enumerator. `OST_CurtainWallPanels` — the third largest category in the supplied project at 6,248 elements — is "Curtain Panels", `OST_StairsRuns` is "Runs", and `OST_StairsRailingBaluster` is "Balusters". 758 of the 1,075 labelled categories differ from the humanised enumerator; 345 of those are labels Revit reuses across sibling sub-categories or that collide with a name another category already keeps, and a name has to identify one category, so they are not adopted. 413 categories are renamed and 13 previously unnamed ones gain a name.

A category's display name is a label, so nothing is allowed to depend on it. Keying behaviour on one is how a rename becomes a silent regression: `ifcClassFor` used to select the IFC class by category name, and the first draft of this change quietly demoted every curtain panel, baluster, top rail, stair flight and landing in the model to `IfcBuildingElementProxy`. That mapping, the architectural plan's stair rules, the datum-pile cleanup and the GLB residual audit are all keyed on the category id now.

Selecting an element in the viewer now lists its decoded parameters by name.

## Module map

Each stage of the pipeline is its own module, so a decoder change cannot reach into the renderer and an export-format change cannot reach into the parser.

| Module | Responsibility |
| --- | --- |
| `lib/reviter/revit-container.ts` | OLE/CFB stream payloads and the truncated-gzip chunk framing |
| `lib/reviter/elem-table.ts` | `Global/ElemTable` layout detection and the native element-ID index |
| `lib/reviter/bounds-records.ts` | the Revit 2027 duplicated-bounds element record |
| `lib/reviter/native-categories.ts` | `BuiltInCategory` tokens, element ownership, and record-code consensus |
| `lib/reviter/native-decoder.ts` | release gating, the 2023 `ArcWall` hypothesis, and the material schema adapter |
| `lib/reviter/segment-scan.ts` | the diagnostic coordinate scanner and its cleanup passes |
| `lib/reviter/scene.ts` | display selection, category batching, and display materials |
| `lib/reviter/convert.ts` | the pipeline that orchestrates the modules above |
| `lib/reviter/export-*.ts` | one module per output format, re-exported by `exports.ts` |
| `lib/reviter/worker.ts`, `ifc-worker.ts` | the Web Worker entry points |
| `lib/reviter/ifc-reference.ts`, `regression.ts` | paired IFC analysis and the regression gates |
| `lib/reviter/schema-reader.ts` | the embedded `Formats/Latest` schema, walked to its last byte: every class the file declares, with its index, base class and field declarations |
| `lib/reviter/partition-names.ts` | workset / family partition names from `Global/PartitionTable` |
| `lib/reviter/types.ts` | the shared public types |

The interface is split the same way: `app/ReviterStudio.tsx` is the composition
root, with the viewport in `app/studio/ModelCanvas.tsx`, Three.js group assembly
in `three-scene.ts`, the paired reference model in `reference-model.ts` and its
runtime batching in `reference-scene.ts`, and the summary panels in
`panels.tsx`.

## Library surface

```ts
import {
  convertRvtBytes,
  makeDxf,
  makeIfcCenterlines,
  makeObj,
  makePlanSvg,
  makeReport,
} from "./lib/reviter";

const bytes = await file.arrayBuffer();
const result = convertRvtBytes(bytes, file.name, {
  maxSegments: 12_000,
  // Read from BasicFileInfo; release-specific native decoders are disabled if omitted.
  revitVersion: 2027,
});

if (result.ok) {
  const obj = makeObj(result);
  const dxf = makeDxf(result);
  const svg = makePlanSvg(result);
  // Historical API name; duplicated-bounds results export as IFC solid proxies.
  const ifc = makeIfcCenterlines(result);
  const audit = makeReport(result, null);
}
```

For production UI work, use `lib/reviter/worker.ts` as the entry point so large files do not block the main thread.

IFC reference analysis is deliberately isolated in `lib/reviter/ifc-worker.ts`, keeping the 3 MB parser bundle and its WebAssembly binary out of the main interface bundle until an IFC is actually selected.

### The optional Revit 2021 compatibility vocabulary

```ts
import { loadLegacyRevit2021Api } from "./lib/reviter";

const legacy = await loadLegacyRevit2021Api();
legacy.category(-2000011);
// { value: -2000011, names: ["OST_Walls"], label: "Walls" }

legacy.displayUnit("DUT_MILLIMETERS");
// catalog string, symbol, compatible unit types and parameter types
```

The data behind it — 8,075 rows of Revit 2021 enum aliases, category and
parameter-group labels, MEP classifications, shared-data types, display units and
symbols — lives in `lib/reviter/legacy-revit-2021.data.ts`. It is loaded through a
dynamic `import()` so the table stays out of the initial viewer bundle, and it is
never used as evidence by the RVT geometry decoder; it is vocabulary for reading
old files, not a decoder input.

**It is the artifact of record and cannot currently be regenerated.** It was
written once by `scripts/generate-legacy-revit-api.ts` from a Revitless toolkit
checkout's `src/Decompiled` C#, and that tree is not in this repository — so the
generator throws for every reader of it. The script is kept, unrun, as the record
of which declarations were extracted and how; both its header and the data file's
say what input would be needed.

## Family files

`.rfa` and `.rft` files open on the same client-only path, but they carry neither the 2027 duplicated-bounds records nor the project category tokens, so they land on the diagnostic coordinate scanner. That scanner's coordinate window is now chosen from the file kind: a family spans a single component, so a project-scale window both discards its short curves and admits long spurious runs the component cannot physically contain. On the `racbasicsamplefamily` corpus the component-scale window roughly doubles the recovered candidates and keeps the recovered extent inside the component — the 2023 sample previously reported a 128 ft extent for a component under 11 ft across. `ConvertOptions.geometryScale` overrides the choice. The output is still diagnostic: it is labelled as such, and it is not a native Revit element model.

## Where the evidence is

Every building-scale rule in Reviter was fitted on **one model**, and the
measurements that justify each one are observations from dated runs rather than
standing facts — there is no model file in this repository, so nothing recomputes
them. [`docs/README.md`](docs/README.md) indexes all 84 entries. The ones to
start with:

| If you want to know | Read |
| --- | --- |
| how much of the supplied building is recovered, and what the coverage percentages mean | [Coverage measurements](docs/unbc-coverage-measurements-2026-07-30.md) |
| what protects a rule that was fitted on one building | [The paired-export harness](docs/unbc-paired-export-harness-2026-07-28.md) · [Validating on a second building](docs/validating-on-a-second-building.md) |
| how an element's extent, body, or arc is actually read | [Which bounds copy is the element's](docs/unbc-bounds-record-copies-2026-07-28.md) · [Wall bodies](docs/unbc-wall-surfaces-and-solids-2026-07-28.md) · [Element object framing](docs/unbc-element-object-framing-2026-07-28.md) |
| why a class is drawn the way it is | [Stairs and railings](docs/unbc-stair-and-railing-geometry-2026-07-28.md) · [Doors, windows and openings](docs/unbc-door-window-opening-geometry-2026-07-28.md) · [Drawn but not elements](docs/unbc-drawn-but-not-elements-2026-07-28.md) |
| what is still missing and whether it is reachable | [The undrawn census](docs/unbc-undrawn-element-census-2026-07-28.md) |
| how much of the file format is decoded at all | [Stream coverage and the embedded schema](docs/rvt-stream-and-schema-coverage.md) |

The Revit 2027 geometry-replay work — faces, edge loops, analytic surfaces,
tessellation, ownership — is a further forty-nine entries, grouped by area in
the index.

## Stair rooms and landings

A source room named `Stair` describes a room envelope, which can include a landing. The building directory colors only recovered native tread projections purple and places the up/down marker on those steps. In the 3D review, tread fills follow their native elevations and the surrounding landing keeps its ordinary room color. Projection alignment and landing boundaries remain reviewable.

Select a stair room to review **Storey connection**. `stairAccess: "local-only"` records local steps or a landing without access to another storey: it suppresses native and reviewed vertical links while preserving same-floor walking access and the source room boundary. `"flight-and-landing"` confirms the distinction but does not manufacture a vertical link. `"unreviewed"` retains the existing native evidence pending review. `"up-flight-only"` permits a bidirectional link to the upper storey while excluding local downward steps from lower-storey links. The 3D colored treads obey the selected floor cut; an overhead flight does not erase landing fill beneath it. `stairAccessNotes` and the review choice survive room JSON export and import.

## Third-party components

The implementation uses Apache-2.0 [`cfb`](https://github.com/SheetJS/js-cfb) for compound-file parsing, [`fflate`](https://github.com/101arrowz/fflate) for local DEFLATE decoding, [Three.js](https://github.com/mrdoob/three.js) for rendering and GLB export, and [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) for client-side IFC reference analysis. `web-ifc` reads the ground-truth IFC; it does not decode RVT.

Reviter's own decoders are clean-room: they are derived from measurements of
Revit files, not from Autodesk source or runtime assemblies. The one exception is
the optional compatibility vocabulary described above, which is explicitly marked
and isolated from the geometry decoder.

## Publication note

The application and dependency licenses are auditable, but this repository itself does not yet declare a license. Choose and add a project license before publishing Reviter as a reusable package.

### Local steps between buildings

Room annotations can preserve `buildingTransitions` reported by a reviewer, including two picked building/level locations, a native stair assembly and the native floor identity at each endpoint. The map exposes **Local building connections**, **View local connection** and an adjoining-building switch. The focused preview draws recovered tread polygons and clipped native landing surfaces, even where the landing has no source room outline. It retains both native elevations in the colored 3D floor section.

The crossing check samples native tread/floor support and rejects surface gaps, slab holes, walls, columns, private rooms and reported voids. It preserves the report separately from storey stair links and door routes; a supported local preview is not a complete campus directory route. Missing landing boundaries and access conditions still require review. Existing room geometry, stair access reviews and export metadata are retained.

Reviewed local steps and their landings use green circulation coloring in both map and 3D. For an upward-flight-only review, native runs terminating at this floor are local steps; the upward storey flight keeps purple. The stair-flight map toggle hides flights while retaining reviewed local floor steps. Native heights and tread shapes are preserved.

The 2D stair overlay uses the same four-foot plan cut as the architectural map, hiding overhead-flight treads while retaining reviewed local downward steps. Wheel zoom accumulates pending deltas at the cursor, normalizes pixel/line/page scrolling, paints the SVG view once per animation frame, and commits room/label overlays after the gesture settles. Reset, selection and drag controls cancel any pending wheel gesture.

### Georeferencing a campus model

In **Floors → Building directory**, choose **Georeference model**. Double-click an identifiable corner or survey marker on the Revit plan, select **Use picked model location**, then click its corresponding location on the geographic map or enter surveyed WGS84 latitude/longitude. Add at least two point pairs; three or more points spread across the campus provide a better alignment check.

The preview registers shared model X/Y coordinates using rotation and translation at 0.3048 metres per Revit foot. **Fit scale from reference points** also estimates scale. Per-point residuals and RMS error compare the selected pairs; map or survey accuracy is separate. The campus-scale local east/north registration preserves original model coordinates, native levels and elevations; it does not assign a vertical survey datum or modify the RVT file.

Reference points can be edited, imported and exported independently, and **Export rooms with edits** includes them with floor reviews. **Export campus GeoJSON** outputs room boundaries and source identities in longitude/latitude. The optional OpenStreetMap basemap fetches visible tiles directly in the browser; model files and point pairs are processed locally.

After pairing reference points, **Show 3D model on map** places the recovered Revit geometry on the optional basemap. Orbit, pan, zoom, or select a north-up top view. **Selected floor cutaway** removes geometry above the selected storey; **Selected floor colors** preserves the reviewed room/circulation surfaces. Change the floor in the directory to compare storeys at the same geographic registration. The model keeps native vertical dimensions even with a fitted horizontal scale. **Map plane elevation** is a display datum in model feet; the basemap is flat and does not represent surveyed terrain or a vertical coordinate system.

### Portable project ZIP

In **Floors → Building directory**, use **Export project ZIP** to download one `.reviter.zip` with the original Revit file, complete room annotations (boundaries, shared circulation, doors, stairs, access reviews, building connections and source provenance), and GIS reference points. The existing **Export rooms with edits** JSON also retains georeferencing, but does not contain the Revit model.

Use **Import project ZIP**, the main Open button, or drag the ZIP into Reviter. Import validates the versioned `manifest.json` and SHA-256 hashes before loading the original model and the reviewed floors together. Model geometry is recovered from the source again; model coordinates and native elevations remain unchanged. The archive includes `model/<original filename>`, `floors/rooms.json`, and, when assigned, `gis/reference-points.json`. Packages remain local. Basemap tiles, browser caches, viewer camera state and separate model comment/markup sidecars are not included.

Version 1 supports a Revit source up to 512 MB, floor JSON up to 64 MB and a ZIP up to 580 MB. Reference points may still be incomplete or require review; saving a package preserves their exact values without claiming survey accuracy.

### OpenIndoorMaps project pipeline

Use **Prepare OpenIndoorMaps project** in the building directory to export a version 2 ZIP with GIS-aligned floor maps, an evidence-backed routing graph and a recovered GLB scene. Import it at OpenIndoorMaps `/projects/indoor`, test routes, review area/connection metadata, and export the reviewed project. The same compiler is available through `npm run indoor:prepare`. See [the complete repeatable workflow](docs/indoor-project-pipeline.md) for input preparation, commands, schema, validation and the UNBC pilot limitations.
