# Revit 2027 `GLine` and the complete replay envelope

This checkpoint corrects the final boundary of a framed `GRep` FIFO and adds
the schema-complete browser reader for source slot 1,973 (`GLine`).

## Why the 16 pre-echo bytes are payload

The framed object length is echoed at:

```text
frame start + objectLength + 16
```

The 16 bytes between the earlier `objectLength` boundary and that echo were
previously treated as generic trailer padding. Exact single-child `GLine`
records disprove that interpretation:

- using the old boundary leaves every body at 68 bytes;
- the Revit 2027 schema requires 84 bytes;
- the missing 16 bytes are exactly `m_dirVec.y` and `m_dirVec.z`;
- including them yields 1,700 of 1,700 schema-complete single-child bodies;
- every resulting direction vector is finite and unit length.

`dynamicPayloadEndOffset` now ends immediately before the independently
validated echo. `frameEndOffset` remains the stored `objectLength` boundary.
Leaf readers still determine their own body ends inside that bounded replay
envelope.

The same correction exposes the schema-declared trailing
`GArray.m_numInstances` int32: `GArray` is 144 bytes, not 140. Twelve later
bytes remain in the one-child array envelope for queued data and are not
assigned to `GArray`.

## Exact `GLine` grammar

Inflated `Formats/Latest` at byte 236,361 defines:

```text
GLine, tag 1974
  parent GCurve, version 3
    m_endParams   double[2]
  GLine, version 4
    m_origin      double[3]
    m_dirVec      double[3]
```

The inherited `GNode` contributes the 20-byte `GInfo` prefix. The complete
body is therefore:

```text
GInfo                         20 bytes
GCurve end parameters         16 bytes
GLine origin                  24 bytes
GLine direction               24 bytes
                              --------
                               84 bytes
```

The available Revit 2026 direct reader at RVA `0x10de6c6` independently
corroborates the order: base `GCurve`, `Point3d`/`setOriginPoint`, then
`Vector3d`/`setDirectionVector`. It is field-order evidence only; the exact
2027 schema and model bytes authorize this reader.

## Exact UNBC result

Run:

```sh
node --experimental-strip-types scripts/audit-revit-2027-gline.ts \
  "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"
```

The model contains 21,849 outer `GLine` descriptors in 11,221 roots. Bounded
initial-FIFO replay using only certified `GLine`, `GGroup`, `GArray`, and
`GPolyLine` readers reaches 18,893 bodies (86.4708%). All 18,893 have finite,
unit-length directions and zero decode failures. This includes all 1,700
single-child bodies.

The remaining initial replay stops, without consuming bytes, at:

| Uncertified source slot | Stops |
| ---: | ---: |
| 2,254 | 483 |
| 2,221 | 266 |
| 2,343 | 214 |
| 2,213 | 174 |
| 2,259 | 2 |

Adding `GLine` to the `GGroup` sibling locator increases certified nested FIFO
positions from 10 of 17,038 to 7,730. It reaches 4,494 non-empty nested bodies:
4,466 `GGroup`, 19 `Geometry`, and 9 `GArray`.

## Tessellator consequence

`GLine` adds exact analytic curve geometry and removes the dominant 7,720
`GGroup → GLine` positioning blocker. It does not itself produce faces or
triangles. Its main solid-modeling value is that replay now reaches 19 owned
`Geometry` bodies, which can hand their face/edge/surface queues toward the
browser tessellator modeled on `TB_Geometry`, `libTD_Ge`,
`libOdBrepModeler`, `libTD_BrepBuilder`/`libTD_Br`, and
`libTD_BrepRenderer`.

No curve is promoted to a face, and no native kernel library is treated as a
browser dependency.
