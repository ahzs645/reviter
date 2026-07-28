# Revit 2026 `GPolyMesh` reader boundary

This note records clean-room static analysis of the locally supplied Revit
2026 reader module and three mesh-shaped byte spans in the UNBC model. No
native ODA code was executed.

The inspected module is `TB_Format2026Readers.tx`, SHA-256:

```text
09d1867c1aaea3653c750fb015fa17838e71da8ad0c52a9de834de920b644e0f
```

Its delegated topology readers are in `TB_FormatCommonReaders.tx`, SHA-256:

```text
66a5f374dc87ae48600e71afe1061670f4a2eda779ecf9f5f419eb9fd4bb835b
```

## Exact release class mapping

Unstripped template instantiations in the module resolve release-specific
source-class slots that were not recoverable from `TB_LoaderBase.tx` alone:

| Source-class slot | Persisted/runtime reader |
| ---: | --- |
| 1,399 | `OdBmGNode` |
| 2,177 | `OdBmGBrep` |
| 2,210 | `OdBmGFakeBRep` |
| 2,215 | `OdBmGFlipControl` |
| 2,237 | `OdBmGPolyMesh` |

This proves that schema tag reference `1426` is not the partition selector for
these geometry classes. In particular, the exact `GPolyMesh` reader is
`CustomDirectReader<..., 2237, OdSmartPtr<OdBmGPolyMesh>>::read` at
`0x10e128c`.

The reader performs these data operations in order:

1. delegates inherited state to the source-class `1399` `GNode` reader;
2. reads `m_pFacetedTopology` through `OdBmCondInt16Reader`;
3. reads `m_interiorGStyleID` through `ElementId201120260Reader`;
4. reads `m_materialID` through `ElementId201120260Reader`;
5. reads `m_polyMeshFlags` through `OdInt32Reader`.

The 2026 fast element-ID reader calls `Identifier202420260Reader`, which calls
`OdUInt64Reader`. The two IDs are therefore unsigned 64-bit values in the
owner record.

## Why the topology body is separated from its owner

`OdBmCondInt16Reader::read` at `TB_LoaderBase.tx:0x1736dc` first consumes a
signed 32-bit condition. When the condition is nonzero it may also consume a
signed 16-bit source-class slot, then calls
`OdBmDynamicQueue::addProperty`. It does not inline-read the nested object.

Consequently, the topology body is replayed later by the dynamic queue. The
bytes immediately following a topology body are the next queued payload, not
the `GPolyMesh` style ID, material ID, and flags. The earlier observation that
two tails happen to begin with valid native element handles (`547662` and
`532606`) cannot establish ownership.

The bytes immediately before the three candidate spans are a complete counted
`OdBmCondInt16` collection. The exact item order is:

```text
int32 token | int16 source-class slot
```

The apparent `a7 08 | uint32` pattern was the same six-byte item viewed from
the wrong boundary. Reading from the counted collection start produces:

| Chunk | Count offset | Count | First run | Second run | Collection end |
| ---: | ---: | ---: | --- | --- | ---: |
| 2,953 | 32,787 | 694 | 5 × slot 2,248, tokens 279–283 | 689 × slot 2,215, tokens 284–972 | 36,955 |
| 3,002 | 2,262 | 110 | 4 × slot 2,248, tokens 20–23 | 106 × slot 2,215, tokens 24–129 | 2,926 |
| 3,169 | 9,516 | 26 | 4 × slot 2,248, tokens 62–65 | 22 × slot 2,215, tokens 66–87 | 9,676 |

The exact 2026 module maps slot 2,248 to `GStyle` and slot 2,215 to
`GFlipControl`. Neither is `GPolyMesh` (2,237) or common
`FacetedTopology8` (5,255). Those offsets are only the ends of nested counted
collections. They are not proven dynamic-replay boundaries.

This is stronger than a missing selector: `OdBmDynamicQueue::readProperties`
can satisfy retained values before consuming the stream, so a multi-entry
queue does not make later payload bytes adjacent to one determinable
descriptor. Derived readers can also continue reading static fields after a
base reader's collection. Both the complete outer static parse and the queue
state must be reproduced. Adjacency alone cannot bind a body.

## `FacetedTopology8` body grammar

The runtime inheritance chain is:

```text
FacetedTopologyImplmnt
  -> FloatNormalsFacetedTopology
  -> FloatFacetedTopology
  -> FacetedTopology0
  -> FacetedTopology8
```

The common reader module makes that delegation executable rather than merely
nominal:

| Common source slot | Direct reader action |
| ---: | --- |
| 5,345 | reads `int32` normals flag, float common normal, counted normals |
| 5,344 | delegates to 5,345, then reads counted float points |
| 5,204 | delegates to 5,344, then reads counted u16 facet rows |
| 5,255 | delegates to 5,204, then reads counted u8 edge flags |

Together with the exact `Formats/Latest` fields, that establishes this
selector-free body:

| Field | Encoding |
| --- | --- |
| `m_normalsFlag` | signed little-endian `int32` |
| `m_commonNormal` | three little-endian `float32` values |
| `m_normalsArr` | signed `int32` count + `float32[count][3]` |
| `m_pointsArr` | signed `int32` count + `float32[count][3]` |
| `m_facetsArr` | signed `int32` count + `uint16[count][3]` |
| `m_edgeVisFlagsArr` | signed `int32` count + `uint8[count]` |

Three UNBC spans validate against that grammar: they start at normals mode `2`,
contain one apparent normal per apparent triangle, and contain one apparent
edge-visibility byte per apparent triangle:

| Chunk / body start | Normals | Vertices | Triangles | Body end |
| --- | ---: | ---: | ---: | ---: |
| 2,953 / 36,955 | 144 | 144 | 144 | 41,451 |
| 3,002 / 2,926 | 26 | 20 | 26 | 3,692 |
| 3,169 / 9,676 | 104 | 104 | 104 | 12,932 |

`locateFacetedTopology8Body` implements exactly this bounded shape validator.
It requires the mode and cardinalities, validates the complete mesh, and
returns the exact end offset. The counted queue proof above demonstrates why
that result is not itself proof that a span is a topology body.

`bindQueuedFacetedTopology8` adds a fail-closed ownership gate. It only binds
when:

1. the registry has exactly one dynamic property in the complete outer queue;
2. the caller has reproduced the complete outer static-object
   boundary and retained DynamicQueue `DataKey` state;
3. the certified individual `CondInt16` descriptor bytes match its token,
   source-class slot, and exact end;
4. replay starts at the complete outer boundary after all inline fields;
5. no retained value precedes the selected entry;
6. that descriptor is common source slot 5,255 and its token matches the
   retained `GPolyMesh` topology property;
7. the owning record was entered as Revit 2026 source slot 2,237;
8. owner, 64-bit style/material IDs, signed flags, and affine transform are
   all supplied and valid; and
9. the complete topology body validates.

None of the three UNBC spans has a proven outer slot-2,237 dispatch or a
registry-issued replay certificate. Reviter therefore does not emit them as
owned geometry.

## Exact-model target-slot audit

A bounded scan was run over every one of the 3,666 inflated partition chunks
in the exact UNBC RVT. It considered signed collection counts from 1 through
10,000 and required every nonzero item to have a positive source-class slot
no greater than 6,000.

Raw 16-bit byte matches were common and not useful: slot 2,237 occurred 4,893
times and slot 5,255 occurred 1,347 times. Only 40 complete
counted-`CondInt16` shapes contained either target:

| Target slot | Complete collection-shaped matches | Contains both target slots |
| ---: | ---: | ---: |
| 2,237 `GPolyMesh` | 39 | 0 |
| 5,255 `FacetedTopology8` | 1 | 0 |

Thirty-seven of the slot-2,237 shapes are incompatible with a plausible
positive property token. The two remaining count-one shapes are:

| Chunk | Count offset | Token | Source slot | Collection end |
| ---: | ---: | ---: | ---: | ---: |
| 1,389 | 82,716 | 300 | 2,237 | 82,726 |
| 2,053 | 111,269 | 300 | 2,237 | 111,279 |

Interpreting the following bytes with the exact `GPolyMesh` static grammar
does not yield a topology reference: in both cases the inherited `GNode`
prefix is followed by a zero conditional token. Treating either collection
end as a `FacetedTopology8` body also fails the normals-mode validation.

The sole complete slot-5,255 shape is chunk 223 at count offset 47,659. It has
count 1, token -1, collection end 47,669, and the following bytes fail the
same topology validator. Its surrounding bytes are consistent with a
schema/layout table rather than a model object.

A second scan requiring at least two positive property tokens, each no greater
than 100,000 and increasing by one, found 161,333 collection-shaped sequences
and none containing slot 2,237 or 5,255. This is a bounded negative result, not
proof that the classes are absent: the native queue is keyed by retained
object/property state, and the relevant source slots need not appear as an
isolated counted collection that a byte scan can recognize.

The audit is reproducible without native execution:

```sh
node --experimental-strip-types scripts/audit-dynamic-geometry-queue.ts model.rvt
```

## Remaining ownership bridge

Static reader inspection establishes the outer geometry path that the queue
replay must preserve:

| Source slot | Reader contract relevant to ownership |
| ---: | --- |
| 1,399 `GNode` | reads `GInfo`: style element ID, tag, control command, flags |
| 2,208 `GGroup` | reads `GNode`, then a dynamic-count array of conditional `GNode` children |
| 2,207 `GRep` | reads `GGroup`, two double-precision bounds, `int64` element ID, `int32` object type, `uint32` flags |
| 2,175 `GInstance` | reads `GNode`, two conditional nested properties, tag element ID, target data, and instance flags |
| 2,174 `GArray` | reads `GInstance`, a `Trf201120260Reader` matrix, and `int32` instance count |

`GRep` is therefore the nearest proven persisted owner of a group/tree and its
element ID. `GInstance` and `GArray` are the proven transform-bearing branches
that can alter a descendant mesh's placement. A mesh cannot be compared with
IFC coordinates until both the child path to its `GRep` and every intervening
instance/array transform have been replayed.

`Trf201120260Reader::read` at `TB_LoaderBase.tx:0xe70c4` establishes a
96-byte transform body:

```text
float64 xAxis[3]
float64 yAxis[3]
float64 zAxis[3]
float64 origin[3]
```

The native reader constructs a coordinate system, transposes its basis, and
places the origin in the translation terms. `decodeTrf201120260` returns the
equivalent browser column-major affine matrix. It rejects truncation,
non-finite values, and a singular basis.

## Proven outer replay boundary

The call site that separates static initialization from dynamic replay is
`OdBmObjectPtrReader::read` in `TB_LoaderBase.tx` at `0x181320`. Its relevant
order is:

1. construct `OdBmDynamicQueue` (`0x1813b5`);
2. call `OdBmObjectPtrInitReader::read` (`0x1817ef`), which traverses the
   complete outer static object graph;
3. call `OdBmDynamicQueue::initReferences` (`0x181994`);
4. call `OdBmDynamicQueue::readDynamicProperties` (`0x1819c5`).

This proves why the end of a `GGroup` child collection cannot be used as the
replay offset. The derived `GRep` reader still reads both bounds, its element
ID, type, and flags after returning from `GGroup`.

The retained state is also more specific than a serialized token.
`OdBmDynamicQueue::addData` at `0x173d62` constructs a `DataKey` from the
current `ValueDisposition`: object identity, `OdBmClassProperty` identity,
and sequence index (initially -1). `dataLeft` at `0x173966` performs an
RB-tree lookup by that key. `readProperties` at `0x17604a` branches on that
lookup: depending on pair/sequence state it reads and merges another property
part or stores newly read data for later resolution. `assignValue` at
`0x173906` applies a resolved value through the retained class property.
Therefore neither “one descriptor equals the next body” nor “a retained value
always skips bytes” is a valid general shortcut.

The smallest unresolved layer is therefore not another byte signature. It is
a browser representation of the outer reader and its stateful queue:

1. reproduce `OdBmObjectPtrInitReader::read` far enough to enter a
   `GPolyMesh` through source-class slot 2,237;
2. preserve stable surrogate object/property identities and sequence indexes
   for every `ValueDisposition`;
3. reproduce `initReferences`, retained-value lookup, queue ordering, and
   stream advancement until the topology property's `DataKey` is selected;
4. associate the selector-free slot-5,255 body with that retained
   `GPolyMesh`;
5. only then attach the owning `GRep` element, transforms, style, and
   material.

## Browser surrogate checkpoint

The corresponding loader in `BmJsonExportEx-isolated` has SHA-256:

```text
56c066e2f308dcff123adfe37edaeb6f51cfa67dad8772ee7f804dbc01f4ae56
```

Its symbols corroborate the boundary above and add three implementation
constraints:

- `OdBmObjectPtrInitReader::read` at `0x180cda` either uses an already scoped
  class or reads an `int16` source-class slot, resolves the class, obtains its
  reader factory, and invokes that reader;
- `OdBmDynamicQueue::addProperty` at `0x17359a` copies the current object,
  class-property, and sequence disposition into an ordered property list;
- `addData`, `dataLeft`, `readProperties`, and `readDynamicProperties` retain
  an RB-tree of values keyed by that three-part identity and include merge,
  pair, sequence, and reference-resolution paths.

`SurrogateObjectPropertyRegistry` now implements the smallest safe browser
subset of this state. During a static traversal it records:

1. stable surrogate object identities with their exact source-class slots;
2. stable class-property identities with their declaring source class;
3. ordered dynamic-property descriptors carrying the exact three-part
   `DataKey`, token, source-class slot, and descriptor byte range;
4. any observed retained-value presence.

The registry can be sealed only at the complete outer static end, then moved
through an explicit reference-initialization phase. It issues an in-process
`DynamicQueueReplayCertificate` only if:

- every object, parent, property, and queued `DataKey` identity resolves;
- replay begins exactly at the sealed outer static end;
- exactly one property exists in the entire queue;
- its sequence index is -1; and
- no retained values were observed.

The certificate is checked by identity, not merely by object shape, before
`bindQueuedFacetedTopology8` will inspect topology bytes. A plain object with
the same fields is rejected. The binder also cross-checks the certified
object slot 2,237, declaring property slot 2,237, queued property slot 5,255,
and property token against the counted descriptor. After the complete
topology body validates, the registry advances the certificate from the exact
replay offset to the decoded body end. Certificates are single-use, so one
owner/property proof cannot be attached to a second byte span.

This checkpoint deliberately does not implement native pair joining,
sequence reconstruction, reference tokens, retained-data merging, or
multi-property replay. Those paths cannot mint a certificate and therefore
cannot emit geometry.

The exact UNBC audit still finds no certifiable slot-2,237/slot-5,255 owner.
The three mesh-shaped spans remain rejected. The release-scoped feed below
adds one exact class reader but does not invent the missing outer-object
position.

## Release-scoped dispatch checkpoint

`dispatchRevit2026ObjectPtrInit` now reproduces the smallest proven native
class-selection branch. If a source class is already scoped in the reader
context it consumes no selector bytes. Otherwise it reads one signed
little-endian `int16`. It then resolves that value only through the explicit
Revit 2026 browser reader table.

Only source slot 2,237 is registered. There is no generic-reader fallback.
Slots 2,177, 2,210, and every other class fail closed until their complete
static reader contracts are implemented.

The slot-2,237 reader follows the exact native delegation and field order:

| Layer | Inline bytes |
| --- | --- |
| slot 1,400 `GInfo` through slot 1,399 `GNode` | `u64` style ID, `i32` tag, `i32` control command, `u32` flags |
| `GPolyMesh.m_pFacetedTopology` | `i32` token, then `i16` source slot only when token is nonzero |
| remaining `GPolyMesh` fields | `u64` interior-style ID, `u64` material ID, `i32` flags |

The dispatcher decodes the complete static body before registering its
surrogate object. A nonzero topology descriptor is queued with its exact
object/property `DataKey` and byte range. A zero condition records no replay
candidate. Static completion remains separate: the caller must still prove
that the returned end is the end of the complete outer object graph, seal the
registry there, and initialize references before a certificate can be issued.

The exact UNBC bounded dispatch audit scans every raw slot-2,237 occurrence
without promoting it to an object boundary:

| Measure | Result |
| --- | ---: |
| Inflated chunks | 3,666 |
| Failed chunks | 0 |
| Raw slot-2,237 occurrences | 4,893 |
| Complete following slot-2,237 static shapes | 3,463 |
| Shapes whose topology descriptor is slot 5,255 | 0 |
| Slot-5,255 shapes with token 1–100,000 | 0 |

The 3,463 complete shapes demonstrate why static body length alone is not a
boundary proof: arbitrary bytes often satisfy fixed-width fields. The
independently significant result is that none reaches the required slot-5,255
topology descriptor. This remains a negative audit; scoped-class dispatches
need not serialize slot 2,237 and cannot be found by this raw scan.

Reproduction:

```sh
node --experimental-strip-types scripts/audit-revit-2026-object-dispatch.ts model.rvt
```

The next unresolved boundary is the parent reader that supplies a genuine
outer object position or scoped class context. Until that position is
decoded, the new dispatcher does not certify any UNBC geometry.
