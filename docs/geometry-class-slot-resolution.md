# Geometry class-slot resolution

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

The missing bridge is the scoped mapping created by the release-specific
`OdBmFormatIOModule`. `getSpecifiedContainer(FileVersion)` in `TB_Loader.tx`
contains dynamic module names `TB_Format2011Readers` through
`TB_Format2026Readers` and queries the loaded module as
`OdBmFormatIOModule`. The supplied isolated directory contains none of those
reader modules; it exposes only the abstract module surface in
`TB_LoaderBase.tx`.

For this exact 2026 model, `TB_Format2026Readers` is therefore the concrete
native piece missing from the reference bundle. A client-side implementation
still needs a lawful TypeScript replacement rather than loading that Linux
module in a browser, but the module boundary tells us where the unresolved
slot/representation registration belongs.

Recovering that mapping, then decoding an enclosing `GNode`/geometry
collection boundary, is required before an actual partition selector can
safely route `GPolyMesh` to the stored faceted-topology decoder or
`GBRep`/`GFakeBRep` to a BRep-specific path.
