# The UNBC model against three other buildings, 2026-09-24

[Validating on a second building](validating-on-a-second-building.md) ends on
the observation that every threshold here is "a hypothesis with one supporting
observation". Three more Revit projects arrived with Autodesk Viewer captures
beside them: Autodesk's `racbasicsampleproject`, the *Snowdon Towers Sample
Architectural* project, and a technical school (`Technicalschoolcurrentm`).
This entry runs the same converter over all four at commit `0cb3712`, and scores
each one against Autodesk's own property database and GLB.

The short version: **none of the three is a Revit 2027 file.** So this run tests
the release gate and the release-independent decoders. It does not test the
2027 rules fitted on UNBC. Those need a second *2027* building, and that is
still missing.

## The four files

| | UNBC | Technical school | RAC basic sample | Snowdon Towers |
| --- | ---: | ---: | ---: | ---: |
| Release (`BasicFileInfo`) | **2027** | 2025 | 2025 | 2024 |
| RVT size | 67.1 MB | 16.2 MB | 18.8 MB | 90.3 MB |
| `uniqueDocumentIncrements` | 326 | 16 | 15 | 71 |
| Partition streams / inflated bytes | 1 / 422 MB | 1 / 96 MB | 1 / 108 MB | 3 / 444 MB |
| `Global/ElemTable` records | 74,437 | 17,523 | 8,326 | 47,232 |
| Autodesk captured view | `{3D}` | `{3D}` | `{3D}` | `Coord - Arch Walls` |
| Autodesk-drawn elements | 36,432 | 5,479 | 450 | 1,310 |
| Autodesk triangles | 1,212,419 | 1,399,046 | 414,160 | 88,844 |
| Categories drawn | 18 | 22 | 27 | 2 |
| Levels | 13 | 5 | 6 | 18 |
| Curtain mullions + panels, share of elements | 70% | 84% | 42% | 0% |

The Snowdon capture shows a walls-only coordination view (1,061 walls and 249
wall sweeps), so it scores only walls, not the whole building.

UNBC is architectural only. Other buildings bring categories it has never
shown: 16 in the RAC sample (33% of its drawn elements: furniture, generic
models, foundations, plumbing, electrical and lighting fixtures, planting,
topography...), 12 in the school (9%: structural columns and framing,
furniture, parking, slab edges...), and wall sweeps in Snowdon. Any
category-keyed display rule, for example `PROXY_ONLY_HELPER_CATEGORY_IDS` or the
glazing fallback, has only ever seen UNBC's 18 categories.

## How Reviter's conversion compares

`npm run extract -- <model>.rvt --out <model>.json` and `--out <model>.glb`,
then `scripts/glb-surface-diff.ts` against each Autodesk GLB at 0.5 m cells.

| | UNBC | Technical school | RAC basic sample | Snowdon Towers |
| --- | ---: | ---: | ---: | ---: |
| Branch | 2027 bounds scene | diagnostic coordinate scan | diagnostic coordinate scan | bounds scene, from 4 synthesised records |
| Active decoders | 25 | 3 | 2 | 4 |
| Elements drawn | 36,391 | 4,647 boxes | 3,268 boxes | 4 boxes |
| Triangles | 896,606 | 55,764 | 39,216 | 264 |
| Conversion time | 56 s | 8 s | 9 s | 25 s |
| Autodesk-drawn elements displayed, by ElementId | **36,283 (99.6%)** | 0 | 0 | 0 |
| Autodesk-drawn elements found in `ElemTable` | 100% | 100% | 100% | 100% |
| Category tokens found / elements owning one | 25,125 / 15,632 (+23,527 inherited) | 1 / 0 | 0 / 0 | 525 / 0 |
| Storeys reported | 12 persisted level ids | 8 elevation bands | 8 elevation bands | 1 elevation band |
| Registration scale (0.3048 is correct) | **0.3048** | 0.2077 | 0.1124 | 3.5326 |
| Surface agreement, recovered / reference | **99.98% / 99.92%** | 5.0% / 1.4% | 5.1% / 1.0% | 47.7% / 11.6% |
| `fittedLimitsReached` | `monumental-solid-treads` × 26 | none | none | none |

On the 2025 files every drawn item is exactly 12 triangles: a box around a
coordinate-like run, as the warning says. The registration scale shows how far
off the extents are. The surface diff scales and centres the recovered scene to
fit the reference. It lands on exactly feet-to-metres for UNBC and is off by
2.7× (RAC) and 1.5× (school) elsewhere. Snowdon's 47.7% comes from stretching
four boxes across the building, not from recovered geometry.

## UNBC scored element by element

The Autodesk property database (`objects_*.json.gz` in each SVF capture) gives
each element's `ElementId`, UniqueId, category and level. The GLB's node extras
(`autodeskDbId`) tie each fragment back to one of those elements. That makes a
per-element check possible that the IFC pairing never allowed, because it uses
Autodesk's own reading of the same file.

- **UniqueIds:** all 40,305 that Reviter decodes and Autodesk also lists agree
  character for character.
- **Coverage:** 36,283 of 36,432 Autodesk-drawn elements are displayed. The 149
  that are not: 82 `Stairs` (the assembly records; their runs, landings and
  supports are drawn), 44 `Basic Wall` records (706 of 210,813 wall triangles)
  that Reviter holds as analytic plane solids but does not display, 13 top
  rails, and 10 model lines.
- **Categories:** every displayed element whose category Reviter decoded agrees
  with Autodesk, apart from two naming aliases: Autodesk shows
  `OST_StairsStringerCarriage` as "Supports" and `OST_StairsRailing` as
  "Railings". The one real disagreement is **36 of 82 `Stairs` labelled
  `Stair Paths`**, all from a native token, so they are probably donated tokens
  of the kind described in
  [validating on a second building](validating-on-a-second-building.md#1-447970--donated-category-tokens-fixed).
  Another 12 stairs have no category.
- **Levels:** 12 of Autodesk's 13 levels match Reviter's level list by id. The
  missing one, `Floor 6` (17,000 mm), is presumably unreferenced by any
  `m_assocLevelId`. Per element, all 35,495 elements that both sides place on a
  level agree.
- **Surface:** 99.98% / 99.92% at 0.5 m. What is left is 86 horizontal and 239
  vertical stair-riser voxels.
- **Reviter-only:** 56 displayed elements that Autodesk does not draw (18
  mullions, 11 ramps, 9 panels, 6 doors...). 20 of them are absent from
  Autodesk's property database entirely.

## What the other three show

**The release-independent decoders hold.** On all three, `Global/ElemTable`
contains every element Autodesk draws. Across the whole property database the
only ids it lacks are Autodesk's own category, family-name and document rows,
plus 16 walls and 17 generic models on Snowdon that Autodesk does not draw. Ownership decodes 3,732,
10,643 and 27,835 relationships, and transmission data decodes on all three.

**Everything else is gated to 2027, and the fallback says so.** RAC and the
school get the diagnostic scan and say "not a native Revit element model".
Their category, identity, material, host and associated-level decoders are
silent.

**Defects this run exposed:**

1. **Snowdon takes the bounds scene on a release with no bounds decoder.** The
   plane-triple surface pass (`collectOwnedSurfaces`) is not release-gated. It
   rebuilt 7 solids from 197 planes,
   `synthesiseGeometryRecords` gave them bounds records, and
   `if (boundedSolids.length)` in `convert.ts` then selected the scene branch
   and dropped the coordinate-scan candidates. The report then claims
   `revit-2027-duplicated-bounds-v1` among the active decoders,
   `"geometry": "validated-rvt-element-bounds"`, and "4 native element records
   supplied duplicated, validated 3D bounds". None of these is true of a 2024
   file.
2. **The 2025 storey list is the old capped elevation-band rule.** It returns
   exactly 8 bands on both 2025 files. On RAC they sit at 0, ±0.5, 1, −1, 1.5,
   2 and 3 ft, which are not storeys: the real levels are −800 mm to 6,000 mm.
   All 29 real level ids across the three files are present in `ElemTable`.
3. **`IsSingleUserCloudModel` decodes as `慆獬e` on all three pre-2027 files.**
   That is ASCII `False` read as UTF-16LE. The 2027 file reads correctly.
4. **Category tokens exist on the 2024 file but are never owned.** Snowdon
   yields 525 tokens and assigns 0. Ownership needs element ids proven by the
   2027 bounds pass. `ElemTable`'s id set, which does decode on 2024, is the
   obvious substitute. The 2025 files yield 0 and 1 tokens, so their token
   format differs.

**A baseline changed on UNBC itself.** The validating note says
`fittedLimitsReached` is "empty on the reference model". Since the stair work
of 2026-08-08, the reference model reaches `monumental-solid-treads` 26 times,
as intended (see `isMonumentalTerracedRun` in `stair-treads.ts`). That limit
therefore has to be read against a baseline of 26, not 0.

## What this does and does not settle

It settles that UNBC's recovery agrees with Autodesk's reading of the same file
element by element, not only as a surface. It also settles that `ElemTable`,
UniqueId, ownership and transmission decoding are not UNBC-specific.

It settles nothing about the 2027 rules. No second 2027 building was converted,
so every row of the table in the validating note is as untested as before. The
next file to look for is a 2027 save. Re-saving one of these three samples in
Revit 2027 would do, and would come with its Autodesk capture already made.
