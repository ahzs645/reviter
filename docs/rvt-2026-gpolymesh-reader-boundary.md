# Revit 2026 `GPolyMesh` reader boundary

This note records clean-room static analysis of the locally supplied Revit
2026 reader module and its agreement with the three strict mesh payloads in
the UNBC model. No native ODA code was executed.

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

The bytes immediately before the three bodies also fit this queued layout.
They contain repeated six-byte values of the form:

```text
a7 08 | sequential uint32
```

The 2026 module maps source slot `0x08a7` (`2215`) to `GFlipControl`. The runs
end at values `972`, `129`, and `87` respectively. They belong to preceding
queued geometry data and are not a faceted-topology selector. The coincidental
schema tag value `0x08a7` associated with `GArray` is a different namespace.

## Proven `FacetedTopology8` body

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

All three UNBC payloads start at normals mode `2`, contain one normal per
triangle, and contain one edge-visibility byte per triangle:

| Chunk / body start | Normals | Vertices | Triangles | Body end |
| --- | ---: | ---: | ---: | ---: |
| 2,953 / 36,955 | 144 | 144 | 144 | 41,451 |
| 3,002 / 2,926 | 26 | 20 | 26 | 3,692 |
| 3,169 / 9,676 | 104 | 104 | 104 | 12,932 |

`locateFacetedTopology8Body` implements exactly this bounded body reader. It
requires the corroborated mode and cardinalities, validates the complete mesh,
and returns the exact end offset. It neither scans arbitrary bytes nor assigns
an owner.

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

The smallest unresolved layer is now the `OdBmDynamicQueue` replay:

1. enter a `GPolyMesh` through source-class slot `2237`;
2. retain the condition/source-slot tuple queued for `m_pFacetedTopology`;
3. reproduce queue ordering until that property body is replayed;
4. associate the selector-free body with that retained `GPolyMesh` context;
5. only then attach the owner's transform, style, material, and element.

Until that queue association is implemented, the three bodies are valid
meshes but are intentionally not emitted as owned model geometry.
