# UNBC IFC parity baseline

> **Release correction:** The IFC measurements and acceptance gates in this
> document remain valid, but the **Smallest evidence-backed next
> improvements** section historically named exact UNBC Revit 2027 slots using
> a Revit 2026 reader table. Those class labels and geometry-route conclusions
> are superseded by the
> [Revit 2027 release boundary](revit-2027-grep-release-boundary.md). No pure
> Revit 2026 slot-to-class statement in this document applies to the UNBC
> model.

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

At this checkpoint, Reviter matches the IFC's complete tagged drawable product
population. Native Revit identity is complete for every numeric IFC Tag,
persisted ownership, host, and associated-level relations reach 99.5% of
comparable IFC tree members, and 28 of 29 IFC material names are decoded as
native definitions. Shared geometry, 45 decoded BasicWallType compound
structures, and 361 reader-certified FamilySymbol geometry-tag maps now assign
35,084 placed elements. In the common numeric-Tag domain, 34,979 of 36,142 IFC
material-assigned Tags match, and every emitted material name on those Tags
occurs in the IFC association. It also
recovers 2,151 reader-certified placed `FamilySymbol` → `Family` relations.
Forty-one referenced family definitions now name 2,035 placed instances; all
2,018 names
with a comparable IFC family string match exactly. It
still does not match the IFC's **shape detail, per-face/full material
assignment population, or complete family semantics**.

| Measure | IFC reference | Current Reviter | Parity |
| --- | ---: | ---: | ---: |
| IFC elements | 41,312 | 38,053 IFC numeric tags recovered | 99.6% of the 38,187 tagged elements |
| Unique tagged products with drawable geometry | 36,144 | 36,144 drawn | **100%** |
| Tessellated triangles | 934,123 | 470,570 | **50.4%** |
| Vertex references | 2,394,161 | 309,442 | 12.9% |
| Model spans, sorted axes | 19.400 / 217.899 / 374.766 m | 19.400 / 217.899 / 374.766 m | matches at displayed precision |
| Numeric IFC Tags with native Revit UniqueId | 38,187 | 38,187 | **100%** |
| Numeric-tagged elements assigned an IFC type | 38,063 | 7,515 exact type names | 19.7% |
| Numeric-tagged elements with IFC family name | 38,063 | 2,018 exact native family names | 5.3% |
| Elements assigned IFC property sets | 39,487 | 11,541 with recovered parameters | 29.2% population coverage |
| Unique IFC material names | 29 | 28 exact native definitions | 96.6% |
| Unique numeric IFC Tags assigned materials | 36,142 | 34,979 exact persisted assignments | **96.8%** |
| Numeric-tagged containment/aggregation members | 38,063 | 37,874 persisted ownership/host/associated-level members | 99.5% |

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
| IfcMember | 19,652 | 19,652 | 100% | 244,628 |
| IfcWallStandardCase | 7,381 | 7,381 | 100% | 147,772 |
| IfcPlate | 6,235 | 6,235 | 100% | 74,934 |
| IfcDoor | 1,912 | 1,912 | 100% | 160,104 |
| IfcColumn | 311 | 311 | 100% | 48,826 |
| IfcRailing | 215 | 215 | 100% | 142,212 |
| IfcWall | 140 | 140 | 100% | 6,889 |
| IfcStairFlight | 108 | 108 | 100% | 78,136 |
| IfcSlab | 107 | 107 | 100% | 21,504 |
| IfcCovering | 46 | 46 | 100% | 1,592 |
| IfcWindow | 20 | 20 | 100.0% | 4,184 |
| IfcRamp | 11 | 11 | 100.0% | 1,182 |
| IfcRoof | 6 | 6 | 100% | 2,136 |

The final two products were present as their own strict duplicated-bounds
records. They were lost later because `InstInfoBase.m_symbolId` was treated as a
cached local-shape id for every placement. For ordinary family instances that
is valid; a stair assembly uses the same field for its run or stringer
subelement. Gating that distinction on the assembly's persisted `OST_Stairs`
category retains member `1272040` and stair flight `1280585` without any IFC
class, element-id list, record adjacency, or inferred ownership.
As an audit only, their emitted boxes reproduce the IFC boxes with worst-axis
centre errors below `4e-10` ft and size errors below `7.2e-7` ft.

The IFC also contains 1,835 `IfcCurtainWall`, 92 `IfcStair`, and 3,071
`IfcOpeningElement` objects with no standalone streamed mesh. They are semantic
containers or voids represented by their child/body relationships. They should
exist in the model tree but must not be treated as missing renderable solids.

## Highest-impact tessellation gaps

The current GLB is a batched envelope/proxy model. Its 38 mesh batches are
grouped by recovered Revit category, while the IFC is grouped by IFC class, so
the following mapping is approximate. It is still sufficient to order the
solid-modeling work:

| Target shape family | IFC triangles | Related Reviter proxy triangles | Approx. shortfall |
| --- | ---: | ---: | ---: |
| Doors | 160,104 | 23,196 | **136,908** |
| Railings and railing parts | 142,212 | 9,636 | **132,576** |
| Stair flights | 78,136 | 1,722 `Stairs Runs` | **76,414** |
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
tags to persisted RVT ownership, host, or associated-level members. This keeps
both sides in the same identifier domain instead of comparing all RVT database
records to an IFC product-only denominator. In the exact UNBC run, 38,063 IFC
tree members carry numeric tags and 37,874 resolve through at least one of
`Global/ElemTable.OwningElementId`, `InsertableInst.m_hostId`, or
`Element.m_assocLevelId`, for **99.5%** coverage. The three relations remain
distinct edge kinds. The associated-level decoder contributes 37,503 exact
element-to-Level relations, has zero conflicting targets, and agrees with all
11,703 comparable IFC storey assignments; IFC is used only as the audit oracle.
The remaining 189 tagged tree members need other typed relationship paths.

An IFC `GlobalId` is not the same value as Revit's native `UniqueId`. Reviter
now reconstructs all 74,437 persisted native identities from creation episode
GUID plus original element ID, and every one of the IFC's 38,187 numeric Tags
joins to that table. The audit deliberately reports this tag-to-identity
coverage rather than comparing unlike `GlobalId` and `UniqueId` strings.

Type recovery is smaller but exact: all 7,515 IFC-tagged elements for which
Reviter emits a type name match the corresponding IFC type-object name after
splitting its `Family:Type` representation. The remaining 30,548 typed Tags
have no decoded type name. The native relationship decoder now recovers 2,151
placed `FamilySymbol` links by combining the fixed `m_familyId` layout with the
reader-proven 112-byte Outline/origin/rotation/cut-plane tail for
variable-width layouts. The adjacent, reader-proven `FamilyBase` name/path pair
decodes 41 referenced family definitions and attaches names to 2,035 elements.
All 2,018 names with a
comparable IFC family string match; the remaining 36,045 comparable family
names and full loadable-family/type regeneration remain open.

Native material-definition framing yields 69 RVT names. Of the IFC's 29 unique
names, 28 match exactly; only the IFC placeholder `<Unnamed>` is absent, and it
occurs zero times in the inflated RVT partitions. Three proven persisted
geometry layouts add 5,413 native
geometry-to-material assignments. Joining each placed instance's persisted
shared-geometry id expands those sources to 25,607 placed elements. The
type-owned `BasicWallType → CompoundStructure → layer material` path adds
7,525 non-overlapping placed elements, producing 33,132 assignments before the
family map.

The persisted `FamilySymbol.m_geomTag2MaterialId` carrier adds 361 unambiguous
maps, 1,336 geometry-tag/material entries, and 3,911 element-material relations
across 1,952 additional placed elements. The common numeric-Tag domain now has
34,979 matches among 36,142 unique IFC-assigned Tags (96.78%), leaving 1,163
IFC-only Tags and 105 native assignments outside the IFC material set. Every
decoded name on all 34,979 comparable assigned Tags occurs in that Tag's IFC
material association; the isolated family-map audit is also exact for all
3,862/3,862 comparable element-material relations. Face-level,
appearance-asset, category, and view-override material paths remain open.

The current 81,806 recovered parameter entries cannot be compared one-for-one
with 12,375 IFC property value entities because the IFC reuses property
entities across many property sets. The defensible first population measure is
elements with any properties: 11,541 of the IFC's 39,487, or 29.2%. A later
value-level test should join by Revit element ID plus normalized property name
and compare typed values and units.

## Smallest evidence-backed next improvements

1. **Recover a genuine outer-object scope for `GPolyMesh` replay.** The three
   UNBC spans that fit the `FacetedTopology8` byte grammar are proven to begin
   at multi-entry `GStyle`/`GFlipControl` replay boundaries, so they are
   rejected as mesh-shaped collisions rather than emitted as geometry. The
   browser decoder now has the counted `CondInt16` collection, an unambiguous
   slot-5,255 topology binding, the 96-byte `GInstance`/`GArray` transform, a
   fail-closed surrogate object/property registry, and the release-scoped
   Revit 2026 `ObjectPtrInitReader` dispatch for slot 2,237. Across all 3,666
   exact UNBC chunks it sees 4,893 raw slot-2,237 occurrences and 3,463
   complete fixed-width static shapes, but none carries the required
   slot-5,255 topology descriptor. The framed `GElement/GRep` owner and exact
   dynamic replay start are now decoded for 63,820 roots, but their 148,223
   direct child descriptors contain no `GBrep`, `GFakeBRep`, `GPolyMesh`, or
   `FacetedTopology8`. The remaining boundary is the intermediate
   representation/target-class mapping plus multi-property DynamicQueue token
   and retained-data semantics. Once recovered, replay the retained topology
   into the neutral browser BRep/mesh layer modeled from the public concepts
   exposed by `TB_Geometry`, `libTD_Ge`,
   `libOdBrepModeler`, `libTD_BrepBuilder`, and `libTD_Br`.
2. **Resolve the remaining family carrier and regenerate shared family
   geometry.** Existing system-family type names are trustworthy—7,515 of 7,515
   match the IFC exactly—and 2,151 reader-certified placed `FamilySymbol` →
   `Family` relations are now retained. Forty-one referenced family definitions
   supply 2,018/2,018 exact comparable emitted names, but 30,548 tagged type
   members and 36,045 comparable family names remain absent. Preserve shared
   family geometry plus transforms rather than
   expanding its 27,776 IFC mapped-item occurrences.
3. **Extend material records to faces and remaining carriers.** Definition-name
   parity is now 28/29, with only a non-persisted `<Unnamed>` IFC placeholder
   absent. Shared geometry, compound wall layers, and FamilySymbol geometry-tag
   maps now match 34,979/36,142 assigned numeric Tags. The remaining 1,163 are
   led by members (352), columns (311), railings (215), stair flights (108),
   slabs (107), and coverings (46). Decode those typed carriers, appearance
   assets, category and view overrides, then preserve genuine BRep face tags
   before assigning material groups to triangles.
4. **Resolve the residual typed tree relations.** Ownership, host, and 37,503
   persisted associated-level relations are preserved as genuine, distinct
   edge kinds and together cover 37,874/38,063 comparable IFC tree members.
   The residual 189 require other typed relationships; relabelling any current
   edge as generic spatial containment would inflate the metric without
   matching IFC.

These are decoder boundaries, not presentation work. The audit shows no
evidence that more envelope heuristics, triangle inflation, or IFC `GlobalId`
copying would close the remaining parity gaps.

## “At least match the IFC” acceptance gates

The reference suggests staged gates that are strict enough to guide work:

1. **Product population:** 100% of the 36,144 uniquely tagged IFC products with
   geometry are represented, with every IFC class at 99% or better. Untagged IFC
   replicas are reported separately. Reviter now passes this gate.
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
- semantic JSON: `454f65adcd4b509bfd56974c0fe9f6c726862295d99438a8bc019fade689464e`
- semantic analytical payload, excluding volatile `stats.durationMs`:
  `9cf2e6daf75921062b3fd5a9bbfdd11e45e7fba72aacee1a1331f5c47972f748`
- GLB: `e1d8af479ce2f7d1b223cef482a080d00ad56c3c8788dc0b187a4b95881d7847`

The script exits nonzero on a missing or invalid input and writes the complete
measurement as JSON for future diffs.
