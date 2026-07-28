# Revit 2027 GFilling boundary

Revit 2027 source slot 2,253 is the persisted `GFilling` selected by
`GFace.m_pGFilling`. This boundary is relevant to exact appearance/material
assignment. It does not contain face topology or triangles.

## Exact schema

The exact `Formats/Latest` source ladder is:

| Source slot | Class |
| ---: | --- |
| 2,250 | `GFakeBRep` |
| 2,251 | `GFillColorOverrider` |
| 2,252 | `GFillPatternOverrider` |
| 2,253 | `GFilling` |
| 2,254 | `GFilter` |
| 2,255 | `GFlipControl` |

`GFilling` record framing starts at byte 266,358 (its ASCII name starts at
266,360), carries inherited raw class ID `0x0592`,
version 6, and declares six fields:

```text
m_pGFace     0e 03 00 00
m_placer     0e 00 00 00 2d 08
m_data       0e 01 00 00
m_patternId  0e 00 00 00 14 00
m_fillColor  05 00 00 00
m_flags      04 00 00 00
```

The inline `FillPatternPlacer` record framing starts at byte 254,450 (its
ASCII name starts at 254,452), version 3. It
declares scale, 2D origin, 2D direction, 2D UV scale, mirrored, and
placed-draft. Its serialized body is 58 bytes.

## Native reader behavior

The Revit 2026 reference reader for source slot 2,213 is at
`TB_Format2026Readers.tx+0x10d2630`. Its base-to-derived calls prove:

1. `GNode` is read first at call site `0x10d2a5e`;
2. `m_pGFace` uses `StaticIntegerReader` at `0x10d2b4c`;
3. the 58-byte `FillPatternPlacer` is read inline at `0x10d2bc4`;
4. `m_data` uses `OdBmCondInt16Reader` at `0x10d2cdc`;
5. pattern ElementId, uint32 color, and int32 flags follow.

`StaticIntegerReader` reads one int32 and invokes
`DynamicQueue::addIdReference`. Therefore `m_pGFace` is an ID-reference. It is
not a queued `Face`, a hidden BRep, or a body-width selector.

Only `m_data` appends an object to the FIFO. Its runtime property type is
`OdSmartPtr<OdBmFillPatternData>`. The decoder preserves a nonzero descriptor,
including native token `-1`, and omits only token zero from
`queuedProperties`.

The complete body is 102 bytes when `Data` is null and 104 bytes when it is
present:

```text
GInfo                         20
face ID-reference              4
FillPatternPlacer             58
Data CondInt16               4/6
pattern ElementId              8
fill color                     4
flags                          4
```

## Exact-model result and stop boundary

The certified UNBC Face scope decodes 40,961 of 40,961 declared faces.
Foreground filling is present on 35,413 faces, and all 35,413 descriptors
select source slot 2,253 with numbered tokens.

Exact `GFilling` body coverage remains zero until `EdgeLoop` replay is
certified. Face children are FIFO-interleaved as loop, filling, and surface
properties. Seeking to filling bodies by assuming a loop width would corrupt
queue ownership and is intentionally rejected.

This means exact material assignment remains incomplete: the pattern ID,
packed color, flags, and queued `FillPatternData` grammar are now known, but
the exact values have not yet been reached and bound to tessellated faces.

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-gfilling.ts model.rvt
```
