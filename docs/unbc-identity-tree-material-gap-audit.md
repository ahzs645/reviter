# UNBC identity, model-graph, and material gap audit

This checkpoint measures the remaining semantic gaps against the exact UNBC
RVT/IFC pair after native `UniqueId`, persisted ownership/host/level edges,
family/type references, positive Face materials, and the
`Face -> Geometry -> GStyle` fallback are applied.

The reproducible bounded result is
[`unbc-identity-tree-material-gaps.json`](generated/unbc-identity-tree-material-gaps.json).
The audit finishes the RVT decode before opening the IFC. IFC values are never
used to manufacture an RVT identity, relation, or material assignment.

## Identity is complete for this file

| Measure | Count |
| --- | ---: |
| `Global/ElemTable` identities | 74,437 |
| Unique native Revit `UniqueId` values | 74,437 |
| Unique numeric IFC Revit Tags | 38,187 |
| Numeric IFC Tags joined to native identity | 38,187 / 38,187 |

Native `UniqueId` is therefore no longer a missing capability for the measured
Revit 2027 layout. IFC `GlobalId` remains a separate identifier domain.

## Persisted model graph

Reviter retains independent typed edges instead of forcing every relation into
one `parentId`.

| RVT relation | Persisted pairs | Independent IFC check |
| --- | ---: | ---: |
| `ElemTable.OwningElementId` | 50,205 | 23,741 exact of 26,256 numeric `IfcRelAggregates`/`IfcRelNests` pairs |
| `InsertableInst.m_hostId` | 27,568 | 1,820 / 1,820 exact fill/void host pairs |
| `Element.m_assocLevelId` | 37,503 | 11,703 exact storey groups, 0 mismatches, 117 IFC-contained tags missing a native level edge |
| recovered instance/type reference | 9,369 | 9,350 exact numeric IFC type-id pairs |
| `FamilySymbol -> Family` | 2,151 | 41 independently named Family targets |

The ownership table has 23,484 roots, 748 self-owned table/partition records,
and zero dangling owner targets.

The family population needs careful wording. There are 7,805 exact persisted
instance `FamilySymbol` IDs. The recovered bounds layer carries 27,813
symbol-or-shared-geometry targets because its older placement contract falls
back to the shared geometry ID when a distinct symbol ID is absent. Only 2,036
recovered instances currently complete the exact
`instance -> symbol -> family` join. The broader value must not be reported as
an exact family-symbol population.

The geometry replay independently contains 248 exact `GInstance` records and
248 paired `InstanceInfo` bodies across 110 owners. These are certified
geometry-composition links. They are not yet emitted as semantic family
subcomponent/model-tree membership, so the published nested semantic edge
count remains zero.

No Revit 2027 `OwnerDBView`/owner-view wire cursor has been certified. View
membership also remains zero rather than being inferred from names, IFC
containment, or nearby IDs.

## Exact material layers

The converter now publishes 37,043 exact element-level material-assignment
rows across 35,084 unique elements:

| Persisted route | Rows |
| --- | ---: |
| instance -> shared geometry -> `MaterialElem` | 25,607 |
| instance -> `FamilySymbol` geometry tag -> `MaterialElem` | 3,911 |
| element -> type compound layer -> `MaterialElem` | 7,525 |

Of those, 36,910 rows have an IFC material-bearing numeric Tag. Every one of
the 36,910 native material names occurs in the material association on the
same IFC product. This is an element-level name check, not proof that IFC and
RVT chose the same material for each individual triangle.

The certified direct-GRep population contains 139,106 Faces:

| Face material result | Faces |
| --- | ---: |
| positive `Face.renderStyleElementId` resolving to named `MaterialElem` | 133,482 |
| selected positive Face `GStyle` | 140 |
| selected positive owning-Geometry `GStyle` | 247 |
| no positive Face or Geometry `GStyle` | 5,237 |
| selected `GStyle` explicitly stores material `-1` | 387 |
| newly exact material from the GStyle fallback | **0** |

All 133,482 direct positive Face values resolve to 36 independently named
`MaterialElem` IDs, with no missing Geometry parent and no replay failures.
The zero GStyle result is exact: all 387 selected styles decode successfully,
but persist a no-material value.

The IFC provides a useful weaker oracle for 99,935 direct Faces whose owning
element has an IFC material association. For 53,542 of those Faces, the native
Face material name is present somewhere on the IFC owner. This does not
establish per-Face IFC parity because `IfcRelAssociatesMaterial` is
product-level and may contain several layer or constituent names.

## Remaining exact carriers

No new browser-safe serialization was promoted by this audit. The next
material layers, in evidence order, are:

1. project already-decoded element/type/family geometry-tag assignments onto
   certified Face ownership where the native precedence proves that fallback;
2. certify category/object-style material lookup;
3. certify view/system material overrides.

The next model-graph layers are owner view, complete instance/type coverage,
full `instance -> symbol -> family` coverage, and semantic nested
subcomponents. Geometry `GInstance` links must not be relabelled as semantic
subcomponents without the corresponding persisted family relation.

## Reproduce

```sh
node --experimental-strip-types \
  scripts/audit-rvt-identity-tree-material-gaps.ts \
  --rvt "/path/to/model.rvt" \
  --ifc "/path/to/reference.ifc" \
  --json docs/generated/unbc-identity-tree-material-gaps.json
```

The generated file records SHA-256 hashes for both inputs. Its IFC hash is
`adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`.
