# Revit 2027 embedded GElement instance boundary

This checkpoint reconstructs the embedded representation used by 209 column
owners in the exact UNBC Revit 2027 corpus. It remains release-gated and fails
closed outside the measured source slots, descriptor states, selector values,
extents, face coverage, and root shapes.

## Persisted bodies

Source slot 2,215 has two exact `GInstance` static lengths:

```text
GInfo                                      20 bytes
conditional InstanceInfo                   6 bytes  token -1, slot 2513
conditional embedded GRep               4 or 6 bytes
tag ElementId                               8 bytes
forbidden target                            4 bytes
resolve-in-view + has-scale                 2 bytes
                                           --------
                                      44 or 46 bytes
```

The 44-byte form has a null four-byte embedded descriptor. The 46-byte form
has a positive six-byte descriptor; all 209 exact column occurrences use token
6 and source slot 2,246.

The selector-free source-2,246 body follows the recursive
`GElement -> GRep -> GGroup` schema in `Formats/Latest`:

```text
GInfo                                      20 bytes
m_subNodes count                            4 bytes
each non-null child descriptor              6 bytes
m_bBox                                     48 bytes
m_tightbBox                                48 bytes
m_elementId                                 8 bytes
m_gElemType                                 4 bytes
m_flags                                     4 bytes
```

The exact bodies are `136 + 6 * childCount` bytes. Their child shapes are:

| Shape | Owners |
| --- | ---: |
| tokens 8–11, all source 2,254 | 147 |
| tokens 8–9, all source 2,254 | 32 |
| tokens 8–10, all source 2,254 | 30 |

Every occurrence has object type 3 and flags 2. `m_elementId` equals its paired
`InstanceInfo.m_symbolId` for all 209. The local extent is valid; the second
tight/world extent carries an invalid sentinel and is not used as an
association envelope.

## Native precedence and transform

Static inspection of `TB_Geometry.tx` establishes two independent branches:

- `OdBmGInstanceImpl::getGeometryWithOpts` at `0x36758e` reads
  `getEmbeddedSymbolGRep`; when non-null it creates the embedded group's
  iterator and calls `parseForGeometries`. Only the null branch at `0x367ca4`
  delegates geometry resolution to `InstanceInfo`.
- `OdBmGInstanceImpl::subViewportDraw` at `0x3655cb` tests the embedded GRep
  first, applies `InstanceInfo::getTrf`, draws the embedded representation, and
  restores the draw context. Its external-symbol branch is used only when the
  embedded pointer is null.

The browser therefore suppresses external symbol traversal for a non-null
embedded descriptor. It associates descendant Face replay paths with that
embedded GElement and composes matrices outer-to-inner before any later scene
placement.

As an independent exact-model check, transforming the eight corners of every
embedded local box by its paired column-major `InstanceInfo` matrix reproduces
the outer framed root local box for 209 of 209 owners. The maximum component
difference is `1.56e-13` feet.

## Exact RVT/IFC result

The complete FIFO audit now replays all 16,977 admitted roots:

| Measure | Result |
| --- | ---: |
| Failed partition chunks | 0 of 3,666 |
| Source-2,215 GInstance spans | 821 |
| Source-2,246 embedded GElement spans | 209 |
| Replay failures | 0 |
| External instance links after embedded suppression | 612 |

The production missing-owner audit retains the fixed 925-tag IFC diagnostic
population and reports:

| Measure | Result |
| --- | ---: |
| Complete requested owners | 722 |
| Partial requested owners | 203 |
| Complete embedded-column owners | 169 of 209 |
| Embedded-column bounds within 0.5 ft of IFC | 169 |
| Embedded-column exact IFC triangle counts | 56 |

Across the full 36,144-Tag IFC geometry population, this route raises complete
certified native Tag presence from 35,762 to 35,931 (`99.4107%`) and half-foot
spatial parity from 35,669 to 35,838 (`99.1534%`). The 40 partial column meshes
are excluded from both totals.

The exact production extraction contains 35,198 native elements and 823,452
native triangles in an 860,494-triangle final scene. The 48,620,092-byte GLB
has SHA-256
`b88919ac14a2ff03160e0195ecff9c2cffbe055e47b50dab985fa6ade1cf16f8`.
Native triangles are `95.6953%` of the scene, and final triangle count is
`92.1178%` of the 934,123-triangle IFC oracle.

The remaining 40 framed columns fail drawable coverage rather than parsing or
association. Their blockers are unresolved loops, unsupported surfaces,
non-rectangular cylinder trims, multi-loop cylinders, and two UV-link cases.
Another 15 IFC columns have no framed GRep definition. These remain proxy/IFC
fallbacks.

The 40 framed failures contain 89 missing positive-loop cylinder faces: 74
non-rectangular single-loop trims, 13 multi-loop trims, and two UV-link
discontinuities. Planar-path diagnostics on the same faces are duplicate
fallback noise. This makes arbitrary sampled cylinder p-curve triangulation
the next geometry route; it is not a reason to weaken replay or association.

## Reproduction

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-public-grep-replay.ts model.rvt \
  > /tmp/revit-public.json

node --experimental-strip-types \
  scripts/audit-revit-2027-missing-owner-routes.ts \
  --rvt model.rvt \
  --ifc model.ifc \
  --rvt-audit /tmp/revit-public.json \
  --json /tmp/revit-missing-owner.json
```
