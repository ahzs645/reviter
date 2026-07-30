# Reviter

Reviter is a local-only Revit inspection and experimental geometry conversion library with a browser studio and a Node extraction command. A local `.rvt`, `.rfa`, `.rte`, or `.rft` file can be opened from the browser file picker and converted in a dedicated Web Worker, or processed directly into an open format from the command line. The application has no file upload route, account system, telemetry, or remote conversion service.

Live client-only application: **https://projects.ahmadjalil.com/reviter/**

Every push to `main` is tested, built as a static Vite application, and deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml). The Pages build is separate from the existing Vinext/Cloudflare build but reuses the same React interface, converter library, Web Workers, and WebAssembly decoders.

## Extract geometry from an RVT

The converter reads the Revit release from the file's own `BasicFileInfo`
stream, so the direct API and Node command do not require a separate metadata
pass or a hard-coded release:

```sh
npm ci
npm run extract -- model.rvt --out model.glb
```

The output extension selects GLB, OBJ, DXF, SVG, IFC proxy, or JSON audit
output. All formats use the same locally recovered scene as the browser; no
model data is uploaded. Use a paired export to verify a model element by
element when one is available:

```sh
node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc
```

## Local utility workspace

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
- browser-generated per-element JSON manifests with recovered IDs, categories, type links, parameters, bounds, display state, and geometry provenance

## What is experimental

Revit's element-instance wire format is proprietary and is not fully decoded by the supplied open-source readers. Reviter selects decoders by the `BasicFileInfo` release rather than applying a byte pattern universally. In the supplied Revit 2027 model, a strict nested record signature contains the native element ID plus two identical six-`f64` axis-aligned bounds blocks. The old Revit 2023 `ArcWall` six-coordinate interpretation is retained only as a bounds hypothesis in tests; it is disabled as production profile geometry because its coordinate semantics have not been proven.

### Native category tokens

Element categories are decoded, and they are the first typed BIM data Reviter reads without a paired reference file. Revit writes each element's `BuiltInCategory` into the partition stream as a fixed 18-byte token — the field tag `04 00`, a `u32` discriminator, the negative 64-bit category id, and an `ff ff ff ff` terminator. The token carries no element id, so ownership is resolved after the scan: the owner is the nearest preceding 64-bit value that the same pass proved to be a real native element id. Elements whose own token is not recoverable inherit a category from a record-code consensus, and a consensus is only published once a code cluster clears one of three support/purity floors — 8 elements at 70%, 4 at 85%, or 3 at 100%. Support and purity trade against each other because a single flat floor of 8 was tuned on the clusters that dominate by count and silently excluded the tail: a building holds a dozen ramps and a couple of dozen ceilings, so those clusters could never reach 8 directly resolved members however unanimous they were. Inheritance is not a minor path — on the supplied model **23,462 of the 39,159 categorised elements (60%) are inherited rather than read from their own token**.

Every assignment is reported with its evidence. In the supplied model the consensus is decisive rather than marginal — curtain panels 98.7%, mullions 96.0%, walls 97.6%, doors 92.2% — and the category counts line up with the paired IFC export's product types (Revit mullions against `IfcMember`, curtain panels against `IfcPlate`, railings against `IfcRailing`, floors against `IfcSlab`, ceilings against `IfcCovering`, ramps against `IfcRamp`). Category ids that the paired export does not corroborate keep their numeric label instead of being guessed at from Revit's much larger category enumeration.

A 2027 envelope is not an element's native shape. Native family meshes, curved faces, openings, compound-layer assignments, element-material references, parameters, constraints, and general typed BIM semantics beyond the category remain undecoded. Appearance/material strings, colors, and embedded previews exist in the partition corpus, but production extraction and assignment are not implemented. The IFC exporter therefore writes clearly described `IfcBuildingElementProxy` geometry; it does not mislabel proxies as native `IfcWall`, `IfcSlab`, or family geometry.

## Comparing against a reference conversion

Reviter can draw a second conversion of the same building beside its own so the two can be judged against each other. Pair a GLB or glTF from the **Reference model** button, the same way a paired IFC export is supplied; it is read locally and never uploaded. A reference carries no element ids, so the object, category and property panels stay on the RVT diagnostic source — it is a yardstick, not a decode.

Measured against one such reference (an Autodesk conversion of the supplied 2027 project, 51,420 fragments), the recovery's extents agree: 704.0 x 1228.4 x 62.3 ft against the reference's 714.9 x 1229.6 x 63.7 ft, and the per-category size medians are ordinary — mullions 3.82 ft, doors 7.25 ft, walls 12.32 ft, with 1 mullion of 19,316 and 0 doors of 1,933 above a sane size bound. The recovery is not systematically over-extending anything.

One real defect surfaced from that comparison and is recorded rather than patched around: element **447970** carries a `Curtain Wall Mullions` category token while measuring 72,315 sq ft with a 0.66 ft z-span — the same footprint and thickness as floor 503705 beside it. Its category came from its own token rather than from the record-code consensus, so this is the documented ownership weakness in `native-categories.ts`: the token carries no element id, the owner is resolved as the nearest preceding value proved to be a real element id, and here a floor plate has taken a mullion's token. It maps to the dark `frame` display role, so it draws as a large dark plate across the model.

## Verified against the paired IFC export

`scripts/verify-pair.ts` scores the recovery element by element against an IFC exported from the same model. The export used here declares `NumberOfSaves: 326`, matching the RVT's own `uniqueDocumentIncrements`, so the two are the same save rather than two versions of the same project.

**36,255 of 38,076 export products are drawn — 95.2%** — and no record reaches past the export's hull at all. Centre and size agreement, within 0.5 ft on every axis:

| IFC product | drawn | centre ok | size ok | median centre error |
| --- | --- | --- | --- | --- |
| `IFCMEMBER` | 19,652 | 98.9% | 98.6% | 0.000 ft |
| `IFCWALLSTANDARDCASE` | 7,381 | 99.3% | 98.5% | 0.000 ft |
| `IFCPLATE` | 6,235 | 99.9% | 99.8% | 0.000 ft |
| `IFCDOOR` | 1,912 | 100.0% | 99.9% | 0.000 ft |
| `IFCCOLUMN` | 311 | 100.0% | 98.7% | 0.000 ft |
| `IFCRAILING` | 215 | 98.6% | 98.6% | 0.011 ft |
| `IFCCOVERING` | 46 | 100.0% | 100.0% | 0.000 ft |
| `IFCWINDOW` | 20 | 100.0% | 100.0% | 0.042 ft |
| `IFCRAMP` | 11 | 100.0% | 100.0% | 0.000 ft |

Two assertions failed on first run. One is fixed below; the other is characterised and left standing, because a failing assertion that names a real gap is doing its job:

- **`no-element-past-its-own-box`** — 27 elements are drawn more than 10 ft past their own export box against a bound of 26. The worst is element **1622190**, a ramp, at 19.8 ft, followed by five `Stairs Stringer Carriage` elements at 14.1–16.6 ft, and they are all sloped stair and ramp parts.

  Three things are established about them and are worth recording before anyone chases the rest. **They are not proxy/native duplication**: no element in the model is drawn as both a native mesh and an envelope proxy, so the overhang is not two representations of one element being unioned. **They split into two distinct causes.** For 1622190 and the 1523160–1523162 stringers the native mesh sits exactly inside the element's own RVT record, so the disagreement is with the export rather than within the recovery — and the classes involved carry the exporter's replication marks (`IFCSTAIRFLIGHT` scores 88.9% against the union of its products but **100.0% against the nearest single one**, with 12 split products; `IFCSLAB` 18, `IFCRAILING` 13, `IFCMEMBER` 49), which is the replication question this tool's own notes warn against reading as a geometry one. For 1498369 and 1500261 it is a real placement error: their meshes sit **6.73 ft and 5.58 ft above their own records**, outside the 0.5 ft admission tolerance, which means they reached the scene through the `exactCarrierComposition` path that skips the envelope cross-check entirely. That bypass is the thread to pull, and it is left un-pulled here rather than guessed at: it exists because carrier-composed geometry legitimately does not match the element's own envelope, so narrowing it needs its own evidence.
- **`tail-placements-read`** — since fixed, and the fix was to the assertion rather than to the decoder. It counted `instanceOnlyElements`: elements the placement read was the *sole* source of geometry for. That was a sharp signal when written — 3 broken against 3,901 working — but it measures how little other evidence exists rather than whether the read works, so it falls whenever the rest of the pipeline improves. It had fallen to 21 not because the read broke but because **30,675 of those elements now also carry a real duplicated-bounds record**, which is the better evidence of the two. The assertion now scores `placedInstances` — elements whose own object yielded a transform and a shared shape, which is the read itself — at 30,696 against 25,887 families, 118.6%, with a 50% floor. An assertion that fails when the decoder improves is worse than no assertion.

Both failures reproduce identically on the commit before the audit work in this branch, so neither is a regression from it. Over the same range the audit's changes moved coverage from 36,229 to 36,255 drawn with every per-class agreement figure unchanged.

A second, independent check against an Autodesk conversion of the same building (51,420 fragments) agrees: element-diagonal percentiles run 6.93 / 15.43 / 43.47 ft for the recovery against 4.82 / 14.05 / 42.20 ft for the reference — the reference splits elements into more, smaller fragments — the two largest extents are the same 779.8 ft floor plate, and **no recovered element is larger than the largest reference fragment**. The recovery is not systematically over-extending anything; the 27 above are specific and identified.

## Decoder compatibility

| Revit release | Native evidence | Rendered geometry | Categories | Materials |
| --- | --- | --- | --- | --- |
| 2023 | fixed `ArcWall` six-coordinate record detected as a bounds hypothesis | production promotion disabled pending paired proof | attempted; no project file in the corpus to verify against | schema adapter only; real extraction pending |
| 2024–2026 | version-specific geometry record not yet proven | diagnostic fallback only | attempted; no project file in the corpus to verify against | schema adapter only; real extraction pending |
| 2027 | supplied-project nested duplicated bounds + native element ID and record classification | filtered, category-styled axis-aligned envelope proxies | native `BuiltInCategory` tokens, IFC-corroborated | category display fallbacks; native assignment pending |
| unknown | no release-specific decoder | diagnostic fallback only | attempted; reports zero when the token is absent | no claim |

The category decoder is not gated on the release, because it is self-validating: a file that carries no category tokens simply reports none, and the previous record-code classification stays in place. Its building-scale rules are verified against the supplied Revit 2027 project, **and against no second building**. The Revitless toolkit contributes one real Revit 2014 `.rfa` fixture, which now verifies legacy release detection, PartAtom metadata, and the component-scale diagnostic path; it does not validate project geometry rules. Every building threshold and classification rule in this document is therefore still fitted on one building.

Two independent things are gated by release, and it is worth not confusing them. Reviter's **own** decoders are chosen per release by `decoderPlanForVersion`, and the element-bounds, identity, category-ownership, and material decoders that carry the supplied model are 2027-specific. The **optional** standards-aware reader is a separate, vendored Rust/WASM library (`lib/rvt-wasm`, from `rvt-rs`) that declares 2016–2026, and that range is load-bearing rather than stale: on the supplied 2027 file its `quickSummary` succeeds and reports the release and 10,481 schema classes, but `openRvtBytesWithDiagnostics` traps inside the WebAssembly module. The two ranges do not overlap, which is why a message about the optional reader must never be written as a verdict on the file — `reader-support.ts` holds the range once so the four places that used to repeat it cannot drift apart.

### What one building's thresholds actually decide

A threshold fitted to one model is a hypothesis about all models, and the ones here are applied with a bare `continue`. Measured on the supplied project:

- **Wrapper detection is category-checked, not record-code-only.** The curtain-wall container fingerprint (`recordCode 30`, field count 8–10) used to run ahead of the decoded category and win. It claimed 1,840 records — every one of which carried a decoded category, so the byte pattern was never breaking a tie, it was overruling evidence. 1,809 are `Walls`, and a curtain wall is a Wall, so the rule was right about the overwhelming majority; the other 31 are 14 Curtain Wall Mullions, 9 Curtain Grids Wall and 8 Curtain Wall Panels — the very children a wrapper exists to reveal. The fingerprint now stands alone only where no category decoded, and those 31 elements are back in the scene.
- **Storeys come from the file, not from a histogram.** `levels` used to be the 8 most populated 0.5 ft elevation buckets, sorted by population, capped at 8 — and the supplied model returned exactly 8, so the cap was binding. Revit persists `Element.m_assocLevelId`, which this model carries 37,503 times, and those relations resolve to 18 level ids of which 12 clear the 20-member floor: −7.2, −3.3, 0, 3.3, 9.8, 14.4, 19.4, 24.3, 30.0, 34.1, 40.0 and 44.0 ft, each with the level's own element id. Each elevation is its members' **median** base height, so one misparsed envelope cannot move a storey. The histogram remains as a fallback for files whose relations do not decode, now uncapped.
- **Limits that bind are reported.** `MAX_TREADS`, `MAX_CURVES_PER_ELEMENT`, `MAX_QUAD_SPAN_FEET`, `MAX_HALF_THICKNESS_FEET` and `MAX_COORDINATE` are ordinary-building envelopes that discard geometry silently, so a monumental stair or a site-scale plane would go missing with the run still reporting success. They are unchanged — re-tuning them without a second building would only move the fitting — but `limit-census.ts` now counts every rejection and `stats.fittedLimitsReached` plus a conversion warning name any limit that bound. The supplied model reaches none of them, which is exactly why they were invisible.

## Native surfaces

Revit does not store element shapes as vertex soup. It stores **trimmed analytic surfaces** — a plane or a cylinder plus the parameter range over which it is used:

```text
plane, 105 bytes            cylinder, 137 bytes
+0    u8  0x01              +0    u8  0x01
+1    f64 origin (3)        +1    f64 origin (3)          arc centre
+25   f64 uDir (3)          +25   f64 xDir (3)
+49   f64 vDir (3)          +49   f64 yDir (3)
+73   f64 uMin, vMin,       +73   f64 zDir (3)
          uMax, vMax        +97   f64 radius
                            +105  f64 uMin, vMin, uMax, vMax
```

A surface point is `origin + u·uDir + v·vDir`. For a wall the plane is its centre plane, so the location line is `origin + t·uDir` over `t ∈ [uMin, uMax]` and the height is `vMax − vMin`.

**Verification.** Of 7,443 walls with a two-point axis in the paired IFC export, **90.9% have a vertical plane record exactly collinear with that axis** — the in-plane line passes through the axis start within 1e-6 ft. The controls are what make this conclusive: shifting the query line sideways by **0.01 ft drops the hit rate to 0.0%**, and rotating it by **half a degree also drops it to 0.0%**. Separately, `vMax − vMin` matches the IFC extrusion height to within 1e-9 ft for 94.2% of walls, against 34.2% under randomised re-pairing. 78 of 78 curved walls have their arc centre present as an exact coordinate triple, 77 have a cylinder record there, and 65 match the IFC radius exactly.

The trim range is the wall **as modelled**, before Revit's join trimming. The difference between `uMin`/`uMax` and the IFC axis endpoints is, element by element, exactly half of a wall thickness present in this model — 60 mm, 100 mm, 125 mm, 150 mm. The IFC axis is the post-join version, so that disagreement is evidence the record is genuine rather than evidence of an error.

**Attribution.** Geometry lives in per-element blobs, and each blob is introduced by an owner record that names its element outright: `ff ff ff ff 10 03 [u32 count][count × u64 element id]`. A surface belongs to the last such record before it — and that is the same anchor the parameter tables hang off, so one scan serves both.

The rule verifies at **99.87%** on the 4,544 wall plane-triples that have a unique geometric owner, against **0.04%** when the truth is shuffled and **0.00%** for a random tag. Across all categories, **96.9%** of attributed planes have their origin inside the owner's own bounding box, against 5.5% for a random element.

Two earlier readings were wrong and are recorded so they are not retried: the nearest preceding element id owns the surface only 0.6% of the time, and the `[u64 elementId][u32 n][n × u32 itemIndex]` table nearby contains the true owner only 0.4% of the time — its indices address a face/edge graph, not surfaces.

## Rebuilt solids

A wall's geometry is three consecutive plane records at a 105-byte stride: the centre plane, then the two face planes offset by half the thickness along the plane normal. That triple is everything needed to rebuild the wall as Revit modelled it — location line from `origin + t·uDir` over `[uMin, uMax]`, height from `vMin` to `vMax`, thickness from the separation of the faces.

**10,028 elements in the supplied project are rebuilt this way**, and the viewer draws those instead of their bounding boxes. Against the paired IFC export the rebuilt location line is collinear with the IFC axis for **6,280 of 6,284 — 99.9%** — and the rebuilt height matches the IFC extrusion depth for **98.2%**. The recovered thicknesses come out as the round millimetre figures a real building has: 90, 140, 150, 250, 300 mm.

This is oriented geometry, not an envelope. A wall running at an angle is drawn at that angle, with its true length and thickness, where the bounding-box path could only draw the box enclosing it.

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

Parameter names come from the `BuiltInParameter` values published in Autodesk's Revit 2026 API documentation, and are corroborating evidence rather than part of the decode: 125 of the 131 parameter ids found in the supplied project resolve, and the names that land beside the verified height are `WALL_USER_HEIGHT_PARAM` "Unconnected Height", `WALL_BASE_OFFSET` "Base Offset", and `WALL_TOP_OFFSET` "Top Offset" — exactly the company a wall height should keep. Six ids, `-1001101` among them, are absent from the published enum; the whole `-1000000…-1000999` band is empty there while its neighbours are dense, so these are most likely internal parameters Autodesk does not surface. They are reported by number rather than guessed at.

Selecting an element in the viewer now lists its decoded parameters by name.

## Element objects

Elements in `Partitions/*` are length-delimited, and the length is written **behind** the object rather than in front of it:

```text
S+0            u64 element id
S+8            u32 near-unique discriminator (not decoded)
S+12           u32 objLen          // object length, counted from S
S+16           u16 marker          // constant per release: 0x08c6 in the 2027 project
S+18           u64 type code       // element class discriminator
S+26           u64 element id, repeated
...            payload, including the duplicated-bounds sub-record
S+objLen+16    u32 objLen          // echoed
S+objLen+20    next object
```

The echo is what makes the chain safe to walk. It holds for **99.5%** of known records, while probing the echo at `+12` or `+20` instead of `+16`, or testing for `objLen ± 4`, all score **0%**, and shifting the whole probe a megabyte away scores 0.06%. Reading the length as a *header* instead scores only 61.7%, and its failures arrive in symmetric pairs — the signature of reading the previous object's length — so the trailer reading is the correct one.

Chaining forward and backward from records the bounds scanner already found recovers **47,265 objects against 35,677 bounds records**, because an object with no bounds record is still linked into the chain. Element identity coverage against the paired IFC export rises from **65.9% to 77.1%**.

The `u64` at `S+18` is an element class discriminator, and it is sharp: joined against the IFC export its modal purity is **94.58%**, with `116`→`IfcMember`, `114`→`IfcPlate`, `79`→`IfcColumn`, `101`→`IfcRailing`, `54`→`IfcSlab`, `62`→`IfcCovering` all at 1.000, and the one impure code (`30`) impure only in which *kind* of wall it is.

One entry in that table was wrong and is corrected here: `44` was read as `IfcOpeningElement` at purity 1.000, and **`44` is the door class**. The 1.000 was an artefact of the tag aliasing described under openings below — of the 1,480 code-44 records, **1,345 join both an `IfcDoor` and an `IfcOpeningElement`, 88 join a door only, and 0 join an opening only**. A code that never once joins an opening without also joining a door is not the opening's code.

The marker drifts by release exactly as schema tags do — `0x086d` in 2024, `0x08a4` in 2025, `0x08cc` in 2026, `0x08c6` in the 2027 project — so it is measured from the file rather than hard-coded. Releases 2020 and 2023 produce no chains; older releases frame objects differently.

Two limits are worth stating. Chaining runs per inflated page, so the ~0.05% of objects that straddle a page boundary are missed — that is the gap between the 47,265 recovered here and the 49,660 reachable when the whole stream is concatenated in memory, which a browser tab should not do for a 417 MB payload. And the marker is not resolvable through `Formats/Latest`: that stream defines roughly 200 classes and references the rest by tag, so `0x08c6` is a tag in Revit's internal class registry that this file never names.

## What the rendered view can and cannot show

The shaded view draws each element flat in its category colour, so the palette is what separates one category from another on screen. It was previously a narrow pale band that rendered the whole building as a single wash; it is now separated in hue and value, which is why glazing, doors, and framing read apart. The other render mode uses per-vertex colour, and that is tinted by category too rather than by elevation alone.

**Most walls used to be missing from the view, and the cause was the scene's entry condition rather than the decoder.** The scene was assembled only from elements carrying a duplicated-bounds record, and most walls do not have one — 2,818 wall records exist against roughly 7,400 wall objects. Those walls did have native geometry the whole time. Elements with a rebuilt solid and no bounds record now get a record synthesised from the solid itself, which takes walls in the scene from 1,250 to **6,846**, against 7,381 `IfcWallStandardCase` plus 1,835 `IfcCurtainWall` in the paired export.

The curtain-wall suppression that also hides records was checked while looking into this and left alone: of the 1,569 records it hides, 1,488 are genuinely `IfcCurtainWall` containers whose panels and mullions are drawn separately, and only 27 are ordinary walls.

Curtain wall panels are drawn as glazing rather than as opaque panels. They are the glass of a facade, and drawing them opaque walls the building off from its own interior — with them glazed, the structure behind a curtain wall is visible, which is the point of looking at the model at all.

What remains is a real limit rather than a cosmetic one. Curtain panels and mullions dominate this model by count and are drawn as envelopes, because they are loadable-family instances whose geometry sits in family-document blobs — the same reason their type names do not resolve.

## Coverage against the paired export

The conversion can report what it recovered. It cannot report what it missed, because nothing inside an RVT says how many walls a building has. The paired IFC export does, and every product Revit exports carries its Revit element id in the `Tag` attribute — the same id the partition decoders recover. Membership is therefore a direct question rather than an estimate, and `scripts/audit-coverage.ts` asks it element by element:

```sh
node --experimental-strip-types scripts/audit-coverage.ts model.rvt model.ifc
```

It separates three things that were previously one number, because they have different fixes:

- **seen** — the scan proved the element id is real, whether or not any geometry was built for it
- **recovered** — the element reached `elementBounds` with an envelope
- **drawn** — the element survived into the default scene

On the supplied 67 MB Revit 2027 project:

Counted by Revit element id, not by export product, and with the elements the export gives mesh geometry to reported separately from the containers it does not:

| IFC product type | in IFC | seen | recovered | drawn | drawn % | with mesh | of those | drawn before |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `IfcWallStandardCase` | 7,381 | 7,223 | 7,210 | **7,186** | 97.4% | 7,381 | 97.4% | 6,324 |
| `IfcWall` | 140 | 139 | 137 | **134** | 95.7% | 140 | 95.7% | 110 |
| `IfcCurtainWall` | 1,835 | 1,804 | 1,804 | 223 | 12.2% | **0** | — | 253 |
| `IfcMember` | 19,652 | 19,197 | 19,147 | **19,120** | 97.3% | 19,652 | 97.3% | 15,916 |
| `IfcPlate` | 6,235 | 6,080 | 6,069 | **6,068** | 97.3% | 6,235 | 97.3% | 4,973 |
| `IfcDoor` | 1,912 | 1,831 | 1,828 | **1,826** | 95.5% | 1,912 | 95.5% | 1,294 |
| `IfcWindow` | 20 | 20 | 20 | **20** | 100.0% | 20 | 100.0% | 3 |
| `IfcColumn` | 311 | 304 | 277 | **277** | 89.1% | 311 | 89.1% | 95 |
| `IfcRailing` | 215 | 204 | 164 | **164** | 76.3% | 215 | 76.3% | 147 |
| `IfcSlab` | 107 | 105 | 103 | **102** | 95.3% | 107 | 95.3% | 135 |
| `IfcRoof` | 20 | 20 | 16 | 16 | 80.0% | 18 | 83.3% | 14 |
| `IfcCovering` | 46 | 42 | 42 | 38 | 82.6% | 46 | 82.6% | 23 |
| `IfcStair` | 82 | 79 | 55 | 51 | 62.2% | **0** | — | 58 |
| `IfcStairFlight` | 108 | 105 | 101 | **101** | 93.5% | 108 | 93.5% | 77 |
| `IfcRamp` | 12 | 12 | 12 | **12** | 100.0% | 12 | 100.0% | 5 |
| building elements | 38,076 | | | **35,338** | **92.8%** | 36,157 | **97.0%** | 29,424 |

`IfcCurtainWall` and `IfcStair` are pure `IfcRelAggregates` containers in this export: **1,919 Tags with no mesh of their own at all.** They print a dash rather than 0.0% in the last column, because "none of its elements are drawable" and "none of them are drawn" read identically as a percentage and mean opposite things. Their panels, mullions, runs and landings are drawn individually, and the census below establishes that holding the containers back costs **zero** geometry-bearing elements — the trade is not merely justified, it is free.

**What the display gates were costing.** Four of them discarded geometry that had already been recovered:

- an envelope whose *category* did not decode was dropped from the scene entirely, even though its envelope came from the same validated duplicated-bounds signature as every other record's. That trades a missing label for a hole in the building, so an unnamed element is now drawn under a neutral **Uncategorised elements** batch — 731 of them here.
- sketch boundary recovery was attempted only for elements whose category had *already* decoded, which is backwards for exactly the elements that need it: ceilings and ramps are the smallest populations in the model and so the likeliest to fail category recovery, and a sketch loop is the only thing that gives them a shape rather than a box. Uncategorised elements with no other geometry are now tried too, and their ring is kept only when its plan extent reproduces the independently decoded envelope. Elements drawn from a real outline rise from **101 to 517**.
- the scene admitted only elements with extent on all three axes, which made `prismGeometry`'s deliberate minimum-depth fallback unreachable and dropped flat ceilings and ramp landings that had a perfectly good outline.
- an element rebuilt from several solids drew only its longest run, leaving a gap where the shorter segment should be.

Two recovery gates were also leaking. Object chaining was seeded only from bounds records, so a page holding none went unwalked and took every placement and shared shape on it out of the model; such a page now seeds itself from its own object markers, and recovered objects rise from 47,265 to **48,488**. Placed family instances were resolved into oriented boxes and then discarded unless the element reached the scene some other way.

Together these took drawn elements from 38,353 to 39,114, and coverings from 50.0% to 82.6% of the export's count, slabs from 83.9% to 93.2%. Removing the cached shapes described below then took the drawn count down to **33,117**, because most of what it removed was never a building element.

**Where the remaining loss is.** After these changes `recovered` and `drawn` are within a few elements of each other for every category except the two that are held back deliberately. The gap that is left is in *recovery*, and the `seen` column locates it:

- **never seen at all** — 3,367 mullions, 1,150 panels, 514 doors, 230 walls, 15 windows and 7 ramps. (Most of the "seen but not recovered" population below has since been placed; see "The missing elements were never in a family document".) Ramps and windows are the starkest: only 5 of 12 ramps and 5 of 20 windows are proven to exist by any pass. Chaining runs per inflated page, so objects straddling a page boundary are lost, and no pass indexes elements the chain never reaches.
- **seen but no geometry built** — 748 walls, 149 columns, 26 stair flights. These elements are known to be real and yield nothing to the surface, sketch, or instance decoders.

Neither is a display problem, so neither is fixed by the changes above. `IfcRamp` is unchanged at 5 drawn for that reason.

**The same split, in the studio.** This table was only ever available offline, while the app reported a single headline match rate — and a single rate flatters the result, because a class can be matched by element id for every one of its elements and still contribute nothing to the scene. Pairing an export now renders **Coverage by object class** in the report dock, with the same seen / recovered / drawn columns this section is built on, one row per class the export carries.

The join is the audit script's: the IFC analysis carries out the matched Revit ids per class, and the app intersects them with the ids the converter gave an envelope and the ids the scene actually drew. The drawn set is slightly stricter than the script's — the script counts a record *selected* for display, the panel counts an element that reached a mesh with triangles in it, 92 stair flights against the script's 97. Classes nothing was recovered for keep their row, since that row is the useful one; classes the export writes without a Revit id at all — storeys, the site, the building — are left out instead, because nothing can be joined to them and an empty row would read as a gap that is not one.

## What a CAD viewer already does, and what Reviter took from it

A bundle of the AutoCAD web application was read for its interaction design — not its code, none of which is here — and the most useful thing in it was a single array: the command allowlist that application applies when a drawing is opened read-only. Twenty commands. Measure, zoom, pan, properties, layers, blocks, xrefs, find, undo, compare. Absent from the entire bundle: isolate, section planes, a view cube, a navigation bar, zoom-to-selection, select-similar. Visibility is one light bulb per layer; orientation is a text button reading `Top` that opens a list of ten. A shipped read-only CAD viewer is *less* graphical than the one Reviter had, not more, and six things followed from that.

**The properties panel is headed by the object, not by the word "Properties".** Their header is the object type — `Line`, `Block Reference`. Reviter's is now the decoded category, with the element id demoted to the subtitle, which answers *what is this* before *which one is this*.

**The object list is windowed rather than capped.** It rendered the first 180 rows and told you to search for the rest, which was the one place the interface admitted it could not show you the model. Rows are a fixed height, so only those inside the scroll viewport exist: 31,391 objects render **19 rows**. Picking in the viewport now scrolls the list to the selection, which it never did.

**One control for orientation, with the ten names every drawing package uses.** A three-faced view cube and a separate 3D/Plan switch held the same idea in two places, and neither could say "SE isometric". Both are replaced by a text button showing the current view, opening `Top · Bottom · Front · Back · Left · Right · SW · SE · NE · NW isometric`. The derivative viewer shares the table rather than keeping a second copy: the SVF is y-up and metres, so its pose is the shared one rotated, `(x, y, z) → (x, z, −y)`.

**Categories are a layer list with a bulb per row.** Turning a category off filters the triangle index by the per-triangle element id the meshes already carry, so the vertices stay exactly where the converter put them and the pick table is filtered in step. 24 categories on the supplied model, largest first. This is the honest version of "isolate" for tens of thousands of envelopes, and it is the one AutoCAD actually shipped.

**Hovering names what is under the cursor** before you commit to clicking it, on the raycaster picking already used, throttled to one resolve per frame.

**Zoom to object** joins zoom extents — their floating nav has both, and framing one element was impossible before.

The vocabulary moved with it: *element* → **object**, *Model browser* → **Objects**, *Search* → **Filter**, *Fit* → **Zoom extents**, *Render style* → **Visual style**. Four words did **not** move. *Recovered*, *drawn*, *envelope* and *fidelity ledger* have no CAD equivalent because authored geometry never needs to express how much of itself is reconstructed guesswork, and renaming them into CAD vocabulary would be a claim about provenance that is not true.

Deliberately not taken: a command line, whose whole value is thirty years of muscle memory for a language only that application speaks; a ribbon, around a twenty-command surface; object snap, because snapping to a recovered envelope implies a precision the data does not have; and `ByLayer`-style inheritance, which exists to control authoring. Measure is in their read-only allowlist and is legitimate here, but it is not in yet: measuring a recovered envelope gives envelope dimensions, and a readout that does not say so would be a lie.

## Sheets: geometry that is drawn but is not an element

Overlaying the recovery on the export and asking what sticks out past the building found thirteen records reaching more than a foot beyond the export's own hull, one of them by **89 ft**. Nine were the same thing twice over.

**A floor's boundary sketch, extruded into a second slab.** Revit keeps a sketch-based element's boundary as an element in its own right, one id below its owner:

```text
1495202  142 × 156 × 0.66 ft  z 43.3  Floors    in the export
1495201  142 × 156 × 0.00 ft  z 44.0  (none)    not in the export
```

Same footprint, no thickness, no category, sitting on top of the floor it belongs to — and the scene was drawing it as a second slab hovering over the first, on every floor in the building. The test is the pairing rather than the shape: no category, no thickness, a ring instead of a solid, and an element one id above with the same plan extent within half a foot. That is **39 records**, and the export names none of them. As a null control, the same shape never occurs on an element that *does* have a category.

**Storey-sized plates that no category claims.** Size alone proves nothing — the largest real slab here is 371 × 686 ft, bigger than any of these. Size *with no decoded category* separates them completely: of the **50** envelopes over 10,000 sq ft that carry a category the export names **49**; of the **22** that carry none it names **none**. A 100 × 100 ft plate that nothing claims is not a building element, and drawing it lays a sheet across the model.

Both are held back the way curtain-wall wrappers already are — omitted from the scene, kept in the record set, reported in the caveats — so nothing is deleted and the coverage table's `recovered` column is unaffected. Records drawn past the export's hull fall from **11 to 2**, and every per-class drawn count is unchanged: the total stays 30,679, with uncategorised drawn down from 472 to 415.

What remains outside the hull is one wall, by 14 ft, and one door, by 3 ft.

Two floors appeared in that list until the measurement was corrected. The probe read each record's *envelope*, but the scene draws a sketch-bounded element from its **ring**, which is a different and usually smaller thing — `buildBoundsMeshes` prefers loops over the oriented box over the envelope, and the probe had that order wrong. Measured the way the viewer actually draws, those two floors are inside the building and the stray count before this change was 11, not 13.

**Railings.** Nobody had looked at them, and they hold the same pattern one level down. `Stairs Railing` itself is sound — 164 of 165 join the export and their median overhang is 0.00 ft. But Revit models a railing's **top rail** as its own element carrying the *railing's* envelope, and the IFC exporter folds it into the one `IfcRailing`: the export names **none** of the 178 here, and 158 of them reproduce a drawn railing's plan extent to within half a foot. Each was drawn as a second plate lying along a railing already in the scene. Those 158 are now held back; the 20 whose railing was never recovered stay, because there they are the only trace of it. Nothing moves in the coverage table.

The evidence for that rule is the duplicate footprint and nothing else. A first attempt also required the sub-element to be thin, on the reasoning that a handrail is thin — and it kept 99 of them, because a top rail on a stair carries the railing's whole rise, up to **24.9 ft**. The thickness test kept precisely the ones that hide the most.

The neighbouring categories look like drawing aids by their names and are **deliberately left alone**: the export names 18 of 20 `Stairs Paths`, 12 of 12 `Stairs Sketch Boundary Lines`, and the one `Sketch Lines` record — as stairs, stair flights, and a covering. Those are real elements whose category was inherited wrongly, and dropping them by name would take the building with them.

### Railings are swept along their path, not filled to their box

What was left after the top rails is not something any comparison against the export could have found: 16 of the 165 railings have an axis-aligned footprint over 500 sq ft, the largest **23,877 sq ft**. A railing running around an atrium spans that rectangle, and drawing the rectangle lays a 3.6 ft slab over the floor. The export's bounding box is identical, so the diff reports perfect agreement — only looking at the model shows it.

The path is in the file. 105 of the 165 railings own sketch curves, and the arithmetic that tells a railing's own path from a neighbour's also produces the missing dimension: **a railing's envelope is its path's own rise plus the guard above it**, so the guard is one minus the other. Across the railings whose path reproduces their envelope it comes out at a median of 3.609 ft, and every one of the 68 that pass lands on **3.61 ft** — a handrail height, derived from the file rather than assumed. The third of the paths that belong to a neighbour give guards from −14 to +23 ft and are rejected by that alone.

Each curve is swept as a thin upright section from the path up by the guard, so a railing follows a stair's rise instead of flattening it:

| | before | after |
| --- | --- | --- |
| railings swept | 0 | **68** of 165 |
| of the 16 worst offenders | 0 | **15** |
| plan area filled by railing boxes | 57,962 sq ft | **10,337 sq ft** |

The largest railing is now 113 runs instead of one 23,877 sq ft plate. Coverage does not move — a swept railing is still one drawn railing.

### A door's record is its opening plus the swing

A door is drawn 1.46 ft off centre and 2.91 ft oversized, and the obvious explanation — that the record is the opening in the wall — turns out to be only half of it. Against the export the **long** horizontal axis is already right: ratio 1.022, median difference 0.08 ft. The **short** axis is 5.1× too big, 3.50 ft where the export says 0.66. And 86% of the boxes are square in plan. That is not the shape of a door in a wall; it is the shape of a quarter-circle **swing**.

So the leaf is what is left when the swing is cut away: the record's own extent along the wall, the wall's thickness across it, centred on the wall's centreline. Both come from the model — walls rebuilt from native surfaces carry a centreline and a thickness — so no reference file is involved. 1,211 of the 1,459 doors find a host wall, and the door row of the overlay changes completely:

| `IfcDoor` | centre within 0.5 ft | size within 0.5 ft | median centre error | median size error |
| --- | --- | --- | --- | --- |
| before | 0.4% | 0.4% | 1.455 ft | 2.910 ft |
| after | **78.1%** | **54.3%** | **0.000 ft** | **0.261 ft** |

**The leaf is in the door, not in the wall.** The host-wall route above was the first half. A door's *shared geometry object* — the shape its placement points at — turns out to be the **swing**, written in the family's local frame as `[-w/2, -R, 0] .. [+w/2, +t, H]`: the width symmetric about the origin, the height starting at it, and the plan axis the arc sweeps through asymmetric, with the radius on one side and `t`, the door's **own half thickness**, on the other. Over 1,046 doors the median local box is 3.333 × 3.311 × 6.916 ft — square in plan, which is why transforming it untouched scored worse than the record and why reading placements appeared to buy doors nothing.

Folding that axis to `±min(|lo|, |hi|)` is the leaf, and the thickness now comes from the door rather than from whatever wall it sits in. The axis is found rather than assumed, because a mirrored family inverts the sign, and a shape symmetric in both plan axes is declined — folding it would be a no-op that quietly replaced the record with the shape's own box.

| `IfcDoor` | centre within 0.5 ft | size within 0.5 ft | median centre | median size |
| --- | --- | --- | --- | --- |
| the record itself | 0.3% | 0.3% | 1.460 ft | 2.921 ft |
| leaf cut from the host wall | 76.7% | 53.2% | 0.000 ft | 0.277 ft |
| **leaf folded from the door's own shape** | **94.4%** | **87.3%** | **0.000 ft** | **0.000 ft** |

On the 1,067 doors the shape route reaches it is 100.0% and 99.9%, with 1,065 sizes better and none worse. The controls isolate every part: without the fold 0.0/0.0, folding the wrong plan axis 0.0/0.0, a shuffled origin 0.0 on centre, a shuffled basis 26.5 on size, a shape shuffled between doors 53.6, and folding to the *wall's* thickness instead of the door's own 71.0 — which is what taking the thickness from the door is worth. The wall route stays as the fallback for the 442 doors whose shape object cannot be read. Order matters: shape first gives 94.4/87.3, wall first only 83.8/53.3.

The fold stays scoped to doors. The same operation would change 4,153 of 6,480 shared shapes, so it is a fact about door families, not a property of the shape reader.

The route that does *not* work is the element's own parameters. A door type carries a width and a height, but only 305 of the 1,459 doors have a parameter table at all and the parameters in it are the **host wall's** — `Unconnected Height`, `Base Offset`, `Top Offset`, median unconnected height 13.12 ft. Nothing decoded so far gives a leaf's own dimensions; the geometry had to come from the wall instead.

### Native faces were outranking the element itself

Chasing the stair flights turned up something that was never about stairs. The drawing precedence put an element's decoded **faces** above its envelope, and measured against the export across every class that owns faces, the envelope is closer for **168 of the 225** elements concerned:

| class · faces owned | n | faces, centre | envelope, centre | envelope better |
| --- | --- | --- | --- | --- |
| `IfcMember` · several | 112 | 4.62 ft | **2.14 ft** | 61% |
| `IfcStairFlight` · one | 39 | 5.99 ft | **2.59 ft** | 77% |
| `IfcWallStandardCase` · several | 36 | 31.84 ft | **0.00 ft** | 94% |
| `IfcWallStandardCase` · one | 24 | 23.22 ft | **0.00 ft** | 96% |
| `IfcStairFlight` · several | 6 | 78.92 ft | **0.08 ft** | 100% |
| `IfcWall` · several | 4 | 96.31 ft | **0.00 ft** | 100% |

A face set is usually a fragment of an element rather than a shape — half of these own exactly one face, and one face is not a solid. Faces are no longer drawn, and every class that had any improves:

| | before | after |
| --- | --- | --- |
| `IfcStairFlight` centre ok | 31.0% | **41.7%** |
| `IfcStairFlight` median centre error | 4.757 ft | **2.051 ft** |
| `IfcSlab` centre ok | 65.7% | **75.5%** |
| `IfcWall` centre ok | 65.4% | **68.5%** |
| `IfcCovering` centre ok | 97.4% | **100%** |
| `IfcWallStandardCase` centre ok | 96.0% | **96.8%** |

**This reverses a conclusion recorded earlier in this file.** A previous pass concluded that preferring the envelope over the faces made stair flights *worse* — 7.95 ft against 5.413. That was measured against a truth map keeping one box per Revit id, so an element the exporter split into several products was compared against whichever piece came last. With the boxes unioned the comparison runs the other way, decisively. The measurement was wrong, not the instinct.

### A stair run's own box was in the file, beside it

Stair flights were the worst class in the model, and the reason is mechanical. A run's duplicated-bounds record holds the run's **plan** — exact to 0.000 ft in centre and size — and the **whole stair's storey z-band**. A straight stair has one run per storey, so that band *is* the run's rise and the record looks right by coincidence. A switchback has two runs and a landing inside one band, so each run is drawn to the full storey while occupying half of it. That is the entire bimodal split: of the 49 flights over a foot out, 31 occupy under 70% of the record they are drawn to.

| | n | export flight height | record height |
| --- | --- | --- | --- |
| within a foot | 35 | 9.68 ft | 9.84 ft |
| over a foot | 49 | 5.97 ft | 9.84 ft |

The run's own elevations were never missing. They sit in an ordinary duplicated-bounds record — same `0x08c6` tag, same family word — filed under the run's element id **+ 1**, which is its Sketch element, carrying record code `169671` with one field. **The decoder was already reading all 111 of them** and drawing each as an anonymous element standing beside its oversized parent. The export names none of the 111, and the id below each is a stair run, landing, stringer or stair sketch line in 95 of the 97 cases.

So the owner adopts its companion's box and the companion is held back:

| | before | after |
| --- | --- | --- |
| `IfcStairFlight` centre within 0.5 ft | 44.3% | **84.8%** |
| `IfcStairFlight` median centre error | 1.895 ft | **0.000 ft** |
| `IfcStairFlight` median size error | 3.707 ft | **0.000 ft** |
| `IfcSlab` centre within 0.5 ft | 75.5% | **80.4%** |

The slab gain is the stair landings, which the exporter writes as slabs. No other class adopts anything — for walls, doors, plates, members, columns, railings, windows, coverings, roofs and ramps the count is zero — so this is a stairs-only companion rather than a general rule with a stairs-shaped side effect.

Stair flights are no longer the worst class; `IfcWall` at 68.5% and `IfcDoor` at 78.1% are now below them. What remains is 11 flights the exporter splits into one product per storey for a multistorey stair: the corrected box matches the **nearest single product to within 0.08 ft** and scores badly only against the union of all of them. Drawing one run per storey needs a replication rule, not a better box.

A second route was measured and rejected in favour of this one. A run's own sketch curves — owner exactly equal to the element id, not the id−1 union the railing path uses — do carry the rise, and reach 76.2% within half a foot. But they need a plan-agreement test and a z-overlap test to stay safe (without the plan test they admit a 226 ft box), they land 0.16 ft high because the curves are the boundary edges, and they do nothing for the landings. The companion record needs no tolerances and is exact.

**The converter is deterministic**, which had to be checked before any of this was believed: two runs of the same code on the same file produce identical counts. An apparent 84-against-79 discrepancy between two measurements was two different builds of the library, taken while it was being changed underneath.

**The panels themselves were never the problem.** The complaint that started this was that curtain-wall panels reached further out than they should. Measured against the export, the 13,931 mullions and 4,426 panels drawn from a placed instance's oriented box overhang it by **0.00 ft at the median, with none over a foot**. What was over-reaching was the sheets.

**And the "247 oversized mullions" recorded here were not mullions.** They were attributed to record code `179015/3`, which this file previously grouped with mullions because the export types both as `IfcMember`. The RVT says otherwise: 131 of the 267 such records carry their own native category token **`-2000123`, `OST_StairsStringerCarriage`**, and the export names all 258 that join a product `… Stringer 1`, `Stringer 3`, `Stringer 10` of `Assembled Stair:Stair`. The error has a stair's shape too — 200 of the 258 are wrong on **z alone** with their plan footprint exact to half a foot, by a median of 5.23 ft, and the inflated values are storey heights. So this is not a mullion problem at all; it is the same "a stair sub-component carries the assembly's vertical range" limit, and the count is **211 stringers about 5 ft too tall**. The mullion population is clean: of 1,723 mullions drawn from a bounds record rather than a placed box, **one** is over a foot out.

**A rule that would have caught the extremes was tested and rejected.** Two of those mullions are 724 ft and 365 ft long, which is absurd on its face — but "absurd" has to be something the decoder can determine without an export to check against. A category with thousands of members carries its own scale, so the obvious test is to flag an envelope many times the longest side of its category's median. At every cut it costs more than it saves: at 6× it flags 89 envelopes of which **1** is genuinely oversized and **73** are correct; at 20× it flags 6 to catch the same 1. A 274 ft mullion and a 479 ft wall are both real in this building. The rule is not shipped.

## Overlay and walk, in the studio

The overlay below started as an offline script. It is now a view mode: load an RVT, pair its IFC export in the **Regression fixture** panel, and the geometry-source switcher gains **Overlay**.

The three geometry sources were mutually exclusive, so comparing recovery against the export meant switching between them and remembering what you saw. Both are z-up and share the project's datum — only units and the origin the recovered scene is drawn around separated them, which is a scale and a translation rather than a registration problem. The export is parented to a group carrying exactly that transform rather than having its vertices rewritten.

The colouring is the point of the mode:

- the **recovery** is solid
- an exported element the recovery also has is a **quiet ghost**
- an exported element the recovery is **missing** is picked out in **red**

So the 6,939 elements the coverage table counts as absent become something you can look at and point at, in place. Picking still works in this mode; it searches recursively, because the recovered meshes sit a level deeper than before and the export's meshes carry no element ids.

**Walk** joins Pan / Zoom / Orbit in the viewport navigation bar. Orbiting is how you look at a building from outside and the wrong way to understand it from inside — a corridor, a stair, a floor-to-ceiling height all read differently at eye level. Mouse look runs on pointer lock, `W A S D` moves, `Shift` runs, `Space` and `C` rise and fall, `Esc` leaves. The eye sits 5.6 ft above the model's floor and the scene is already drawn in feet, so nothing needs scaling. Yaw and pitch are tracked directly rather than accumulated onto the camera's quaternion, which drifts into roll and tips the horizon over; leaving walk mode hands the camera back where the walker left it instead of snapping to the last preset.

## One command to check a model

Every rule in this file is fitted on one building, and there is no second one on this machine to check them against. What can be built now is the harness that makes the second one cheap, so `scripts/verify-pair.ts` runs the coverage audit and the geometric overlay in a single conversion and then **asserts** the things the rules were written to guarantee:

```sh
node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc   # exit 1 on any failure
node --experimental-strip-types scripts/verify-pair.ts model.rvt model.ifc --json > run.json
```

Twenty-two assertions, each named after the rule it guards, so a rule that does not generalise fails loudly rather than quietly drifting: per-class centre agreement floors for the six classes the bounds work put at 96–100%, the door-swing geometry, the railing guard height, the share of sheets held back, a tripwire on records drawn past the export's own hull, and four **firing** assertions. Four of the thresholds are worth reading for their reasoning, which is in the file's header:

- **records outside the hull is budgeted at 6, not a percentage.** Before the sheets rule this model drew 11 records past the hull; a 0.1%-of-drawn budget would have been 31 and would not have caught it. The gate is sized to fire on the state the rule exists to fix. It now reports **0**.
- **the guard-height band is 2.5–4.5 ft, narrower than the decoder's own 1.5–5 ft filter.** Asserting the filter back would be untestable — every survivor is inside it by construction.
- **hull overhang is capped at 200 ft**, which guards the tighter-of-two-copies rule specifically: always taking the second copy admitted a box 8,701 ft across.
- **an element may not be drawn far past its own export box.** `no-records-outside-hull` measures against the whole building's hull, so a wall drawn a hundred feet from where it belongs while staying *inside* the envelope passes it — and the per-class size percentages cannot see it either, because they are counts and a handful of monsters cannot move a figure over 7,000 walls. Measured per element against that element's own truth, **35 of 35,720 drawn** reach over 10 ft past their own box: one wall at **260.3 ft**, and about two dozen raked stair stringers drawn as axis-aligned envelopes 11–17 ft across where the export gives them 1.3–9.3 ft. The budget is 40.
- **the tail-placement read is asserted as a share, not a count.** Nothing here originally asserted that a rule *fires* at all, only that what it produced was accurate — so a rule that silently stopped firing would pass every threshold. Four assertions now check reach. A floor of “≥ 1” would not have caught the one that mattered: the tail-placement read placed **3** elements when it was broken against 4,328 now, so it is sized at ≥ 1% of the members and plates in the export. Each firing assertion skips rather than fails when the export holds too small a population to judge.

Doors, `IfcWall`, slabs and stair flights sit at 78/68/75/44% and are **deliberately not** given floors: pinning them would assert known decoder gaps rather than detect a broken rule. A class the export does not contain reports `skip`, not `pass`.

**The gate has its own control.** A gate that cannot fail is decoration, so every `Tag` in the export was shifted past any real Revit id and the harness re-run: coverage went to 0.0% and failed, the eight join-dependent assertions reported `skip` with their reason rather than passing vacuously, and the three RVT-only assertions still passed. That run also caught a nonsense message in the output, since fixed.

### Holding out halves of the one building

Every threshold above is measured on the whole model, which cannot distinguish a rule that is right from a rule that was fitted to where in this building it happened to be measured. `scripts/holdout.ts` partitions the building two ways no decoder rule can have keyed on and reports each rule per partition:

```sh
node --experimental-strip-types scripts/holdout.ts model.rvt model.ifc   # exit 1 on any silent rule
node --experimental-strip-types scripts/holdout.ts --cache               # re-derive in 2s, no models needed
```

- **by storey** — the export's `IfcBuildingStorey` containment, propagated down `IfcRelAggregates` so a curtain panel inherits its wall's storey. That covers **100% of the 38,226 tagged products** across 13 storeys, Floor 0 at −7.2 ft to Floor 6 at 55.8 ft. Anything with no product falls back to elevation bands, and every rule prints what share of its population took the fallback.
- **by wing** — the export hull's longer plan axis, halved.

A spread only counts as a split if it also clears a pooled two-proportion `|z| > 2`; without that, an 18pp gap on n=36 reads as a finding when it is a coin toss. Storeys too thin to compare are pooled into halves so there is still a storey test.

**Six of seven rules hold on parts of the building they were not fitted to. Two reports did not come out clean, and both are reach rather than accuracy — which is exactly why no threshold above saw either:**

- **the railing sweep is silent below Floor 1.5.** Its guard height is 3.609 ft on all 70 railings it reaches, on every partition, so the arithmetic generalises perfectly. But it reaches **0 of the 41 railings at or below Floor 1** — 0/1, 0/10, 0/21, 0/9 — against 70 of the 124 above. This is the failure mode a pass-rate cannot express: a rule can be flawless on what it touches and still be wrong about the building, because it never touches half of it. Chasing it down found something worse than silence, and is the section below.
- **stair companion adoption splits by storey**, 95.2% on Floor 1 against 55.2% on Floor 2 and 65.0% on Floor 3, z=3.1. Of the 24 owners still over half a foot out, 11 are the flights the exporter splits one product per storey — a truth-side artefact — and **13 are landings the export writes as slabs**, 20 of the 24 on Floors 2 and 3. The premise itself is spotless: the export names 0 of 117 companions, on every partition. Chasing the landings down is the section below; it took the rule to 87.5%, and what survives is the exporter's split alone.

Two results worth reading past the verdicts. **The tail-placement window is right rather than fitted**: searching 80–240 bytes back instead of 125–149 finds 1,331 extra candidates, of which only 143 join an export element and **24** reproduce it. Scoring raw candidates made this look like a 98pp split, which was the probe's own false positives; framing the population as *placements that reproduce the export* gives 99.9% everywhere. And **the 10,000 sq ft sheet rule holds back exactly one element the export names** — 1522385, an `IfcMember` with a 61,572 sq ft footprint, which is to say a misparse.

**What this does not establish.** Every partition shares this file's Revit release, exporter version, family library, practice conventions and structural grid. Partitioning can catch a rule fitted to *where in the building* it was measured — a real failure mode, with precedent here — and cannot catch one fitted to any of those four. It is not a substitute for a second file. That caveat is in the script header, printed above its first table, and carried in the JSON's `caveat` field.

## Overlay against the paired export

Counting elements answers whether something is present. It cannot answer whether it is in the right place, and an element can be drawn and drawn wrong. `scripts/overlay-diff.ts` puts both models in one frame and measures the disagreement:

```sh
node --experimental-strip-types scripts/overlay-diff.ts model.rvt model.ifc
```

`web-ifc` returns metres in a Y-up frame and the recovered model is feet, Z-up, so the export is mapped through `(x, y, z) → (x, −z, y)` — the same mapping `ifc-reference.ts` already applies — and scaled. The comparison is against the geometry the viewer actually **draws**, following the same precedence `buildBoundsMeshes` uses, because for a placed family the drawn shape is its oriented box rather than its axis-aligned bounds.

| IFC product type | drawn | centre ok | size ok | median centre error |
| --- | --- | --- | --- | --- |
| `IfcMember` | 15,944 | 98.6% | 98.4% | 0.000 ft |
| `IfcWallStandardCase` | 7,145 | 96.8% | 55.2% | 0.084 ft |
| `IfcPlate` | 4,973 | 99.9% | 99.7% | 0.000 ft |
| `IfcDoor` | 1,399 | 78.1% | 54.3% | 0.000 ft |
| `IfcColumn` | 266 | 100.0% | 100.0% | 0.000 ft |
| `IfcRailing` | 163 | 100.0% | 100.0% | 0.000 ft |
| `IfcWall` | 127 | 68.5% | 40.2% | 0.209 ft |
| `IfcSlab` | 102 | 75.5% | 61.8% | 0.000 ft |
| `IfcStairFlight` | 84 | 41.7% | 40.5% | 2.051 ft |
| `IfcCovering` | 38 | 100.0% | 100.0% | 0.000 ft |

"ok" means within half a foot on every axis.

**The wall size column was two-thirds measurement error.** This file used to explain it away: "the record is the wall as modelled, before Revit's join trimming, and the difference is half a wall thickness". That is wrong about the record. For the 106 `IfcWall` and 6,045 `IfcWallStandardCase` elements that carry a real duplicated-bounds record, **the record reproduces the export's box corner for corner** — within 0.001 ft for 100.0% and 99.4% of them. The as-modelled reading is the **solid**, which the viewer draws over the record, and 33 of 110 `IfcWall` solids run longer than the wall's own location line by a median of 6.07 ft.

On top of that, `overlay-diff.ts` was measuring solids wrong. A solid is drawn as an *oriented* box, offset from its centreline by half a thickness along its own normal; the script added half a thickness to **both** x and y, which reports a box a full thickness too long. For a 25.242 ft wall 1.148 ft thick it printed 26.390. Correcting the measurement alone, with no change to what is drawn, took `IfcWallStandardCase` size agreement from 55.3% to **83.4%** and `IfcWall` from 40.2% to **59.1%**.

Then clipping each solid's centreline to the element's own envelope — two independent readings, so the shorter is not a guess — gives the rest:

| | shipped | metric fixed | and clipped |
| --- | --- | --- | --- |
| `IfcWallStandardCase` centre / size | 96.8% / 55.3% | 96.8% / 83.4% | **98.6% / 92.4%** |
| `IfcWall` centre / size | 68.5% / 40.2% | 68.5% / 59.1% | **90.6% / 76.4%** |

`IfcWall` here is not a stacked wall or an in-place family: all 140 are `Basic Wall:Interior Wall`, and what distinguishes them is the *body* the exporter writes — 88 faceted `Brep`s and 43 multi-extrusion `SweptSolid`s against 7,336 single extrusions for `IfcWallStandardCase`. A profile-edited wall is exactly the case where a trim range off the centre plane stops describing the wall.

Clipping to a **shuffled** envelope fixes 0 and breaks 7; clipping to the envelope of the element one id below — a genuinely nearby box — is +421 against −944. The gain needs the element's own envelope. Falling back to the envelope outright wherever a clipped solid still disagrees by over half a foot scores better again, `IfcWall` at 92.9% / 88.2%, but costs 269 of 6,527 solid-drawn records their orientation, and an angled wall drawn as its axis-aligned box is an error the metric cannot see because the export's box is axis-aligned too. Measured and not taken, for the same reason railings are swept rather than boxed.

**Two artefacts were removed from the drawing, both found by asking what reaches past the building.** A bounds record whose reserved word at `+22` is non-zero without an all-ones record code is corrupt: across 42,333 records that word is zero in 41,124 and `0xffffffff` in 1,206 — every one of those paired with an all-ones code — and exactly **three** match neither. All three are broken, one of them the model's worst envelope, a stair stringer drawn **724.6 ft** long whose code word has had its high half overwritten. Rejecting them costs no correct element — with one qualification worth stating: the export does name two of the three, and while one has no usable bounds copy either way, the other's surviving copy *is* the 724.8 ft stringer. So the rule costs one named element its geometry; that geometry was the wrong geometry. Separately, an element whose only geometry is a hull over the faces attributed to it is no longer drawn: **37 of the 40** such elements that join a product are over a foot out, median 7.96 ft, one of them a 0.2 × 0.5 × 4.3 ft mullion drawn as a 168 × 366 ft hull over faces that are not its own. The record is still synthesised, because it is what lets a sketch ring attach later — removing the synthesis outright cost 15 coverings and 13 slabs that were being drawn correctly from rings they only had because the record existed. Together these take records reaching past the hull from 1 to **0**, and cost 51 elements their geometry out of 30,679.

**One element can leave the exporter as several products.** A floor sketched in three regions becomes three `IfcSlab`s, each carrying the same Revit id in its `Tag`. The script kept the last box it saw for an id, so an element that exported as three regions was compared against whichever region came last, and the recovery — which draws all three — looked oversized by the distance between them. That produced a floors-are-drawn-too-big result that was entirely an artefact of one line: **20% of slabs measured over a foot out; unioning the boxes for a shared id puts it at 3%**. Railings went from 6% to **0%**. It did not rescue stair flights, which are genuinely oversized, and it does not touch `audit-coverage.ts`, which asks only whether an id is present. The wall size column is expected rather than wrong: the record is the wall **as modelled**, before Revit's join trimming, and the difference is half a wall thickness.

**The scene was framed to the wrong place.** The origin was the midpoint of the absolute extent of every drawn record, so the handful of misparsed envelopes that land thousands of feet from the building dragged it with them — the supplied model's centre came out at `177.4, 448.5, −56` where the export puts the building at `−5.4, 287.6, 24`. The camera opened on empty ground. Ignoring one part in a thousand at each end of each axis puts it at `−1.5, 287.3, 21.7`, within **4 ft**. Nothing is discarded; this decides only where the viewer looks.

**A placed box is now checked against the element's own envelope.** An instance's oriented box and its duplicated-bounds record are independent readings of the same element, so their agreement costs nothing to test. For curtain-wall mullions and panels — 18,357 elements — they agree to 0.000 ft and the box is exact. For doors they disagree by 7.15 ft, and the box is wrong by that full amount while the record is wrong by 2.75: the shared shape a door instance points at is not the door's own extent. Using the box only where it agrees leaves members, plates and columns untouched and takes the median door error from **3.458 ft to 1.426 ft**. 942 of 19,356 placed boxes are rejected this way.

Stair flights remain wrong at 5.4 ft and are not addressed here.

**Where the unrecovered elements actually go.** Joining the export's family and storey data to the elements that never appear shows the losses are not spread evenly:

- **round columns** account for most of the 149 columns that are seen but yield no geometry — 75% of `Round Column:24" Diameter`, 87% of `20"`, 89% of `16"`. Cylinder surface patches exist in the file but only 146 of them, so a round column is not stored as a cylinder patch; 47 of these columns are instances whose shared shape never resolved.
- **5,260 of 24,616 instance placements reference a shared geometry object that is never read.** 1,637 of those objects are found in the chain and rejected, because `readLocalBounds` reads the local AABB at `+48` and these larger objects do not keep it there. An offset search against the export found no consistent alternative, so the layout is still open. This costs 540 elements outright and coarsens the rest.
- **ramps and windows are simply absent** — 7 of 12 ramps and 15 of 20 windows appear nowhere in any pass, so there is nothing to place.

## The bounds are written twice, and the tighter copy is the element's

The record's two identical bounds blocks were treated as a single test: if the
copies disagreed, the record was thrown away. That is what was missing the
interior partitions. **994 walls** the export names had no geometry at all, and
looking at their objects, every one of the 757 that could be found failed on
that one check and no other — not the marker, not the id, not the family word,
not the field count.

Their bounds were there the whole time. Searching every offset of those 757 wall
objects for six `f64` reproducing the exported wall, **the block at the second
copy matches for 757 of 757**, and the same search against a deliberately
mismatched wall matches **nothing at all**. Where the two copies disagree, the
first holds something else and the second is the element's own extent.

So one of the two copies is read rather than the record being thrown away, and
disagreement is recorded as evidence rather than treated as disqualifying. The
result, measured against the export:

| | drawn before | drawn now | of the export's count |
| --- | --- | --- | --- |
| `IfcWallStandardCase` | 6,324 | **7,145** | 96.8% |
| `IfcColumn` | 95 | **266** | 85.5% |
| `IfcStairFlight` | 76 | **97** | 80.2% |
| `IfcRailing` | 147 | **173** | 75.5% |
| `IfcDoor` | 1,294 | **1,399** | 73.2% |
| building elements | 29,452 | **30,676** | 80.3% |

The new geometry is in the right place, which is the part that matters: columns
go to **100.0% centre and 100.0% size agreement at 0.000 ft median error** — the
round columns that three earlier investigations could not explain were simply
these records, rejected. Walls hold 96.0% centre agreement across 821 more of
them, members 98.5%, plates 99.9%, railings 94.5%.

This also retires the earlier conclusion that these elements had "no geometry
anywhere in the file". They did. The decoder was asking the bytes the wrong
question.

### Which copy, tested on the classes the rule was not fitted to

"Read the second copy" was derived from 757 walls, and a rule fitted on walls and
then applied to everything is the shape overfitting takes. A second building
would be the proper control; there is only one here, so the substitute is to hold
out the element classes the rule never saw. Over the **5,339 records whose two
copies actually differ** and that join to an export element:

| class | n | median error, first copy | second copy | second wins |
| --- | --- | --- | --- | --- |
| `IfcWallStandardCase` | 4,853 | 0.197 ft | **0.000 ft** | 94% |
| `IfcDoor` | 104 | 3.529 ft | 3.529 ft | 7% |
| `IfcColumn` | 103 | 0.003 ft | **0.000 ft** | 64% |
| `IfcMember` | 81 | **6.187 ft** | 6.187 ft | 4% |

The rule holds on columns, which it was not fitted to, and does nothing for doors
or members — consistent with those classes' error coming from somewhere else
entirely. But taking the second copy unconditionally also admits a handful of
wild boxes, one of them **8,701 ft** across. Choosing whichever copy encloses
less volume — a test the decoder can apply with no export to check against —
keeps the same accuracy and drops the tail:

| rule | mean error | worst case | within 0.05 ft |
| --- | --- | --- | --- |
| always the first copy | 0.538 ft | 23.5 ft | 10.8% |
| always the second copy | 2.009 ft | 8,701.2 ft | 95.9% |
| **whichever encloses less** | **0.380 ft** | **851.9 ft** | **95.9%** |

That is what ships. It takes building elements from 30,676 to **30,679** — the
point is not the three, it is that the worst case shrinks tenfold without costing
anything, on classes the rule was not derived from.

## The railing sweep was silent on the stairs, and wrong where it spoke

The hold-out harness said the sweep reached none of the 41 railings at or below Floor 1. The storey was a proxy: **the lower storeys are where this building's stairs are**, and there are two kinds of railing written two different ways.

| | n | path filed under | path rise | swept before |
| --- | --- | --- | --- | --- |
| record code `101/3` — a level railing | 92 | `id − 1` | 0.00 ft | 70 |
| record code `101/2` — a stair railing | 71 | `id + 1` | the stair's | **0** |

`railPathFor` looked at `id` and `id − 1` only, so it never saw a stair railing's path. `id + 1` is the same convention the stair-companion rule already uses. Not one of the 165 railings owns a curve under its own id, so the `id` half of the union was always dead weight.

**The worse finding is that the arithmetic could not fail.** The guard was `envelope height − path rise`, which for *any* flat curve set returns the envelope height regardless of where in z that curve set sits. Identical railings stack floor on floor, so a neighbour's path a storey away matched in plan and returned exactly 3.609 ft. Measured against the export's own railing meshes, **21 of the 70 swept railings sat a median 8.04 ft from the nearest exported railing vertex**, best case 3.78 ft, recall 0%.

**Nothing caught it, and that is on this file's own harness.** `drawnBounds` in `overlay-diff.ts` had no `railPath` branch, so the agreement table measured the railing's *envelope* while the geometry drawn from it went a storey astray. `IFCRAILING 100.0%` was measuring something the viewer does not draw. That is now fixed, and the fix is its own control:

| | railing centre agreement |
| --- | --- |
| old rule, old metric | 100.0% — blind |
| **old rule, new metric** | **87.2% — the error is visible** |
| new rule, new metric | **100.0%** |

A metric that does not follow the drawing precedence is not measuring the drawing. Note that even at 87.2% the assertion would still have *passed* its 80% floor: the threshold was never the thing that would have caught this, the missing branch was.

The rule now takes the curve set at `id − 1` **or** `id + 1`, judged per owner rather than unioned — a stair railing owns both its path and a flat projection of it — requiring the plan to fit the envelope within 0.5 ft and the base within a new `RAIL_PATH_BASE_TOLERANCE_FEET = 1`, with the guard taken **top-anchored** as `envelope top − path top`. Top-anchoring is not a restatement of the old arithmetic: on the 57 sloped paths, a population 3.609 ft was never fitted on, it gives 52 of 57 at 3.609, where base-anchoring gives guards from −30.9 to +13.5 ft.

| | before | after |
| --- | --- | --- |
| railings swept | 70 | **80** — 49 kept with identical guards, **21 dropped**, 31 added |
| at or below Floor 1 | 0 of 41 | **25 of 41** |
| sweep vs the export's mesh, median | — | **0.76 ft**, against the envelope's 1.65 ft |
| closer than the element's own box | — | **75 of 80** |
| exported vertices covered, median | box 60%, worst 2% | **100%, worst 88%** |
| guard height | 3.609 ft on all 70 | 3.609 ft on all 80, every one within 0.05 ft |

Controls: railing envelopes shuffled among railings fire **0.3 times of 165** over 20 trials against the rule's 80; wrong offsets score ±2 → 3, ±3 → 0, ±7 → 0, ±1001 → 0; the same test on drawn non-railings fires **27 of 35,325**, 0.08%; and a railing's ribbon scored against a *different* railing's exported mesh has recall 0%. The base tolerance is a plateau rather than a fit — 0.75 to 3.0 ft all sweep 78–81 with the same worst case, 5 ft admits 4 more errors and 10 ft admits 8.

Honest residuals. Railing **size** agreement reads 91.5% now, down from a 100.0% that was measuring the envelope; the median size error is 0.003 ft. And 85 railings are still not swept: **46 have a plan-fitting neighbour path whose base is wrong** — the stacked-storey twins, now correctly refused rather than silently drawn — 33 own no curves at `id ± 1` at all, 4 fail the plan test and 2 the guard band. A wider id search finds a plan-matching owner for 158 of 165, but those owners are top rails and balusters at offsets +8 to +40 with no consistent stride; adopting them would be fitting, and it was not done.

## A stair landing is a slab, and was being drawn as a location line

`IfcSlab` sat at 80.4% centre agreement — the worst class in the model that is not a stair or a door — and the hold-out harness said why it was invisible to every other measure: the misses clustered on Floors 2 and 3, and the rule they were blamed on was innocent.

The 13 landings are named `Assembled Stair:Stair:<parent> Landing 1`, carry the native category `Stairs Landings` (−2000920), and the export writes each as an `IfcSlab` with a single `Body/SweptSolid` shape — a profile extruded through a thickness, which is the definition of a sketch-based element. That category was not in `SKETCH_BOUNDARY_CATEGORIES`, so a landing fell through to the rebuilt-solid route instead.

**A plane triple on a landing is not a location line.** Across all 6,346 solid-route elements that join an export product, `Stairs Landings` is the *only* category where the route fails outright: **0.0% centre agreement on 17 elements, median 2.551 ft out**, against walls at 98.0%, columns at 100% and panels at 100%. Four landings were drawn as 0.2 × 0.2 × 1.0 ft stubs where the export has a 3.8 × 8.0 ft slab.

The landing's own sketch curves were in the file the whole time — 21 to 24 each, filed under its own id — and assembled they reproduce the export's own footprint to **0.00 ft at the worst corner, 20 of 20**:

| landings owning a ring, n = 19 | centre within 0.5 ft | median centre error |
| --- | --- | --- |
| drawn from the rebuilt solid | 2 | 2.551 ft |
| drawn from the envelope | 13 | 0.000 ft |
| **drawn from the ring** | **17** | **0.000 ft** |
| control: another landing's ring | **0** | 243.612 ft |

The fix is one category id. `IfcSlab` centre agreement goes **80.4% → 95.1%** and size **71.6% → 82.4%**, landings drawn within half a foot go from 7 of 25 to **22**, and the hold-out rule goes from 76.9% to **87.5%** — Floor 1 to 100%, Floor 2 to 65.5%, Floor 3 to 85.0%. Every other row of the overlay table is byte-identical, and nine of the ten hold-out rules print identical n, accuracy, spread and z.

**The companion-adoption rule was never the problem, and the earlier account of the 24 misses was slightly wrong.** The adopted envelope was already correct — 0.00 ft for 11 of the 12 — and simply never drawn, because `record.solid` outranks it. Scoring each owner against the *nearest single* export product rather than the union also corrects the split: 11 flights **and one landing** reproduce a single product to ≤0.02 ft, so the honest baseline was 12 truth-side artefacts and 12 our defect, not 11 and 13. All 12 residual misses now match a single product to ≤0.02 ft, so what remains is entirely the exporter writing a multistorey stair as one product per storey — which lives on Floors 2–3 by definition, and is the split.

Three negative results from the same work. **A general "envelope beats rebuilt solid" rule is rejected**: over 6,346 solid-route elements it fixes 68 walls and 11 landings and breaks a ceiling, and this file already records that a global envelope fallback costs 269 of 6,527 records their orientation — invisible to an axis-aligned metric because the export's box is axis-aligned too. Scoped to landings, where a flat slab has no orientation to lose, it costs nothing. **The `id − 1` union hypothesis is true and worthless**: a stair part's Sketch companion sits one *above* it, so the floor convention looked wrong here, but own-only and the union score identically at 17 of 19, so nothing was special-cased. And **the sketch route does nothing for stair flights** — the three that reach it are all per-storey splits.

One residual is recorded rather than papered over: five landings have no duplicated-bounds record at all, so their envelope is synthesised from that same bad solid, 1.00 ft thick where the export writes 0.16. The ring fixes four of their plans and leaves 0.42 ft of z error. That is a recovery gap, not a drawing one, and no thickness was invented for it.

## What is actually still missing: the census

Five rounds chased one class at a time. This is the whole undrawn population at once, grouped by **cause rather than class**, which is the grouping that says what is worth doing next.

36,144 distinct Tags carry mesh geometry in the export. **1,171 of them are not drawn:**

| n | share | cause | reachable |
| --- | --- | --- | --- |
| **877** | 74.9% | **never seen** — no pass proves the id exists | **no** |
| **231** | 19.7% | **seen, but no bounds record built** | **the only real work left** |
| 53 | 4.5% | face-hull-only records | **no — measured, below** |
| 6 | 0.5% | wrapper — ordinary walls mistaken for containers | marginal |
| 3 | 0.26% | no drawable extent and nothing else holds them | trivial |
| 1 | 0.09% | the unnamed-plate rule, correctly | correctly held |

Never-seen is 455 `IfcMember`, 158 `IfcWallStandardCase`, 155 `IfcPlate`, 81 `IfcDoor`, 11 railings, 7 columns, 4 coverings, 3 flights, 2 slabs, 1 wall. Seen-with-no-record is 106 members, 40 railings, 29 columns, 21 plates, 17 walls, 5 flights, 5 ramps, 5 doors, 2 slabs and 1 roof — proven by the partition scan alone for 144, by the ElemTable alone for 83, by both for 4. **Null control:** shifting every Tag past any real Revit id puts all 36,144 into "never seen" and 0 into every other bucket, so no bucket fills by set arithmetic.

**Three display gates were suspected of costing geometry and cost none.** No `IfcCurtainWall` or `IfcStair` product carries a mesh in this export — they are pure `IfcRelAggregates` containers — so the wrapper trade this file describes is not merely justified, it is **free**. The sheets rule, the no-class rule, the sub-element rule, the stair-companion rule and the dominant-container rule each claim **0** of the 1,171: they hold back records, and none of those records joins an export mesh.

**The face-hull bucket was the one candidate fix, and the numbers close it.** Of the 53 face-hull records that join an export mesh, **3 are within half a foot in plan and centre — 5.7%** — median plan error **8.81 ft**, worst **199.3 ft**. Splitting by facet count does not rescue it: single-facet hulls, the best case, are 2 of 13; multi-facet 1 of 40. Null control with the truth rotated 12,345 places: **0 of 53** against 3. Releasing the bucket would draw 50 elements wrongly to gain 3. That confirms and extends the 37-of-40 result recorded earlier, on a population it had not measured.

Relaxing the drawable-extent filter is the same shape of loss: 1,267 records have no drawable extent, 232 are claimed by another gate, and of the remaining 1,035 the export names **4** and does not name **1,031**, carrying 131,493 sq ft of plan with six over 5,000 sq ft each. Four named elements for a thousand unnamed sheets.

**The two small classes resolve differently.** `IfcRoof`'s 4 missing are all *seen with no bounds record* — one cause, a recovery gap rather than a display one, exactly the single-rule shape small classes usually have. `IfcCovering`'s 8 are two causes and no clean rule: 4 never seen, and 4 single-facet flat face hulls whose plan reproduces the export to 0.01–1.6 ft — 2 of the only 3 accurate hulls in the entire 53 — but drawing them needs *both* the extent gate and the face-hull gate relaxed, and three of the four carry the category `Sketch Lines` rather than a covering, so there is nothing clean to scope a rule to.

**So the remaining work is one bucket, not many.** 877 elements are not in the readable stream at all, which is the same wall the surfaces investigation hit and closes with more of the file rather than more rules. 231 are *seen and have no record*, and that bucket was then opened.

### Inside the 231, and why the duplicated-bounds decoder was never the gate

Probing every id at byte level, against a 1-in-40 control sample of 875 drawn elements measured the same way:

| n | state |
| --- | --- |
| 90 | the id occurs in the stream but at **no offset that frames as an object** |
| 88 | a **valid framed object exists that the chain never reaches** |
| 53 | the object is chained into the model and still yields no record |

**Only 6 of the 231 carry a `0x08c6` object at all** — 4 rejected on the family word at `+34`, 1 on the field lead at `+42`, 1 accepted. For the other 225 there is no duplicated-bounds record to reject. In the drawn control, `0x08c6` heads 720 of 875 and its gate accepts 719. The bounds decoder was never the problem here; the objects are under other markers — `0x07ef` heads 62 of them, `0x0256` **all 40 railings**, `0x1019` 29 members, `0x0d7b` 5 ramps.

**Looking for an extent under those markers is a dead route, measured.** Searching every offset of all 148 framed objects for six `f64` reproducing that element's own export box at ±0.05 ft — the same search that found the second bounds copy for walls — returns **2 hits, both under `0x08c6`**, and **0 of the 146 objects under `0x07ef`, `0x0256`, `0x1019`, `0x0d7b`, `0x0d40` and `0x1006`**. Null control: 0.

Counting the other routes: 11 have an instance placement whose shared shape never resolves, **1** owns any plane or cylinder patch, and 75 own sketch curves of which only **12 assemble a closed ring**. **207 of the 231 have no geometry source of any kind in the readable stream.**

### A marker's members can speak for the ones with no category token

Of those 12 ring owners, **11 reproduce the export box in plan within 0.5 ft, median 0.000 ft** (null, ring against another bucket element's box: 0 of 12). The shipped ring-synthesis gate is the element's own decoded `BuiltInCategory`, and it reaches none of them, because their token is not written.

The key that *is* in the file is the object marker, and the members of a marker that do carry a token can speak for those that do not. Over 843 record-less ring owners, of which the export names 67:

| gate | selected | named by the export |
| --- | --- | --- |
| own category token (shipped before) | 36 | 36 |
| **marker consensus, support ≥ 3, purity 1.0** | **42** | **42, none unnamed** |
| the same consensus permuted, 10 shifts | 23.1 per trial | 8.0 per trial |

The threshold is a plateau — every floor from support ≥ 1 to support ≥ 7 at purity 1.0 selects the same 42, and loosening to purity 0.7 selects 35. Toggling only this gate: **6 elements gained, 0 lost**, 5 ramps and 1 stair flight. `IfcRamp` goes from 7 drawn to **12 of 12**.

**This supersedes a claim made earlier in this file.** An earlier round rejected marker consensus as "not a category decoder … a listed constant on a population of twelve", on the strength of a model-wide measurement where it gave 4,859 elements a category and the export agreed with 456 while disagreeing with 265. That verdict stands *for that use*. It does not stand for this one: restricted to elements that already own a closed ring and to markers whose token-carrying members agree unanimously, the consensus is measured rather than listed, and it is 42 of 42 against a permuted null of 8.0.

**Honest cost.** The 5 ramps are drawn with an exact plan — 0.000 ft — and the wrong rise, 3.778 ft out, because a ramp's ring is flat and its whole curve neighbourhood is flat, so `ringRecordRise` correctly declines to lend it one. They are drawn as 1 ft plates. `IfcRamp` therefore appears as a new agreement row at 36.4%: the class went from mostly absent to fully present and visibly wrong in z, which is the same trade the windows made before their shape decode was found.

**What is still declined, with numbers.** Of the 67 named ring candidates, 25 remain: 13 under `0x0feb` whose consensus is `Stairs`, an assembly rather than a sketch category; 7 under `0x0f3b` whose 6,993 members are unanimously `Walls`; 4 under `0x0d40`, whose 20 members carry **no category token at all**, so there is nothing to reach consensus on; and 1 at purity 0.35. Reaching any of them means dropping the purity floor or the sketch-category restriction, which is what the 843-candidate baseline measures the cost of.

**A caveat on the coverage denominator, since it cuts the other way — now measured.** 1,919 of the Tags counted in `building elements` are containers the export gives no mesh of their own, `IfcCurtainWall` and `IfcStair`, so a single figure was measured partly against elements there is nothing to draw for. The table now prints both:

```
building elements        38076                      35338    92.8%    36157     97.0%

1919 of the 38076 are containers the export gives no mesh of their own,
so the last column is the share of what could be drawn at all.
```

**92.8% of what the export names; 97.0% of what it draws.** Both are true and neither alone is the whole statement. A class with no mesh anywhere prints a dash rather than 0.0% in that column, because "none of its elements are drawable" and "none of them are drawn" read identically as a percentage and mean opposite things.

## The exporter writes some elements several times, and the coverage table was counting them

`IfcStairFlight` read 86.9% centre agreement and 82.6% drawn. Both figures were artefacts of counting export **products** where the join key is a Revit element **id**.

Scoring every drawn flight against the union of its Tag's products and against the single **nearest** product separates the two cleanly:

| products per flight | n | union centre | nearest centre |
| --- | --- | --- | --- |
| 1 | 88 | 100.0% | 100.0% |
| 2 | 11 | **0.0%**, median 4.92 ft | 100.0%, median 0.017 ft |
| 3 | 1 | **0.0%**, median 9.84 ft | 100.0%, median 0.010 ft |

**The export proves this by itself, with no reference to the RVT.** All 12 multi-product Tags are *congruent* — identical plan corner, identical size to 0.01 ft — offset in z by exactly **9.84 ft per product, one storey**. The union error is exactly half that pitch or the whole pitch, and the size error is exactly the pitch. Every one is named `Assembled Stair:Stair:<parent> Run n` on 2–3 consecutive storeys.

So the honest figure is **100.0% centre and 100.0% size on 100 drawn flights**, with a residual *replication* gap of 13 products on 12 elements, which is not a geometry error.

**The nearest-product reading is not generically generous**, which is what makes it evidence rather than a softer ruler: across classes where the recovery draws every product it is *worse* — `IfcRailing` 100.0% → 95.1%, `IfcSlab` 95.1% → 88.2%. It is better only where the recovery draws one element and the export writes it once per storey.

And this is not stairs-specific, only visible there: of the 92 Tags the exporter writes as several products, **74 are replicas** — 49 `IfcMember`, 13 `IfcRailing`, 12 `IfcStairFlight`, 3 `IfcSlab`. The 15 multi-product `IfcSlab`s are genuine multi-region floors. Stair flights are simply the only class small enough for 12 replicas to move a percentage.

**The coverage table now counts elements.** It counted products, so an element the exporter wrote three times counted three. Correcting it changes the denominator from 38,222 to **38,076** and these rows:

| | counted by product | counted by element |
| --- | --- | --- |
| `IfcStairFlight` | 121 in export, 82.6% drawn | **108, 92.6%** |
| `IfcSlab` | 161, 93.2% | **107, 95.3%** |
| `IfcRailing` | 229, 76.0% | **215, 76.3%** |
| building elements | 92.5% | **92.6%** |

**One real defect was hiding behind the artefact.** 1842441 was drawn 16.90 × 17.06 × **0.00 ft** where the export writes 16.90 × 17.10 × 9.68 — plan exact to 0.02 ft, rise zero. Its record is synthesised from its boundary ring, and a stair run's ring is flat, so it was extruded from its base to its base. `ringRecordRise` takes z from the element's *own* curve set when the ring is flat, the curve set is not, and the two bands meet — the same `bandsMeet` guard, so a stacked twin a storey away cannot lend a rise. **Specificity: 2 of 38,960 records move**, and a full before/after record diff shows nothing else in the model changes. The two other flat-ring records are ramps whose whole curve neighbourhood is flat, and the rule declines both.

**Negative result.** Reconstructing the multistorey extent is not reachable: it does exist in the file — parent assembly 1988738's record spans three storeys, 1498360's two — but only **3 of the 12** parents have a record at all, and nothing decoded links a run to its parent. Not attempted.

**Both readings are now printed, because neither is right alone.** The agreement table carries `nearest c`, `nearest s` and `split` beside the union columns:

```
IFC product type         drawn  centre ok  size ok  median dc  median ds  nearest c  nearest s  split
IFCSTAIRFLIGHT             101      88.1%    88.1%      0.021      0.041     100.0%     100.0%     12
IFCSLAB                    102      95.1%    91.2%      0.000      0.000      99.0%      94.1%     16
IFCMEMBER                19120      99.1%    98.9%      0.000      0.000      99.2%      99.0%     35
IFCWALLSTANDARDCASE       7186      98.9%    96.0%      0.000      0.000      98.9%      96.0%      0
```

A class where the two agree and `split` is zero is settled. A class where they diverge *and* `split` is non-zero is asking a **replication** question rather than a geometry one. Stair flights are the extreme, 88.1% against 100.0% on 12 replicated elements. Slabs move only 95.1% → 99.0% on 16 splits, and that is the reading working correctly: some of those are genuine multi-region floors, where drawing one region of three *is* a miss and the union rightly still penalises it.

## Second readings, and a note on how this round was recorded

Four rules were added together, all following the pattern `clipSolidToEnvelope` established: **an element is described twice in the partition stream, the two readings are independent, and where they disagree the disagreement is itself the evidence.** None invents a dimension.

- **A railing's ribbon is trimmed to the railing's own envelope.** The sweep draws from the rail path up by the guard height, so the ribbon's *top* reproduces the envelope by construction; its base is the path, and a stair railing's path starts about one riser below the railing it carries. Measured against the export's own railing meshes, **14 of 101 swept railings had their base up to 0.886 ft low and not one had its top wrong** — median top error 0.000 ft. Clipping rather than clamping matters: clamping would lift the first tread onto the landing and flatten the bottom of the run.
- **A solid's elevation band is intersected with the record's**, the same argument as the plan clipping applied to the axis nothing was checking. **This is the sharpest rule here precisely because it almost never applies**: of 5,312 solid-drawn records with a real bounds block it fires on **3** — 1192647, whose record *and* whose export box both read 0.66 ft tall against a solid drawn 9.84 — and all three go to 0.000 ft. Nulls: a shuffled band fires on 579 records and makes **572 worse**; the band of the element one id below fires on 79 and improves **none**. Specificity 3 of 5,312, **0.06%**, against 11% and 1.5%.
- A sketch-based element whose record is a hull over a single planar face takes the thickness its own category is written with everywhere else in the model.

| | before | after |
| --- | --- | --- |
| `IfcWallStandardCase` centre / size | 98.5% / 92.4% | **98.9% / 96.0%** |
| — median size error | 0.073 ft | **0.000 ft** |
| `IfcWall` centre / size | 90.3% / 73.9% | **91.8% / 89.6%** |
| `IfcRailing` size | 91.5% | **100.0%** |
| `IfcSlab` size | 82.4% | **91.2%** |
| `IfcStairFlight` drawn | 91 | **99** |

The 0.073 ft median wall-size error — 0.88 inches, systematic across 7,000 walls and so more likely one wrong constant than 7,000 wrong walls — is now 0.000.

**How this round was recorded, stated plainly.** The three agents that produced it died before reporting. Their rules are verified — 22 assertions pass, 154 tests, and the controls quoted above are their own, written into the source as this project requires. What is *missing* is the surrounding record: the alternatives they tried and rejected, and the negative results they measured on the way. Every other section here can name what was ruled out; this one cannot. That is a gap in the evidence trail rather than in the code, and it is recorded rather than papered over.

## Windows are bounded by the opposite evidence to doors

A window and a door point at the same class of `0x0810` B-rep and are bounded by *opposite* faces of it. A door's own thickness is the **nearest** y-normal plane, because the furthest is the swing; a window's frame depth is the **outermost** pair, because the nearest is the glass. The door reading also forces `z ∈ [0, longest range]`, which for a window on a sill is a storey out — that was the whole of the 2.208 ft centre error.

The placement was never the problem: all 20 windows carry a correct one, and their plan was already right to 0.32 ft.

An axis's extent is the span of the origins of the planes whose normal is that axis. Trim ranges are never consulted, for the reason the door work established: several patches carry a neighbour's range verbatim, which is why a hull over them is 27.3 × 12.6 × 10.4 ft against a real 6.0 × 1.0 × 4.4 ft window. Where a shape holds a second plane table the two are **intersected** per axis, which is what cuts a casement's swung-open sash.

The gate has two clauses, each measured on its own: every axis's extreme pair must have its own **mid-plane** (exact mean to 1e-6), **and** the box's base must sit above the local origin. That second clause is the discriminator, and it comes from the building rather than from a threshold — **a door leaf stands on the floor, z base 0.0000 for all 257 door shapes; a window sits on a sill, 1.0007–3.0020 ft.** The sill threshold is a plateau: anything from 1e-6 to 1.0 ft selects the same 8 window shapes and 0 door shapes.

| `IfcWindow` | before | after |
| --- | --- | --- |
| drawn | 14 of 20 | **20 of 20** |
| centre within 0.5 ft | 21.4% | **100.0%** |
| size within 0.5 ft | 14.3% | **100.0%** |
| median centre error | 2.208 ft | **0.042 ft** |

The gate fires on 8 of 2,157 `0x0810` shapes and **0 of 228 door, 0 of 29 door-and-opening, 0 of 17 column, 0 of 1,662 unnamed, 0 of 4 opening**. Every other row of the report is byte-identical; doors stay at 99.2% / 99.1%. Null control over 20 trials, never a window's own shape: 63.8% centre / **21.0% size** from the 8 window shapes — high only because 5 of the 8 differ from each other by frame depth alone — and **1.3% / 0.5%** from all 2,157, median size error 3.728 ft.

Four negatives, all measured. Dropping the mid-plane test admits 53 door shapes serving 195 doors and takes doors from 99.5% to **0.0%**. The sill test without the mid-plane test breaks 2 columns from 100% to 0%. A strict "exactly three faces per axis" reaches only the 5 casement shapes and leaves 9 windows wrong. Skipping the table intersection gives 45.0% / 45.0%. And exempting *every* flagged shape from `agreesWithBounds` rather than only face-read ones gains 3 windows and costs **26 columns** — the flag was narrowed instead.

Separately, `readLocalBounds` now refuses a fallback box degenerate on **all three** axes: 368 of the 3,699 objects reaching the `+48` fallback read as six subnormal doubles, 12 of them shapes that placements point at, each drawn as eight identical corners. Flatness on *one* axis is deliberately not refused — 4,077 of 14,876 framed reads are flat on one axis, so it is not evidence of a bad read.

## A raked solid is not recoverable, and the stringers' defect is not rake

Two dozen stair stringers were drawn as axis-aligned envelopes 11–17 ft across where the export gives them 1.3–9.3 ft, which reads on screen as a flat wedge through the building. The obvious fix — the raked analogue of `wallSolidsFor` — does not exist in this file, and the census says so cleanly:

| stride-105 windows on an owned plane run | 31,153 |
| --- | --- |
| three planes mutually parallel | 17,181 |
| and the centre midway between the faces | 6,553 |
| and all three trims equal | 6,495 |
| of the 6,553 — already taken by `wallSolidsFor` | 6,352 |
| — horizontal | 200 |
| — vertical with a tilted in-plane frame | **1** |
| — **raked** | **0** |

Of 82,021 planes, 790 are raked in total, and no three of them anywhere form a centre-plus-two-faces triple, at 1e-6 or at 0.01 ft. What a stringer actually owns is 11–13 consecutive plane records written twice whose normals cycle through mutually perpendicular directions — a **facet list**, not a centre and two faces. A sliding window of three over that list is what an earlier count of "314 triples" was measuring.

**One reading recorded here was wrong.** `uDir.z = 0.3367, vDir.z = 0.9416` was read as a sloped body's facet. Those square to 1.000, which in an orthonormal frame means the *normal is horizontal*: it is a **vertical plane with a rotated frame**. The verdict — `wallSolidsFor` declines — stands; the stated reason did not.

**The stringers' real defect is the z band.** Their plan is right to 0.16 ft, and 208 of the 214 over a foot out are wrong in z alone, carrying the *stair assembly's* band: 1523108–1523114 all read −3.3 to 14.4 ft where their own boxes are 1.3–4.9 ft slices. That band is not recoverable from a companion record (33 of 263 within ±20 ids, 18 of which were already correct; shuffled control 2 of 263), not in the parameter table (0 of 263 stringers carry one), and not from the facet hull outright (12 better, 71 worse of 83).

What works for 78 of them is narrowing the envelope's z to the element's own facets **only where those facets cap it** — the set must hold a face with a vertical normal component both up and down. Unconditionally this is a net loss: `IfcMember` 33.7% → 61.4% but `IfcWallStandardCase` **100.0% → 34.9% with 27 of 43 walls flattened to zero height**, because a wall's attributed facets are a fragment of one vertical face and a vertical face bounds nothing in z. With the cap test, `IfcMember` on the 83 concerned goes 33.7% → **63.9%** centre and its median error 1.811 → **0.082 ft**, while walls, slabs and coverings all decline the rule and stay at 100%. Nulls: giving each accepted element another accepted element's band scores 9.6% and flattens 32 of 83; against a shuffled truth the rule improves 0 elements where it improves 42 against the real one. The cap threshold is a plateau — 1e-9 to 0.5 selects the same 79 elements.

Reach is the limit: **190 of 273 drawn stringers own no surface at all.** Stringers over a foot out go 214 → 187, over 5 ft 116 → 99, over 10 ft 27 → 21.

**The honest alternative was measured and not taken.** Dropping all 273 stringer records costs 262 `IfcMember`, one `IfcStairFlight` and 10 unnamed elements — coverage 92.5% → 91.8%. And it cannot be aimed at "known raked surfaces", because only 83 own facets and those are now the ones drawn *right*: that key would delete precisely the 78 the narrowing fixed.

## A solid drawn on the wrong element

Six of the seven elements drawn more than 10 ft past their own export box were one bug, worst 260.3 ft: the bounds record reproduces the export box corner for corner, and a **misattributed plane triple** is drawn over it. `clipSolidToEnvelope` declines to help by design, because a solid wholly outside its envelope is "a disagreement to report rather than a length to invent".

The evidence that the solid is the wrong reading is independent of any box metric: **4 of the 11 stray solids are carried by a second element** — a plane triple is one body — and for 3 of those the co-owner's envelope reproduces the solid's own length and thickness to 0.01 ft. 1501065's box is 0.39 × 29.89 ft against a 29.37 × 0.394 ft solid that was being drawn on 1501060 and 1501062 as well.

`solidBelongsToEnvelope` drops them. 147 of 6,756 solids on records with a real bounds block fail, **11 on records the scene draws**; 6 improved — centre error 252.21, 38.21, 20.07, 14.83, 14.62 and 4.82 ft all to **0.00** — and **0 worsened**.

**Per-class percentages cannot judge this rule and were not used to fit it.** The same containment test against the envelope of the element one id below rejects 3,342 of 5,360 solids, and against a *shuffled* envelope 5,356, and both score **higher** on wall size (95.7% and 97.0% against 92.4%) — because the envelope is the export's own box, so rejecting everything looks like an improvement. The discriminator is specificity: **11 of 5,360, 0.2%, against 62% and 100%.**

Two of the seven are not this bug and are recorded as unreachable. 401861 has no duplicated-bounds record at all, so there is no second reading to check against; the export gives it 0.82 ft where its solid is 14.60, and the reason is visible in the export — a curtain wall fills 77.58 to 90.95 ft between it and its neighbour, so the trim range is the wall *before* the curtain-wall insertion. And 1622190, now the assertion's worst case at 19.8 ft, is a **truth-side artefact**: the exporter tags only the ramp's landing and writes its two flights as *untagged* `IfcRampFlight`s, so the element's record box is exactly the union of three products the join can only see one of.

**A latent aliasing bug is recorded, not fixed.** 11 solid *objects* in this model sit in two elements' groups, and `clipSolidToEnvelope` mutates solids in place — so clipping one owner's copy mutates the other's. The disown rule removes every drawn instance of it here, but the aliasing remains.

## The openings row was double-counting, and openings must not be drawn

`IfcOpeningElement` looked like the largest absolute gap in the model — 3,071 in the export, 1,772 drawn, 57.7%, 1,299 missing. It is not a gap. **An opening's `Tag` is not the opening's Revit id; it is the id of the element occupying the opening.**

| the Tag actually names | products | drawn |
| --- | --- | --- |
| an `IfcDoor` | 1,903 | **1,641** |
| an `IfcCurtainWall` | 1,013 | 115 |
| nothing else in the export | 124 | 0 |
| an `IfcWindow` | 20 | 6 |
| an `IfcWallStandardCase` | 11 | 10 |

3,071 products carry only **2,965 distinct Tags**, and all 1,820 `IfcRelFillsElement` have filler Tag equal to opening Tag. The row's drawn figure decomposes exactly — 1,641 + 115 + 6 + 10 = 1,772, where 1,641 is the *entire* `IfcDoor` drawn count and 6 the entire `IfcWindow` one. **The row carries no information the other rows do not already carry**, and the "1,299 missing" are 262 doors, 898 curtain walls held back on purpose, 14 windows, one wall, and 124 floor openings.

And they should not be drawn, on three separate measurements:

- **doors** — the export's opening box and the leaf the viewer already draws agree to a median **0.125 ft** at the centre, 89.7% within half a foot, with boxes overlapping on all three axes for **1,640 of 1,641**. Null against another door's leaf: median 397.4 ft, 0.0%. Drawing the opening would put a second box exactly where the leaf is.
- **curtain walls** — the opening is the slot the container sits in; 879 of 1,013 name a record the wrapper rule holds back, median worst corner 0.812 ft. Drawing them *is* the sheet over the panels the wrapper rule exists to prevent.
- **the 124 with an id of their own** are floor and shaft openings, largest 11,620 sq ft. They are already in the model as holes: of the 96 whose host is drawn from a sketch ring, **96 of 96** have the host's ring vertices tracing the opening outline, against **15 of 96** for the same rectangles shifted 37/23 ft. `groupRings` already cuts them, and drawing them as solids would fill the holes they are.

Openings were already excluded from the `building elements` total, and stay excluded — but for a better stated reason than "an opening is a void". The reason is that the Tag aliases another element, so the row double-counts, which is measurable rather than definitional.

**Not done, and stated as such:** using openings to *cut* their host walls. The geometry exists — the code-44 record is the opening plus the swing — but it needs CSG in `buildBoundsMeshes`, and the overlay metric compares boxes, so it could not tell whether the cut was right. Left alone rather than half-done.

## Curved walls are written the way straight ones are

A quarter-round wall was being drawn as the rectangle enclosing its whole bulge — which is what an axis-aligned envelope of an arc is, and it reads on screen as a curve squared off into a block.

`wallSolidsFor` reads a straight wall as three plane records at a 105-byte stride: the centre plane, then the two faces half a thickness out. A curved wall is written **exactly the same way**, in cylinder records at their own 137-byte stride — the centre cylinder carries the centreline radius and the two faces carry that radius plus and minus half the thickness. Element 305688 owns three at 10.05, 9.72 and 10.38 ft.

The converter had been counting those records and throwing them away.

The test that three cylinders are one wall is arithmetic rather than positional: **the middle radius must be the mean of the outer two**, to 1e-6. That is not a threshold fitted to anything — a run of unrelated cylinders will not have a centre radius. Of the 42 stride-137 triples in the supplied project, **27 pass**, and all 27 are elements the export types `IfcWallStandardCase`.

**Verification against the paired export.** For every one of the 27 the median distance from an export vertex to the annulus sector is **0.0000 ft**; 18 have every vertex within a foot. Against a shuffled pairing, **0 of 27** are within half a foot. The larger worst-vertex figures are elements the export writes as an arc *plus* straight runs, where the arc is exact over its own sweep and the residual is the part of the element it does not cover.

What it buys is not mainly a tighter box. Five of the 27 had a bounds record covering only a fragment of the wall, and the arc gives them their true extent:

| element | envelope plan | arc plan | export plan |
| --- | --- | --- | --- |
| 305688 | 10 sq ft | **224** | 223 |
| 1783529 | 56 | **248** | 248 |
| 1873366 | 16 | **88** | 87 |
| 960687 | 2 | **13** | 13 |
| 960631 | 2 | **13** | 12 |

The arc is drawn as an annulus sector at no coarser than π/32 per segment, and it sits below the rebuilt solid in the drawing precedence: an element with a straight location line has one for a reason, and the arc is what a curved wall has instead.

`curved-walls-rebuilt` is a **firing** assertion, not an accuracy one. The arithmetic is self-checking, so the failure mode is not a wrong arc but silence — a release that writes cylinders at a different stride, or an attribution that stops reaching them, and every curved wall quietly reverts to its bulge rectangle with nothing in the output saying so.

### What the curve complaint turned out to mostly be

The census that found this is worth stating, because the headline number is not curvature. `scripts/footprint-audit.ts` measures it on any pair:

```sh
node --experimental-strip-types scripts/footprint-audit.ts model.rvt model.ifc
```

It asks how much of its own plan bounding box an element's footprint fills — an axis-aligned rectangle fills 1.00, a quarter round fills π/4, a 1 ft wall 30 ft long at 45° fills 0.03 — for the export's footprint and for the geometry the viewer actually draws. The difference is plan area the recovery invents. This is deliberately not what `overlay-diff.ts` measures: a wall at 45° can have a perfect centre *and* a perfect size and still be drawn as a rectangle many times its own area.

Of 33,719 export footprints, 1,171 are not boxes in plan. The recovery already follows 923 of them — 869 from a rebuilt solid, 42 from an oriented box, 12 from the new curved-wall arc. The remaining **248 are drawn as an axis-aligned box anyway, adding 77,415 sq ft of plan area** that is not in the building:

| | count | plan sq ft added |
| --- | --- | --- |
| curved | 49 | 4,760 |
| diagonal | 199 | **72,655** |

So the visible defect has two causes and they are very different sizes — **94% of the invented area is diagonal, not curved.** An angled wall's axis-aligned box is a large rectangle where the wall is a thin sliver, and the worst single element adds 18,599 sq ft on its own.

The diagonal case is not fixed, and the reason is now settled rather than suspected: **the geometry is not in the readable stream**. That is worked through below.

**The way curved and diagonal are told apart was wrong once, and the correction is worth recording.** The first version counted hull corners, collapsing turns under 12°: a rotated rectangle keeps four, a tessellated arc shows many. That reads plausibly and is not measurable — how far an arc's turns fall below any angular threshold depends entirely on how finely the *exporter* tessellated it, and a 64-segment quarter round at 1.4° per step collapses to three corners and reads as a triangle. It undercounted the curved elements by eightfold, at 6 against the true 49. The measure now used is the footprint's fill against its own *minimum-area* rectangle: a rectangle at any rotation fills it exactly, an arc fills π/4 of it at any tessellation, and no threshold on tessellation is involved.

**One route was tried and rejected.** A wall's location line is recoverable from its sketch curves, and given a location line the thickness is not a guess: an axis-aligned envelope of a wall of length `L` at angle `t` with thickness `w` is `W = L·|cos t| + w·|sin t|` and `H = L·|sin t| + w·|cos t|`, so `w` falls out of the envelope the record already carries — twice, from two independent equations. 111 of the 245 own a curve and 63 solve a thickness, but only 22 land within half a foot of the export. The self-consistency check that should have separated them does not: at its tightest, requiring the two solutions to agree to 0.001 ft, it keeps 14 of which **4 are still over 5 ft wrong**. A rule that draws 4 in 14 elements badly wrong is worse than the box it replaces, so it is not shipped. Recorded here so it is not retried on the same evidence.

### Why the angled walls cannot be fixed from what they own

A wall's surfaces are not loose in the page. They live in an **object of their own, under marker `0x0f3b`**, sitting beside the element's ordinary `0x08c6` object, and the `ff ff ff ff 10 03 01 …` anchor is that object's head. 7,954 of them exist against 7,208 walls in the export, so the class is the wall body and nothing else. Of a 900-wall sample that the export names *and* that carries an anchor, **883 have a `0x0f3b` object; of the 893 walls with no anchor, 9 do.**

So an element with no anchor has no surfaces because it has no geometry object, and **146 of the 165 angled walls that own nothing are named by no anchor anywhere**, against 12.2% of every element the export names. Four candidate explanations, separated:

| | verdict | the numbers |
| --- | --- | --- |
| attribution does not reach them | **refuted** | Ignoring ownership entirely — is *any* vertical plane in the file collinear with the wall's own export axis? — hits **88.6%** for anchored walls and **10.1%** for unanchored. Controls: axis rotated 5° → 0.1%, shifted 1 ft → 2.3%. The z band must be in the query; without it the unanchored score 47.9%, which is the wall one storey up. |
| page-boundary chunking | **real, but not theirs** | 19,987 of the file's 82,285 surfaces sit on one of the 2,368 anchorless pages of 3,613. Carrying the last anchor across the boundary attributes all 19,987 to **38** ids, and **0 of 19,987** land in the box of the element they would be given to. |
| the chunks that still fail to inflate | **12 of 893 at most** | 1.29 MB stored, which at the 6.16× ratio the rest of the stream reads at is 7.9 MB of 417 MB — about 123 walls against 893 missing. Bracketing each failure by the anchor ids either side puts 12 of the 893 inside a band, against **0 of 900** anchored controls. |
| the geometry is genuinely elsewhere | **supported, ~86–90%** | Nothing else in their own object holds it either: searching every offset for the element's own plan-axis endpoint finds it for 28 of 151, against **0** for a mismatched-target control. |

**Being angled has nothing to do with it.** 11.8% of the export's 2,632 angled walls own no surface, against **13.1%** of its 4,576 orthogonal ones. The diagonals are simply the subset where the fallback box is visibly wrong — an orthogonal wall drawn as its envelope looks right.

And the 67 that *do* own planes are not a missed opportunity either: 33 have a stride-105 triple, **314 triples between them, and not one has all three planes vertical**. They read `uDir.z = 0.3367`, `vDir.z = 0.9416` — facets of a sloped body — and 24 of those elements carry the category `Stairs Stringer Carriage`. `wallSolidsFor` is declining correctly.

**One lead came out of this and it is not the diagonals.** A quarter of every analytic surface in the file sits on a page the owner scan cannot attribute, because the scan starts each page with no owner. The containing object header names its own element at `S+0` and is self-checking through its length echo; used as an owner it scores **81.25%** inside-the-owner's-box against **0.02%** shuffled — better than the shipped anchor rule's 76.80% — and is still a **net loss**, because it displaces anchors mid-blob: 189 elements gain a solid (11 named by the export) and 953 lose theirs (467 named). Restricted to a fallback that can never displace an anchor it adds 18,417 surfaces and 20 elements with a solid, at a median 10.1 ft worst-vertex error with none inside a foot — those surfaces are not wall bodies. Something narrower than "header wins" and wider than "header only before the first anchor" may exist there. It will not recover these 165.

## Four remaining gaps, and which of them are reachable

After the second-copy fix, four things still separate the recovery from the
export. Each was tested rather than assumed, and only one of the four turns out
to be a decoder problem that a rule could reach.

**Curtain walls are held back on purpose, and the suppression is precise.** 1,794
are recovered and 241 drawn; the other 1,553 are containers whose panels and
mullions are drawn in their place. Of the 1,585 envelopes held back as wrappers,
**1,553 are genuinely `IfcCurtainWall`** — the rule mistakes 32 elements, or 2%.
The facade is represented by 15,984 members and 4,973 plates, not by 1,553 boxes
that would hide them.

**Doors are not a choice between the two bounds copies.** Doors are drawn about
2.8 ft oversized, and after the wall fix the obvious guess was that the other
copy holds the leaf. It does not: across 1,398 doors the mean error is **2.767 ft
from the first copy and 2.760 ft from the second**, and the copies differ for
only 7% of them. Both copies are the opening. The door leaf is not in this
record, and no reading of it will produce one.

**Stair components are not either.** A stringer carriage is drawn 10.08 ft tall
where the export's own bounding box is 4.71, and a landing 9.84 ft where the
export has 0.16. Across 79 stair flights the two copies score **4.221 and 4.035
ft** — both wrong, by about a storey. The envelope recorded for a stair
sub-component is the assembly's, not the component's.

**The remaining mullions and panels carry no geometry at all, and this is now
settled by three independent tests.** 3,169 members, 1,090 plates, 426 doors, 36
columns and 15 windows the export names are still missing. Every one of them is
rejected on the same check — the object's marker is `0x07ef` rather than
`0x08c6` — which is exactly the shape of the wall bug, so it was worth asking
whether the marker was again the only thing in the way. It is not:

- running the entire bounds framing on those objects with the marker check
  removed, **0 of 4,707 produce a valid bounds block**;
- searching every offset of 24,620 such objects for six `f64` reproducing the
  element's exported bounding box returns **nothing**, with a mismatched-target
  control that also returns nothing;
- **0 of 4,933** of these elements have an instance-placement object, so there is
  no transform-plus-shared-shape route either. Almost all have exactly one
  object, about 567 bytes long.

So these elements are named in the file, and their position is not. That is the
family-document boundary the type-name decoder already runs into, and it is not
reachable by reading partition records more carefully.

## Cached shapes are not building elements

A loadable family stores its shape once and places it many times. That cached shape is an ordinary object in the partition stream, and it carries the same bounds sub-record an element does — so it was being decoded into the model as though it were an element. Its box is in the family's own local frame, so it landed at the model origin.

The scale of it: **9,655 of 42,348 records — 22.8% — were centred within 50 ft of the origin**, a window that is 1.1% of the building's footprint, and only 3.9% of them corresponded to anything in the paired export. Everywhere else in the model 93.8% of records match. The view had a solid blob of several thousand boxes sitting in the middle of the building.

The file names them, so they do not have to be guessed at from position: an instance's trailer points at the shape it uses, and the referenced set is read straight out of the placements. In the supplied project 6,627 shape ids are referenced, **6,013 of them were being drawn as elements, and 97% of those sat at the origin**. No id is both a shape and an instance, so removing them cannot take an element with it.

The cost is 13 counted elements: one stair flight that was drawn correctly, and six `IfcStair` containers that carry no geometry in the export at all. That is why the stair rows above go down. Removing roughly 6,000 phantom boxes for one correctly drawn element is worth it, and the drawn set goes from 75% real to **89% real**.

**A shape's bounds are not at a fixed offset.** `readLocalBounds` read six f64 at `+48`, which is the `recordCount == 1` case of the same `42 + 6 * count` framing the element bounds record uses — so every shape with a longer field table was rejected, 12,038 of them. Reading the count-derived offset, with the duplicated-block check that makes it safe, recovers 4,874 more and takes resolved placements from 19,356 to **21,257**.

## Three things that turned out not to be the problem

Each of these was a plausible cause with a cheap test, and the test said no. They are recorded so they are not tried again.

**Page seams do not hide the missing elements.** Chaining and record detection run per inflated page, so an object spanning two pages should be invisible to both. Objects are under 64 KB, so joining each page's tail to the next page's head contains every straddler. Scanning those seams across the whole stream finds **1 extra object and 0 extra bounds records**. The 3,439 elements the export knows about and no pass sees are not there to be found.

**Chain breaks were real but minor.** Chaining walks until an object fails to verify, and about one record in two hundred does, so a chain grown from a few seeds loses everything downstream of its first break. Seeding from every validated object marker rather than only from bounds records makes a break local instead of terminal, and takes recovered objects from 48,488 to **51,457**. It moves `seen` a little — walls 7,151 → 7,173, railings 157 → 174, openings 2,458 → 2,501 — and `drawn` almost not at all.

## The elements that were nowhere are objects of another class

5,449 elements the export names appeared in no pass at all. They are in the file: searching 385 MB of inflated pages for their ids finds **98.8% of them**, a median of ten times each, against 100% for a control of ids that are recovered. So they were written; they were just not being read.

Sixteen bytes past those ids — where an object keeps its marker — sits `0x07ef`, and the rest of the object framing holds there: the length is in range and the trailer echoes it. `0x08c6` is not the only object class in the stream, and it was the only one anything looked for. Scanning a page for the framing itself rather than for one marker turns up **51,455 objects under `0x08c6` and 27,078 under `0x07ef`**, plus a tail of smaller classes, and `0x07ef` alone heads the objects of 4,312 of the missing elements.

The markers are now measured from the file — a sample of twelve pages, keeping any marker that heads at least 24 verified objects — rather than listed in the source, which also survives the tag drift between releases. Elements the scan can account for rise sharply:

| | seen before | seen now | in the export |
| --- | --- | --- | --- |
| `IfcMember` | 16,342 | **19,213** | 19,707 |
| `IfcPlate` | 5,085 | **6,074** | 6,235 |
| `IfcDoor` | 1,405 | **1,827** | 1,912 |
| `IfcColumn` | 256 | **300** | 311 |
| `IfcWindow` | 5 | **20** | 20 |
| `IfcRamp` | 5 | **12** | 12 |
| `IfcRoof` | 18 | **20** | 20 |

Every ramp and every window in the building is now accounted for. The conversion also got faster, 57s to **40s**, because more seeds mean each chain walk is shorter.

**What this does not do is draw them.** A `0x07ef` object carries no bounds sub-record, no instance placement, and — tested directly — no world extent anywhere in its payload. Searching every offset of 24,620 of them for six f64 reproducing the element's exported bounding box returns **nothing at all**, and the same search against a deliberately mismatched target also returns nothing, so the search was sharp rather than merely unlucky. Reading three f64 as a centre finds a best offset with 5 hits out of 24,620, which is noise.

These elements are therefore *known* rather than *drawn*, and the coverage table now says so honestly: the gap between `seen` and `recovered` is the real remaining decoder work, and it is no longer hidden inside a gap between `in IFC` and `seen`. Their geometry lives in the family-document blobs the type-name decoder already cannot reach.

**Stair flights are drawn from the wrong source after all — see the faces section below.** This paragraph originally recorded the opposite: that preferring the element's envelope over its single face measured *worse*, 7.95 ft against 5.413, so no change was made. That comparison used a truth map keeping one export box per Revit id, and an element the exporter splits into several products was therefore compared against a piece of itself. Re-measured with those boxes unioned, the envelope wins for 168 of the 225 elements that own faces, and faces are no longer drawn.

**This was where the wall gap was wrongly written off.** An earlier reading of this section concluded that the 748 walls proven real and yielding no geometry needed a new record type decoded, on the evidence that 745 of them owned zero decoded surface patches. Surface patches were the wrong place to look: those walls had a duplicated-bounds record the whole time, and the copy check above was rejecting it. After that fix, only **14 walls are seen without being recovered**, not 748. The paragraph is kept rather than deleted because the mistake is instructive — an absence measured through one decoder is not an absence in the file.

The record-code consensus floor was also widened, so that a cluster too small to reach the old flat support floor of 8 can qualify by being near-unanimous instead — a building holds a dozen ramps and their cluster could never reach 8 no matter how consistent the evidence was. On this model it changes almost nothing: the small categories are limited by not being seen, not by failing to reach consensus. It is kept because the bias it removes is real and the tail categories are the ones a widened floor exists for, but it is recorded here as having produced no measurable gain.

## The missing elements were never in a family document

The largest remaining gap — 3,708 curtain-wall mullions, 1,262 panels, 513 doors, all *seen* and never recovered — was attributed in this file to family definitions the decoder could not reach. **That was wrong, and the section that said so is replaced by this one.**

**`revit.local.family:<40 hex>-1.0.0` is not a document reference. It is a parameter id.** Dumping a carrier object whole shows the string sitting in the middle of a three-part identifier triple:

```text
autodesk.parameter.group:dimensions-1.0.0
revit.local.family:bcd13b0166914fd3ba97077a6c6280ae00000665-1.0.0
autodesk.spec.aec:length-1.0.0
```

Parameter group, identifier, data type. It is the ForgeTypeId namespace Revit gives a **family-local parameter**, and there are 546 occurrences of 502 distinct ones — not the 193 "documents" a sampled count suggested. The 20-byte binary form of those digests appears **0 times** in all 384.5 MB of inflated pages. Nothing points at a definition blob because nothing is being pointed at.

**What a recovered mullion has that a missing one does not is a second object, and the placement is in the first one anyway.** Same page, same family, byte for byte:

| | objects |
| --- | --- |
| recovered mullion 300149 | `0x07ef` len 567 **+** `0x08c6` len 300 |
| missing mullion 303358 | `0x07ef` len 567 only |

which holds for 3,140 of 3,223 missing members, 1,086 of 1,101 plates, 426 of 428 doors and 36 of 36 columns. But the two `0x07ef` objects differ in exactly one region, `+418` to `+517`, and that region is a rigid placement:

```text
+418   9 x f64   orthonormal basis — identity for 300149, a 45° rotation for 303358
+490   3 x f64   world origin in feet
+514   u64       element id of the shared geometry object
```

The same three fields, in the same order, as the 300-byte instance object the library has read since the placed-instance work. `readInstancePlacement` returned early on `objectLength !== 300`, so it had never been read.

**Reading it closes most of the gap:**

| | before | after |
| --- | --- | --- |
| building elements drawn | 30,628 · 80.1% | **34,457 · 90.1%** |
| `IfcMember` drawn | 15,912 | **18,658** |
| `IfcPlate` drawn | 4,972 | **5,917** |
| `IfcMember` centre within 0.5 ft | 98.8% | **99.0%** |
| elements placed from an instance alone | 3 | **3,901** |

Accuracy went *up* while 2,746 mullions and 948 panels were added: the newly placed elements land within **0.25 ft for 100.0% of members and plates, median error 0.0001 ft**, and the residual is truth-side — the export's box comes from tessellated triangles.

**The controls are what make it safe to believe.** On the 19,584 elements that carry *both* objects the rule finds exactly one transform per object, and its origin agrees with the instance object's for 19,582 of them; the geometry reference agrees for 21,637 of 21,637. Shuffling the target scores 0.1% within 0.25 ft against 100%, shuffling the origin 0.1%, shuffling the geometry reference 6.3%, and transposing the basis 62.8% — that last failing only on the non-90° curtain walls, which is exactly where the columns-are-axes convention is the one that matters. The composite rule fires on 0.0% of seven other object classes, while an orthonormal basis *alone* fires on 99.7% of one of them: the live geometry reference behind the basis is what makes it specific, not the basis.

The basis offset is not fixed — `+418` for 22,511 objects, `+412` for 2,323, `+414` for 1,442 — so it is found by orthonormality in a 25-byte window rather than indexed. A shared geometry object is excluded before the search runs, by the bounds sub-record it carries and a placement object does not; without that test a shape whose tail happened to hold an orthonormal basis would be taken for an instance and lose its own box.

**What is still missing, and it is now a small list.** 716 references resolve to an object under marker `0x10dc`, `0x10de` or `0x0810` that carries no bounds sub-record at all — 383 members, 157 doors, 135 plates — a different shape class, probably a real solid rather than a box. A further 1,078 elements have no object in the stream at all. And **doors gain nothing in accuracy** from this: the 138 newly placed ones carry the same 2.9 ft leaf error as every other door, because the record is the opening.

One negative result, recorded so it is not retried. **Object coverage of the stream is 67%, and the uncovered remainder is not geometry** — full-offset seeding raises objects from 140,812 to 154,431 and newly placed export elements only from 3,929 to 3,966, so the gain does not depend on changing the seeding.

An earlier version of this section claimed the opposite of what follows, and was wrong twice over: that all 328 inflation failures were 40-byte per-chunk descriptors, and that an apparent 7.3 MB of unclaimed bytes was node `zlib` failing where `fflate` succeeds. Both are corrected below — the bytes are real payload, and it is node `zlib` *with a dictionary* that reads them.

### Chunks that reference the chunk before them

7.24 MB of `Partitions/325` never inflated: 332 of its 3,666 chunks, none of them inside a successful chunk's span, so they were payload nothing read. They fail with `invalid distance too far back` — the body reaches for bytes behind its own start.

That is a DEFLATE stream written against a window the previous chunk left behind. Supplying the preceding chunk's output tail as a **preset dictionary** reads them: 273 of the 332 failures inflate, 5.76 MB stored becoming 32.4 MB, and the partition's payload goes from 384.1 MB to 416.5 MB. `fflate` has supported `dictionary` since 0.8.0, so this needs no new dependency and works unchanged in the browser; the read is stateless when no window is passed, which is what the strided marker sample wants.

The recovered bytes are real geometry, not noise that happens to decode. 29 of 35 newly found bounds blocks land within 0.5 ft of the same element in the export, against **0 of 35 for a null pairing**, and on the paired model the continuation read moves coverage from 91.6% to **91.8%** (35,009 → 35,103 elements) with every per-type agreement figure holding or improving: doors 88.3% → 89.0% centre, stair flights 84.8% → 86.1%, columns 266 → 274 at 100.0%. Elements with no object anywhere in the stream fall from 1,005 to 920.

### The chunks that desync partway, and what they were hiding

The remaining chunks fail differently — `invalid block type`, `invalid length/literal`, `unexpected EOF` — with or without the window. Four explanations were separated and three ruled out.

**They are not false gzip signatures.** All 63 (node `zlib`'s count; the shipped `fflate` read tolerates four of them) carry a *byte-identical* canonical header, `1f 8b 08 00 00000000 00 0b`, and all 63 open with a well-formed dynamic-Huffman block — BFINAL=0, BTYPE=2, **63 of 63**, where random bytes would spread the block type over four values. The header validation is not letting them through by luck.

**Not another codec, and not stored data.** They decode as ordinary DEFLATE for 16 KiB to 115 KiB of the ~128 KiB a chunk holds, and the decoded bytes are Revit payload: `c6 08` object markers, `ff ff ff ff` field terminators, and duplicated-bounds records the export corroborates.

**Not a different dictionary.** Sweeping the previous 64 chunk tails, and a correct rolling 32 KiB window over the concatenated prior output, makes only **7 of 63** decode without erroring — exactly the 7 whose predecessor emitted under 32 KiB. Their content is *not* corroborated: 2 of 12 export-named records within 0.5 ft, median 0.930 ft, against 168 of 181 for the salvage read below. A preset dictionary makes any out-of-range distance legal, so a wrong one decodes cleanly while copying the wrong bytes — which is exactly why the check has to be against the export and not against whether it threw. Recorded and not shipped.

**Not truncation or an inserted structure.** Each chunk is followed by a 40-byte descriptor (constant `0x0f630000`, whose field[1] is the chunk's inflated length, exact for 2,533 of 3,507), and that descriptor never appears inside a failing chunk's body — 0 of 63, against 0 of 400 for a control. The desync lands at input offsets 2,102–65,111 with no alignment and no marker.

So it is a **genuine mid-stream discontinuity inside an otherwise valid DEFLATE stream, and its cause is still not identified.** The error sequence is consistent with a length or distance code this decoder reads differently — Deflate64's symbol 285 and distance codes 30 and 31 — but that is a candidate, not a proof, and testing it needs a Deflate64 decoder.

**The prefix in front of the desync is ordinary payload, and throwing it away was costing elements.** `inflateSync` raises before returning anything, so a chunk that desyncs partway lost everything it had already decoded correctly; a streaming read keeps it. That recovers 2.69 MB of the ~8.3 MB those chunks hold, and it is verified rather than assumed: the prefixes carry **213 duplicated-bounds records no other read reaches, the export names 181, and 168 land within 0.5 ft of the export's own box against 0 for a null pairing**, median error 0.000 ft.

| | before | after |
| --- | --- | --- |
| building elements drawn | 35,261 · 92.6% | **35,338 · 92.8%** |
| records recovered | 38,960 | **39,042** |
| `IfcMember` drawn | 19,063 · 97.0% | **19,120 · 97.3%** |
| `IfcPlate` / `IfcColumn` | 6,058 / 275 | **6,068 / 277** |

Accuracy is unmoved — members 99.1%, plates 99.9%, columns 100.0%, walls 98.9% — and neither tripwire shifts. A salvaged prefix is deliberately **not** allowed to seed the next chunk's window, because it is short of that chunk's true trailing 32 KiB.

**And it settles a question the census left open.** The `seen` column is identical in every class before and after: 911 building elements are never seen either way. The salvaged payload gives geometry to elements that were *already known* and adds no new element. On the third of these chunks that can now be read, the never-seen population is not there — strong evidence rather than proof, since the ~5.6 MB past each desync point is still unreadable.

## Stream coverage

Reviter reports what is inside a Revit file and how much of it is understood, stream by stream, so the remaining gap is measurable instead of invisible. Every CFB stream is listed whether or not anything is decoded from it, with its stored size, chunk count, inflated size, and the decoder that claims it.

Each stream is graded by depth rather than weighed by bytes. Weighing by bytes would be flattering and wrong: the partition stream is 69 MB of the 70 MB file, so "claiming" it would read as 99% coverage while the decoders recover element envelopes and category tokens from a payload that inflates to 417 MB. For the supplied 2027 project the honest figure is **2 streams read fully, 4 read partially, and 8 not decoded at all**:

| Stream | Stored | Depth | What is read |
| --- | --- | --- | --- |
| `Partitions/325` | 69.00 MB | partial | element bounds records and `BuiltInCategory` tokens; shapes, materials, and parameters are not decoded |
| `Global/ContentDocuments` | 0.47 MB | none | structured content index on a different ID space (see below) |
| `Global/ElemTable` | 0.39 MB | partial | native element-ID index; the remaining record fields are not decoded |
| `Formats/Latest` | 0.19 MB | partial | serializable class inventory; field lists are not walked |
| `Global/Latest` | 0.14 MB | none | document-level object graph; wire format not decoded |
| `Global/DocumentIncrementTable` | 0.02 MB | none | incremental save table |
| `Global/History` | 0.02 MB | none | document edit history |
| `Global/PartitionTable` | small | partial | workset / family partition names |
| `BasicFileInfo` | small | full | release, build, locale, document identity |
| `RevitPreview4.0` | small | full | embedded preview image |
| `ProjectInformation`, `TransmissionData`, `Contents` | small | none | not decoded |

The largest fully-unread payload is `Global/ContentDocuments`, and it was probed rather than assumed. Of the 38,223 element IDs recovered from the partition stream, 306 — 0.8% — appear anywhere in its 2.76 MB of inflated bytes, at any alignment. That is chance, so the stream indexes something other than model elements. It independently reproduces the same conclusion `rvt-rs` reached from the other direction, against `ElemTable` rather than against recovered element records.

## Embedded schema

`Formats/Latest` is Autodesk's own dictionary for the on-disk object graph — roughly half a megabyte of class names, inheritance, and field declarations shipped inside every Revit file. A class that is serializable at the top level is written as:

```text
[u16 nameLen] [name] [u16 tag | 0x8000] [u16 pad]
[u16 parentLen] [parent name]
[u16 flag] [u32 version] [u32 declared field count]
```

The tag is what identifies the class in `Partitions/NN` records, and it drifts between releases as Autodesk inserts classes into the ordering — in the local corpus `ArcWall` moves `0x14f` → `0x1b8` → `0x1c3` across 2020, 2026, and 2027 while its parent stays `VWall`.

**The parent name is what makes the record trustworthy.** A name-and-tag pattern alone also matches compressed noise: scanning for it loosely over the supplied 2027 project yields 232 candidates, of which 48 are mangled strings such as `Cuuuuuuuaaaas` and `HostTrfCreatDr`, including one name carrying four different tags. Requiring a well-formed parent-class name to begin exactly four bytes after the class name removes every one of those and leaves 184 classes, each with its base class — `ArcWall` → `VWall`, `HostObjAttr` → `Symbol`, `Cell` → `CellInterface`, `GeomStep` → `GeomGenerator`.

The inventory is corroborated against an independent source: across the Revit 2020, 2023, and 2026 family files it reproduces all 218 checkable class-to-tag pairs in the tag-drift dataset published by `rvt-rs`, with no disagreements — before and after the parent-name filter, so the filter costs no true positives.

The field *list* is deliberately not walked. The declared count and schema version are read because they sit at a fixed offset after the parent name, but the field records that follow contain inline class definitions whose layout does not close across the corpus. Several framings fit the observed bytes and each leaves a variable unexplained remainder — measured over the 2026 family file, the bytes following a zero-field class run 18, 33, 34, 40, 42, 54, 55, 82, and longer. `rvt-rs` reports the same gap as field-count mismatches. A field graph that is probably wrong would be worse than none, so the parser stops at what the bytes prove.

`Global/PartitionTable` is also read, for its UTF-16 partition names. In a project these are worksets; in a family the stream carries the family partition path instead, so the decoder reports the names without asserting which kind they are.

## Supplied-project synthesis

| Supplied project | What Reviter uses |
| --- | --- |
| `rvt-app-main` | The MIT-licensed [`@phi-ag/rvt`](https://github.com/phi-ag/rvt) streaming metadata and thumbnail reader |
| `rvt-ts-viewer` | The partition-coordinate recovery approach, reworked into the reusable `lib/reviter` core and a transferable Web Worker pipeline |
| `rvt-rs-main` | The clean-room format status, support boundary, diagnostic model, and optional WebAssembly reader integration |
| `rvt2ifc-fe-master` | The openBIM viewer/export direction; current Reviter exports can be handed to IFC viewers |
| `rvt-convert-main` | Export-format and configuration ideas only; its Autodesk/Azure upload flow is intentionally excluded because it conflicts with client-only processing |
| `revitless-toolkit-master` | Clean TypeScript equivalents for PartAtom, shared parameters, type catalogs, OmniClass text, and legacy `BasicFileInfo`; its OLE/thumbnail layer is redundant with the existing browser reader |

A second review of the supplied projects found little left to bring over from the browser ones: `rvt-app-main`'s Revit handling is a thin wrapper over `@phi-ag/rvt` that Reviter already calls directly, `rvt-ts-viewer`'s recovery is a subset of `lib/reviter/segment-scan.ts`, and `rvt2ifc-fe-master`'s IFC type-code table is redundant now that `web-ifc` reports type names directly. The remaining value was in `rvt-rs`: its `Formats/Latest` work is the basis for the schema inventory above, and its published tag-drift dataset is what that inventory is checked against.

The Revitless review did not uncover another RVT geometry decoder. Its useful portable surface has been reimplemented as worker-safe TypeScript in `lib/reviter`, without .NET, filesystem APIs, or Autodesk runtime assemblies. For this personal/internal build, its `Decompiled/*` Revit 2021 vocabulary is also mechanically transposed into an explicitly marked optional compatibility module. The generated data preserves the old API enum aliases, category and parameter-group labels, MEP classifications, shared-data types, display units, symbols, and their cross-mappings. It is lazy-loaded so the 0.5 MB table does not enter the initial viewer bundle, and it is not treated as clean evidence by the RVT geometry decoder. The toolkit's vanilla and food-service OmniClass editions are bundled as static, on-demand text assets for the local classification browser. A separate [static analysis of the isolated ODA BmJsonExport example](docs/bm-json-export-static-analysis.md) documents its semantic JSON contract, the native geometry API boundary, and the pieces that cannot be carried into a browser from the supplied ELF binaries.

### Personal Revit 2021 compatibility API

```ts
import { loadLegacyRevit2021Api } from "./lib/reviter";

const legacy = await loadLegacyRevit2021Api();
legacy.category(-2000011);
// { value: -2000011, names: ["OST_Walls"], label: "Walls" }

legacy.displayUnit("DUT_MILLIMETERS");
// catalog string, symbol, compatible unit types and parameter types
```

Regenerate the compatibility data from a local Revitless checkout with:

```sh
npm run generate:legacy-revit-api -- /path/to/revitless-toolkit-master
```

The implementation also uses Apache-2.0 [`cfb`](https://github.com/SheetJS/js-cfb) for compound-file parsing, [`fflate`](https://github.com/101arrowz/fflate) for local DEFLATE decoding, [Three.js](https://github.com/mrdoob/three.js) for rendering and GLB export, and [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) for client-side IFC reference analysis. `web-ifc` reads the ground-truth IFC; it does not decode RVT.

The captured Autodesk Viewer assets were inspected with the supplied `jsmap` workflow. For the exact supplied sample, Reviter now bundles a locally converted, quantized GLB of Autodesk's server-generated derivative and uses it as the high-fidelity reference view. It contains the source mesh hierarchy and materials but does not turn Autodesk Viewer into an RVT decoder: other RVT files still use Reviter's local recovery or a paired IFC reference.

## Paired regression workflow

After opening an RVT, choose its matching IFC export in the **Regression fixture** panel. Both files remain local. Reviter then:

1. parses native IDs from `Global/ElemTable`;
2. detects every strict nested duplicated-bounds record in each decompressible `Partitions/*` page and inventories leading-u32 evidence;
3. joins numeric IFC `Tag` values back to those RVT records;
4. measures IFC geometry with `web-ifc`; and
5. rejects or accepts the recovered output against identity, extent, topology, and semantic gates.

When the recovery fails those gates, the viewer now switches to the coherent IFC ground-truth geometry automatically. IFC elements whose `Tag` resolves to an RVT record are highlighted, the remainder stays as darker model context, and the broken coordinate recovery remains available only through the **RVT diagnostic** toggle.

The partition leading-u32 join remains diagnostic evidence. A duplicated-bounds record is stronger. Correlation against the supplied IFC joins 25,180 unique recovered IDs to known IFC products/types and yields strong record-code clusters for walls, doors, panels, members, columns, railings, slabs, roofs, coverings, and windows. This validates the record as an element envelope and supports the supplied-model display classification, but it still does not prove a native shape or a universal Revit object class mapping.

## Sample evidence

The workspace sample is a 67 MB Revit 2027 model. Local validation found:

- metadata: Revit `2027`, build `20260417_1515(x64)`, locale `ENU`
- native Rust reader: file and schema open successfully, but the version is beyond its verified 2016–2026 range
- nested duplicated-bounds recovery: 35,677 record occurrences, 35,633 unique native IDs, and 33,985 non-zero 3D envelopes
- RVT-only default scene: 33,117 element proxies, 578 of them drawn as uncategorised; 6,013 cached family shapes are excluded because they are not elements, and 1,569 curtain-wall/opening wrapper envelopes remain auditable/exportable but are held back so their child panels and mullions stay visible
- generated scene: 435,242 triangles
- paired index evidence: 8,902 `ElemTable` IDs plus 37,324 partition-record IDs
- Autodesk derivative cross-check: 59,582 stable Revit IDs and 51,420 fragments in the signed-in reference capture
- Autodesk derivative presentation evidence: 22 materials and no bitmap textures; its screenshot look comes primarily from detailed meshes, technical shading, feature edges, and shadows
- strongest supplied-pair clusters include 1,044 standard walls, 1,294 doors, 15,654 members, 4,972 plates, 95 columns, 136 railings, and 53 slabs
- native category recovery: 22,353 category tokens, 11,926 elements resolved directly from their own token, 21,997 more inherited from a record-code consensus, for 33,923 categorised elements — 18,352 curtain wall mullions, 6,878 curtain panels, 2,818 walls, 1,288 doors, 146 railings, 82 columns, 49 floors, 27 stairs, 24 ceilings, 5 windows, 5 ramps, and 4,247 stair/railing components
- local RVT-only conversion of the 67 MB model completes in about 17 seconds in Node and 25 seconds in a Chromium tab, including native category recovery
- the conversion previously spent roughly 90% of its time decompressing garbage: four byte sequences inside the DEFLATE payload happen to match the gzip signature, and each one was handed the remaining 69 MB of the stream as input. `fflate` sizes its output buffer from the input length, so those four false chunks allocated and decoded hundreds of megabytes each. Validating the gzip flag byte and bounding every chunk by the next valid signature cut the same workload from 134 seconds to 17 with byte-identical record output (35,633 bounds records, 33,985 solid envelopes)

The bounds signature is currently confirmed for this supplied Revit 2027 file. It must be regression-tested on more RVT versions before being treated as a general Revit decoder.

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
| `lib/reviter/schema.ts` | the embedded `Formats/Latest` serializable-class inventory |
| `lib/reviter/partition-names.ts` | workset / family partition names from `Global/PartitionTable` |
| `lib/reviter/types.ts` | the shared public types |

The interface is split the same way: `app/ReviterStudio.tsx` is the composition root, with the viewport in `app/studio/ModelCanvas.tsx`, Three.js group assembly in `three-scene.ts`, the Autodesk reference in `autodesk-reference.ts`, and the summary panels in `panels.tsx`.

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

## Family files

`.rfa` and `.rft` files open on the same client-only path, but they carry neither the 2027 duplicated-bounds records nor the project category tokens, so they land on the diagnostic coordinate scanner. That scanner's coordinate window is now chosen from the file kind: a family spans a single component, so a project-scale window both discards its short curves and admits long spurious runs the component cannot physically contain. On the `racbasicsamplefamily` corpus the component-scale window roughly doubles the recovered candidates and keeps the recovered extent inside the component — the 2023 sample previously reported a 128 ft extent for a component under 11 ft across. `ConvertOptions.geometryScale` overrides the choice. The output is still diagnostic: it is labelled as such, and it is not a native Revit element model.

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

Build it with the default base path for that check; a bundle built for GitHub Pages requests its assets from `/reviter/` and will not boot under the local root server. Passing the matching IFC export also pairs it in the same tab, which is how the paired workflow below was verified: the 67 MB model converts in about 25 seconds and the 80 MB IFC pairs to 41,312 typed elements, both without leaving the browser.

The raw SVF extraction remains in ignored `work/` storage. **No reference derivative is bundled any more.** A 25.6 MB GLB of one building used to ship in the repository and be offered to whichever file matched it, which meant every clone carried a derivative of someone's project and every other RVT found the feature permanently disabled. The comparison is worth keeping — a conversion by Revit's own tooling is the best yardstick there is for judging a recovery — so the capability stayed and the asset went: pair your own GLB or glTF from disk, exactly as a paired IFC export is already supplied. It is read in the browser through an object URL and never uploaded, it works for any model, and nothing about a particular building is compiled in. The deployment now ships only the small glTF runtime loader.

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

## Publication note

The application and dependency licenses are auditable, but this repository itself does not yet declare a license. Choose and add a project license before publishing Reviter as a reusable package.
