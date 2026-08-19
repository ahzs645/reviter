# The ODA label and parameter tables

Two of the isolated `BmJsonExportEx` binaries carry embedded enumeration data.
`TB_ExLabelUtils.tx` holds a CSV-derived label resource, and `TB_Base.tx` holds
a binary parameter descriptor table, `g_Parameters`, which is read for the ids
the labels do not reach. Both are extracted by
`scripts/extract-oda-label-tables.mjs`.

The label resource's rows are plain ASCII:

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
351 of the 1,075 ids have a label shared that way. One more collides with the
enumerator-derived name that a category adopting no label keeps:
`OST_StairsRailing` is "Railings" in Revit, but `OST_Railings` is a different id
that already reads that way and has no label of its own to take instead.

Judging uniqueness inside the label table alone misses that second kind and puts
two categories under one name. Testing every label against every other id's
enumerator name is too strict in the other direction, because most ids never use
theirs: `OST_Curtain_Systems` would read "Curtain Systems", but it has its own
label, "Ruled Curtain System", so it never contends for the name. The test is
against the names actually displayed, which is a fixpoint — withdrawing an
adoption can only resolve collisions, never create them, so it converges, here
after one pass. 352 ids fail it and keep their enumerator-derived name —
`OST_AdaptivePoints_Lines` stays "Adaptive Points Lines" rather than collapsing
to "Lines" — returning `undefined` from `builtInCategoryLabel`. The remaining
723 use their label, and all 1,224 known ids map to 1,224 distinct names.

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

### The unnamed parameters have names after all

Six parameter ids observed in the supplied project resolved in neither published
source. `-1001101` — the id whose stored value reproduces the paired IFC export's
wall extrusion depth on 6,272 of 6,278 walls — and `-1001111` were among them,
and the README inferred from their absence that they were internal.

They are not absent. `g_Parameters` in `TB_Base.tx` is a second, richer table
from the same SDK: one binary descriptor per parameter carrying its storage
type, measurement spec, group, label and Autodesk Forge type id. It tiles its
symbol exactly — 3,723 records over 1,074,594 bytes, no remainder — and it is a
strict superset of the label CSV, agreeing on every shared id with no label
conflict. It names 20 ids the CSV omits, and those are precisely the ids Revit
shows no label for:

| Id | Forge name | Storage | Spec |
| --- | --- | --- | --- |
| `-1001101` | `wallHeightParam` | Double | `autodesk.spec.aec:length` |
| `-1001111` | `wallBaseOffsetComputed` | Double | `autodesk.spec.aec:length` |

So `-1001101` is a length parameter on walls, named by Autodesk's own schema.
That is independent corroboration of the decode from a direction the paired IFC
export cannot give: the id whose value matches a wall's extrusion depth is
called *wall height* and is typed as a *length*. `parameterDisplayName` now
returns `wallHeightParam` rather than `Parameter -1001101`.

The README's supporting argument was wrong in any case, and is corrected there:
it called the `-1,000,000…-1,000,999` band empty, but these ids are not in it.
They sit in `-1,001,000…-1,001,999`, which holds 245 entries.

The remaining two of the six are `-1005051` and `-1006800` if they are among the
20; both appear in `g_Parameters` with a spec but no Forge type id, so they stay
reported by number. Which four ids the other unresolved observations were is not
recorded in this repository, so that cannot be closed here.

## Cost

[`oda-label-resource.ts`](../lib/reviter/oda-label-resource.ts) is generated, and
carries only what the transcribed tables do not already have: 1,075 category
labels, 3,703 parameter enumerators, the 352-id ambiguous-label list, the 18
Forge names, and the 13 category and 25 parameter entries that fill gaps. It is
183 KiB of source, 45 KiB gzipped, next to the 140 KiB the two transcribed tables
already cost. The 3,688
parameter labels and 1,211 category enumerators the two sources share are not
shipped twice.

## What was left

`g_Parameters` also carries, for all 3,723 parameters, a storage type — 1,401
Double, 1,205 Integer, 532 String, 466 ElementId, 119 None — a measurement spec
across 116 kinds, and a parameter group across 111. The whole table is committed
as [`generated/oda-parameter-descriptors.json`](generated/oda-parameter-descriptors.json).

None of it is shipped, because nothing consumes it yet. It is the answer to a
question `element-parameters.ts` currently states without explaining, though:
"Only f64 values appear in these tables" is what you would expect if the decoder
reads one of several value sets, and this table says which 1,401 parameters are
doubles and which 2,322 are not. The spec would also give unit-aware formatting a
basis it does not have.

`TB_ExLabelUtils.tx` carries one further table, `g_ParameterValues`, that looked
like a straightforward win and is not. It gives the enumerated values behind 427
parameters — `FUNCTION_PARAM` is Interior/Exterior/Foundation/Retaining/Soffit/
Coreshaft, `WALL_STRUCTURAL_USAGE_PARAM` is Non-bearing/Bearing/Shear/Combined —
so a decoded number could read as a word. It is not shipped because **none of
those 427 parameters is stored as a double**: 385 are Integer, 37 ElementId, 5
String. The parameters Reviter can currently read and the parameters that have
enumerated values are disjoint sets, and they will stay disjoint until one of the
other three value sets in `Element` is decoded. Nine of its value rows are also
keyed by shared-parameter GUID rather than an integer, so the table is not purely
ordinal.

## Regenerating

The binaries are not in this repository and are not redistributable. `nm` is
needed to locate `g_Parameters`; without it the label tables still extract and
the descriptor step is skipped with a warning.

```sh
node scripts/extract-oda-label-tables.mjs /path/to/BmJsonExportEx-isolated --write-lib
```

Without `--write-lib` it writes only the two `docs/generated` artifacts. The run
is deterministic: the same input reproduces both files and the generated module
byte for byte.
