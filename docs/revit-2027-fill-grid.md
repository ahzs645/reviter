# Revit 2027 FillGrid boundary

Source slot 2,085 is the `FillGrid` object queued by
`FillPatternData.m_fillGrids`. It describes one line family in a surface fill
pattern. It is appearance data rather than face topology or tessellation.

## Exact schema and native reader

The exact UNBC `Formats/Latest` record begins at offset 253,755, with its ASCII
name at offset 253,757. It has raw class ID zero, version 1, and four fields:

```text
m_angle       float64
m_origin      fixed_array<float64, 2>
m_deltas      fixed_array<float64, 2>
m_segs        array<float64>
```

The independent common native reader is
`TB_FormatCommonReaders.tx` source 5,312 at `0x6dcea2`. Its body reads:

- `doubleReader` for the angle at `0x6dd250`;
- `OdGePoint2dReader<double>` for the origin at `0x6dd275`;
- a fixed two-item double collection for the deltas between
  `0x6dd2b6` and `0x6dd3c6`;
- `OdArray<double>` for the segments at `0x6dd4fe`.

The browser grammar is therefore:

```text
angle                            float64
origin                           2 * float64
deltas                           2 * float64
segment count                    int32
segments                         count * float64
```

The decoder rejects releases other than 2027, invalid offsets, negative or
over-limit counts, truncated arrays, and non-finite values. It does not scan
for a successor body or infer a body width from corpus observations.

## Exact UNBC corpus

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-fill-grid.ts model.rvt
```

All 99 queued bodies decode at exactly 44 bytes. Every body has an empty
segment array in this model. The persisted scalar ranges are:

| Value | Minimum | Maximum |
| --- | ---: | ---: |
| angle | -3.1415926535897927 | 4.712388980384687 |
| origin x | -32.79609580629415 | 35.15849848413594 |
| origin y | -4.6292596241889035 | 37.49416847747605 |
| delta 0 | 0 | 0 |
| delta 1 | 0.00984251968503937 | 1.9685039370078736 |

The general counted-segment grammar remains implemented and tested even though
the exact model only exercises count zero.

## Stop boundary

This clears the source-2,085 appearance boundary for 45 geometry owners. The
remaining exact descendant boundary is one source-2,213 `GArc` profile queued
by `SurfRev`. Under the shared pointer-token namespace there are no remaining
token, reader, route, or boundary failures.

FillGrid recovery does not by itself assign the pattern to rendered triangles.
That still requires the owning face/material pipeline and parity validation
against the supplied IFC.
