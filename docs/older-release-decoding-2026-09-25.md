# Reading Revit 2024 and 2025 files, 2026-09-25

[The four-building comparison](four-building-comparison-2026-09-24.md) ran the
converter over three projects beside UNBC. All three were 2024 or 2025 saves,
and on all three Reviter drew nothing real: the 2025 files fell to the
diagnostic coordinate scan (boxes around coordinate-like runs, 0% of
Autodesk's elements), and Snowdon took the bounds scene from four synthesised
records. Every decoder that carries UNBC was gated to 2027.

This entry records what it took to read those files properly. Most of it came
down to one finding: the 2027 decoders were not wrong for 2024 and 2025. They
were looking for the wrong numbers.

Every figure below is from the four files named in the comparison, measured
against the Autodesk Viewer captures beside them (the SVF property database for
ids, names, categories, levels and materials; the GLB for per-element geometry).

## Where things stand

| | UNBC | Technical school | RAC basic sample | Snowdon Towers |
| --- | ---: | ---: | ---: | ---: |
| Release | 2027 | 2025 | 2025 | 2024 |
| Autodesk-drawn elements displayed | 36,337 of 36,432 | 5,434 of 5,479 | 429 of 450 | 1,310 of 1,310 † |
| … of those, drawn box within 0.5 ft of Autodesk's (centre and size) | 99.7% | 99.1% | 91.6% | 95.2% |
| Elements drawn that Autodesk does not draw | 34 | 66 | 9 | † |
| Materials: name, colour and transparency exact | 94 / 94 | 186 / 186 | 174 / 174 | 220 / 220 |
| Levels: name and elevation exact | 13 / 13 | 5 / 5 | 6 / 6 | 18 / 18 |
| Type names equal to Autodesk's "Type Name" | 35,299 / 35,299 | 5,356 / 5,356 | 427 / 427 | 7,725 / 7,764 ‡ |
| Time to the ready studio (headless Chromium) | 57 s | 13 s | 12 s | 54 s |

‡ The 39 that differ are walls, from the older wall-type decoder (`element-types.ts`), not the name entries below; they look like walls whose type was changed after they were drawn.

† Snowdon's Autodesk capture is a walls-only coordination view (1,061 walls and
249 wall sweeps), so it scores only those. The studio draws 9,247 elements
from the file.

Before this work the three older files scored 0 displayed, 0 materials, and 8,
8 and 1 invented "storeys" at arbitrary elevations.

## 1. Class indices move between releases

The partition object header carries a 16-bit class marker at frame + 16, and
every decoder keys on it: `0x0270` is `BasicWallType`, `0x08c6` is `GElement`,
`0x0a19` is `Level`. Those are not fixed Revit constants. The marker is the
class's **index in the file's own `Formats/Latest` schema**, and the indices are
dense from 12 upward in roughly alphabetical order. A release that adds one
class near the start of the alphabet shifts everything after it.

Between 2025 and 2027, 4,553 classes are in both schemas and **16 keep their
index**. The record layouts barely changed: 4,321 of those 4,553 classes have
the same version and field count in both. So the decoders were reading the
right layouts at the wrong addresses.

`lib/reviter/revit-class-tags.ts` translates by name. After the schema is read,
`buildClassTagTranslation` maps each of the file's class indices to the index
the same name has in 2027 (`revit-2027-class-names.data.ts`, generated from the
UNBC schema by `scripts/generate-revit-class-tags.ts`). Readers wrap the marker
they read in `canonicalClassTag`, and byte searches that look for a class in
the data use `fileClassTag` to search for the file's own index. The
translation only switches on for a real release schema, where at least half of
2027's 4,757 class names match, and only when some class has actually moved,
so small synthetic schemas in the tests keep identity.

With the translation in place, the release gates that said `revitVersion ===
2027` became `usesRevit2027RecordLayout(version)`, true for 2024 to 2027. 2023
and older are not claimed: no file from those releases was available to check.

Where a layout did change, the file's own schema says so.
`CompoundStructureLayer` is version 2 with eight fields in 2027 (41 bytes a
layer, with `m_layerPriority`) and version 1 with seven in 2025 (37 bytes, no
priority), and the compound-layer reader takes its layout from the file's
declared field count.

## 2. Each element states its own category and owning view

The 2027 category decoder reads `BuiltInCategory` tokens and assigns them to
the nearest proven element id. The 2025 files carry 0 and 1 such tokens, so it
had nothing to read. Every element, in every release, has an `ElementHeader`
record instead:

```text
[u64 owner id] [u32] [u16 ElementHeader class index]
[u32 n] n x 22-byte m_regenHistory entries
[i64 m_categroryId] [i64 m_familyId] [i64 m_ownerViewId] [i64 m_designOptionId] ...
```

(`m_categroryId` is Revit's own spelling.) The class index is 1540 in 2027,
1479 in 2025 and 1439 in 2024. `lib/reviter/element-headers.ts` reads it, and
header categories now take precedence over tokens. On every file, every
displayed element whose category Reviter reads agrees with Autodesk, apart from
Autodesk's display aliases ("Supports", "Railings").

The header also says what is **not** part of the 3D model, which the 2027 rules
had been inferring from one building. Every element Autodesk draws in a 3D view
has no owning view and a stated category: 36,283 of 36,283 in UNBC, 5,404 of
5,404 in the school, 421 of 421 in RAC. `model-elements.ts` therefore holds
back view-owned elements (tags, text, detail items), elements with no category,
and a list of categories that are never building elements by Revit's own
definition: datums, sketch and path lines, rooms and spaces, containers whose
members are drawn in their own right, massing, opening voids, family subcategory
projections, RVT link instances, curtain grids and the structural analytical
model. On the technical school that is 44,710 records, reported by reason.

Terrain, planting and entourage are drawn when they have a mesh, and otherwise
left out: a toposolid's envelope is a solid block under the site (175 x 248 x
35 ft in RAC), and an RPC tree's is its whole canopy as a cube.

## 3. Materials through the schema's own field grammar

A `Material` record follows its name with two object pointers, then six ids,
transparency and smoothness as f32, four pattern colours, the colour as
`0x00BBGGRR` and the shininess. A pointer is four bytes when null and six when
live, and a live pointer's body is deferred to later in the stream, so the
offset of the colour depends on which pointers are live. `material-records.ts`
now walks that grammar instead of searching near the name. Names, colours and
transparency are exact for every material Autodesk lists on all four files.

## 4. Levels from the `Level` element

`Level` derives from `DatumPlane`, whose first field `m_text` is the level's
name, and one copy of the elevation sits 40 bytes before the record's stored
length. `level-definitions.ts` reads both, and the storey list now uses the
level's own elevation instead of the median base of its members. That old rule
put the school's "01 - Entry Level" (elevation 0) at 12.53 ft. The floor
browser, minimap and report show the names.

## 5. Geometry fixes found by scoring per element

Joining Reviter's drawn triangles to Autodesk's GLB nodes by element id (with
the GLB's TRS node transforms applied) scores each element's drawn box. Three
general faults showed up, none specific to one file:

- **A curtain wall running across a wall's end was cut into it as an
  opening.** The facade's envelope crosses both faces of a wall that meets it
  end-on. A curtain wall set into a wall is at least as long along the wall as
  across it at any plan angle, and now only such a wrapper cuts. School walls
  went from 117 to 138 of 146, and 16 UNBC walls that had been cut away entirely
  reappeared.
- **Layered walls were drawn at their core thickness.** In 2024 and 2025 the
  wall's centre-plane triple is usually around the structural layers. For a
  straight wall along a model axis, its own envelope's extent across it matched
  Autodesk's thickness for every such wall (877 of 877 in Snowdon, 146 of 146
  in the school, 4,801 of 4,801 in UNBC), and those walls are now drawn at it.
  Snowdon walls went from 848 to 995 of 1,061, and school walls to 146 of 146.
- **A door leaf could be deeper than the door.** The wall route sized a leaf by
  its host wall's thickness, so a 0.43 ft frame in a 3.28 ft wall became a 3.28
  ft leaf. The leaf is now capped by the door's own extent.

## 6. The viewer

- **Framing.** The camera distance was 2.05 x 0.62 x the longest side, which
  cut off a compact tower under perspective. It is now the least distance at
  which every corner of the framed box, each at its own depth, is inside the
  view. Terrain and planting no longer set the box.
- **Parameters.** Every number was printed as feet, so a floor's span direction
  read "2.5831 ft" (148 degrees) and its structural flag "0.0000 ft".
  `parameter-specs.ts` packs Autodesk's declared storage and spec for each
  built-in parameter, and values now show as ft, degrees, ft², ft³, Yes/No or
  element ids. Parameters Revit never shows are left out. The same declaration
  checks the decode: an element-id table has the double table's 16-byte stride,
  and on the older files it was being read as doubles.
- **Family names.** Instances whose symbol resolves to a `Family` element now
  show the family name in the properties palette, the selection caption, the
  object list and its filter. They match Autodesk's name for every element both
  sides name.
- **Display roles** for furnishings, services and site, so a 2025 file's
  furniture and MEP no longer take the wall colour.

## 7. Speed

The split-frame collectors re-copied every held page each time a frame crossed
a page boundary, which is quadratic in the number of held pages. RAC took 121 s
and Snowdon did not finish in reasonable time. `split-frame-stream.ts` keeps
the held pages as a list and uses the native `indexOf` on each watched class's
file index to find candidates. UNBC's output is byte-identical and its time is
unchanged.

## 8. Second pass, 2026-09-27

A second pass worked through the list above, with two outside inputs: a survey of this repository's other branches, and a search for public material on the format. The rvt-rs project's published reports (Apache-2.0) supplied two facts reimplemented here; everything else is this project's own measurement against the Autodesk captures.

- **Grouped and datum-centred elements.** A model group's placement points at one of its members, and the member was removed as a cached family shape: 6 bar chairs and 12 solar panels in RAC. The datum-pile rule removed a wall and a ceiling of RAC, whose building stands on its own origin; they were the only project walls, floors, roofs or ceilings in the pile of any of the four files, and host elements are now exempt. An element whose `ElementHeader` names a family (`m_familyId`) is part of that family's definition: none of the 111,000 elements Autodesk lists across the four files has one, and they are no longer drawn (RAC's extras 39 → 9, UNBC's 51 → 34).
- **Type and family names** (`name-entries.ts`, `family-type-names.ts`). Partitions carry a name entry, `[u64 id][u32 n][UTF-16 name][i64 category]`, for every loaded family and type (rvt-rs RE-38). An instance's type is the one id its own record references with an entry of its category, and its family the one its type's record references. Doors and windows point their placement at a per-host symbol clone with no name, so the record, not the placement, is what reaches the type.
- **Parameters on older files.** 2024 and 2025 write each double parameter entry as `[f64 value][i64 id]`, the reverse of 2027, with identical schema declarations; the reader now takes the order from the table (a parameter id's all-ones high word sits at +4 in one order and +12 in the other). Base and Top Offset equal Autodesk's on every wall compared. The same comparison showed the stored Unconnected Height is stale once a wall's top is constrained (right for 209 of 9,368 UNBC walls), while the wall's built height is right for all 9,368; the palette shows that as Height. Enumerated values show by name ("Interior", "Plumb Cut"), from the branch `learn-external-document`.
- **Rotations are rows.** A nested instance's stored rotation was read as columns; `instanceCorners` has always read a placement's as rows. Read as rows, RAC's 37-degree solar panels and two of the school's beams land on Autodesk's boxes (0.02 ft), and no UNBC element moves.
- **Unplaced instances.** An instance whose placement did not decode is now composed from its own geometry root, which is a GInstance of its symbol: RAC's solar panels, and 38 more UNBC elements.
- **Page-crossing geometry.** A `GElement` whose length echo falls on the next 64 KiB page was never framed; those are now reassembled (UNBC 14 more elements within tolerance).
- **Walls.** An angled wall takes its type's compound width, placed by its envelope's middle, where that keeps the core inside the wall and the wall inside its envelope (5 Snowdon walls, all closer).
- **Reinforcement and beam systems.** Rebar, area, path and fabric reinforcement envelopes are the region their bars run through, and are not drawn as boxes; a beam system is a container whose beams are drawn, and is left out.
- **From the other branches:** the independent IFC reader check with its recovery-evidence IDS, which found a synthesised stair container with no `Reviter_Recovery` set (now fixed); per-row "decoded / inferred" markers in the properties palette; and the enumerated parameter value names.
- **Revit 2026** is read by the same path. Autodesk's 2026 RAC basic and structural samples convert in 12 s and 8 s, with type names, parameters and levels; there is no Autodesk capture of them to score against.

## 9. Third pass, 2026-09-27: what was left in RAC

RAC had 65 elements drawn as boxes. Instrumenting the geometry replay to say why each one stopped gave four causes, worked through here.

- **Geometry node classes without a reader.** The replay stops at the first object it cannot read, so one unknown node leaves a whole element a box. Read from the schema and checked against the bytes: `GEllipse` (124 bytes, like `GArc` with two radii), `GComponentRef` (a host's reference to a component that is its own element, 26 bytes and a queued `InstanceInfo`), `GImposter` (a lamp's rendering stand-in: a transform and a queued `Asset`, whose property tree of `AProperties` and seventeen typed `AProperty` classes is read too), and `GPolyMesh` with its `FacetedTopology` (twelve plain forms: float, offset-float or double points, 16- or 32-bit facets, with or without edge flags). A polymesh is drawn as stored. Every RPC tree the Autodesk Viewer draws now lands on its vertices exactly, with the same triangle counts (108 and 689 in RAC), as do all 24 in the technical school.
- **Pile caps.** With `GComponentRef` read, each pile cap's own geometry is complete: the cap, and a reference to its pile, which the pile's element draws. Each of RAC's eleven caps is drawn at 1.97 × 1.97 × 0.98 ft (Autodesk: 2 × 2 × 1), where its box spanned the pile and stood 20.7 ft tall. This needed one more rule: a scene element with no decoded placement is published from its own complete root whatever the root's shape.
- **What Revit does not show.** Three kinds of element were drawn that Revit does not display:
  - a light fixture's *light-source* shape, drawn in the "Light Source" subcategory (`OST_LightingFixtureSource`), which put RAC's pendants outside their envelopes. A graphics style's category is now read in every release (the `GStyleElem` descriptor is found, not assumed at +121), and faces in a light-source style are left out. Both pendants are drawn at Autodesk's 13.79 × 0.50 × 2.54 ft;
  - members of a model group type with no placed instance, named by `ElementHeader.m_unplacedOwnerId`: RAC's second copy of its terrain and two solar panels, none of which the Autodesk Viewer has a record of;
  - family types. A door's per-host copy of its type has a bounds record and was drawn as a second door: 2 in RAC, 21 in the technical school, 64 in Snowdon. Autodesk draws none of them.
- **Types that store no geometry.** 25 RAC instances (windows, a cabinet, a seat, lavatories, wind generators) point at types with no geometry object in the file. Revit builds it from the family's own document, and the project carries every loaded family's document: `Global/ContentDocuments` indexes them (an entry per document with its GUID and a table of its element ids; 162 in RAC, 116 in the technical school, 172 in Snowdon), a project `Family` names its document by GUID, and the document's elements, forms included, sit in the project partition under ids of their own. A type with no geometry of its own is drawn from its document's solid forms when all of them decode complete, and only where the result fills the placed element's envelope on every side to 0.05 ft, because a document holds its family in whichever type it was last edited in. RAC's cabinet lands on Autodesk's box; its windows' document is a 3.3 ft window where the placed ones are 4.9 ft, so they keep their boxes. Most of the rest wait on curved forms that do not mesh yet (Snowdon has 21 instances whose complete forms already fill their envelopes).

Two fixes fell out along the way. `SplineNode` declares its fields in a different order in 2024 and 2025 (parameter, point, tangent) than in 2027 (point, tangent, parameter), so older splines' parameters were read from their tangents; decoders can now ask the file for a class's field order. And a wall swap that fires at exactly 0.5 ft had been deciding four Snowdon walls by float32 rounding.

The comparison script now takes each Autodesk box from its node's transformed vertices rather than its transformed local box, which overstated rotated nodes such as trees.
## 10. Revit 2019 to 2023, 2026-09-27

Autodesk's RAC basic sample is published for every release, and the 2019 to 2023 copies keep the element ids of the 2025 copy that Autodesk's viewer capture scores. That made each decoder checkable byte for byte: read the 2025 file, find the same element's record in the older one, and measure where the same values sit.

**What differs is the id width.** The 2019 to 2023 schemas declare `Identifier.m_id` as an `int32`; 2024 on declare an `int64`. `element-id-width.ts` takes the width from the file's schema for each conversion, and `usesNarrowIdRecordLayout` admits 2019 to 2023 only while the schema says 32 bits (`readsElementRecordLayout` is that or the 2024 to 2027 gate). Everything else follows from narrowed ids:

| | 2024 on | 2019 to 2023 |
| --- | --- | --- |
| Object frame | `[u64 id][u32 disc][u32 len][u16 class]`, length echoed at start + 16 + len | `[u32 id][u32 disc][u32 len][u16 class]`, echoed at start + 12 + len |
| `ElementHeader` record | `[u64 id][u32 len][u16 class]` | `[u32 id][u32 len][u16 class]`; category, family and owner view `int32` |
| `GElement` bounds record | record code +18 (i64), id +26, field table +42 | id +14, record code +22 (u32), field table +34 |
| `Level` name | +127 to +133 | +91 to +97 (the elevation is 56 bytes before the echo in both) |
| Double parameter entry | `[f64][i64 id]` or the reverse | `[f64][i32 id]`, value first |
| `InsertableInst` host id | +151 / +153 | +115 / +117 |
| `CompoundStructureLayer` | 37 or 41 bytes, ids after the width | 29 bytes, function and embedding type before the ids |
| `GInfo` | 20 bytes | 16 bytes |
| `GRep` | carries `m_elementId` | version 5 has none; the owner is the frame's id |
| `InstanceInfo` | 112 bytes | 108 (2023), 104 without `m_GRepId` (2019 to 2022) |
| `ElemTable` rows | 40 bytes | 28 bytes from byte 30 |

The 2024 schema also moved `ElementId` fields to the front of several classes (`GInfo`, `GFace`, `GInstance`, `GStyle`, `Material`, `CompoundStructureLayer`, the stairs tail), so the narrow layouts are not the wide ones with four bytes removed; each reader has its own offsets, and each was found by locating the 2025 values in the 2023 bytes. Where a class version changed inside the range, the reader takes the layout from the file's declared field count: `GInstance` v5 (no `m_tagId`), `InstInfoBase` v1 (no `m_GRepId`), `GPoint` v3 (no `m_borderSize`) in 2019 to 2022, and `FillPatternPlacer` v2 (no `m_uvScale`) in 2019 to 2021. Missing `m_GRepId` also moves every family instance's placement: the word after its geometry id is `m_cda`, not zero, and the fixed instance object is 268 bytes.

Against Autodesk's capture of the 2025 file:

| | 2019 | 2020 | 2021 | 2022 | 2023 | 2025 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Autodesk-drawn elements displayed (of 450) | 431 | 431 | 431 | 431 | 431 | 429 |
| … box within 0.5 ft | 394 | 394 | 393 | 393 | 393 | 393 |
| Type names equal to Autodesk's | 432 / 432 | 432 / 432 | 432 / 432 | 432 / 432 | 432 / 432 | 427 / 427 |
| Materials: name, colour, transparency exact (of 174) | 156 | 171 | 171 | 171 | 173 | 174 |
| Parameter values equal to the 2025 file's | 18,415 / 18,495 | 18,427 / 18,505 | 18,496 / 18,505 | 18,497 / 18,505 | 18,574 / 18,583 | |

Levels (names and elevations) are equal to the 2025 file's in every release. Against the 2025 file itself, 2023 agrees on all 85,381 `ElementHeader`s both carry, 2,780 of 2,783 bounds records, 562 of 562 level relations, 462 of 463 placements, 304 of 304 host relations, 11 of 11 compound structures, 8,214 of 8,216 `ElemTable` owners and every stair aggregate; 11,023 geometry owners replay to identical triangle counts. The materials the older files miss are not in them (their ids, from 1,093,206 up, do not occur in the partitions), and the one other difference is a transparency of 97.5% that Autodesk shows as 98%. Nor do the 2019 and 2020 files store the `VOID_CUTS_GEOMETRY` parameter that accounts for 69 of their absent values. The 17 level relations 2019 to 2022 lack belong to analytical panels the 2023 upgrade created.

2023 writes 5,784 more `GElement` frames than 2022. 5,615 of them are sketch lines and most of the rest analytical nodes and stair sketch lines; together they hold 38 triangles; the 5,240 owners both files replay have identical triangle counts. The structural sample's 2019, 2022 and 2023 copies draw all 503 elements the 2026 copy draws within 0.5 ft of its boxes.


## What is still not right

- **Curved faces with irregular trims.** Most of RAC's and the technical school's remaining boxes are fixtures and railings whose curved faces are trimmed by something other than their surface's parameter rectangle; the curved meshers only take the rectangle. The same faces keep most family-document types from qualifying.
- **Family documents in another type's size.** A type whose document was last edited in a different type keeps its box (RAC's 15 windows).
- **Not drawn:** the school's 27 parking stalls draw one of their two painted stripes. Planting, entourage and terrain are drawn only where their stored mesh decodes (their boxes are not their shape); rebar, room separation lines and UNBC's stair assemblies are left out on purpose. Terrain is drawn as its stored surface, where the Autodesk capture adds a base down to -37.7 ft and crops it.
- **Snowdon's 39 wall types** read from the older decoder as the type they were drawn with.
- **Revit 2019 to 2023** (section 10) still lack: the family-material relations (18 of the 437 elements the 2023 and 2025 RAC files both draw show a different material), the native-identity (`UniqueId`) reader, the railing baluster and alternate-frame readers, and the GStyle material binding. Of section 9's additions, `GEllipse`, `GComponentRef`, `GImposter` and the asset tree read either width; `GPolyMesh`, the family-document forms and the light-source styles are read only where ids are 64-bit, and fail closed before that. The regeneration-history entry size in narrow `ElementHeader`s is assumed, not measured: every sample's count is zero. Revit 2018 and older are not claimed; no sample was available.
- **The optional Rust reader** stops on the 2024 and 2027 samples. Nothing shown depends on it.
