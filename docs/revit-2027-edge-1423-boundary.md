# Revit 2027 source slot 1423: GEdge boundary

This checkpoint resolves the exact class and static grammar of the edge
properties queued by Revit 2027 `Geometry`. The audit consumes the face
bodies that precede those edges in the dynamic FIFO; it does not position an
edge by scanning or adjacency.

## Exact identity

`BasicFileInfo` records `Format: 2027`. The exact `Formats/Latest` recursive
definition at byte 170,503 is:

| Schema layer | Tag |
| --- | ---: |
| `Edge` | 1,424 |
| `GEdge` | 1,425 |
| `GEdgeBase` | 1,426 |

The independently decoded `Geometry.m_pEdges` field queues 426,393
descriptors, and every descriptor names source slot 1,423. `TB_Geometry`
defines:

```text
OdBmGeometry::setEdges(
  OdArray<OdSmartPtr<OdBmGEdge>, ...> const&
)
```

This typed ownership link identifies slot 1,423 as `GEdge`; it is not a
same-number lookup in the Revit 2026 source table. The available Revit 2026
reader at `TB_Format2026Readers.tx+0x10d0eb4` corroborates field order only.

## Complete schema grammar

The exact 2027 schema declares:

```text
m_pFace                   fixed 2 references
m_next                    fixed 2 references
m_prev                    fixed 2 references
m_interiorEdgePnts        dynamic EdgePnt array
m_firstAndLastEdgePnts    fixed 2 EdgePnt values
m_flags                   uint8
```

`EdgePnt` contains `uv`, a fixed pair of double-precision 2D points. One
`EdgePnt` is therefore 32 bytes.

Static inspection of the native GEdge reader independently shows:

- inherited `GNode` first;
- three fixed two-item `int32` collection readers;
- `OdBmCollectionReader<OdArray<OdBmEdgePnt>>::read`;
- two fixed `OdBmEdgePnt` reads;
- `OdUInt8Reader`;
- the corresponding `setFaces`, `setNext`, `setPrev`,
  `setInteriorEdgePnts`, `setFirstAndLastEdgePnts`, and `setFlags` calls.

The complete selector-free body is:

```text
GInfo                                  20 bytes
face reference tokens                  2 * int32
next-edge reference tokens             2 * int32
previous-edge reference tokens         2 * int32
interior EdgePnt count                 int32
interior EdgePnt values                count * 32 bytes
first and last EdgePnt values           2 * 32 bytes
flags                                  uint8
```

The minimum body is 113 bytes; each interior point adds 32 bytes.
`decodeRevit2027GEdgeStatic` is release-gated, bounds the count and complete
body, preserves signed reference tokens, and returns zero queued child
properties. It does not resolve pointers, faces, loops, or curves.

## Exact UNBC body replay and fail-closed boundary

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-edge-1423.ts model.rvt
```

The broad certified Geometry census reports:

| Measure | Result |
| --- | ---: |
| Geometry static bodies reached | 20,963 |
| Initial / nested Geometry bodies | 13,568 / 7,395 |
| Edge-bearing Geometry bodies | 20,672 |
| Queued face descriptors | 117,054, all slot 1,825 |
| Queued edge descriptors | 426,393, all slot 1,423 |
| Edge-bearing bodies with no preceding face | 0 |
| Direct outer slot-1,423 descriptors | 0 |
| Failed partition chunks | 0 of 3,666 |

Exact body replay is narrower than that census. It accepts only a root whose
dynamic queue is either one direct `Geometry`, or one `GGroup` containing
exactly one `Geometry`. The UNBC file contains 5,996 accepted direct roots and
no accepted single-group roots. Of these owners, 5,815 contain edges.

For each accepted root the audit:

1. validates every positive FIFO append token;
2. treats token `-1` as queued without advancing the positive-token vector;
3. decodes all slot-1,825 Face bodies;
4. appends every Face child behind the Geometry-owned queue; and
5. decodes the pre-existing slot-1,423 edge bodies before any Face child.

This positions and decodes 84,499 of 84,499 declared GEdge bodies (100%) after
decoding 40,961 of 40,961 preceding Face bodies (100%). There are no replay,
token, Face, or GEdge failures.

The exact Face static-body sizes encountered were:

| Body bytes | Bodies |
| ---: | ---: |
| 58 | 485 |
| 60 | 5,069 |
| 62 | 35,407 |

All 40,961 Faces declared zero face regions. Their appended child descriptors
had this exact source-slot/token distribution:

| Child source slot | Numbered | `-1` sentinel | Total |
| ---: | ---: | ---: | ---: |
| 634 | 40,813 | 0 | 40,813 |
| 900 | 0 | 10 | 10 |
| 1,144 | 0 | 136 | 136 |
| 1,434 | 40,448 | 0 | 40,448 |
| 1,437 | 22 | 0 | 22 |
| 2,253 | 35,413 | 0 | 35,413 |
| 4,283 | 0 | 2 | 2 |

GEdge declares no queued child property. Its exact body-size/interior-point
distribution in the accepted roots was:

| Body bytes | Interior points | Bodies |
| ---: | ---: | ---: |
| 113 | 0 | 84,097 |
| 145 | 1 | 16 |
| 177 | 2 | 12 |
| 209 | 3 | 10 |
| 273 | 5 | 119 |
| 337 | 7 | 4 |
| 369 | 8 | 10 |
| 401 | 9 | 8 |
| 433 | 10 | 28 |
| 465 | 11 | 63 |
| 529 | 13 | 6 |
| 593 | 15 | 2 |
| 625 | 16 | 2 |
| 689 | 18 | 8 |
| 721 | 19 | 10 |
| 753 | 20 | 10 |
| 785 | 21 | 14 |
| 817 | 22 | 12 |
| 849 | 23 | 10 |
| 881 | 24 | 6 |
| 977 | 27 | 4 |
| 1,009 | 28 | 4 |
| 1,073 | 30 | 2 |
| 1,137 | 32 | 3 |
| 1,169 | 33 | 13 |
| 1,393 | 40 | 10 |
| 1,521 | 44 | 2 |
| 1,617 | 47 | 8 |
| 1,777 | 52 | 2 |
| 2,193 | 65 | 2 |
| 2,289 | 68 | 2 |

Every observed size satisfies `113 + 32 * interiorPointCount`, so the
TypeScript reader is now schema-, native-, and exact-corpus-certified within
this conservative 5,996-root replay scope.

The audit also validates decoded values rather than relying on body lengths
alone. Across all endpoints and interior points it reads 697,844 UV scalars:

| UV scalar class | Count |
| --- | ---: |
| Finite | 697,844 |
| NaN | 0 |
| Positive / negative infinity | 0 / 0 |
| Positive / negative zero | 260,404 / 2,437 |
| Extreme finite sentinel candidates (`abs(value) >= 1e300`) | 0 |

The observed finite range is
`[-224.3879210266375, 317.4694035968442]`. Extreme finite values are reported,
not rejected: the threshold is an audit category, not a validity rule. This
corpus contains no such value, and the reader does not reject a native UV
sentinel merely because it is unusual.

Each reference field contributes exactly two signed `int32` values per edge.
Their observed distributions are:

| Reference pair | Tokens | `-1` | Zero | Positive | Other negative | Range | Distinct |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Face | 168,998 | 0 | 1,195 | 167,803 | 0 | 0–129 | 127 |
| Next edge | 168,998 | 0 | 3,759 | 165,239 | 0 | 0–636 | 580 |
| Previous edge | 168,998 | 0 | 3,759 | 165,239 | 0 | 0–636 | 580 |

The machine-readable audit additionally emits the 20 most frequent exact
tokens for each reference pair. The exact one-byte flags distribution is:

| Flags | Bodies |
| ---: | ---: |
| 6 | 62,775 |
| 7 | 21,352 |
| 14 | 326 |
| 15 | 46 |

Native accessors give those bits exact meaning for this hashed build:

- bit 0: `OdBmGEdgeImpl::isFlipped()`;
- bit 1: first endpoint is set;
- bit 2: last endpoint is set;
- bit 3: the edge is a 3D arc.

`OdBmBrEdge::getOrientToCurve()` is always forward, while
`OdBmBrEdge::isOrientToLoop()` combines bit 0 with the face-reference side.
The directed sample order is forward exactly when the flip bit equals whether
the current Face occupies `faceReferences[1]`. Consequently `0x6` and `0xe`
have identical loop orientation; their only difference is the 3D-arc bit.

Native traversal also resolves the two next/previous arrays without an
endpoint-order inference:

- `OdBmBrCoedge::GetNext()` at `TB_Database.tx:0x22210a8` obtains the
  coedge's loop Face, compares it with `GEdge.faces[0]` and `[1]`, and passes
  that exact side index to `GEdge.getNextItem()`;
- `OdBmBrCoedge::GetPrev()` at `0x2221208` does the same with
  `GEdge.getPrevItem()`;
- `GEdge.getNextItem()` at `TB_Geometry.tx:0x413f0a` directly indexes the
  internal two-pointer next array, while `getPrevItem()` at `0x413f3e`
  directly indexes the previous array;
- `OdBmGEdgeImpl::getNextInLoop()` at `0x3465a8` and
  `getPrevInLoop()` at `0x3465c6` independently expose the same side-indexed
  arrays.

Therefore `nextReferences[faceSide]` and
`previousReferences[faceSide]` are the exact native coedge neighbors. The
browser owner paths share this rule and validate that the final previous
reference closes back to the loop sentinel.

These value domains, the paired next/previous population, the UV values, and
the `113 + 32n` boundary agreement independently support the field grammar.
The audit stops after the Geometry-owned GEdge run, before Geometry
shared-surface bodies and the Face-owned loop, filling, and surface bodies.

## Native tessellator handoff

The supplied native layer explains why the decoded fields matter:

- `TB_Geometry` evaluates GEdge UV data on adjacent faces and exposes the
  underlying 3D curve;
- `libTD_Ge` exports `tesselateCurve3d`;
- `libOdBrepModeler` owns and merges modeler edges;
- `libTD_BrepBuilder` adds 3D edges, 2D coedges, loops, and faces;
- `libTD_Br` traverses BRep edges and loop-edge incidence;
- `libTD_BrepRenderer` validates/strokes edges and builds trimmed face loops.

Those native binaries are semantic and call-order evidence, not browser
dependencies. A web implementation still needs the face/surface reader,
reference resolution, analytic 2D/3D curve evaluation, loop orientation, and
tolerance-controlled tessellation in TypeScript or WebAssembly.

The IFC oracle contains 9,371 `IFCFACETEDBREP`, 93,749 `IFCFACE`, and 93,874
`IFCPOLYLOOP` records. RVT GEdge bodies are now decoded in the certified
scope, but their Face references and Face-owned loops/surfaces are not yet
resolved or assembled. This checkpoint therefore still produces zero
IFC-comparable shells or triangles.
