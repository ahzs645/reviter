# Revit 2027 analytic surface boundary

This boundary decodes the four schema-complete analytic `Face.m_pSurf`
source representations observed in the supplied UNBC Revit 2027 file. It is
deliberately a persistence decoder, not a tessellator and not an IFC-parity
claim.

## Exact-file observations

The certified `Face` traversal decodes all 40,961 faces in its safe owner scope.
Every face has one surface descriptor:

| Source slot | Persisted surface | Count | Token kind |
| ---: | --- | ---: | --- |
| 634 | `Plane` | 40,813 | numbered |
| 900 | `ConeSurf` | 10 | `-1` sentinel |
| 1,144 | `CylSurf` | 136 | `-1` sentinel |
| 4,283 | `SurfRev` (surface of revolution) | 2 | `-1` sentinel |

All four slots are supported by the exact `Formats/Latest` field
layouts, the native common readers for the same classes, and their exact body
successors. They are not inferred from arbitrary byte patterns or body length.

The exact schema offsets are:

- `Plane` at 89,626, embedding the common `Surface` fields;
- `ConeSurf` at 114,240;
- `CylSurf` at 138,828;
- `SurfRev` at 469,522.

The top-level class-name ladder independently resolves the formerly ambiguous
numeric slot: slot 4,282 is `SuppressGCMemberFaceRegionsGStep`, slot 4,283 is
`SurfRev`, and slot 4,284 is `SurfaceAdapter`. The same ladder resolves the
profile descriptor's source slot 2,213 to `GArc`.

## Native read order

The decompiled 2026 reference readers in `TB_FormatCommonReaders.tx` establish
the reusable order:

1. the derived reader calls common `Surface` reader source 5,927 at `0x5ea8a4`;
2. `Surface` reads `Envelope201120260` and then a boolean orientation flag;
3. the derived reader consumes its declared fields.

The common derived entry points are `Plane` source 5,627 at `0x57dec8`,
`ConeSurf` source 4,951 at `0x603ade`, `CylSurf` source 5,015 at `0x655f6c`,
and `SurfRev` source 5,926 at `0x5eb160`.

This yields the client-side layouts:

- common `Surface`: two 2D envelope corners and one strict boolean;
- `Plane`: origin, x vector, y vector;
- `ConeSurf`: center, x/y/z vectors, half angle;
- `CylSurf`: center, x/y/z vectors, radius;
- `SurfRev`: center, x/y/z vectors, then one conditional profile curve.

All coordinates and scalars are little-endian float64 values.

## Exact source slot 4,283

Both exact slot-4,283 bodies belong to element 245,109. Each has a verified
135-byte extent:

```text
common Surface                              33 bytes
center + x/y/z vectors                      4 * 24 bytes
profile-curve descriptor                    int32 token + int16 source slot
```

The first body is at dynamic-payload offsets 44,187..44,322 and ends with
token 56/source slot 2,213. The second is at 44,493..44,628 and ends with
token 57/source slot 2,213. Consuming all 135 bytes aligns the first exactly to
the following `EdgeLoop` `GInfo` prefix and the second exactly to the following
`Plane` body.

The earlier 89+46 split was a coincidental `RuledSurf` misparse: 89 bytes
consume the common 33-byte `Surface`, all of `center` and `xVector`, and the
first scalar of `yVector`. The remaining 46 bytes are therefore exactly the
other five vector scalars plus the six-byte profile descriptor. The
`SurfRev` schema and native reader account for every byte.

## Fail-closed boundary

`decodeRevit2027AnalyticSurface` accepts release 2027 and the complete slots
634/900/1144/4283. It rejects unknown slots, invalid booleans, non-finite
geometry, malformed profile descriptors, and bounded-buffer truncation. It
never chooses a class from body length.

The combined FIFO audit reaches both exact `SurfRev` bodies and queues their
`GArc` profile descriptors. It stops at the separately uncertified GArc body
rather than guessing that nested curve's width.

Consequently there are still zero tessellated solids and no comparison with
the IFC oracle's 93,749 `IFCFACE` entities. The next layers remain curve-loop
replay, BRep assembly through the behavior represented by
`libTD_BrepBuilder`/`libTD_Br`, analytic evaluation equivalent to `libTD_Ge`,
and triangle generation.

Run the audit with:

```sh
node --experimental-strip-types scripts/audit-revit-2027-surfaces.ts \
  model.rvt reference.ifc
```
