# UNBC GPolyMesh outer-object context audit

This is a bounded audit of the 4,893 raw little-endian slot-2,237 occurrences
and 3,463 following fixed-width shapes in the exact UNBC RVT. It asks only
whether an independently framed parent establishes a genuine
`ObjectPtrInitReader` boundary. IFC is not consulted by the probe.

## Exact framed-context result

`scanFramedElementObjects` applies the existing partition object gate: a
zero-high-word element id, bounded object length, and a trailer that echoes
that exact length. `scripts/audit-revit-2026-object-contexts.ts` then classifies
each raw slot without promoting containment or proximity to ownership.

| Measure | Exact result |
| --- | ---: |
| Inflated chunks / failed chunks | 3,666 / 0 |
| Raw slot-2,237 words | 4,893 |
| Raw words inside a framed element object | 1,211 |
| Raw words in framed payload bytes | 1,162 |
| Raw words outside a framed element object | 3,682 |
| Complete following fixed-width shapes | 3,463 |
| Fixed shapes inside a framed element object | 784 |
| Fixed shapes wholly inside that frame | 751 |
| Selectors exactly at framed payload start | 1 |
| Bodies ending exactly at framed object end | 0 |
| Full framed-payload static shapes | 0 |
| Shapes naming slot-5,255 topology | 0 |
| Certifiable outer GPolyMesh owners | **0** |

The single payload-start shape is a useful rejection control. It begins at
`Partitions/325` chunk 2,053, element 2,361,533, marker `0x08c6`, but its
48-byte parse ends at relative offset 74 in a 300-byte object. Its alleged
topology token is negative, its alleged topology slot is 24,494, and all three
alleged style/material ids exceed 32 bits. The frame proves the containing
element, not the child reader or the fixed-width interpretation.

Twelve fixed shapes happen to put a real `MaterialElem` id in the alleged
material field. All twelve have a null topology token; none has a resolving
GStyle id, and only four have a separately framed alleged interior-style id.
They occur at unrelated offsets in large records. This is the expected
multiple-comparisons control: target-id resolution alone cannot repair a
failed class layout.

The independently decoded `0x08c6` parent path reaches the same conclusion
from the positive side. `Formats/Latest` tag 2,247 identifies `GElement`, whose
wire selector is tag minus one. Of 63,782 framed `0x08c6` records, 63,692
decode as complete GRep roots, 63,359 carry two valid extents, and every
decoded GRep element id equals its frame id. Their observed child slots include
2,248, 2,215, 2,254, and 1,973, but never 2,237. This certifies the parent and
ownership path without certifying a GPolyMesh child.

The native dynamic-queue call graph explains why raw slot scanning remains
incomplete: a queued or statically scoped child supplies its class through
reader context, so replay need not serialize slot 2,237 again. The missing
piece is therefore a parent property whose schema/reader contract declares
GPolyMesh—not another nearby occurrence of the number 2,237.

## Highest-impact bounded material carrier

With topology still at zero certifiable candidates, the strongest next
persisted assignment path in the isolated evidence is host-object compound
structure, not a looser mesh scan.

The exact embedded `Formats/Latest` schema declares:

- `HostObjAttr` (tag 111, parent `Symbol`, version 3) with
  `m_pCompoundStructure`;
- `CompoundStructure.m_layers`, a collection of
  `CompoundStructureLayer`;
- each layer's `m_layerWidth`, `m_materialId`, `m_profileId`,
  `m_layerFunction`, `m_layerPriority`, `m_embeddingType`, `m_layerId`, and
  `m_layerCapFlag`.

The isolated `TB_HostObj.tx` exports the matching runtime contract:

- `OdBmHostObjAttr::getCompoundStructure()`;
- `OdBmCompoundStructure::getNumLayers()`, `getLayerWidth()`, and
  `getMaterialId()`;
- `OdBmCompoundStructureLayer::getMaterialId()`, `getLayerFunction()`, and
  `getLayerWidth()`;
- `OdBmCompoundStructureImpl::getMaterialsForSideFace(...)`;
- `OdBmCeilingAndFloorImpl::genFaceHistForRefPlaneGStep(...)`.

This carrier targets system-family walls, floors, ceilings, and roofs—the
largest semantic/material population not addressed by the current
instance-to-shared-geometry join. The current scene contains 9,336 walls, 67
floors, and 46 ceilings, compared with a remaining IFC assignment-count gap of
10,614 elements. Those counts establish priority, not an assumed join.

### Browser-safe implementation boundary

1. Extend the exact-release schema reader only far enough to publish the
   `HostObjAttr → CompoundStructure → layers` field graph. Do not infer field
   order from partition proximity.
2. Reproduce the nested object/collection reader for those three schema
   classes with bounded counts and exact end offsets.
3. Accept a layer material only when its 64-bit id resolves to a separately
   framed `MaterialElem`; require finite nonnegative width and known enum
   ranges for function/embedding fields.
4. Attach the decoded structure to its persisted type element, then use the
   existing exact element-to-type relation to publish ordered
   element/type-layer material assignments.
5. Keep layer assignment distinct from face assignment. Side-face precedence
   requires the later `getMaterialsForSideFace`/BRep mapping path.
6. Use IFC layer-set names, widths, and element Tags only as an offline
   precision/coverage oracle. No IFC value may enter conversion.

This path is implementable without native execution and can improve exact
material semantics before general BRep replay is solved. It does not claim
per-face tessellation or appearance assignment.

## Reproduce

```sh
node --experimental-strip-types \
  scripts/audit-revit-2026-object-contexts.ts \
  '/path/to/model.rvt'
```
