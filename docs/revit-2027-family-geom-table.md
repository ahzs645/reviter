# Revit 2027 FamilySymbol geometry-table boundary

This checkpoint covers the shared `FamilySymbol` owners that still account for
2,019 placed IFC Tags in the UNBC parity audit. It records only byte-level
facts from the supplied RVT and static facts from the supplied Linux ODA
binaries. It does not use the IFC mesh to synthesize RVT geometry.

## Result

`GeomTable.m_table` is not a persisted drawable graph. Its native entry value
is one signed 32-bit geometry-generator ID. The Revit schema also serializes a
dynamic `m_pGNode` selector for each entry, but the native runtime
`OdBmGeomTabEntry` does not retain that pointer. A browser reader can therefore
use this table as an index only after it has reconstructed the owning
`GeomStepList`/history state or an actual `m_geometry` `GElement`; it cannot
turn the generator IDs into triangles by themselves.

This rules out the tempting shortcut of treating the four persisted `GLine`
objects in the five sampled door symbols as a solid. They are exact curve
records, but they do not carry face-loop, coedge, shell, or material ownership.

## Schema evidence

Inflated `Formats/Latest` declares the following contiguous source classes:

| Source slot | Class | Declared fields |
| ---: | --- | --- |
| 643 | `BigArrGeomTabEntryWrapper` | `m_startIndex`, `m_filledBase`, `m_bigTable`, `m_filledTables` |
| 644 | `GeomTabEntry` | `m_pGNode`, `m_geomGeneratorId` |
| 2,337 | `GeomStepList` | generator-stage arrays, four snapshots, element reference, counters, flags |
| 2,338 | `GeomTable` | reference-point/cache flags, table, owner, material markers, face-type markers |

The `GeomTabEntry` field descriptors are:

- `m_pGNode`: `0e 03 22 00`
- `m_geomGeneratorId`: `04 00 00 00`

The descriptor proves that a dynamic `GNode` selector is present in the wire
representation. It does not prove retained `GNode` ownership after loading.

## Native representation

Static disassembly of `TB_Geometry.tx` establishes the runtime value layout:

| Symbol | Address | Observed operation |
| --- | ---: | --- |
| `OdBmGeomTabEntry::OdBmGeomTabEntry()` | `0x45f744` | writes `-1` to dword offset 0 |
| copy constructor | `0x45f74c` | copies only dword offset 0 |
| equality | `0x45f760` | compares only dword offset 0 |
| `getGeomGeneratorId()` | `0x45f77a` | returns dword offset 0 |
| `setGeomGeneratorId(int)` | `0x45f77e` | writes dword offset 0 |
| `OdBmGeomTableImpl::getGeomGeneratorId` | `0x386b3c` | indexes the backing array with a four-byte stride |
| `OdBmGeomTableImpl::addEntry` | `0x386bcc` | appends a generator-ID entry |

There is no second runtime field and no retained node pointer in this value
type. The named schema field must therefore be handled as serialization/replay
state, not as a stable ownership pointer.

`TB_Database.tx` confirms the direction of the index:

- `OdBmElementImpl::generateGeomTable` at `0x137d15c` walks generator stages
  from a live `GeomStepList`, collects Face/Edge/Curve history IDs, and adds
  table entries whose values are generator IDs.
- `OdBmElementImpl::internalGetGeomTable` at `0x1372438` first updates geometry
  when required.
- `OdBmElementImpl::getGeometryFromId` at `0x137309a` retrieves a child from the
  actual element `m_geometry` graph; it does not construct one from
  `GeomTable`.
- `OdBmFamilySymbolImpl::getGeometryFromId` in `TB_Family.tx` at `0x3b7148`
  checks reference faces and non-BRep geometry before delegating to that base
  `m_geometry` lookup.

The geometry table is consequently a tag/history-to-generator indirection
created from already active family geometry state. It is not input accepted by
the BRep tessellator stack.

## Exact UNBC door records

The five sampled door-type owners have the same 8,297-byte
`FamilySymbol`-shaped frame and the same geometry-table candidate bytes:

| Owner | IFC Tags at the parity checkpoint | Candidate node selectors | Candidate generator IDs |
| ---: | ---: | --- | --- |
| 845,328 | 222 | tokens 27–30, slot 1,973 `GLine` | `16, 0, 0, 0` |
| 788,064 | 218 | tokens 27–30, slot 1,973 `GLine` | `16, 0, 0, 0` |
| 899,478 | 152 | tokens 27–30, slot 1,973 `GLine` | `16, 0, 0, 0` |
| 863,572 | 131 | tokens 27–30, slot 1,973 `GLine` | `16, 0, 0, 0` |
| 1,119,482 | 48 | tokens 27–30, slot 1,973 `GLine` | `16, 0, 0, 0` |

The count begins at frame-relative `+1682`, the four six-byte selectors occupy
`+1686..+1709`, and the four signed generator IDs occupy `+1710..+1725`.
All four referenced 84-byte `GLine` bodies are independently decodable and
form a rectangular perimeter. They do not close a persisted BRep:

- there are no owned face loops or coedges;
- the adjacent `m_refFaces` are unbounded reference planes;
- the frames do not select `SnapshotData`, `Geometry`, `GGroup`, `GBRep`, or
  `GPolyMesh`;
- the IFC doors contain many triangles, so the perimeter is not equivalent to
  the exported solid.

The bytes before `+1682` are still part of FIFO replay involving
`FamilySymbolPatternHelper`, `GeomStepList`, and `GeomTable`. The exact
four-byte zero at `+1678` is reproducible, but static evidence is insufficient
to assign every byte in that prefix to one of those objects. The selector and
generator columns above are exact; their containing-field start remains a
candidate, not a public reader contract.

## Column-symbol correction

Owner 2,179,544 is not shaped like the door records. Its initial dynamic queue
is, in order:

1. slot 3,221 `ParamValueSetInt`;
2. slot 3,220 `ParamValueSetElementId`;
3. slot 2,337 `GeomStepList`;
4. slot 2,338 `GeomTable`.

The byte at `+1011` completes the preceding
`FamilySymbolPatternHelper` body. The following bytes include an empty
`ParamValueSetInt` and a five-entry `ParamValueSetElementId`. Therefore the
previous interpretation of a `GeomStepList` boundary at `+1011` and a
five-entry `GeomTable` at `+1015` is false.

The supplied loader contains dedicated readers at:

- `ParamValueSetElementId201120260Reader::read` — `0xf2482`
- `ParamValueSetInt201120260Reader::read` — `0xf298a`

Both use the dynamic object queue for map members. Until that queue grammar is
decoded and bounded, the later `GeomStepList`/`GeomTable` bodies in this frame
cannot be positioned safely. No production decoder should skip those maps by
guessing a fixed entry width.

## Browser implementation boundary

The client-side converter may safely retain the following today:

- exact `GLine` curve decoding;
- the dynamic selector tokens and source slots when their containing count is
  bounded;
- signed generator IDs as opaque index values;
- an explicit unresolved-family-regeneration diagnostic.

It must not:

- expose the schema name `m_pGNode` as retained ownership;
- infer a prism or box from the four lines or reference planes;
- send `GeomTable` entries directly to `TB_Geometry`, `libTD_Ge`,
  `libOdBrepModeler`, `libTD_BrepBuilder`/`libTD_Br`, or a replacement WASM
  tessellator;
- claim IFC parity for these owners until the RVT supplies an owned drawable
  graph.

The next lawful implementation checkpoint is an exact dynamic queue reader for
the parameter maps and `GeomStepList`. It should then search for either:

1. a persisted `m_geometry`/snapshot graph with complete BRep ownership, which
   can be decoded and tessellated client-side; or
2. sufficient generator steps and family parameter state for genuine family
   regeneration.

If neither graph is persisted, matching the IFC requires implementing the
family regeneration semantics themselves; the geometry-table IDs alone do not
reduce that work to tessellation.
