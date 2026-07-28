# Revit 2027 UNBC GRep release boundary

This checkpoint corrects a release-label error in the earlier UNBC GRep
audits. The exact model is a Revit **2027** file. A source-class number read
from that file must not be named with the class at the same numeric index in
`TB_Format2026Readers.tx`.

The result is a clean-room interoperability boundary. The native modules were
inspected statically; they were not executed. The IFC remains an output audit
oracle and is not an input to any RVT decoder.

## Inputs

| Input | SHA-256 |
| --- | --- |
| exact UNBC RVT | `8c294549ee667ed7aba38f1f4f3a53514dae7544af97f0157ee8187dd8702178` |
| inflated UNBC `Formats/Latest` (513,948 bytes) | `d961c44726fe7fc32bce4425639481a5d5e91acecec7b7fd897610fc369f046f` |
| local `TB_Format2026Readers.tx` | `09d1867c1aaea3653c750fb015fa17838e71da8ad0c52a9de834de920b644e0f` |

`BasicFileInfo` is version 14 and records:

- `Format: 2027`;
- `Build: 20260417_1515(x64)`;
- `ClientAppName: RevitApplication`.

This is application/file-format evidence. It does not prove that a module
named `Format2026` can consume a 2027 source-class table.

## Corrected high-volume identities

The exact embedded schema and the payload bytes jointly resolve the two
high-volume source classes that were previously called 2026 “leaves”:

| UNBC source slot | Root descriptors | 2027 identity | Independent evidence |
| ---: | ---: | --- | --- |
| 2,215 | 40,652 | `GArray` | `Formats/Latest` defines `GArray` with tag 2,215 and parent `GInstance`; the payload ends in the schema-declared 96-byte transform |
| 2,248 | 42,832 | `GGroup` | the 2027 source order is `GElement` 2,246, `GRep` 2,247, `GGroup` 2,248; every tested payload begins with the exact `GNode/GInfo + AllSubNodes` prefix |

They are **not** the classes at the same numeric indexes in the 2026 module:

| Numeric slot | 2026 module class | Exact 2027 UNBC class |
| ---: | --- | --- |
| 2,215 | `GFlipControl` | `GArray` |
| 2,248 | `GStyle` | `GGroup` |

The old same-number lookup crossed release-scoped source tables. It must not
be used to authorize body consumption.

### Slot 2,215 payload

There are 30,572 roots whose only initial child is slot 2,215. Every dynamic
payload is exactly 140 bytes. All 30,572 have:

```text
GInfo                                      20 bytes
GInstance conditional instanceInfo         6 bytes (token -1, source 2513)
GInstance null embedded-symbol GRep         4 bytes
GInstance tag ElementId                     8 bytes
GTarget target value                        4 bytes
resolveSymInView + hasScale                  2 bytes
stepTrf                                    96 bytes (12 float64)
                                           --------
                                            140 bytes
```

All 30,572 transforms are finite and have three mutually orthogonal unit
basis vectors. The available 2026 `GArray` reader also calls `GInstance` and
then the 96-byte `Trf201120260Reader`, which corroborates the shared portion
of the call order. The exact 2027 body does not contain the trailing
`m_numInstances` `int32` that the 2026 reader would consume. Consequently this
is positive class/layout evidence and a negative compatibility result: the
2026 direct reader is not a byte-for-byte 2027 reader.

### Slot 2,248 nested group prefix

Slot 2,248 is the first initial child in 17,038 framed roots. All 17,038
decode the following bounded prefix at the exact replay start:

```text
GInfo                                      20 bytes
AllSubNodes count                          int32
each child                                 int32 token
non-null child                             int16 source slot
```

All 17,038 nested token sequences continue exactly after the outer initial
tokens. The immediate nested-source census is:

| Nested source slot | Count |
| ---: | ---: |
| 2,343 | 7,395 |
| 2,248 | 6,016 |
| 2,215 | 288 |
| 1,973 | 252 |
| 2,219 | 203 |
| 2,213 | 78 |

The nested child-count shapes are:

| Shape | Roots |
| --- | ---: |
| one 2,343 child | 7,395 |
| one 2,248 child | 5,813 |
| no child | 3,422 |
| 2,248 then 2,219 | 203 |
| two 2,215 children | 110 |
| 1,973, 1,973, 2,213 | 78 |
| other bounded shapes | 17 |

This is a certified nested `GGroup` route, but not yet a complete nested
object replay. The 2027 derived/static suffixes and the bodies of the
remaining initial siblings are needed before the child-enqueued values can be
located in the dynamic stream.

## 2027 drawable-slot boundary

The 2027 schema order plus the aligned 2026 class-name sequence identifies
the likely release-shifted drawable source classes:

| Persisted class | 2026 source slot | 2027 candidate source slot |
| --- | ---: | ---: |
| `GBRep` | 2,177 | 2,218 |
| `GFakeBRep` | 2,210 | 2,250 |
| `GPolyMesh` | 2,237 | 2,277 |

This alignment is strongly corroborated around the geometry class block:
2026 `GFilter` 2,214 becomes exact slot 2,254, `GFlipControl` 2,215 becomes
2,255, `GHermiteSpline` 2,219 becomes 2,259, `GPolyLine` 2,236 becomes
2,276, and `GPolyMesh` follows it at 2,277.

The distinction is important: the 232 exact outer descriptors at slot 2,276
are `GPolyLine`, not `GeomGeneratorData` and not `GPolyMesh`. Their payload
starts with the exact 2026-compatible `GPolyLine` shape (`GInfo`, counted
double-precision points, extents, filled flag).

None of the following appears in the certified outer-root descriptor census
or the certified first nested-group census:

- 2,218 candidate `GBRep`;
- 2,250 candidate `GFakeBRep`;
- 2,277 candidate `GPolyMesh`.

Because no local `TB_Format2027Classes/Readers` module is present, the
candidate mappings must remain dispatch evidence rather than an executable
reader registry. In particular, common slot 5,255
`FacetedTopology8` cannot be attached to the 2027 object graph until an owned
2,277 `GPolyMesh` property is reached and its exact 2027 field order is
certified.

## Required corrections

The following files currently mix a pure 2026 native table with exact UNBC
2027 counts or names and must be release-gated or renamed:

- `lib/reviter/revit-2026-grep-root.ts`
- `lib/reviter/revit-grep-queue-replay.ts`
- `lib/reviter/revit-2026-source-representations.ts`
- `scripts/audit-revit-2026-grep-roots.ts`
- `scripts/audit-revit-grep-queue-replay.ts`
- `docs/revit-2026-grep-child-reader-map.md`
- `docs/revit-2026-source-representation-targets.md`
- `docs/revit-grep-dynamic-queue-subset.md`
- `docs/rvt-2026-gpolymesh-reader-boundary.md`
- `docs/unbc-gpolymesh-object-context-audit.md`
- `docs/revit-2026-element-grep-carrier.md`

The root framing/static decoder should become release-neutral where its bytes
are independently certified, while source-class names and reader dispatch
must require `BasicFileInfo` release compatibility. A 2026 table may still be
documented and tested as a 2026 table; it must not label 2027 slot numbers.

The mixed-release documents now carry correction banners, and the queue audit
reports slots 2,215/2,248 only as numeric coincidences. The older 2026 root
and queue APIs remain release-scoped compatibility infrastructure; they are
not a 2027 reader registry.

## Browser implementation checkpoint

The following release-gated, browser-safe subset is now implemented:

- `decodeRevit2027FramedGRepRoot` adapts only the independently measured
  length/echo frame, `GInfo`, `AllSubNodes`, extents, owner, object-type, and
  flags grammar;
- `decodeRevit2027GArray` consumes only an exact 140-byte slot-2,215 body;
- `decodeRevit2027GGroupPrefix` consumes `GInfo + AllSubNodes` only and
  returns the first unknown suffix byte without reading it.

The exact audit in
[`audit-revit-2027-grep-prefixes.ts`](../scripts/audit-revit-2027-grep-prefixes.ts)
decodes 30,572/30,572 `GArray` bodies and 17,038/17,038 first-child
`GGroup` prefixes across 3,666 chunks, with zero reader or chunk failures.
It reads `BasicFileInfo` and refuses any release other than 2027.

## Safe next step

Reconstruct enough release-specific static suffixes and observed sibling
readers to locate the child-enqueued FIFO bodies. Only emit general BRep or
stored-mesh geometry after a complete replay reaches an owned 2,218, 2,250,
or 2,277 dispatch and consumes the exact body to its certified boundary.
