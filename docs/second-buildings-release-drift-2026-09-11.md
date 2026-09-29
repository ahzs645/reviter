# Three more buildings, three other releases: what the converter is missing

Measured 2026-09-11 on the Autodesk sample models in
`My Drive/Projects/UNBC BIM/Autodesk Models`, each supplied as an RVT, the
Autodesk Viewer's SVF capture (`*-svf.tar`, captured with
`tools/autodesk/capture-viewer.js` on 2026-09-10) and the GLB the
[capture pipeline](../tools/autodesk/README.md) converted from it. This is the
second-building run that
[validating-on-a-second-building.md](validating-on-a-second-building.md) was
written for, and its first finding is upstream of every rule that document
lists: none of the release-gated decoders run at all, because every one of
them is keyed on a class index that only holds for Revit 2027.

## The models

| Model | Release (`BasicFileInfo`) | RVT | Partition pages | Autodesk fragments | Autodesk-drawn elements |
| --- | ---: | ---: | ---: | ---: | ---: |
| RAC Basic Sample Project | 2025 | 18.8 MB | 1,157 | 738 | 450 |
| Technical School (`Technicalschoolcurrentm`) | 2025 | 16.2 MB | 1,000 | 6,542 | 5,479 |
| Snowdon Towers, "Coord - Arch Walls" view | 2024 | 90.3 MB | 4,604 | 2,632 | 1,310 |
| UNBC (the reference project) | 2027 | 67 MB | 3,666 | 51,420 | — |

"Autodesk-drawn elements" is the number of distinct Revit element ids behind
the SVF fragment list, joined through `objects_ids.json` (the Revit UniqueId's
trailing eight hex digits). The Snowdon capture is a single filtered view: only
walls (1,061) and wall sweeps (249) are in it, so it is a wall-only yardstick.
The other two are full `{3D}` views: the Technical School is dominated by
curtain-wall mullions (3,276) and panels (1,349), then railings, walls, doors,
furniture and structural columns; the RAC sample is a small house with 144
mullions, 46 walls, 17 windows, 16 doors and furniture.

The SVF property databases confirm what an element inventory should look like
on each: 5,242 / 12,353 / 34,368 leaf objects with Revit UniqueIds, of which
the geometry-bearing categories are the drawn counts above.

## What the converter did on them before the change

`npm run extract` on each RVT, JSON output:

| Model | Exact bounds records | Native categories | Native meshes | Elements drawn | Geometry fidelity | Reference coverage at 0.5 m |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| RAC 2025 | 0 | 0 tokens | 0 | 3,268 coordinate clusters | `diagnostic-only` | 1.0% |
| Technical School 2025 | 0 | 1 token | 0 | 4,647 coordinate clusters | `diagnostic-only` | 1.4% |
| Snowdon 2024 | 4 | 525 tokens, 0 elements | 0 | 4 | `validated-rvt-element-bounds` | 11.6% |

The reference coverage is `scripts/glb-surface-diff.ts` against the Autodesk
GLB, and the diff had to auto-scale the recovered scene by 0.11×, 0.21× and
3.5× to register it at all — the coordinate-cluster fallback is not the
building. The only decoders that fired are the release-independent ones:
`Global/ElemTable` ownership (3,732 / 10,643 / 27,835 relations), transmission
data, `BasicFileInfo`, and the `Formats/Latest` schema reader, which tiled all
four streams to their last byte (4,600 classes and 12,296 properties in both
2025 files, 4,492 / 11,982 in 2024, 4,757 / 13,080 in 2027).

## Why: the class index drifts, the layout does not

Every geometry, category, material, level, host and stair decoder in
`lib/reviter/` finds its records by a constant that is a class index in the
file's own `Formats/Latest` — `REVIT_2027_MATERIAL_ELEMENT_MARKER = 0x0ad3`,
`REVIT_2027_GELEMENT_SOURCE_CLASS_SLOT = 2246`, and so on. There are 57 such
constants. `scripts/probe-release-schema-drift.ts` reads the schema of each
file and looks the 2027 index's class *name* up in the others:

| | 2027 | 2025 (both files) | 2024 |
| --- | ---: | ---: | ---: |
| `GElement` (object marker, bounds record tag) | 2246 / `0x08c6` | 2166 / `0x0876` | 2111 / `0x083f` |
| `MaterialElem` | 2771 | 2674 | 2607 |
| `BasicWallType` | 624 | 595 | 574 |
| `FamilyInstance` (`INSERTABLE_INSTANCE_MARKER`) | 2031 | 1951 | 1894 |
| `Level` | 2585 | 2487 | 2422 |
| `Face` / `Edge` / `EdgeLoop` | 1825 / 1423 / 1434 | 1739 / 1369 / 1380 | 1687 / 1339 / 1350 |
| `StairsElement` / `StairsLanding` / `StairsRun` | 4075 / 4080 / 4102 | 3930 / 3935 / 3957 | 3833 / 3838 / 3860 |
| `Plane` / `CylSurf` / `ConeSurf` / `SurfRev` / `RuledSurf` | 634 / 1144 / 900 / 4283 / 3859 | 605 / 1093 / 863 / 4131 / 3722 | 584 / 1068 / 840 / 4034 / 3630 |
| `ElementHeader` (frames the category id) | 1540 / `0x0604` | 1479 / `0x05c7` | 1439 |

The full table is the probe's output. The summary line is the finding:
**57 shifted, 0 same, 0 missing.** Every class the decoders depend on exists
by name in every file, and not one of them keeps its index across a release.
Within a release the indices are identical — the two 2025 files agree on all
4,600 shared classes — so the drift is per release, not per document. Of the
4,553 classes 2025 and 2027 share, 16 keep their index, by coincidence.

The field declarations do not drift. `Element`, `MaterialElem`, `GRep`,
`Face`, `Level`, `InsertableInst`, `StairsRun`, `GStyleElem` and
`BaseRailingSym` declare the same fields in the same order in 2024, 2025 and
2027. `FamilySymbol` grew from 60 to 61 to 63 fields, all appended.

### The bounds record is byte-identical

`scripts/probe-release-bounds-marker.ts` runs the 2027 duplicated-bounds
signature from `bounds-records.ts` — element id at +0, zero word, the tag at
+16, the id echoed at +26, family word `0x00088004` at +34, `3` at +42, the
counted field table, then the six-`f64` envelope written twice — with the tag
taken from the file's schema instead of the source constant:

| Model | Tag | Records | Unique element ids | Of which Autodesk draws | Copies agree |
| --- | --- | ---: | ---: | ---: | ---: |
| Technical School 2025 | `0x0876` (schema `GElement`) | 8,506 | 8,506 | **5,443 of 5,479 drawn (99.3%)** | 7,630 |
| Technical School 2025 | `0x08c6` (the 2027 constant) | 0 | 0 | 0 | — |
| Technical School 2025 | `0x08a4` (the value a comment in `element-objects.ts` gives for 2025) | 0 | 0 | 0 | — |
| RAC 2025 | `0x0876` | 3,173 | 3,173 | **440 of 450 (97.8%)** | 2,705 |
| Snowdon 2024, 658 of 4,604 pages sampled | `0x083f` (schema `GElement`) | 2,615 | 2,615 | 189 of 1,310 in a 14% sample | 1,475 |
| UNBC 2027 control, 408 of 3,666 pages | `0x08c6` | 6,616 | 6,616 | — | 5,701 |

Nothing else in the signature changed: the family word, the `3`, the field
table stride and the duplicated envelope all pass at the same rates as on the
2027 control (the second family-word variant `0x00089004`, which the signature
rejects, is present in 2027 too, at 15%, so it is not a release difference).
The comment in `element-objects.ts` that gives the 2025 marker as `0x08a4` is
wrong for these files — `0x08a4` is `GStyleElem`'s 2025 index, heads 9,380
objects and echoes no ids. The schema lookup is the measurement to trust.

### The category id is framed the same way, and the 2027 token is the rare form

`scripts/probe-release-category-frame.ts` finds every `i64` in the
BuiltInCategory window followed by `ff ff ff ff`. The Technical School's 1,000
pages hold 20,510 of them, at a higher density than the 2027 file; walls
(`-2000011`), doors, curtain panels, mullions and structural columns lead. The
ten bytes before the id are, in both releases, `[u32 n][u16 ElementHeader
index][u32 0]` — `c7 05` in 2025, `04 06` in 2027. The `04 00 [u32] [i64] ff×4`
token that `native-categories.ts` matches is one of several 2027 forms and
occurs **once** in the 2025 file, which is why the converter reported one
token. Keying the token on the file's `ElementHeader` index reaches the ids on
all four files; the nearest-preceding-owner rule that resolves them is
unchanged.

## What was done about it (same day)

The 57 constants became registered live bindings resolved per file
(`lib/reviter/release-markers.ts`): each keeps its 2027 value as the default
and registers the class name it stands for; `openRevitContainer` reads
`Formats/Latest` before the decoder plan is settled, resolves every name, and
opens the release gates for the file's release only when all of them resolved.
Every `revitVersion !== 2027` gate (46 of them) became
`releaseDecodersApply(revitVersion)`, and the eight places that passed a
literal `2027` into a decoder — the native mesh collector, the FIFO replay
context, the stairs-run collector and the baluster reader — now pass the
active release. Tables built from the constants at module load (the certified
reader registry, the owner-surface index, the direct-geometry root shapes,
the family-material field offsets, the sketch owner anchor) rebuild through
`releaseMemo`. The category token additionally matches the `ElementHeader`
frame. The bounds-record tag comes from the `GElement` registration. The
second-2025-index comment in `element-objects.ts` is superseded by the
schema lookup. A conversion's audit now carries `releaseMarkers` (release,
resolved, missing, shifted) and up to twelve native-mesh failure details, and
the warnings name the resolution.

Two more things surfaced only once the decoders ran, and both were fixed:

- **Non-model categories drawn as boxes.** On Snowdon, five `RVT Links`
  instances drew as a single 662 million cubic-foot block — a link's
  envelope is the linked building's — and were 1,368,328 of 1,437,842
  recovered-only voxels; a text note drew as a 2.6 million cubic-foot plate,
  and 227 viewports, 360 sun-path elements, C-lines, section boxes and
  adaptive points drew at their sheet and datum positions. `scene.ts` now
  holds back a listed set of non-model categories (links, groups, text notes,
  viewports, views, sheets, datums, dimensions, analytical elements, sun path,
  design options) ahead of every geometry route, and the warning counts them.
  The 2027 project draws none of these categories, and its output is unchanged.
- **Registration.** `glb-surface-diff.ts` registers by overall bounds, and an
  Autodesk view that carries site elements the recovery drops makes that
  scale wrong by the ratio of the extents — 0.34 on the Technical School.
  `scripts/register-glb-by-elements.py` pairs elements by Revit id (audit
  bounds against Autodesk node bounds through `fragments.json` and
  `objects_ids.json`) and derives scale and offset from the medians; the
  diff takes it through `--registration`. On every model the per-element
  offsets agree to under a millionth of a foot and the size ratio comes out
  at 0.3048 exactly, which is feet to metres.

### Results, both directions

Element inventory against the Autodesk property database
(`scripts/compare-svf-elements.py`), surface against the Autodesk GLB at
0.5 m (`glb-surface-diff.ts` with the element registration), residuals by
category (`scripts/residuals-by-category.py`):

| Model | Autodesk-drawn elements displayed | Native BRep elements | Recovered coverage | Reference coverage | What the reference-only residual is |
| --- | ---: | ---: | ---: | ---: | --- |
| Technical School 2025 | 5,404 of 5,479 (98.6%) | 4,853 | 80.5% | 46.6% | Topography 154,471 of 160,121 voxels (a site surface Reviter draws as a box), planting 4,520, roofs 2,462; walls, floors, ceilings, doors, columns, stairs, railings, furniture all 0 |
| RAC 2025 | 417 of 450 (92.7%) | 360 | 28.9% | 55.9% | Topography 16,138 of 16,208; 12 electrical equipment elements have no bounds record at all |
| Snowdon 2024, walls-only view | 1,310 of 1,310 (100%) | 7,137 | 71.8% | 99.7% | 302 wall voxels of 138,372 (was 96.6% / 98.5% before categories came from element headers) |
| UNBC 2027 control | — | as before | 99.994% | 99.980% | 64 recovered-only (was 159), 223 reference-only, 21 of 21 verify-pair assertions |

Before the change the same three files scored 1.0%, 1.4% and 11.6% reference
coverage with the diagnostic path. Snowdon's recovered-only figure is
dominated by the rest of the building, which the captured view filters out;
its 4,924 uncategorised records and 2,608 railing supports are the next thing
to read on that file. The two 2025 files' recovered-only residual is
topography and planting envelopes — the box a site surface or a tree gets
when the only recovered evidence is its bounds — plus masses the Autodesk view
hides.

### Element by element against the Autodesk GLB

`scripts/compare-glb-elements.py` pairs elements by Revit id and scores centre
and size agreement to 0.5 ft on every axis, per Autodesk category, the way
`verify-pair.ts` does against a paired IFC. The audit's bounds are the
element's persisted envelope rather than the drawn mesh, so a door — whose
Revit envelope includes its swing — reads as a size disagreement while the
voxel diff finds nothing of its leaf missing; the two views are read together.

| Model | Matched | Centre within 0.5 ft | Size within 0.5 ft | Categories at 100 / 100 | What disagrees |
| --- | ---: | ---: | ---: | --- | --- |
| Technical School 2025 | 5,404 | 97.8% | 97.5% | mullions 3,276, panels 1,349, columns, walls, ceilings, framing, windows, railings, floors, stairs, roofs | doors (envelope holds the swing), 25 furniture panels whose shared shape is 12 ft tall against 1.4–5.5 ft, 4 lighting fixtures, the topography box |
| RAC 2025 | 417 | 90.9% | 89.9% | mullions, panels, generic models, furniture, windows, top rails, floors, columns, site, roofs | 22 structural foundations whose envelope is 20.7 ft tall against a 1 ft footing, doors, plumbing fixtures, pads, the topography box |
| Snowdon 2024 | 1,310 | 100% | 99.9% | walls 1,061, wall sweeps 249 | one wall 0.6 ft longer |

The geometry-route column says how much of the agreement is a real surface:
on the Technical School, mullions, panels, windows and furniture are placed
shared shapes, ceilings, floors and roofs are sketch prisms, and columns,
walls and framing are envelope boxes that happen to be exactly right for
rectangular members. Walls there are 47,087 Autodesk voxels at 0 reference-only
but are still boxes — an opening cut through a box is not drawn.

The plan-view diffs (`glb-surface-diff.ts --svg`, rasterised with
`scripts/svg-to-png.mjs`) show the residual as shapes rather than counts. On
both 2025 files the Autodesk-only surface is the site: a terrain mesh
surrounding the building that Reviter has as a flat box. The RVT-only surface
on the Technical School is the conceptual masses the Autodesk view hides
(`Show Mass` is off in a default 3D view) and planting drawn as boxes; on RAC
it is the topography box's top face lying above the real terrain. Snowdon's
RVT-only surface is the rest of the building that its walls-only view filters
out, and the UNBC control is almost blank.

### What is still missing, ranked

1. **Site surfaces and planting.** Topography is 96% of the Technical School's
   reference-only residual and all of RAC's; Reviter has no terrain-mesh
   decoder and draws the envelope. Planting is RPC content, drawn as a box.
2. **Category-token ownership on the 2024 file** — closed the same day by
   reading each element's category from its own element-header record; see
   [the partition-sequences entry](partition-sequences-and-element-headers-2026-09-11.md).
   All 1,061 drawn walls display.
3. **`GImposter` GRep nodes** (2025 slot 2182, 2027 index 2262) have no
   certified reader; six of the Technical School's 39 remaining owner
   failures name it.
4. **Appearance-backed materials.** 186 `MaterialElem` frames on the Technical
   School yield 0 named definitions (RAC: 11 of 174) — the nested layout the
   material decoder does not read, already recorded as an assumption.
5. RAC's 12 electrical equipment elements have no bounds record under any
   marker; 6 furniture and 2 entourage elements are absent likewise.
