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
| Autodesk-drawn elements displayed | 36,299 of 36,432 | 5,369 of 5,479 | 410 of 450 | 1,310 of 1,310 † |
| … of those, drawn box within 0.5 ft of Autodesk's (centre and size) | 99.6% | 99.6% | 91.2% | 95.0% |
| Materials: name, colour and transparency exact | 94 / 94 | 186 / 186 | 174 / 174 | 220 / 220 |
| Levels: name and elevation exact | 13 / 13 | 5 / 5 | 6 / 6 | 18 / 18 |
| Family names, where decoded, equal to Autodesk's | 2,235 / 2,235 | 249 / 249 | 114 / 114 | — |
| Time to the ready studio (headless Chromium) | 54 s | 11 s | 10 s | 47 s |

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

## What is still not right

- **Loadable families with no decoded geometry are boxes.** RAC's wind
  generators (34 ft tall), its round drop-cap column, and the school's pendant
  lights draw as their envelopes. Where the envelope includes things Autodesk
  does not draw, the box is too big: 11 RAC pile caps are 20.7 ft tall because
  a pile cap's envelope includes its nested pile, and the school's pendants
  include the light's hanging rod.
- **Not drawn:** RAC's 12 electrical equipment items and 6 furniture pieces, and
  the school's 38 generic models and 27 parking stalls. Planting, entourage,
  terrain, room separation lines and UNBC's 82 stair assemblies (whose runs,
  landings and supports are drawn) are left out on purpose.
- **Type names** decode only for system-family walls. Loadable-family type
  names and most family names are still missing: family names reach 2,235 of
  UNBC's 36,299 drawn elements and 249 of the school's 5,369.
- **Parameters on older files are sparse.** 2024 and 2025 walls rarely yield a
  parameter table, so Base Offset, Unconnected Height and similar show only on
  UNBC.
- **Angled walls** in 2024 and 2025 keep their core thickness, since their
  envelope mixes length into depth. Most of Snowdon's remaining 66 wall
  mismatches are those, or walls built from segments that are not on one line.
- **The optional Rust reader** stops on the 2024 and 2027 samples. Nothing
  shown depends on it.
- **2023 and older** are untouched: no project from those releases was
  available to check.
