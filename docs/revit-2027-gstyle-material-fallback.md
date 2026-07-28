# Revit 2027 GStyle material fallback

This checkpoint decodes the persisted
`GStyleElem -> GStyle -> MaterialElem` relation and applies the native
Face-before-Geometry node-style precedence. It is browser-safe, release-gated,
and does not use the IFC to discover an RVT field or identity.

## Persisted layout

`Formats/Latest` places the relevant classes at these source slots:

| Source slot | Class |
| ---: | --- |
| 2,288 | `GStyle` |
| 2,292 | `GStyleElem` |

The schema declares `GStyle` version 4 with these fields, in order:

1. `m_linePatternId`
2. `m_materialElemId`
3. `m_penNumber`
4. `m_color`
5. `m_isScreenSized`

`GStyleElem` version 7 then declares:

1. `m_pGStyle`
2. `m_categoryId`
3. `m_ownerId`
4. `m_gstyleType`

The certified 156-byte 2027 frame writes the `m_pGStyle` CondInt16 descriptor
at `+121` as token `-1`, source slot 2,288. Because dynamic properties use a
FIFO, the static `GStyleElem` fields follow first:

| Offset | Persisted value |
| ---: | --- |
| `+127` | category element id |
| `+135` | owner element id |
| `+143` | graphics-style type |

The queued `GStyle` body follows:

| Offset | Persisted value |
| ---: | --- |
| `+147` | line-pattern element id |
| `+155` | material element id |
| `+163` | pen number |
| `+167` | color |
| `+171` | screen-sized flag |
| `+172` | echoed object length |

The material ID is therefore at `+155`. The plausible IDs at `+127` and
`+135` are category and owner references, not materials.

[`revit-2027-gstyle-material.ts`](../lib/reviter/revit-2027-gstyle-material.ts)
checks the release, independent length/echo frame, repeated element identity,
exact marker 2,292, type code zero, exact 156-byte layout, exact queued
source-slot descriptor, and boolean domain before returning a record.

## Native precedence

Lawful static inspection of `TB_Database.tx` establishes the execution order:

- `OdBmBrFace::getMaterial(unsigned long&)` checks a view material override;
- it then checks `OdBmGFace::getRenderStyleId`;
- direct material and BuiltInCategory paths are attempted before node style;
- `OdBm::Details::getGStyle` asks the Face `OdBmGNode::getGStyleId`;
- only when that ID is null does it ask the owning geometry node;
- the resulting `OdBmGStyle` supplies `getMaterialElemId`;
- `getMaterialByCategory` is later fallback state and remains a separate path.

The native Revit 2027 BuiltInCategory array has 1,224 exact 64-bit values.
`-4000010` is not among them and cannot be a positive framed element ID, so
the supplied file's two non-explicit face values, `-1` and `-4000010`, both
enter the node-GStyle fallback after the earlier paths fail. The browser
resolver admits only these two proven values; it does not generalize all
negative IDs.

## Full-model result

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-gstyle-material-fallback.ts \
  "/path/to/model.rvt" \
  "/path/to/reference.ifc"
```

The supplied UNBC model produced:

| Measure | Count |
| --- | ---: |
| decoded Faces | 139,106 |
| direct positive face materials | 133,482 |
| non-explicit fallback Faces | 5,624 |
| framed `GStyleElem` objects | 8,465 |
| exact 156-byte queued-`GStyle` records | 6,942 |
| alternate layouts rejected | 1,523 |
| decoded styles with positive material IDs | 229 |
| decoded positive style material IDs | 37 |
| styles binding to independently named `MaterialElem` | 47 |
| independently named material IDs used by those styles | 12 |

For the 5,624 fallback Faces:

| Result | Faces |
| --- | ---: |
| selected positive Face GStyle | 140 |
| selected positive owning-Geometry GStyle | 247 |
| neither node had a positive GStyle | 5,237 |
| selected GStyle decoded with material ID `-1` | 387 |
| newly exact material bindings | **0** |

All 387 selected style records were decoded; none hit an unsupported
`GStyleElem` layout. Their persisted `GStyle.m_materialElemId` is exactly
`-1`, so zero new bindings is a positive result, not a failed join or missing
decoder.

The first remaining carriers for these 5,624 Faces are therefore:

- no positive Face/Geometry GStyle on 5,237 Faces;
- an explicit persisted no-material value on the other 387 Faces.

Recovering additional exact materials requires a different native layer:
element/type/family geometry-tag assignments, category material lookup, or
view/system overrides. The 1,523 alternate `GStyleElem` layouts are still
unsupported in general, but none is on this Face fallback path.

The audit opens the IFC only after all RVT records and joins are finalized.
It reports 29 IFC material names and 14,768 styled items, but zero fallback
names to compare because the RVT produced zero new exact bindings.
