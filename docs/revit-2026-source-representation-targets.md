# Revit 2026 source-representation targets

> **Release correction:** This historical note applied Revit 2026
> source-representation targets to exact UNBC Revit 2027 slot counts. That
> cross-release join and its payload classifications are superseded by the
> [Revit 2027 release boundary](revit-2027-grep-release-boundary.md). The pure
> Revit 2026 registration records, target readers, and persisted
> `GBrep`/`GFakeBRep`/`GPolyMesh` routes remain valid for Revit 2026 only. Raw
> UNBC counts remain numeric measurements only.

This note closes the four unresolved source slots in the certified UNBC
`GElement -> GRep` child histogram. The result comes from static analysis of
the release class and reader modules; no ODA native code was executed.

## Evidence boundary

| Binary | SHA-256 |
| --- | --- |
| `TB_Format2026Classes.tx` | `cc2565e778cd8b1b03955ef09cec9431169608b3433dda7820f915803bae8921` |
| `TB_Format2026Readers.tx` | `09d1867c1aaea3653c750fb015fa17838e71da8ad0c52a9de834de920b644e0f` |
| `TB_FormatCommonReaders.tx` | `66a5f374dc87ae48600e71afe1061670f4a2eda779ecf9f5f419eb9fd4bb835b` |
| `TB_LoaderBase.tx` | `56c066e2f308dcff123adfe37edaeb6f51cfa67dad8772ee7f804dbc01f4ae56` |

`TB_Format2026Readers.tx::OdBmFormat2026ReadersModule::initApp` loads
`TB_Format2026Classes` at `0x1786511` and `TB_FormatCommonReaders` at
`0x1786538`. The Classes module is the missing link: its
`version2026::Internals::HostAppServices::container` calls
`ClassesContainer::addRepresentation` once per release source
representation.

`ClassesContainer::addRepresentation` is implemented in `TB_LoaderBase.tx`
at `0xe1f78`. It stores the target `OdTfClass*` at record offset `+0x10`.
`ClassesContainer::targetClass` at `0xe1d0c` returns that field, and
`ClassesContainer::readersFactory` at `0xe1d36` uses the target class to find
the reader factory. This proves why a release slot can have no
release-specific `CustomDirectReader` symbol and still be readable.

## Resolved mappings

All registrations pass `true` as the third `addRepresentation` argument.
Addresses below are ELF-relative virtual addresses.

| Revit 2026 source slot | UNBC root count | Target-class `desc()` call | `addRepresentation` call | Effective target reader | Common `addReadersFactory` call |
| ---: | ---: | --- | ---: | --- | ---: |
| 1,973 | 21,849 | `OdBmFamilyConnectorPosition::desc` at `0x67f447` | `0x67f45c` | common slot 5,290, reader `0x6c04b0` | `0x6f0ddf` |
| 2,254 | 22,104 | `OdBmGSurfacesTransparencyOverrider::desc` at `0x681715` | `0x68172a` | common slot 5,391, reader `0x52a980` | `0x6f23ff` |
| 2,259 | 8 | `OdBmGTagomizingFamSymHistoryDriver::desc` at `0x6817ba` | `0x6817cf` | common slot 5,393, reader `0x52d2d6` | `0x6f2475` |
| 2,276 | 232 | `OdBmGeomGeneratorData::desc` at `0x6819eb` | `0x681a00` | common slot 5,406, reader `0x544752` | `0x6f2774` |

The exact local UNBC probe completed in 3.03 seconds and reported 3,666
inflated chunks, no failed chunks, 63,955 framed roots, 63,820 decoded roots,
148,223 children, and the four counts shown above. The same histogram has
zero source descriptors for slots 2,177, 2,210, and 2,237.

## Payload classification

The common readers show that none of the four newly resolved slots is a
persisted drawable body:

- `OdBmFamilyConnectorPosition` uses common reader slot 5,290 at `0x6c04b0`.
  It invokes the common `OdBmConnectorModifier` reader (slot 4,959) at
  `0x6c08d0`. This is connector placement/control data.
- `OdBmGSurfacesTransparencyOverrider` uses common reader slot 5,391 at
  `0x52a980`. Its own payload is one `Int32`, applied by
  `setTransparency` at `0x52acf8`.
- `OdBmGTagomizingFamSymHistoryDriver` uses common reader slot 5,393 at
  `0x52d2d6`. It has no own persisted field after its inherited/object setup;
  it is a history-driver marker.
- `OdBmGeomGeneratorData` uses common reader slot 5,406 at `0x544752`. It
  invokes `OdBmGeomGenerator` slot 5,405 at `0x544b75`, then reads
  `NNextTag` and applies it at `0x544be0`.

The nested `OdBmGeomGenerator` reader begins at `0x543762`. It populates
regeneration/history metadata:

| Setter | Call |
| --- | ---: |
| `setFaceHistTable` | `0x543ce1` |
| `setCurveHistTableSet` | `0x543f86` |
| `setEdgeHistTable` | `0x54422b` |
| `setEdgeHistTableReverse` | `0x5444f9` |
| `setId` | `0x54462d` |

That reader contains no call to a `GBrep`, `GFakeBRep`, `GPolyMesh`, or
faceted-topology reader. Slot 2,276 therefore preserves information useful
for family regeneration, but it is not a shortcut to display triangles.

## Exact persisted geometry routes

The same release representation table independently confirms the actual
drawable routes:

| Revit 2026 source slot | Target | `addRepresentation` call | Release reader | Release `addReadersFactory` call |
| ---: | --- | ---: | ---: | ---: |
| 2,177 | `OdBmGBrep` | `0x680d7f` | `0x10ca5b6` | `0x15f166a` |
| 2,210 | `OdBmGFakeBRep` | `0x68119f` | `0x10c20da` | `0x15f1b06` |
| 2,237 | `OdBmGPolyMesh` | `0x6814f9` | `0x10e128c` | `0x15f1fdd` |

`OdBmGPolyMesh` calls its `GNode` base reader at `0x10e16ba`, then a
conditional reader at `0x10e17a8`, followed by material/style IDs and mesh
flags. The nested stored-topology reader for common slot 5,255,
`OdBmFacetedTopology8`, is at
`TB_FormatCommonReaders.tx+0x6c8d8c`; its common factory is registered at
`0x6f0609`.

The dispatch records needed by the TypeScript parser are encoded in
`lib/reviter/revit-2026-source-representations.ts`. They deliberately mark
only slots 2,177, 2,210, and 2,237 as persisted drawable geometry. Slot
5,255 is recorded separately because it is a common nested reader slot, not
a Revit 2026 outer source slot.

## Client-side consequence

The browser parser can now bind every source slot in the current UNBC GRep
histogram to a target class. The four formerly unknown high-volume entries
are connector state, display override state, a family-history marker, and
regeneration history—not missing mesh bodies.

The remaining geometry blocker is unchanged but narrower: current certified
UNBC roots do not select `GBrep`, `GFakeBRep`, or `GPolyMesh`. General
client-side geometry still requires complete FIFO replay of the owned
dynamic queue and certification of a nested route into one of those three
classes. Only after that persisted object graph is reconstructed should the
web tessellator consume BRep faces or faceted topology.
