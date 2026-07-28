# Revit 2027 Face static-body boundary

## Result

The exact UNBC `Formats/Latest` stream and the local native reader agree that
Revit 2027 source slot 1,825 is persisted `Face`. Its selector-free static
body is now decoded by
`lib/reviter/revit-2027-face-static.ts`.

This advances the proven browser-side route to:

```text
framed GRep owner
  -> Geometry / GBRep
    -> owned Face
      -> queued first loop
      -> queued face regions
      -> queued foreground/background filling
      -> render-style ElementId
      -> queued analytic surface
```

It does not decode those queued child bodies, assemble a BRep, or emit
triangles.

## Exact Revit 2027 schema

The supplied model's `Formats/Latest` stream contains this ordered source
ladder:

| Source slot | Record | Offset |
| ---: | --- | ---: |
| 1,822 | `FabricationSettings` | 224,859 |
| 1,823 | `FabricationSettingsElement` | 224,926 |
| 1,824 | `FabricationShapeSecondaryData` | 225,002 |
| 1,825 | `Face` | 225,216 |
| 1,826 | `GFace` | 225,226 |

The slot-1,825 record is a high-bit `Face` definition with raw class word
`0x8722`. It embeds `GFace` class word `0x0592`, version 10:

```text
GFace.m_pFirstLoop            0e 01 00 00
GFace.m_faceRegions           0e 51 00 00
GFace.m_pGFilling             0e 01 00 00
GFace.m_oBackgroundFilling    0e 01 00 00
GFace.m_renderStyleId         0e 00 00 00 14 00
GFace.m_cutType               04 00 00 00
GFace.m_faceFlags_v9          05 00 00 00
```

The derived `Face` layer is version 6 with one field:

```text
Face.m_pSurf                  0e 01 00 00
```

The source slot, schema class word, and runtime class are separate identities;
the reader never substitutes one for another.

## Native reader and queue order

The isolated bundle supplies the loader and runtime geometry kernels. The
matching local Revit 2026 format-reader module supplies the independently
inspectable release reader:

| Evidence | SHA-256 |
| --- | --- |
| `TB_Format2026Readers.tx` | `09d1867c1aaea3653c750fb015fa17838e71da8ad0c52a9de834de920b644e0f` |
| `TB_LoaderBase.tx` | `56c066e2f308dcff123adfe37edaeb6f51cfa67dad8772ee7f804dbc01f4ae56` |
| `TB_Geometry.tx` | `4f93e3753f3011145063d649c474dd957ade06910dd3f21b9f41512192cfcf5f` |
| `libTD_Ge.so` | `bd8821c698f1217df6726efcfe57b45011ebf5ed855f95a77d5ff539022a0c7b` |
| `libOdBrepModeler.so` | `f9ac29574c44060f1e1b5de4c44c9e4110e711d1cb37c79f80d395490b262562` |
| `libTD_BrepBuilder.so` | `23a9481d1d36649b4a230c6e72949ba8a338e80a450b4e6c699ea1f17f77e0e7` |
| `libTD_Br.so` | `c32a077404815e652cd1b55ac44754c8081e6f7c2313c753c423c7ee1ff82e4c` |

The Revit 2026 source reader is slot 1,775, shifted to exact-model Revit 2027
slot 1,825 by the intervening source records. Its call order is:

```text
Face reader 0x100b9d0
  -> GFace reader, source 1776                 0x100bdf3
  -> Face.m_pSurf CondInt16                    0x100bee2

GFace reader 0x10cc250
  -> GNode/GInfo                               0x10cc693
  -> m_pFirstLoop CondInt16                    0x10cc799
  -> m_faceRegions collection<CondInt16>       0x10cc91c
  -> m_pGFilling CondInt16                     0x10cca3d
  -> m_oBackgroundFilling CondInt16            0x10ccafd
  -> m_renderStyleId ElementId                 0x10ccb79
  -> m_cutType int32                           0x10ccc04
  -> m_faceFlags_v9 uint32                     0x10ccc31
```

`OdBmCondInt16Reader::read` in `TB_LoaderBase.tx` reads an `int32` token and,
when nonzero, an `int16` source slot before calling
`OdBmDynamicQueue::addProperty`. Token zero is null. Token `-1` is a real
queued-property sentinel, but does not advance the positive numbered-token
namespace. The exact audit preserves both properties:

- every nonzero descriptor remains in FIFO body order;
- only positive tokens advance the next expected numbered token.

This distinction is required to traverse the exact model without inventing a
boundary.

## Browser-safe reader

`decodeRevit2027FaceStatic` is:

- release-gated to Revit 2027;
- bounded by its enclosing replay envelope;
- bounded independently for the face-region collection;
- exact about the 64-bit ElementId and signed/unsigned scalar fields;
- explicit about null, numbered, and negative-one conditional descriptors;
- stopped immediately after `Face.m_pSurf`.

The reader returns the conditional descriptors in native append order. It
does not inspect or infer the length of any queued child body.

## Exact UNBC audit

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-face-static.ts \
  "UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"
```

The audit deliberately selects only roots whose existing FIFO contains a
single initial `Geometry`. In that shape, Geometry appends all faces before
edges, and each Face appends its children behind the already queued faces and
edges. Therefore every declared Face body is contiguous and independently
positioned without decoding an unrelated sibling.

| Measure | Result |
| --- | ---: |
| Partition chunks decoded | 3,666 |
| Failed chunks | 0 |
| Single-Geometry roots | 5,996 |
| Geometry owners with faces | 5,815 |
| Geometry owners without faces | 181 |
| Slot-1,825 faces declared | 40,961 |
| Face static bodies decoded | 40,961 |
| Scoped Face coverage | 100% |
| Replay failures | 0 |
| Face body sizes | 58, 60, or 62 bytes |
| Non-empty face-region collections | 0 |
| Nonzero cut types | 0 |
| Distinct render-style ElementIds | 31 |

Face flags are:

| Face flags | Occurrences |
| ---: | ---: |
| 4 | 37,121 |
| 6 | 3,807 |
| 516 | 33 |

Optional-property presence is:

| Property | Set | Null |
| --- | ---: | ---: |
| First loop | 40,470 | 491 |
| Foreground filling | 35,413 | 5,548 |
| Background filling | 0 | 40,961 |
| Surface | 40,961 | 0 |

The 116,844 owned child descriptors are:

| Source slot | Numbered | `-1` sentinel | Total |
| ---: | ---: | ---: | ---: |
| 634 | 40,813 | 0 | 40,813 |
| 900 | 0 | 10 | 10 |
| 1,144 | 0 | 136 | 136 |
| 1,434 | 40,448 | 0 | 40,448 |
| 1,437 | 22 | 0 | 22 |
| 2,253 | 35,413 | 0 | 35,413 |
| 4,283 | 0 | 2 | 2 |

Those numeric slots are retained as numeric source identities until each
release-specific target and body reader is independently certified.

The broader Geometry audit reaches 117,054 Face descriptors. This checkpoint
decodes 40,961 of them (34.9933%) because only the single-Geometry owner shape
has a child-free FIFO prefix. The other descriptors are not malformed; they
remain behind still-uncertified sibling bodies.

## Tessellator and IFC parity

The native runtime corroborates what must happen after deserialization:

- `TB_Geometry` exposes `OdBmFaceInternalImpl::setSurface/getSurface`,
  `OdBmGFaceInternalImpl::setRenderStyleId`, and filling setters;
- `libTD_Ge` supplies analytic surface and curve mathematics;
- `libTD_BrepBuilder` consumes an `OdGeSurface` in `addFace`, then adds loops
  and edges before `finish`;
- `libTD_Br` traverses BRep faces, loops, and edges and exposes face surface
  and material queries;
- `libOdBrepModeler` supplies solid-modeler operations after topology exists.

These binaries prove the runtime direction; they are not browser-compatible
RVT readers. The TypeScript path must first deserialize the queued surface,
loop, and edge objects, then build equivalent neutral topology before the
existing browser tessellator can run.

The IFC oracle contains 93,749 `IFCFACE` records and 9,371
`IFCFACETEDBREP`/`IFCCLOSEDSHELL` solids. The scoped 40,961 RVT Face bodies
are 43.6922% of the raw IFC face count, but this is not a parity percentage:
Revit can retain non-exported, duplicated, instance, or construction faces,
and IFC can split topology differently. This checkpoint still produces zero
of 9,371 IFC-equivalent tessellated solids.

The persisted `m_renderStyleId` is exact per Face, which materially improves
future material ownership. It is not yet an IFC material assignment. The
style elements and their material/category resolution remain undecoded, so
the route matches zero of the IFC's 14,768 styled items and 30 material
definitions.

## Remaining bounded transitions

The next work is constrained by the newly measured queue:

1. certify source slots 634, 900, 1,144, and 4,283 as the surface variants
   used by `Face.m_pSurf`;
2. certify source slots 1,434 and 1,437 as the first-loop variants;
3. certify source slot 2,253 filling and resolve its style/material semantics;
4. decode Geometry edge bodies and bind loops to their oriented edges;
5. assemble closed shells and only then invoke surface tessellation;
6. expand FIFO replay through the sibling classes that guard the remaining
   76,093 reachable Face descriptors.

Until those transitions are proven, queued bodies, modeler topology, exact
materials, and triangles remain intentionally unavailable.
