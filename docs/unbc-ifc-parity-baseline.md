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

At checkpoint `67e32d4`, Reviter is two elements short of the IFC's tagged
drawable population. Native Revit identity is complete for every numeric IFC
Tag, persisted ownership reaches 68.0% of comparable IFC tree members, and 21
of 29 IFC material names are decoded as native definitions. It still does not
match the IFC's **shape detail, material assignment, or family semantics**.

| Measure | IFC reference | Current Reviter | Parity |
| --- | ---: | ---: | ---: |
| IFC elements | 41,312 | 38,051 IFC numeric tags recovered | 99.6% of the 38,187 tagged elements |
| Unique tagged products with drawable geometry | 36,144 | 36,142 drawn | **99.994%** |
| Tessellated triangles | 934,123 | 470,558 | **50.4%** |
| Vertex references | 2,394,161 | 309,434 | 12.9% |
| Model spans, sorted axes | 19.400 / 217.899 / 374.766 m | 19.400 / 217.899 / 374.766 m | matches at displayed precision |
| Numeric IFC Tags with native Revit UniqueId | 38,187 | 38,187 | **100%** |
| Numeric-tagged elements assigned an IFC type | 38,063 | 7,515 exact type names | 19.7% |
| Numeric-tagged elements with IFC family name | 38,063 | 0 | 0% |
| Elements assigned IFC property sets | 39,487 | 11,541 with recovered parameters | 29.2% population coverage |
| Unique IFC material names | 29 | 21 exact native definitions | 72.4% |
| Elements assigned materials, including through type | 36,221 | 0 native assignments | 0% |
| Numeric-tagged containment/aggregation members | 38,063 | 25,884 persisted ownership members | 68.0% |

The triangle and vertex ratios are diagnostic, not a demand for byte-identical
tessellation. Different valid chord tolerances produce different triangle
counts. Matching the IFC means the same product population and materially
equivalent surfaces, openings, placement, extent, names, types, properties,
materials, and hierarchy—not merely emitting exactly 934,123 triangles.

The native Revit UniqueId is not the IFC `GlobalId`. The audit joins native
identity by the numeric Revit element ID in IFC `Tag`; all 38,187 unique Tags
resolve to one of the 74,437 persisted `Global/ElemTable` identities, with no
identity conflicts.

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
`1280585`. Persisted `Global/ElemTable.OwningElementId` now proves that the
adjacent records cannot be reassigned: `1272040` and `1272041` are siblings
under owner `1271877`, while `1280586` belongs to `1280525`, not `1280585`.
Closing these last geometry gaps requires each missing element's own BRep or a
different typed relation; record adjacency is explicitly rejected.

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

The model-tree parity ratio joins only IFC tree members carrying numeric Revit
tags to persisted RVT ownership members. This keeps both sides in the same
identifier domain instead of comparing all RVT database records to an IFC
product-only denominator. In the exact UNBC run, 38,063 IFC tree members carry
numeric tags and 25,884 of them are non-self members in the persisted RVT
ownership graph, or **68.0%**. The remaining gap is expected to include spatial
containment that `OwningElementId` does not represent; the metric deliberately
does not relabel that as recovered ownership.

An IFC `GlobalId` is not the same value as Revit's native `UniqueId`. Reviter
now reconstructs all 74,437 persisted native identities from creation episode
GUID plus original element ID, and every one of the IFC's 38,187 numeric Tags
joins to that table. The audit deliberately reports this tag-to-identity
coverage rather than comparing unlike `GlobalId` and `UniqueId` strings.

Type recovery is smaller but exact: all 7,515 IFC-tagged elements for which
Reviter emits a type name match the corresponding IFC type-object name after
splitting its `Family:Type` representation. The remaining 30,548 typed Tags
have no decoded type name. No family name is emitted for any of the 38,063
numeric-tagged IFC type members, so full loadable-family/type regeneration
remains open.

Native material-definition framing yields 54 RVT names. Of the IFC's 29 unique
names, 21 match exactly. The eight unresolved IFC names are recorded in the
machine report. This is definition coverage only: native element, type, layer,
geometry, and face assignments remain 0 of the IFC's 36,221 assigned elements.

The current 81,806 recovered parameter entries cannot be compared one-for-one
with 12,375 IFC property value entities because the IFC reuses property
entities across many property sets. The defensible first population measure is
elements with any properties: 11,541 of the IFC's 39,487, or 29.2%. A later
value-level test should join by Revit element ID plus normalized property name
and compare typed values and units.

## Smallest evidence-backed next improvements

1. **Close the two-product population gap with typed geometry evidence.**
   Recover the own geometry or a proven typed geometry relation for member
   `1272040` and stair flight `1280585`. Persisted ownership proves that their
   adjacent element rows are not substitutes.
2. **Finish the topology collection boundary, then use the tessellator already
   exposed.** Current field-schema work resolves `FacetedTopology0` point and
   facet descriptors, but the UNBC probe finds no direct counted-array body
   after the selector. The next missing grammar is the property/inheritance or
   PArray item/group token immediately before its dynamic count. Decoding that
   token is smaller and more general than adding another category-specific box
   rule; it is the path to the missing door, railing, stair, wall, and column
   surface detail.
3. **Decode the family/type carrier that follows the proven instance type ID.**
   Existing system-family type names are trustworthy—7,515 of 7,515 match the
   IFC exactly—but 30,548 tagged type members and all 38,063 family names remain
   absent. Preserve shared family geometry plus transforms rather than
   expanding its 27,776 IFC mapped-item occurrences.
4. **Extend material records in two bounded steps.** First, close the remaining
   material-name layouts (40 framed material elements currently have an
   unsupported or empty name layout; the IFC has eight names not yet matched).
   Second, decode persisted element/type/layer/face material references and
   resolve them to the 54 definition IDs. Definition counts or display colors
   cannot substitute for the 36,221 IFC-assigned elements.
5. **Add spatial containment separately from ownership.** `OwningElementId`
   gives 25,884 comparable IFC tree memberships and must remain the genuine
   ownership edge. The residual 12,179 tagged IFC tree members require level,
   storey, assembly, host, or other typed relations; relabelling ownership as
   spatial containment would inflate the metric without matching IFC.

These are decoder boundaries, not presentation work. The audit shows no
evidence that more envelope heuristics, triangle inflation, or IFC `GlobalId`
copying would close the remaining parity gaps.

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
- semantic JSON: `b72e2abd02d7d83acc0fee41901f407ff320251a50e281aecd3ffba6a51024b2`
- semantic analytical payload, excluding volatile `stats.durationMs`:
  `1dfb873b5d51f1b3c21f7bb417d4e1f995d0655ce3cea4e121a24a91a92b979c`
- GLB: `77818ed3b4245f165017349fd695e7c49cfd4eced6bdd33828602d470cf4a38e`

The script exits nonzero on a missing or invalid input and writes the complete
measurement as JSON for future diffs.
