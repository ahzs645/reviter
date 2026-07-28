# Remaining native material carriers

This checkpoint ranks the largest exact material-assignment gaps after the
compound-structure, shared-geometry, and `FamilySymbol` geometry-tag carriers.
The paired IFC is used only to select and measure the missing population. It
is never consumed by the RVT decoder or converter.

The reproducible audit is
[`audit-rvt-remaining-material-carriers.ts`](../scripts/audit-rvt-remaining-material-carriers.ts).
Against the exact UNBC pair it selects 878 still-unassigned IFC products:

| IFC class | Products | Independently framed RVT records | Outer RVT type code |
| --- | ---: | ---: | ---: |
| `IfcMember` | 352 | 352 | 179015 (`StairsSupport`) |
| `IfcColumn` | 311 | 296 | 79 |
| `IfcRailing` | 215 | 215 | 101 |

The remaining 15 columns are not independently length/echo framed by the
current partition scanner.

## Stair-support path

Static inspection proves the intended runtime path:

```text
StairsSupport
  -> getTypeID()
  -> StairsSupportType
  -> getMaterialId()
  -> MaterialElem
```

`TB_StairsRamp.tx` contains
`OdBmStairsSupportImpl::getMaterialIds` at RVA `0x4d47d0`; its call to
`OdBmStairsSupportTypeInternalImpl::getMaterialId` is at `0x4d4905`.
The embedded schema declares `StairsSupport.m_typeId` and
`m_hostCompId`, and declares `StairsSupportType.m_materialId` after four
doubles and `m_sectionProfileId`.

That does not yet provide a wire cursor. Three earlier fields must first be
consumed with their scoped readers:

- `m_oSupportPathCurveLoop`, a polymorphic object;
- `m_oBoundaryCurveLoops`, a fixed object array;
- `m_refFaces`, a dynamic object array.

`getTypeID()` also uses `m_typeId` only when `m_isTypeOverridden` is true.
Otherwise it follows the host component through the stair and stair type to a
left, right, or intermediate support-type geometry reference. None of those
branches may be replaced with a nearby 64-bit-id scan.

The certifiable result is consequently **0/352 resolved**, meaning “reader
path not yet available,” not “material absent.”

## Railing and column boundaries

The next railing paths are:

```text
BaseRailingAttr.m_pRailStructure
  -> NonContinuousRailInfo.m_materialId

ContinuousRail
  -> ContinuousRailType.m_materialId
```

They remain behind the unresolved polymorphic rail-structure reader.

For columns, the native family-instance material collector iterates instance
and symbol `FamilyParams` before consulting geometry-tag materials.
`TB_Family.tx` exposes that path in the family-instance `getMaterialIds`
implementation at RVA `0x38674e`. Exact column coverage therefore requires
the named-parameter variant reader; scanning for material-shaped ids inside
the parameter record would be heuristic.

## Reproduce

```sh
node --experimental-strip-types \
  scripts/audit-rvt-remaining-material-carriers.ts \
  --rvt "/path/to/model.rvt" \
  --ifc "/path/to/reference.ifc" \
  --json outputs/unbc-parity.json
```

The script explicitly labels aligned object ids as candidates. It promotes
only the length/echo frame, repeated owner id, outer type code, and separately
decoded `MaterialElem` definitions. No candidate reference offset is a
runtime assignment until a schema/native field cursor reaches it.
