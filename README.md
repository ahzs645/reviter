# Reviter

Reviter is a browser-only Revit inspection and experimental geometry conversion library. A local `.rvt`, `.rfa`, `.rte`, or `.rft` file is opened from the browser file picker, parsed in the tab, and converted in a dedicated Web Worker. The application has no file upload route, account system, telemetry, or remote conversion service.

Live client-only application: **https://projects.ahmadjalil.com/reviter/**

Every push to `main` is tested, built as a static Vite application, and deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml). The Pages build is separate from the existing Vinext/Cloudflare build but reuses the same React interface, converter library, Web Workers, and WebAssembly decoders.

## What is reliable

- OLE/CFB container validation and stream inventory
- `BasicFileInfo` metadata, including Revit version, build, locale, and document identity
- embedded Revit thumbnail extraction
- truncated-gzip partition decompression
- `Global/ElemTable` framing and native Revit element-ID inventory
- optional IFC reference parsing and geometry measurement with `web-ifc`
- paired regression gates for element identity, extents, topology, and typed semantics
- Revit 2027 nested duplicated-bounds record detection, with native element IDs, record codes, field counts, and axis-aligned bounds in feet
- native Revit `BuiltInCategory` recovery straight from the partition stream, so walls, doors, curtain panels, mullions, railings, columns, floors, ceilings, stairs, and ramps are named from the RVT itself rather than inferred from a paired IFC
- evidence-backed display classification for walls, doors, panels, frames, columns, railings, slabs/roofs, coverings, windows, stairs, and ramps in the supplied 2027 model
- a standards-aware Revit `Material` schema adapter for reader-supported releases (real-file extraction and element assignment are not wired yet)
- open-format export of recovered geometry to GLB, OBJ, DXF, SVG, IFC solid proxies, and JSON audit data, with the decoded Revit category carried through the proxy name, description, and audit report

## What is experimental

Revit's element-instance wire format is proprietary and is not fully decoded by the supplied open-source readers. Reviter selects decoders by the `BasicFileInfo` release rather than applying a byte pattern universally. In the supplied Revit 2027 model, a strict nested record signature contains the native element ID plus two identical six-`f64` axis-aligned bounds blocks. The old Revit 2023 `ArcWall` six-coordinate interpretation is retained only as a bounds hypothesis in tests; it is disabled as production profile geometry because its coordinate semantics have not been proven.

### Native category tokens

Element categories are decoded, and they are the first typed BIM data Reviter reads without a paired reference file. Revit writes each element's `BuiltInCategory` into the partition stream as a fixed 18-byte token — the field tag `04 00`, a `u32` discriminator, the negative 64-bit category id, and an `ff ff ff ff` terminator. The token carries no element id, so ownership is resolved after the scan: the owner is the nearest preceding 64-bit value that the same pass proved to be a real native element id. Elements whose own token is not recoverable inherit a category from a record-code consensus, and a consensus is only published once a code cluster clears both a support floor (8 elements) and a purity floor (70%).

Every assignment is reported with its evidence. In the supplied model the consensus is decisive rather than marginal — curtain panels 98.7%, mullions 96.0%, walls 97.6%, doors 92.2% — and the category counts line up with the paired IFC export's product types (Revit mullions against `IfcMember`, curtain panels against `IfcPlate`, railings against `IfcRailing`, floors against `IfcSlab`, ceilings against `IfcCovering`, ramps against `IfcRamp`). Category ids that the paired export does not corroborate keep their numeric label instead of being guessed at from Revit's much larger category enumeration.

A 2027 envelope is not an element's native shape. Native family meshes, curved faces, openings, compound-layer assignments, element-material references, parameters, constraints, and general typed BIM semantics beyond the category remain undecoded. Appearance/material strings, colors, and embedded previews exist in the partition corpus, but production extraction and assignment are not implemented. The IFC exporter therefore writes clearly described `IfcBuildingElementProxy` geometry; it does not mislabel proxies as native `IfcWall`, `IfcSlab`, or family geometry.

## Decoder compatibility

| Revit release | Native evidence | Rendered geometry | Categories | Materials |
| --- | --- | --- | --- | --- |
| 2023 | fixed `ArcWall` six-coordinate record detected as a bounds hypothesis | production promotion disabled pending paired proof | attempted; no project file in the corpus to verify against | schema adapter only; real extraction pending |
| 2024–2026 | version-specific geometry record not yet proven | diagnostic fallback only | attempted; no project file in the corpus to verify against | schema adapter only; real extraction pending |
| 2027 | supplied-project nested duplicated bounds + native element ID and record classification | filtered, category-styled axis-aligned envelope proxies | native `BuiltInCategory` tokens, IFC-corroborated | category display fallbacks; native assignment pending |
| unknown | no release-specific decoder | diagnostic fallback only | attempted; reports zero when the token is absent | no claim |

The category decoder is not gated on the release, because it is self-validating: a file that carries no category tokens simply reports none, and the previous record-code classification stays in place. It is verified against the supplied Revit 2027 project. The only other real Revit files in the corpus are the `.rfa` family files from the `@phi-ag/rvt` examples (2016–2026); families carry no project category tokens, so they neither confirm nor refute cross-release behaviour.

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

The `u64` at `S+18` is an element class discriminator, and it is sharp: joined against the IFC export its modal purity is **94.58%**, with `116`→`IfcMember`, `114`→`IfcPlate`, `44`→`IfcOpeningElement`, `79`→`IfcColumn`, `101`→`IfcRailing`, `54`→`IfcSlab`, `62`→`IfcCovering` all at 1.000, and the one impure code (`30`) impure only in which *kind* of wall it is.

The marker drifts by release exactly as schema tags do — `0x086d` in 2024, `0x08a4` in 2025, `0x08cc` in 2026, `0x08c6` in the 2027 project — so it is measured from the file rather than hard-coded. Releases 2020 and 2023 produce no chains; older releases frame objects differently.

Two limits are worth stating. Chaining runs per inflated page, so the ~0.05% of objects that straddle a page boundary are missed — that is the gap between the 47,265 recovered here and the 49,660 reachable when the whole stream is concatenated in memory, which a browser tab should not do for a 384 MB payload. And the marker is not resolvable through `Formats/Latest`: that stream defines roughly 200 classes and references the rest by tag, so `0x08c6` is a tag in Revit's internal class registry that this file never names.

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

| IFC product type | in IFC | seen | recovered | drawn | drawn before |
| --- | --- | --- | --- | --- | --- |
| `IfcWallStandardCase` | 7,381 | 7,151 | 6,403 | 6,324 | 6,324 |
| `IfcWall` | 140 | 139 | 124 | 110 | 110 |
| `IfcCurtainWall` | 1,835 | 1,796 | 1,790 | 253 | 253 |
| `IfcMember` | 19,707 | 16,340 | 15,918 | 15,916 | 15,916 |
| `IfcPlate` | 6,235 | 5,085 | 4,973 | 4,973 | 4,973 |
| `IfcDoor` | 1,912 | 1,398 | 1,339 | 1,294 | 1,294 |
| `IfcWindow` | 20 | 5 | 5 | 3 | 3 |
| `IfcColumn` | 311 | 248 | 99 | 95 | 95 |
| `IfcRailing` | 229 | 157 | 147 | 147 | 144 |
| `IfcSlab` | 161 | 155 | 151 | 150 | 135 |
| `IfcRoof` | 20 | 18 | 16 | 16 | 14 |
| `IfcCovering` | 46 | 42 | 42 | 38 | 23 |
| `IfcStair` | 92 | 68 | 64 | 64 | 58 |
| `IfcStairFlight` | 121 | 112 | 86 | 77 | 77 |
| `IfcRamp` | 12 | 5 | 5 | 5 | 5 |
| building elements | 38,222 | | | 29,465 | 29,424 |

`IfcCurtainWall` is low by design: 1,488 of the containers held back are drawn as their own panels and mullions instead.

**What the display gates were costing.** Four of them discarded geometry that had already been recovered:

- an envelope whose *category* did not decode was dropped from the scene entirely, even though its envelope came from the same validated duplicated-bounds signature as every other record's. That trades a missing label for a hole in the building, so an unnamed element is now drawn under a neutral **Uncategorised elements** batch — 731 of them here.
- sketch boundary recovery was attempted only for elements whose category had *already* decoded, which is backwards for exactly the elements that need it: ceilings and ramps are the smallest populations in the model and so the likeliest to fail category recovery, and a sketch loop is the only thing that gives them a shape rather than a box. Uncategorised elements with no other geometry are now tried too, and their ring is kept only when its plan extent reproduces the independently decoded envelope. Elements drawn from a real outline rise from **101 to 517**.
- the scene admitted only elements with extent on all three axes, which made `prismGeometry`'s deliberate minimum-depth fallback unreachable and dropped flat ceilings and ramp landings that had a perfectly good outline.
- an element rebuilt from several solids drew only its longest run, leaving a gap where the shorter segment should be.

Two recovery gates were also leaking. Object chaining was seeded only from bounds records, so a page holding none went unwalked and took every placement and shared shape on it out of the model; such a page now seeds itself from its own object markers, and recovered objects rise from 47,265 to **48,488**. Placed family instances were resolved into oriented boxes and then discarded unless the element reached the scene some other way.

Together these take drawn elements from 38,353 to **39,114**, and coverings from 50.0% to 82.6% of the export's count, slabs from 83.9% to 93.2%, stairs from 63.0% to 69.6%.

**Where the remaining loss is.** After these changes `recovered` and `drawn` are within a few elements of each other for every category except the two that are held back deliberately. The gap that is left is in *recovery*, and the `seen` column locates it:

- **never seen at all** — 3,367 mullions, 1,150 panels, 514 doors, 230 walls, 15 windows and 7 ramps. Ramps and windows are the starkest: only 5 of 12 ramps and 5 of 20 windows are proven to exist by any pass. Chaining runs per inflated page, so objects straddling a page boundary are lost, and no pass indexes elements the chain never reaches.
- **seen but no geometry built** — 748 walls, 149 columns, 26 stair flights. These elements are known to be real and yield nothing to the surface, sketch, or instance decoders.

Neither is a display problem, so neither is fixed by the changes above. `IfcRamp` is unchanged at 5 drawn for that reason.

The record-code consensus floor was also widened, so that a cluster too small to reach the old flat support floor of 8 can qualify by being near-unanimous instead — a building holds a dozen ramps and their cluster could never reach 8 no matter how consistent the evidence was. On this model it changes almost nothing: the small categories are limited by not being seen, not by failing to reach consensus. It is kept because the bias it removes is real and the tail categories are the ones a widened floor exists for, but it is recorded here as having produced no measurable gain.

## Stream coverage

Reviter reports what is inside a Revit file and how much of it is understood, stream by stream, so the remaining gap is measurable instead of invisible. Every CFB stream is listed whether or not anything is decoded from it, with its stored size, chunk count, inflated size, and the decoder that claims it.

Each stream is graded by depth rather than weighed by bytes. Weighing by bytes would be flattering and wrong: the partition stream is 69 MB of the 70 MB file, so "claiming" it would read as 99% coverage while the decoders recover element envelopes and category tokens from a payload that inflates to 384 MB. For the supplied 2027 project the honest figure is **2 streams read fully, 4 read partially, and 8 not decoded at all**:

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
| `ProjectInformation`, `TransmissionData`, `Contents`, `PartAtom` | small | none | not decoded |

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

A second review of the supplied projects found little left to bring over from the browser ones: `rvt-app-main`'s Revit handling is a thin wrapper over `@phi-ag/rvt` that Reviter already calls directly, `rvt-ts-viewer`'s recovery is a subset of `lib/reviter/segment-scan.ts`, and `rvt2ifc-fe-master`'s IFC type-code table is redundant now that `web-ifc` reports type names directly. The remaining value was in `rvt-rs`: its `Formats/Latest` work is the basis for the schema inventory above, and its published tag-drift dataset is what that inventory is checked against.

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
- RVT-only default scene: 39,114 element proxies across 25 decoded Revit categories, 731 of them drawn as uncategorised; 1,569 curtain-wall/opening wrapper envelopes remain auditable/exportable but are held back so their child panels and mullions stay visible
- generated scene: 336,146 vertices, 509,824 triangles, and 44 batches
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

The raw SVF extraction remains in ignored `work/` storage. The deployment includes only the optimized `public/autodesk-reference.glb` reference derivative and its small runtime loader; that reference activates only for the matching supplied-project filename.

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
