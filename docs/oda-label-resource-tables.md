# The ODA label resource

`TB_ExLabelUtils.tx` in the isolated `BmJsonExportEx` runtime carries an
embedded, CSV-derived label resource. Its rows are plain ASCII:

```text
OdBm::BuiltInParameter::WALL_USER_HEIGHT_PARAM;-1001105;Unconnected Height
OdBm::BuiltInCategory::OST_CurtainWallPanels;-2000170;Curtain Panels
```

Each row is an identifier, its C++ enumerator name, and the label Revit shows
for it. That is the same kind of fact already transcribed into
[`built-in-categories.ts`](../lib/reviter/built-in-categories.ts) and
[`built-in-parameters.ts`](../lib/reviter/built-in-parameters.ts) from Autodesk's
published Revit 2026 API documentation, recovered here from a second and
independently produced source.

No ODA code, algorithm, or binary is reproduced, and nothing here needs the
runtime to execute. `scripts/extract-oda-label-tables.mjs` scans the module for
printable-ASCII runs — the same thing `strings` does, done in-process so the
extraction has no binutils dependency — and keeps the rows that match the shape
above. The full result is committed as
[`generated/oda-label-resource-tables.json`](generated/oda-label-resource-tables.json),
summarised in [`generated/oda-label-resource-tables.md`](generated/oda-label-resource-tables.md).

## What is in it

5,597 rows across 19 enumerations. These are the four largest; only the first
two have a consumer:

| Enumeration | Rows | Labelled |
| --- | ---: | ---: |
| `OdBm::BuiltInParameter` | 3,703 | 3,703 |
| `OdBm::BuiltInCategory` | 1,224 | 1,075 |
| `OdBm::FamilyName` | 213 | 209 |
| `OdBm::PartitionType` | 178 | 173 |

`FamilyName` and `PartitionType`, like `BuiltInParameterGroup`, `SystemType`,
`AreaSpaceType`, `LightSourceDefinition`, `PipeJointType` and ten more, are
recorded in the JSON but have no decoder to feed yet.

All 5,881 row strings in the module are distinct; the file holds one table per
enumeration, not repeated copies. 284 parameter ids nevertheless appear twice,
once labelled in their own table and once bare in the table that lists which
parameters have enumerated values. A further 143 rows in that second table carry
a `MAPPING;` prefix. Rows are keyed by `(enumeration, id)`, the labelled copy
supplies the label, and conflicting labels are refused rather than merged — none
occur. Four parameter ids carry both a renamed and a live enumerator, and only
one of each pair is labelled:

| Id | Enumerator | Alias |
| --- | --- | --- |
| `-1017007` | `REBAR_ELEM_TERMINATION_START_ORIENT` | `REBAR_ELEM_HOOK_START_ORIENT` |
| `-1017009` | `REBAR_ELEM_TERMINATION_END_ORIENT` | `REBAR_ELEM_HOOK_END_ORIENT` |
| `-1017023` | `REBAR_SHAPE_HOOK_START_TYPE` | `REBAR_SHAPE_HOOK_START_TYPE_OBSOLETE` |
| `-1017024` | `REBAR_SHAPE_HOOK_END_TYPE` | `REBAR_SHAPE_HOOK_END_TYPE_OBSOLETE` |

The live name for `-1017023` and the alias for `-1017009` exist only on the
`MAPPING;` rows, so reading the label tables alone publishes `-1017023` under its
`_OBSOLETE` name while its mirror-image sibling `-1017024` is named correctly.

Labels carry presentation padding — a trailing space on `Specify `, a run of
spaces inside `Scale Value    1:`. They are whitespace-normalised, which alters
4 of 5,443 rows and changes no word. 160 rows have no label to take: 154 carry
the resource's `ODBM_CSV_NULL` sentinel and 6 an empty field. They are omitted
rather than guessed at. The rows written with no label *field* all have a
labelled twin, so nothing is lost on their account.

## What it changed

### Categories are now named the way Revit names them

The transcribed table stores enumerators and
[`humaniseCategoryName`](../lib/reviter/built-in-categories.ts) reconstructs a
display name from one. That is close, and for most categories it is exactly
right, but it is a reconstruction: 758 of the 1,075 labelled categories are not
the humanised enumerator. One of them, `OST_StairsRailingBaluster`, is the third
largest category recovered from the supplied 2027 project at 3,166 elements.

| Id | Enumerator | Was shown | Revit's label |
| --- | --- | --- | --- |
| `-2000170` | `OST_CurtainWallPanels` | Curtain Wall Panels | **Curtain Panels** |
| `-2000127` | `OST_StairsRailingBaluster` | Stairs Railing Baluster | **Balusters** |
| `-2000919` | `OST_StairsRuns` | Stairs Runs | **Runs** |
| `-2000920` | `OST_StairsLandings` | Stairs Landings | **Landings** |
| `-2000938` | `OST_StairsPaths` | Stairs Paths | **Stair Paths** |

`categoryDisplayName` prefers the label. 413 categories are renamed and 13
previously unnamed ones gain a name, and it reaches every object list, properties
dock, report, and export name.

Which is why nothing may depend on one. A display name is a label; keying
behaviour on it makes that behaviour change when Revit's wording does. Five
consumers did, and the first draft of this change broke all five without failing
a test, because every fixture wrote its own category name instead of deriving it:
`ifcClassFor` demoted curtain panels, balusters, top rails, stair flights and
landings to `IfcBuildingElementProxy`; the architectural plan stopped drawing
landings, and the studio filtered them out before the plan worker saw them; the
datum-pile cleanup lost curtain panels and top rails from its candidate set, and
with them the record count it needs to run at all; and the GLB residual audit
stopped recognising a stair run. All five are keyed on the category id now, and
`tests/export-ifc.test.ts` pins the id-to-class map with names it derives rather
than writes.

The dated ledgers under `generated/` — the IFC parity histogram, the missing-owner
routes, the surface diff — still carry the names of the run that produced them.
They are records of a run on a model this repository does not contain, so they
are left as they were rather than rewritten.

A label is only adopted when it names one category and nothing else. Revit
reuses one label across sibling sub-categories, because it shows them nested
under a parent: `Lines` names 5 categories and `<Hidden Lines>` names 65, and
351 of the 1,075 ids have a label shared that way. Two more collide with the
enumerator-derived name that a category adopting no label keeps —
`OST_StairsRailing` is "Railings" in Revit, but `OST_Railings` is a different id
that already reads that way, and `OST_CurtainSystems` collides with
`OST_Curtain_Systems`. Judging uniqueness inside the label table alone misses
that second kind and puts two categories under one name, so the test is the
whole display-name space. 353 ids fail it, keep their enumerator-derived name —
`OST_AdaptivePoints_Lines` stays "Adaptive Points Lines" rather than collapsing
to "Lines" — and return `undefined` from `builtInCategoryLabel`. The remaining
722 use their label, and all 1,224 known ids still map to 1,224 distinct names.

The resource also names 13 categories the published documentation omits, all of
them deprecated or removed.

### Parameters carry their enumerator

The transcribed table keeps labels and drops enumerators. The resource has both,
so `builtInParameterEnumName(-1001105)` is now `WALL_USER_HEIGHT_PARAM` and every
decoded `ElementParameter` carries an `enumName` beside its label. The enumerator
is what survives a release change or a localised install, so a consumer joining
on parameters should read it rather than the display string.

The resource also supplies 15 ids the documentation omits, and a real label for
10 ids where the transcribed table fell back to the humanised enumerator —
`RGB_B_PARAM` was showing as "Rgb B Param" and is "Blue value for RGB color spec.
(for Use with XAML Data Template example)".

It repairs one transcription artifact too. `-1006703 GRID_BUBBLE_LINE_PEN` was
stored with a literal backslash-`n` on the end of "Bubble Weight Number", which
reached the properties dock verbatim.

### A second source agrees the internal ids are internal

Six parameter ids observed in the supplied project resolve in neither published
source. `-1001101` — the id whose stored value reproduces the paired IFC export's
wall extrusion depth on 6,272 of 6,278 walls — and `-1001111` are among them.

This resource is a separately produced table of the same enumeration and it does
not carry those ids either — independent corroboration that they are internal
parameters Autodesk does not surface. They are still reported by number.

The README reached that conclusion by a different route, and its reasoning does
not survive checking: it calls the `-1,000,000…-1,000,999` band empty, but
`-1001101` and `-1001111` are not in it. They sit in `-1,001,000…-1,001,999`,
which holds 245 entries in both tables. The band the README describes is empty,
and so is everything above `-1,000,000` bar `-1` "Invalid" — the ids are simply
gaps inside a dense band. Two independent tables omitting them is the evidence;
the band argument is not.

## Cost

[`oda-label-resource.ts`](../lib/reviter/oda-label-resource.ts) is generated, and
carries only what the transcribed tables do not already have: 1,075 category
labels, 3,703 parameter enumerators, the 353-id ambiguous-label list, and the 13
category and 25 parameter entries that fill gaps. It is 181 KiB of source, 44 KiB
gzipped, next to the 140 KiB the two transcribed tables already cost. The 3,688
parameter labels and 1,211 category enumerators the two sources share are not
shipped twice.

## Regenerating

The binaries are not in this repository and are not redistributable.

```sh
node scripts/extract-oda-label-tables.mjs /path/to/BmJsonExportEx-isolated --write-lib
```

Without `--write-lib` it writes only the two `docs/generated` artifacts. The run
is deterministic: the same input reproduces both files and the generated module
byte for byte.
