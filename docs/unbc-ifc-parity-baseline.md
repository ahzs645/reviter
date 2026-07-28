# UNBC IFC parity baseline

This is the acceptance baseline for the goal “the client-side RVT parser should
at least match the supplied IFC.” It compares:

- `UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt`, as represented by
  Reviter's current `outputs/unbc-parity.json` and
  `outputs/unbc-parity.glb`;
- `UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc`, the 30 June 2026
  Revit 2027 IFC2X3 export.

The full machine-readable result is
[`generated/unbc-ifc-parity.json`](generated/unbc-ifc-parity.json). The audit is
local and read-only. It uses the project's browser-capable `web-ifc` WASM build,
so it does not depend on Revit or the proprietary ODA binaries.

## Executive result

After decoding the RVT checksum-page layer and releasing named analytic wall
solids from the curtain-wall wrapper rule, Reviter is two elements short of the
IFC's tagged drawable population. It still does not match the IFC's **shape
detail or BIM semantics**.

| Measure | IFC reference | Current Reviter | Parity |
| --- | ---: | ---: | ---: |
| IFC elements | 41,312 | 38,051 IFC numeric tags recovered | 99.6% of the 38,187 tagged elements |
| Unique tagged products with drawable geometry | 36,144 | 36,142 drawn | **99.994%** |
| Tessellated triangles | 934,123 | 470,558 | **50.4%** |
| Vertex references | 2,394,161 | 309,434 | 12.9% |
| Model spans, sorted axes | 19.400 / 217.899 / 374.766 m | 19.400 / 217.899 / 374.766 m | matches at displayed precision |
| IFC GlobalIds | 41,312 | 0 | 0% |
| Elements assigned an IFC type | 38,171 | 7,523 with recovered type name | 19.7% |
| Elements assigned IFC property sets | 39,487 | 11,541 with recovered parameters | 29.2% population coverage |
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
joined to the current RVT records and is excluded from the 36,144 denominator.

| IFC class | Tagged products with geometry | Drawn by Reviter | Coverage | IFC triangles |
| --- | ---: | ---: | ---: | ---: |
| IfcMember | 19,652 | 19,651 | 99.995% | 244,628 |
| IfcWallStandardCase | 7,381 | 7,381 | 100% | 147,772 |
| IfcPlate | 6,235 | 6,235 | 100% | 74,934 |
| IfcDoor | 1,912 | 1,912 | 100% | 160,104 |
| IfcColumn | 311 | 311 | 100% | 48,826 |
| IfcRailing | 215 | 215 | 100% | 142,212 |
| IfcWall | 140 | 140 | 100% | 6,889 |
| IfcStairFlight | 108 | 107 | 99.1% | 78,136 |
| IfcSlab | 107 | 107 | 100% | 21,504 |
| IfcCovering | 46 | 46 | 100% | 1,592 |
| IfcWindow | 20 | 20 | 100.0% | 4,184 |
| IfcRamp | 11 | 11 | 100.0% | 1,182 |
| IfcRoof | 6 | 6 | 100% | 2,136 |

The only missing tagged drawable products are member `1272040` and stair flight
`1280585`. The RVT parser currently recovers adjacent geometry records
`1272041` and `1280586`; a persisted ownership/subcomponent relation is still
needed before those shapes can be assigned to the IFC-tagged elements without
hard-coding adjacency.

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
| Doors | 160,104 | 23,196 | **136,908** |
| Railings and railing parts | 142,212 | 9,636 | **132,576** |
| Stair flights | 78,136 | 1,710 `Stairs Runs` | **76,426** |
| Walls, both IFC wall classes | 154,661 | 94,924 | **59,737** |
| Columns | 48,826 | 3,744 | **45,082** |
| Members / mullions / stringers | 244,628 | 231,624 | **13,004** |
| Windows | 4,184 | 264 | 3,920 |
| Slabs / floor proxies | 21,504 | 19,048 | 2,456 |
| Coverings / ceilings | 1,592 | 1,092 | 500 |
| Curtain panels / plates | 74,934 | 74,904 | 30 |

Doors and railings alone account for about 269,000 triangles of missing shape
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

The current 81,806 recovered parameter entries cannot be compared one-for-one
with 12,375 IFC property value entities because the IFC reuses property
entities across many property sets. The defensible first population measure is
elements with any properties: 11,541 of the IFC's 39,487, or 29.2%. A later
value-level test should join by Revit element ID plus normalized property name
and compare typed values and units.

## “At least match the IFC” acceptance gates

The reference suggests staged gates that are strict enough to guide work:

1. **Product population:** 100% of the 36,144 uniquely tagged IFC products with
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
  --semantic outputs/unbc-parity.json \
  --glb outputs/unbc-parity.glb \
  --json docs/generated/unbc-ifc-parity.json
```

The committed input hashes are:

- IFC: `adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`
- semantic JSON: `db41ac0a0a31cb49f52bce8e7822f6a5a5c5a5d9eb8e5a12ed9e707022d7c0d8`
- GLB: `91f2f4def44c0a7cfbea1a9ab730ce0be6d89802bc032f97b218de2e8caba47d`

The script exits nonzero on a missing or invalid input and writes the complete
measurement as JSON for future diffs.
