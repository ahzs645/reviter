# Geometry class-slot resolution

> **Release correction:** This historical note combines exact UNBC Revit 2027
> slot observations with a Revit 2026 source-class table. The same-number
> class labels and the claim that class-slot resolution is complete for UNBC
> are superseded by the
> [Revit 2027 release boundary](revit-2027-grep-release-boundary.md). The
> **Native loader boundary**, raw **Exact UNBC schema evidence**, and the pure
> Revit 2026 source-representation map remain valid within their own release
> scopes; the 2026 map must not name 2027 source slots.

The browser parser must not map schema tag reference `1426` (`0x0592`) directly to
`GPolyMesh`, `GBRep`, or `GFakeBRep`. The exact UNBC `Formats/Latest` stream
contains one high-bit tagged definition and 26 structurally valid class
headers carrying that low-bit reference.

Most importantly, the word following a schema class name and the signed
`int16` at a partition object boundary serve different scopes. After
`GPolyMesh`, `0x0592` is a schema `tagReference`; there is no evidence that it
is the `GPolyMesh` object selector.

## Native loader boundary

Clean-room static analysis of the unstripped ELF metadata and small call sites
in `TB_LoaderBase.tx` establishes three separate identities:

1. `OdBmObjectPtrInitReader::read` at `0x180cda` reads a signed little-endian
   `int16` and passes the sign-extended value to
   `ClassesContainer::find(unsigned)` at `0xe0efa`.
2. `ClassesContainer::find(unsigned)` uses the argument as a direct index into
   its class-pointer vector.
3. `ClassDefinitionRef201120260Reader::read` at `0xe73ce` reads the same
   signed `int16`, calls `find`, and then calls
   `ClassesContainer::targetClass` at `0xe1d0c`. It returns the target when one
   exists and the original class otherwise.

`ClassesContainer::addClass(unsigned, OdTfClass*, ...)` at `0xe243e` can put
the same runtime class pointer in several vector slots.
`ClassesContainer::addRepresentation(unsigned, OdTfClass*, bool)` at
`0xe1f78` stores a target class separately in the record at offset `+0x10`.
Consequently, the partition object slot, schema tag reference, schema
class name, and selected runtime class are not interchangeable.

`ObjectPtrInitReader::read` at `0x182214` delegates to
`OdBmObjectPtrInitReader::read`; it does not introduce a second framing rule.

## Exact UNBC schema evidence

The high-bit definition is:

| Offset | Name | Raw word | Slot |
| ---: | --- | ---: | ---: |
| 170,524 | `GEdgeBase` | `0x8592` | 1,426 |

The geometry class records sharing tag reference `0x0592` include:

| Offset | Name | Version | Fields | First field |
| ---: | --- | ---: | ---: | --- |
| 225,226 | `GFace` | 10 | 7 | decoded by probe |
| 236,372 | `GCurve` | 3 | 1 | decoded by probe |
| 262,981 | `GInstance` | 6 | 6 | `m_instanceInfo` |
| 263,243 | `GBRep` | 1 | 1 | `m_pFaces` |
| 266,150 | `GFakeBRep` | 1 | 1 | `m_recoveryKey` |
| 268,643 | `GPolyMesh` | 10 | 4 | `m_pFacetedTopology` |

The probe reports all 26 reference records rather than embedding a release-
specific list. `GBRep` has no exported runtime symbol in `TB_Geometry.tx`,
while `OdBmGFakeBRep`, `OdBmGInstance`, and `OdBmGPolyMesh` do. This is
consistent with persisted representation names being distinct from runtime
class identities. It is not by itself enough to reconstruct the missing
outer mapping.

It is also not a base-class reference. `OdBmGPolyMesh::rxInit` at `0x43e1c8`
and `OdBmGFakeBRep::rxInit` at `0x41cab6` both call `OdBmGNode::desc` as their
runtime base, not `OdBmGEdgeBase::desc`. The exact semantic name of the
low-bit schema reference therefore remains deliberately unresolved.

## Browser-safe rule

`inspectSchemaTagReference` scans `Formats/Latest` and returns:

- high-bit tagged definition records;
- bounded low-bit reference records with version, field count, and first
  field;
- an explicit `shared-reference` status when several class records carry the
  same reference.

`selectSchemaReferenceRecord` fails closed on a shared reference. It only
locates a record when there is one header or when its caller supplies an exact
expected name obtained from independently decoded schema context. It does not
resolve a partition object selector.

The partition probe separately counts two-byte occurrences. These counts are
diagnostic only: arbitrary numeric payloads contain the same byte pairs, so a
hit is not called a class selector unless a higher-level reader has established
the object boundary.

## Reproduction

```sh
node --experimental-strip-types --test tests/schema-tag-references.test.ts
node --experimental-strip-types scripts/probe-geometry-tag-references.ts \
  "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt" \
  1426
```

The release-specific bridge was subsequently found in a local ODA trial
backup. Static inspection of `TB_Format2026Readers.tx` (SHA-256
`09d1867c1aaea3653c750fb015fa17838e71da8ad0c52a9de834de920b644e0f`)
resolves:

| Source-class slot | Reader target |
| ---: | --- |
| 2,177 | `OdBmGBrep` |
| 2,210 | `OdBmGFakeBRep` |
| 2,237 | `OdBmGPolyMesh` |

The exact `GPolyMesh` reader also proves that its nested topology is scheduled
through `OdBmCondInt16Reader` and `OdBmDynamicQueue`, rather than read inline.
The remaining bridge is therefore no longer the class-slot mapping: it is
reproducing that queued-property association so a selector-free topology body
can be joined back to its owning `GPolyMesh`.

See `docs/rvt-2026-gpolymesh-reader-boundary.md` for the reader call order and
the `FacetedTopology8`-shaped span boundary measured against all three UNBC
payloads.
