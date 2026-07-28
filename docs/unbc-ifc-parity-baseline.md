# UNBC IFC parity baseline

This is the acceptance baseline for the goal “the client-side RVT parser should
at least match the supplied IFC.” It compares:

- `UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt`, as represented by
  Reviter's current `outputs/unbc-semantic.json` and
  `outputs/unbc-recovered.glb`;
- `UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc`, the 30 June 2026
  Revit 2027 IFC2X3 export.

The full machine-readable result is
[`generated/unbc-ifc-parity.json`](generated/unbc-ifc-parity.json). The audit is
local and read-only. It uses the project's browser-capable `web-ifc` WASM build,
so it does not depend on Revit or the proprietary ODA binaries.

## Executive result

Reviter is already close on **which products appear and where the whole model
sits**, but it does not yet match the IFC's **shape detail or BIM semantics**.

| Measure | IFC reference | Current Reviter | Parity |
| --- | ---: | ---: | ---: |
| IFC elements | 41,312 | 36,974 IFC numeric tags recovered | 96.8% of the 38,187 tagged elements |
| Unique tagged products with drawable geometry | 36,157 | 35,052 drawn | **97.0%** |
| Tessellated triangles | 934,123 | 453,492 | **48.5%** |
| Vertex references | 2,394,161 | 298,826 | 12.5% |
| Model spans, sorted axes | 19.400 / 217.899 / 374.766 m | 19.200 / 217.899 / 375.091 m | within 1.03% per axis |
| IFC GlobalIds | 41,312 | 0 | 0% |
| Elements assigned an IFC type | 38,171 | 5,716 with recovered type name | 15.0% |
| Elements assigned IFC property sets | 39,487 | 10,056 with recovered parameters | 25.5% population coverage |
| Elements assigned materials, including through type | 36,221 | 0 native assignments | 0% |
| Elements in containment/aggregation tree | 38,241 | 0 genuine memberships | 0% |

The triangle and vertex ratios are diagnostic, not a demand for byte-identical
tessellation. Different valid chord tolerances produce different triangle
counts. Matching the IFC means the same product population and materially
equivalent surfaces, openings, placement, extent, names, types, properties,
materials, and hierarchy—not merely emitting exactly 934,123 triangles.

## Geometry population by IFC class

Counts below are deduplicated by the Revit element ID stored in IFC `Tag`.
`IfcRampFlight` has two drawn products but no numeric tag, so it cannot be
joined to the current RVT records and is excluded from the 36,157 denominator.

| IFC class | Tagged products with geometry | Drawn by Reviter | Coverage | IFC triangles |
| --- | ---: | ---: | ---: | ---: |
| IfcMember | 19,652 | 19,120 | 97.3% | 244,628 |
| IfcWallStandardCase | 7,381 | 7,186 | 97.4% | 147,772 |
| IfcPlate | 6,235 | 6,068 | 97.3% | 74,934 |
| IfcDoor | 1,912 | 1,826 | 95.5% | 160,104 |
| IfcColumn | 311 | 277 | 89.1% | 48,826 |
| IfcRailing | 215 | 164 | **76.3%** | 142,212 |
| IfcWall | 140 | 134 | 95.7% | 6,889 |
| IfcStairFlight | 108 | 101 | 93.5% | 78,136 |
| IfcSlab | 107 | 102 | 95.3% | 21,504 |
| IfcCovering | 46 | 38 | 82.6% | 1,592 |
| IfcWindow | 20 | 20 | 100.0% | 4,184 |
| IfcRamp | 11 | 11 | 100.0% | 1,182 |
| IfcRoof | 6 | 5 | 83.3% | 2,136 |

This confirms the existing coverage audit and makes the largest population
defect explicit: **railings are missing 51 of 215 drawable tagged products**.
Columns miss 34 of 311, members 532 of 19,652, standard walls 195 of 7,381,
plates 167 of 6,235, and doors 86 of 1,912.

The IFC also contains 1,835 `IfcCurtainWall`, 92 `IfcStair`, and 3,071
`IfcOpeningElement` objects with no standalone streamed mesh. They are semantic
containers or voids represented by their child/body relationships. They should
exist in the model tree but must not be treated as missing renderable solids.

## Highest-impact tessellation gaps

The current GLB is a batched envelope/proxy model. Its 39 mesh batches are
grouped by recovered Revit category, while the IFC is grouped by IFC class, so
the following mapping is approximate. It is still sufficient to order the
solid-modeling work:

| Target shape family | IFC triangles | Related Reviter proxy triangles | Approx. shortfall |
| --- | ---: | ---: | ---: |
| Doors | 160,104 | 20,124 | **139,980** |
| Railings and railing parts | 142,212 | 8,808 | **133,404** |
| Stair flights | 78,136 | 1,650 `Stairs Runs` | **76,486** |
| Walls, both IFC wall classes | 154,661 | 91,568 | **63,093** |
| Members / mullions / stringers | 244,628 | 195,636 | **48,992** |
| Columns | 48,826 | 3,480 | **45,346** |
| Curtain panels / plates | 74,934 | 64,404 | 10,530 |
| Slabs / floor proxies | 21,504 | 16,878 | 4,626 |
| Windows | 4,184 | 204 | 3,980 |
| Coverings / ceilings | 1,592 | 896 | 696 |

Doors and railings alone account for about 273,000 triangles of missing shape
complexity. Stair flights and columns are present by ID but still look mostly
like low-face-count bounds. That is why a general BRep/tessellation path through
the concepts exposed by `TB_Geometry`, `libTD_Ge`, `libOdBrepModeler`,
`libTD_BrepBuilder`, and `libTD_Br` has higher value than adding more
category-specific boxes.

The IFC has 56,728 placed geometry occurrences but only 29,984 unique geometry
definitions, plus 27,776 `IfcMappedItem` entities and 5,944 representation maps.
This is strong evidence that the client-side target should preserve shared
family/type geometry and instance it with transforms rather than expanding
every occurrence into independent vertices.

## Semantic reference populations

The IFC provides a concrete minimum target:

- 41,312 element `GlobalId` values and 38,187 numeric Revit `Tag` values;
- 38,171 elements assigned to types through 6,010 `IfcRelDefinesByType`
  relationships;
- 89,470 property-set instances using 24 property-set names and 12,375 reusable
  property value entities, attached to 39,487 elements;
- 30 `IfcMaterial` entities (29 unique names), 7,554 material association
  relationships, and 36,221 elements with a direct or inherited material;
- 11,838 spatially contained elements and 26,403 aggregated elements, with
  38,241 unique elements participating in that model tree.

An IFC `GlobalId` is not the same value as Revit's native `UniqueId`. Therefore
“recover native Revit UniqueId” remains a stricter RVT-parser requirement than
IFC parity. For the minimum IFC parity gate, Reviter needs a stable identifier
on every IFC-equivalent element and must retain the numeric Revit element ID;
native `UniqueId` should be added when its RVT record is decoded.

The current 71,271 recovered parameter entries cannot be compared one-for-one
with 12,375 IFC property value entities because the IFC reuses property
entities across many property sets. The defensible first population measure is
elements with any properties: 10,056 of the IFC's 39,487, or 25.5%. A later
value-level test should join by Revit element ID plus normalized property name
and compare typed values and units.

## “At least match the IFC” acceptance gates

The reference suggests staged gates that are strict enough to guide work:

1. **Product population:** 100% of the 36,157 uniquely tagged IFC products with
   geometry are represented, with every IFC class at 99% or better. Untagged IFC
   replicas are reported separately.
2. **Placement and extent:** each joined product has a world-space bounds
   center within 0.5 ft and its extents within an agreed per-axis/volume
   tolerance. Whole-model spans must remain within 1%; Reviter already passes
   this coarse hull check.
3. **Surface equivalence:** curved surfaces, holes, sweeps, profiles, and
   boolean openings are tessellated. Compare bounds plus sampled surface
   distance or voxel occupancy per joined product; triangle equality alone is
   not a correctness criterion.
4. **Identifiers and type:** every joined product retains element ID, stable
   identifier, instance name, type ID, type name, and family name where present.
5. **Hierarchy:** every reference containment and aggregation edge that has an
   RVT equivalent is represented. Meshless curtain-wall/stair/opening containers
   remain in the semantic tree without adding duplicate solids.
6. **Properties:** every IFC-visible property attached to a joined element is
   present with compatible value and unit. Native RVT-only parameters may
   exceed this minimum.
7. **Materials:** all 30 reference material definitions and assignments for
   36,221 elements resolve through direct, type, layer-set, and style paths.
   Display fallback colors do not count as material parity.

The machine baseline records the current starting point. New converter changes
should regenerate the semantic JSON and GLB, rerun this audit, and diff the
result. Coverage, class-level geometry, or semantic ratios must not regress.

## Reproduce

From the repository root:

```sh
node scripts/audit-ifc-parity.mjs \
  --ifc '/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc' \
  --semantic outputs/unbc-semantic.json \
  --glb outputs/unbc-recovered.glb \
  --json docs/generated/unbc-ifc-parity.json
```

The committed input hashes are:

- IFC: `adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`
- semantic JSON: `38b889607ed444653b288d63a3c43ff6a001fea484d6e5baf6e216739091fc35`
- GLB: `81fb66a7a949efbc19cbdf17f335cb46ffe5ba0fe554fa2dd6058d233e1600cf`

The script exits nonzero on a missing or invalid input and writes the complete
measurement as JSON for future diffs.
