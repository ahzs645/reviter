# Revit 2027 compound-structure material carrier

This checkpoint recovers the persisted wall-type material carrier without
Revit, IFC, ODA, or a server runtime:

```text
placed element
  -> persisted typeId
  -> BasicWallType / HostObjAttr
  -> CompoundStructure.m_layers
  -> CompoundStructureLayer.materialId
  -> framed MaterialElem
```

The decoder is browser-safe TypeScript in
`lib/reviter/compound-structure-materials.ts`. IFC is used only by
`scripts/audit-rvt-compound-materials.ts`, as an offline accuracy oracle.

## Proven static grammar

The supplied RVT's embedded `Formats/Latest` stream identifies
`BasicWallType` as schema tag 625. Partition object headers persist tag minus
one, so the decoder accepts only framed objects with marker `0x0270` and only
when the selected Revit release is 2027.

Inside the inherited `HostObjAttr.m_pCompoundStructure`, the exact
`CompoundStructure.m_layers` field selector is:

```text
ff ff ff ff ab 11
u32 layerCount
layer[layerCount]
```

Each layer has a fixed 41-byte stride, matching the embedded field graph:

| Offset | Width | Field |
| ---: | ---: | --- |
| 0 | 8 | `f64 m_layerWidth` in feet |
| 8 | 8 | `u64 m_materialId` |
| 16 | 8 | `u64 m_profileId` |
| 24 | 4 | `i32 m_layerFunction` |
| 28 | 4 | `i32 m_layerPriority` |
| 32 | 4 | `i32 m_embeddingType` |
| 36 | 4 | `i32 m_layerId` |
| 40 | 1 | `bool m_layerCapFlag` |

The UNBC file contains 45 framed `BasicWallType` compound structures and 51
layers. Forty-four structures resolve to real `MaterialElem` IDs. The remaining
structure contains the exact persisted unassigned state—null material and
profile, function 0, priority 999—and deliberately produces no assignment.

The decoder fails closed on the wrong release or class marker, multiple layer
selectors, an invalid count or extent, malformed 64-bit IDs, non-finite widths,
invalid function/priority combinations, non-default embedding, non-sequential
layer IDs, invalid cap flags, unresolved non-null material IDs, duplicate type
definitions that disagree, or conflicting element-to-type references.

## Exact UNBC audit

Run:

```sh
node --experimental-strip-types scripts/audit-rvt-compound-materials.ts \
  --rvt "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt" \
  --ifc "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc" \
  --json /tmp/unbc-compound-materials.json
```

The audit scans all inflated partition chunks, resolves 69 native material
definitions, 45 compound definitions, and 9,381 persisted element-to-type
references. Forty-four material-bearing wall types assign 7,525 placed
elements. All 7,525 are new relative to the existing shared-geometry carrier;
7,515 of those IDs are also material-assigned in the paired IFC.

Adding this carrier to the current 25,607 native placed-element assignments
projects 33,132 distinct RVT-assigned elements. Of those, 33,048 are in the
IFC material population. The comparison uses unique numeric Revit Tags because
that is the common identity domain:

- IFC material-assigned elements by IFC express ID: 36,221
- material-assigned IFC rows carrying numeric Revit Tags: 36,219
- distinct material-assigned numeric Revit Tags: 36,142
- projected matched Tags: 33,048, or 91.44%
- IFC-only Tags remaining: 3,094
- projected RVT assignments outside the IFC material set: 84

The 36,221 express-ID count remains the whole IFC population baseline. The
36,142-Tag denominator is the defensible parity denominator for a join to
native Revit element IDs; missing and duplicate IFC Tags account for the
difference.

## What this does and does not establish

This establishes exact persisted wall-type layer membership, layer width,
function, and material identity for the supported subset. It does not yet
choose a material for a particular BRep face or emitted triangle.

The native `TB_HostObj` symbols corroborate the intended next join:

- `OdBmHostObjAttr::getCompoundStructure`
- `OdBmCompoundStructureLayer::getMaterialId`
- `OdBmCompoundStructureLayer::getLayerFunction`
- `OdBmCompoundStructureImpl::getMaterialsForSideFace`

The last operation depends on topology and host-side semantics. Likewise,
`TB_Geometry`, `libTD_Ge`, `libOdBrepModeler`, `libTD_BrepBuilder`, and
`libTD_Br` form a native solid-modeling/tessellation kernel. Their presence
confirms where Revit's parametric BRep becomes drawable triangles, but their
native ABI is not a client-side TypeScript reader and cannot be treated as one.

The remaining boundary is therefore explicit: decode or independently
reimplement the persisted BRep/topology grammar, reproduce side/cap/cut face
classification, and only then attach these proven layer materials to exact
faces and tessellated triangles. Until that boundary is crossed, the
7,525-element result is an element/type material carrier, not a claim of exact
face material assignment or general BRep tessellation.
