# Revit 2027 FillPatternData boundary

Source slot 2,087 is the `FillPatternData` property queued by
`GFilling.m_data`. It describes fill-pattern statistics and queues individual
fill grids; it is appearance data, not face topology or triangles.

## Exact schema and native reader

The exact UNBC `Formats/Latest` record begins at offset 253,987. It has raw
class ID zero, version 1, and five fields:

```text
m_windowSize       float64
m_lengthPerArea    float64
m_strokesPerArea   float64
m_linesPerLength   float64
m_fillGrids        array<CondInt16>
```

The independent common native reader is
`TB_FormatCommonReaders.tx` source 5,313 at `0x6df656`. It reads the four
doubles at call sites `0x6dfa0f`, `0x6dfa3a`, `0x6dfa65`, and `0x6dfa90`,
then invokes the `OdArray<OdBmCondInt16>` collection reader at `0x6dfc1b`.
There is no `GNode`/`GInfo` base.

The browser grammar is therefore:

```text
four statistics                   4 * float64
fill-grid count                   int32
fill-grid descriptors             count * CondInt16
```

The decoder bounds the count and complete descriptor collection, rejects
non-finite statistics, and returns non-null grid descriptors in native
collection order.

## Exact corpus

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-fill-pattern-data.ts model.rvt
```

The exact model contains 50 bodies:

| Body shape | Count |
| --- | ---: |
| 42 bytes, one grid | 1 |
| 48 bytes, two grids | 49 |

All 99 grid descriptors use the `-1` sentinel and source slot 2,085. The four
statistic ranges are:

| Statistic | Minimum | Maximum |
| --- | ---: | ---: |
| window size | 0.00984251968503937 | 1.9685039370078736 |
| length per area | 1.0160000000000002 | 203.19999999999996 |
| strokes per area | 0 | 0 |
| lines per length | 1.0160000000000002 | 203.19999999999996 |

All 50 bodies terminate at the exact next owned FIFO body. No scanning,
padding, or inferred width is used.

## Stop boundary

This clears all source-2,087 bodies that previously stopped 45 owner scopes.
The 99 queued source-2,085 `FillGrid` bodies are now decoded by the downstream
FillGrid reader and exact-model audit. Exact fill appearance is still
incomplete: those grids must be related to the face's pattern element, color,
flags, and placer in the rendered material pipeline. No material or
tessellation parity is claimed.
