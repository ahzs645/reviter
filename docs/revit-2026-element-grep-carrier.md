# Revit 2026 element-to-geometry carrier

This note records the smallest proven persisted ownership carrier between a
Revit element and its geometry representation. It is based on clean-room
static inspection of the locally supplied reader modules and bounded probes of
the exact UNBC RVT. No native ODA code was executed.

## Proven slot-1,479 reader

`TB_Format2026Readers.tx` contains:

```text
CustomDirectReader<..., 1479, OdSmartPtr<OdBmElementAndGRep>>::read
```

at `0xf8da6e`. Its data reads, in order, are:

1. `ElementId201120260Reader::read`, followed by
   `OdBmElementAndGRepInternalImpl::setId`;
2. `OdBmCondInt16Reader::read` for the element property; and
3. `OdBmCondInt16Reader::read` for the GRep property.

`TB_Main.tx` independently exposes `setElement`, `setGRep`, and `setId` on the
same implementation. The complete inline body is therefore:

```text
u64 elementId
CondInt16 element
CondInt16 gRep
```

Each conditional descriptor is an `i32` token followed, when nonzero, by an
`i16` source-class slot. The two pointed-to objects are not inline. They are
replayed later by `OdBmDynamicQueue`, keyed by object identity, class-property
identity, and sequence index.

`decodeRevit2026ElementAndGRepStatic` implements this exact inline grammar. It
does not infer an outer boundary or replay the two pointers.

## Other persisted carriers

The exact slot-2,207 `GRep` reader supplies an independent ownership check. It
reads `GGroup`, two 48-byte double-precision extents, an `i64` element ID,
`i32` object type, and `u32` flags. In the exact UNBC model, independently
length/echo-framed `0x08c6` roots parse with the same element ID in the GRep
tail. This makes the element-to-GRep association real even before child
geometry replay is complete.

`ContentElemRecPointers` at release slot 928 is a compact-storage index, not an
inline geometry owner. Its reader consumes, in order:

```text
CondInt16 elementHeader
u64 elementId
SerializableCompactMemoryPointer compactElement
SerializableCompactMemoryPointer compactGRep
i32 episodeKingId
```

Common slot 5,791 proves that each compact pointer is only two `i32` parts.
The supplied binaries expose no browser-safe rule that turns those parts into
a partition byte offset, so they cannot yet locate a GRep body.

`GeomTabEntry` is also not an ownership bridge in this release. Although the
schema names both `m_pGNode` and `m_geomGeneratorId`, common slot 5,412 reads
only one `i32` generator ID. The GNode field is transient or reconstructed by
another layer.

## Exact-model replay boundary

At every proven `0x08c6` GRep root the static end is computable after:

```text
GInfo (20 bytes)
counted CondInt16 child descriptors
two extents (96 bytes)
elementId + objectType + flags (16 bytes)
```

A bounded run on the current workspace tree found 63,820 ID-matching roots.
Of those, 41,506 have a one-entry top-level child queue. Across all roots:

- no direct child descriptor names release slot 2,237 `GPolyMesh`;
- no selector-free GPolyMesh static body with a slot-5,255 topology
  descriptor begins at the exact GRep static end; and
- every root has remaining dynamic data after the static end (minimum 32
  bytes, median 140 bytes).

This is a useful negative boundary. The GRep frame supplies a genuine owner
and exact replay start, but the top-level children are intermediate geometry
nodes. `DynamicQueue` token/retained-data behavior and their static readers
must be reproduced before a nested `GPolyMesh` can be reached.

One tempting raw pattern was rejected explicitly. A small number of byte spans
look like:

```text
live u64 id | token -1 | slot 754 | token 1 | slot 2206/2207
```

They occur at a fixed relative position inside marker-756 relation rows. The
supposed second source slot is merely the low 16 bits of the following element
ID, which increments across adjacent rows. They are not slot-1,479 objects.
Likewise, neither the partition nor `Global/ContentDocuments` supplies a
live-element candidate after a serialized raw slot-1,479 occurrence.

The remaining safe path is:

1. enter slot 1,479 or a framed GRep through a proven outer dispatch;
2. retain the exact `DataKey` for both conditional properties;
3. reproduce `initReferences` and token/retained-data resolution;
4. replay intermediate GNode classes until a scoped slot-2,237 child is
   reached; and
5. only then decode and bind its queued slot-5,255 topology body.
