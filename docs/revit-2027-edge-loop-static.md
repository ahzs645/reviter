# Revit 2027 Face first-loop variants

This checkpoint certifies the two source variants queued by
`GFace.m_pFirstLoop` in the exact UNBC Revit 2027 model. It provides
selector-free, browser-safe static readers. It does not scan for loop bodies,
connect the readers to general replay, resolve pointers, or tessellate a BRep.

## Exact identities and schema

`BasicFileInfo` records `Format: 2027`. The model's inflated
`Formats/Latest` stream is 513,948 bytes and declares:

| Source slot | Schema offset | Class | Static fields |
| ---: | ---: | --- | --- |
| 1,434 | 171,278 | `EdgeLoop` / `GEdgeLoop` | six inherited fields |
| 1,437 | runtime dispatch | `EdgeLoopWithChainEnvelopes` | inherited `EdgeLoop`; counted `EdgeChainWithEnvelope` array |

The `EdgeLoop` class word is `0x859b`; its lower 15-bit value is 1,435,
which directly anchors source slot 1,434. Its parent layer is version 2:

```text
GEdgeLoop.m_nextLoop    0e 01 00 00
GEdgeLoop.m_pFace       0e 03 00 00
GEdgeLoop.m_next        0e 03 00 00
GEdgeLoop.m_prev        0e 03 00 00
GEdgeLoop.m_Envelope    0e 00 00 00 7c 02
GEdgeLoop.m_open        01 00 00 00
```

The derived `EdgeLoop` layer is version 2 with zero additional fields.
The schema also declares a separate `EdgeLoopRef.m_sortedTagArr`, but the full
FIFO corpus disproves the earlier assumption that source slot 1,437 dispatches
that class. Every reached slot-1,437 body instead has the exact
`EdgeLoopWithChainEnvelopes` layout. Its repeated element is:

```text
EdgeChainWithEnvelope.m_pStartEdge    mode-03 StaticInteger
EdgeChainWithEnvelope.m_envelope      Extents2d
```

Source slot and schema class word remain separate identities; this correction
comes from owned FIFO replay, not from searching payload bytes for a
class-like value.

## Native corroboration

The native bundle is evidence only and is not shipped to or executed in the
browser:

| Module | SHA-256 | Relevant evidence |
| --- | --- | --- |
| `TB_Geometry.tx` | `4f93e3753f3011145063d649c474dd957ade06910dd3f21b9f41512192cfcf5f` | `OdBmGEdgeLoop` constructor at `0x416b16` calls the `GEdgeBase` constructor; typed accessors expose next loop, face, next/previous edge, envelope, and open state |
| `TB_LoaderBase.tx` | `56c066e2f308dcff123adfe37edaeb6f51cfa67dad8772ee7f804dbc01f4ae56` | `OdBmCondInt16Reader::read` at `0x1736dc`; `StaticIntegerReader::read` at `0x1738c8` registers ID references |
| `TB_Common.tx` | `3d3c7e3386263cc39aa9e6cad63c9a6e0fbae1f825b8cad053e2f6a399152737` | double `OdGeExtents2dReader` at `0x2a308` reads two `Point2d<double>` values; `boolReader` is at `0x299fe` |

Together with the exact release schema, these symbols corroborate the base
type, field meanings, four-double envelopes, one-byte boolean, and static edge
references. They are not treated as a Revit 2027 reader or as permission to
infer unseen body boundaries.

## Static body grammars

Source slot 1,434 has this selector-free body:

```text
inherited GInfo                     20 bytes
m_nextLoop token                    int32
  source slot, when token != 0      int16
m_pFace weak/static reference       int32
m_next weak/static reference        int32
m_prev weak/static reference        int32
m_Envelope minimum Point2d          2 * float64
m_Envelope maximum Point2d          2 * float64
m_open                              uint8 boolean
```

Its null-next-loop body is 69 bytes; a non-null descriptor makes it 71 bytes.
`decodeRevit2027EdgeLoopStatic` preserves reference tokens without resolving
them and appends only the non-null `m_nextLoop` descriptor to its returned
queue.

Source slot 1,437 is:

```text
inherited EdgeLoop body             69 or 71 bytes
chain count                         int32
for each chain:
  m_pStartEdge static reference     int32
  envelope minimum Point2d          2 * float64
  envelope maximum Point2d          2 * float64
```

`decodeRevit2027EdgeLoopWithChainEnvelopesStatic` bounds the count and full
`count * 36` extent, rejects non-finite envelopes, preserves every start-edge
reference, and returns the inherited non-null `m_nextLoop` in native FIFO
order.

Both readers:

- require release 2027;
- stay inside an explicit enclosing end offset;
- reject invalid count options and truncated fields;
- reject non-boolean `m_open` and non-finite envelopes;
- return the exact static end offset;
- never scan forward or infer a body from payload resemblance.

For conditional queue tokens, zero is null, positive values use the numbered
namespace, and `-1` is the observed queued sentinel. `-1` does not advance the
positive namespace. Any token below `-1` fails closed because no other
negative sentinel is independently proven.

## Exact UNBC queue census

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-edge-loop-static.ts \
  "UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"
```

The exact audit traverses 5,996 single-Geometry owner scopes, decodes 40,961
Face bodies, preserves each Face child append list, and reports:

| `GFace.m_pFirstLoop` result | Count |
| --- | ---: |
| null | 491 |
| set | 40,470 |
| source slot 1,434 (`EdgeLoop`) | 40,448 |
| source slot 1,437 (`EdgeLoopWithChainEnvelopes`) | 22 |
| numbered set descriptors | 40,470 |
| `-1` set descriptors | 0 |

The full child replay reaches 28 slot-1,437 bodies: 22 initial Face children
and six descendants. Their exact body widths are 73×2, 145×4, 147×12, 181×2,
217×2, 219×4, and 327×2. Chain counts are 0×2, 2×16, 3×2, 4×6, and 7×2.
All 304 envelope scalars are finite; 76 start-edge references range from 24
through 317. These boundaries disprove the old count-only `EdgeLoopRef`
interpretation.

## Deliberate stop boundary

The general replay now follows the owned FIFO across Geometry, Face, GEdge,
loops, fillings, and analytic surfaces. It never scans forward to a plausible
payload. Certification still stops at the first uncertified body; the current
corpus-wide blocker is the unresolved source-4,283 composite surface, not a
loop boundary.
