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
[`generated/oda-label-resource-tables.json`](generated/oda-label-resource-tables.md).

## What is in it

5,597 rows across 19 enumerations. Four matter to Reviter today:

| Enumeration | Rows | Labelled |
| --- | ---: | ---: |
| `OdBm::BuiltInParameter` | 3,703 | 3,703 |
| `OdBm::BuiltInCategory` | 1,224 | 1,075 |
| `OdBm::FamilyName` | 213 | 209 |
| `OdBm::PartitionType` | 178 | 173 |

The rest — `BuiltInParameterGroup`, `SystemType`, `AreaSpaceType`,
`LightSourceDefinition`, `PipeJointType` and nine more — are recorded in the JSON
but have no decoder to feed yet.

The resource repeats itself: it is emitted once per translation unit that
references it, so identical rows recur and a row sometimes appears with its label
and again without. Rows are keyed by `(enumeration, id)` and the labelled copy
wins. Two parameter ids carry a renamed and a current enumerator, and only one of
each pair is labelled:

| Id | Enumerator | Alias |
| --- | --- | --- |
| `-1017007` | `REBAR_ELEM_TERMINATION_START_ORIENT` | `REBAR_ELEM_HOOK_START_ORIENT` |
| `-1017024` | `REBAR_SHAPE_HOOK_END_TYPE` | `REBAR_SHAPE_HOOK_END_TYPE_OBSOLETE` |

Labels carry presentation padding — a trailing space on `Specify `, a run of
spaces inside `Scale Value    1:`. They are whitespace-normalised, which changes
no word. Rows the resource marks `ODBM_CSV_NULL`, or writes with no label field
at all, are omitted rather than guessed at.

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
| `-2000126` | `OST_StairsRailing` | Stairs Railing | **Railings** |
| `-2000127` | `OST_StairsRailingBaluster` | Stairs Railing Baluster | **Balusters** |
| `-2000938` | `OST_StairsPaths` | Stairs Paths | **Stair Paths** |

`categoryDisplayName` prefers the label. It reaches every object list, properties
dock, report, and export name.

Revit reuses one label across sibling sub-categories, though, because it shows
them nested under a parent: `Lines` names 5 categories and `<Hidden Lines>` names
65. 351 of the 1,075 ids have a label shared with at least one sibling, and a
shared label cannot identify a category in a flat list. Those ids keep the
enumerator-derived name — `OST_AdaptivePointsLines` stays "Adaptive Points
Lines" rather than collapsing to "Lines" — and `builtInCategoryLabel` returns
`undefined` for them. The 724 ids with a label of their own use it.

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
`RGB_B_PARAM` was showing as "Rgb B Param" and is "Blue value for RGB color
spec.".

### A second source agrees the internal ids are internal

Six parameter ids observed in the supplied project resolve in neither published
source. `-1001101` — the id whose stored value reproduces the paired IFC export's
wall extrusion depth on 6,272 of 6,278 walls — and `-1001111` are among them.

This resource is a separately produced table of the same enumeration and it does
not carry those ids either. That is independent corroboration for what the
README already said by inference from the empty `-1,000,000…-1,000,999` band:
they are internal parameters Autodesk does not surface. They are still reported
by number.

## Cost

[`oda-label-resource.ts`](../lib/reviter/oda-label-resource.ts) is generated, and
carries only what the transcribed tables do not already have: 1,075 category
labels, 3,703 parameter enumerators, the 351-id ambiguous-label list, and the 13
category and 25 parameter entries that fill gaps. It is 181 KB of source, 44 KB
gzipped, next to the 139 KB the two transcribed tables already cost. The
duplicated 3,700 parameter labels and 1,211 category enumerators are not shipped
twice.

## Regenerating

The binaries are not in this repository and are not redistributable.

```sh
node scripts/extract-oda-label-tables.mjs /path/to/BmJsonExportEx-isolated --write-lib
```

Without `--write-lib` it writes only the two `docs/generated` artifacts. The run
is deterministic: the same input reproduces both files and the generated module
byte for byte.
