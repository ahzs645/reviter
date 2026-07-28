# Revit loader and stream-framing analysis

## Scope

This is a clean-room interoperability analysis of `TB_Loader.tx` from
`BmJsonExportEx-isolated`, checked against:

`UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt`

The native binaries are Linux ELF files and are not bundled, loaded, or called
by Reviter. Symbol names and narrow disassembly observations are used only to
identify the on-disk layering that the browser reader must reproduce.

The complete binary inventory is in
[`generated/oda-binary-inventory.md`](generated/oda-binary-inventory.md).

## Confirmed loader stack

`nm -n -C TB_Loader.tx` exposes the loader as composable reader templates:

1. `PagedStreamImplReader<OdBmPagedStreamContext<..., 65249u>>`
2. `PageReader<true>` or `PageReader<false>`
3. `PartitionStreamDataReader`, `BasicStreamReader`, or
   `CompressedStreamImplReader`
4. `FixedHeaderReader<0u>`, `FixedHeaderReader<8u>`, or
   `ContentsHeaderReader`
5. `OdBmGZipCompressor` or `OdBmPKZipCompressor`
6. object readers and post-processors

Relevant symbols and addresses in this build include:

| Address | Symbol |
|---:|---|
| `0x8b2b0` | `OdBmPKZipCompressor::compress` |
| `0x8baf4` | `OdBmGZipCompressor::decompress` |
| `0x8c0b6` | `OdBmPKZipCompressor::decompress` |
| `0x95f52` | `OdBmFileCRC::verifyAndCutCRC` |
| `0xd648c` | `PartitionStreamDataReader::read` |
| `0xd6c20` | `PageReader<true>::read` |
| `0xd8060` | `ContentsHeaderBaseReader::read` |
| `0xd80ea` | `ContentsHeaderReader::read` |
| `0xdbb50` | `FixedHeaderReader<0u>::read` |
| `0xdbc52` | `FixedHeaderReader<8u>::read` |
| `0xdbd58` | `PageReader<false>::read` |
| `0xdd320` | checksum-paged partition stream reader |

The paged reader loops over stored chunks no larger than `65,249` bytes.
`PageReader<true>` calls `OdBmFileCRC::verifyAndCutCRC`; `PageReader<false>`
passes the bytes through. The partition reader then dispatches versions 6, 7,
8, and 9 from an eight-byte fixed header.

## Page payload recovered

For a full 65,249-byte page, `verifyAndCutCRC` returns 64,896 stream bytes.
Therefore a full stored page is:

| Region | Bytes |
|---|---:|
| Payload | 64,896 |
| Checksum/error-correction tail | 353 |
| Stored page | 65,249 |

This was independently verified on the UNBC partition. Removing bytes
`[64896, 65249)` from each complete stored page, concatenating the payloads,
and leaving the last short page intact produces a continuous compressed stream.

The implementation is
`stripRevitPageChecksums` in `lib/reviter/revit-container.ts`. It also maps a
clean payload offset back to the stored stream offset for diagnostics.

Reviter does not yet implement the native error-correction algorithm. It
removes checksum tails but does not validate or repair corrupted payload bytes.
The last short page is retained in full because its checksum is after the final
DEFLATE stream and is ignored by the inflater; its variable encoded payload
length has not been generalized yet.

## Real-file proof

The UNBC file contains one 68,999,154-byte partition:

| Metric | Raw stream | Checksum-clean stream |
|---|---:|---:|
| Candidate gzip chunks | 3,666 | 3,666 |
| Fully inflated | 3,613 | 3,666 |
| Prefix-salvaged | 36 | 0 |
| Unreadable | 17 | 0 |
| Inflated bytes | 419,264,490 | 421,867,755 |

The apparent “desync” was checksum data inserted into DEFLATE input at outer
page boundaries. Preset dictionaries remain part of the inner chunk reader, but
prefix salvage is no longer needed for this file once the outer layer is read
correctly.

End-to-end conversion changed as follows:

| Metric | Before page decoding | After page decoding | Change |
|---|---:|---:|---:|
| Validated element bounds | 39,042 | 40,666 | +1,624 |
| Displayed elements | 35,628 | 36,536 | +908 |
| Triangles | 453,492 | 470,426 | +16,934 |
| Framed element objects | 147,369 | 174,785 | +27,416 |
| Elements with parameters | 18,134 | 20,524 | +2,390 |
| Categorized elements | 33,930 | 39,157 | +5,227 |
| Elements linked to a type | 8,153 | 9,381 | +1,228 |
| Elements with named types | 5,716 | 7,523 | +1,807 |
| Unclassified elements | 3,980 | 131 | −3,849 |

The post-change output is `outputs/unbc-crc.json` (ignored by Git). The earlier
comparison output is `outputs/unbc-loader-check.json`.

## Header and compression variants in the UNBC file

The first valid compressed payload begins at different offsets:

| Stream | First payload | Observed prefix |
|---|---:|---|
| `Formats/Latest` | 0 | gzip directly |
| `Global/ElemTable` and most `Global/*` | 8 | `FixedHeaderReader<8u>` |
| `Contents` | 24 | contents header |
| `Partitions/325` | 44 | partition version/header data; first byte is 9 |
| `ProjectInformation` | 0 | ordinary PKZip archive |

The native compressed reader first preserves the selected header and then
decompresses the remaining bytes. This matches the file: the eight-byte Global
prefix is not part of gzip.

`ProjectInformation` follows the non-checksummed PKZip route. Its archive holds
one `.project.xml` Atom entry. Reviter now decodes the project/design-file
metadata and property groups in the browser, with an uncompressed XML size cap.
On the UNBC model this adds:

- project title and update time;
- Revit product version 2027;
- organization, building, and author;
- issue date, status, client, address, and project name.

## Dynamic-object layer

The loader also exposes:

- `OdBmDynamicQueue::readPropertyToken`
- `OdBmDynamicQueue::readPairToken`
- `OdBmDynamicQueue::readProperties`
- `OdBmDynamicQueue::readDynamicProperties`
- `OdBmGenericObjectReader`
- versioned `ComposeForLoadYYYYYYYY` functions
- `ESSchema201220200Reader`
- `ESSchema202120260Reader`

Primitive reader/writer names include `XYZ0`, `XYZ1`, `Trf0`, `Trf40`,
`Outline0`, `Envelope0`, `ElementId0`, `ElementId1`, `ParamSet0`, and
`ElemTable0`. These names support a schema-driven TypeScript architecture, but
do not by themselves disclose field order for every Revit class. Reviter should
continue learning field layouts from corroborated records and IFC comparisons,
not infer them solely from names.

## Browser implementation boundary

Portable and now implemented:

- OLE/CFB stream access;
- checksum-page removal for known database streams;
- gzip and PKZip decompression;
- fixed/contents/partition prefix preservation;
- release detection and version-specific decoder selection;
- schema, element table, partition names, project Atom metadata, and recovered
  element records.

Still requiring additional clean-room format work:

- checksum validation/correction and exact short-page trimming;
- complete dynamic property-token decoding;
- history-backed identifiers and typed relation graphs;
- stored BRep/mesh/material record layouts;
- general Revit parametric regeneration.

General BRep evaluation and tessellation are native modeler operations, not a
compression-layer feature. They are analyzed separately in the geometry report.
