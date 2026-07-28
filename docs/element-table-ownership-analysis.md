# Persisted Revit element ownership

## Result

The Revit 2024-2026 `Global/ElemTable` stream contains an authoritative
`OwningElementId` for each ordinary element record. It can support a genuine
ownership graph in the browser, but it does **not** justify assigning the two
remaining IFC products to the adjacent geometry records in the UNBC model.

The clean-room TypeScript decoder is
`lib/reviter/element-relations.ts`. It operates on the inflated stream with
`DataView` and has no native or Node dependency.

## Contract evidence

Static API inspection identifies four reflected `OdBmElemRec` properties:

1. `ObjectId`
2. `History`
3. `PartitionId`
4. `OwningElementId`

The native getters and setters place `OwningElementId` in the element record,
and `OdBmElement::getOwningElementId()` delegates to that record. Independently,
the model's own `Formats/Latest` schema defines `ElemRec` with seven fields,
including adjacent `m_id` and `m_OwningElementId` fields that use the same
ElementId type token.

The UNBC 2026 stream then supplies a measurable fixed-width representation:

- collection count: unsigned 32-bit integer at byte 2;
- first complete ordinary record: byte 34;
- ordinary record stride: 40 bytes;
- owning element id: unsigned 64-bit value at row byte 0;
- object id: unsigned 64-bit value at row byte 12;
- partition id: unsigned 32-bit value at row byte 20;
- repeated object id: unsigned 64-bit value at row byte 32;
- table suffix: 36 bytes.

The decoder checks the collection length, every zero object-id prefix, every
object-id echo, every duplicate id, and every 64-bit id conversion. It emits
only persisted edges. It never creates an edge from neighbouring ids or rows.

## Exact UNBC probe

Command:

```sh
node --experimental-strip-types scripts/probe-element-relations.ts \
  "/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/UNBC BIM/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt" \
  1272040 1272041 1280585 1280586
```

Measured result:

- inflated element table: 2,977,550 bytes;
- declared records: 74,438;
- complete ordinary records decoded: 74,437;
- root/no-owner records: 23,484;
- self-owned table/partition records: 748;
- persisted non-self ownership edges: 50,205;
- dangling owner references: 0.

Target rows:

| Element | Persisted owner | Partition | Byte offset | Persisted children |
|---:|---:|---:|---:|---|
| 1,272,040 | 1,271,877 | 776 | 699,674 | none |
| 1,272,041 | 1,271,877 | 776 | 699,714 | none |
| 1,280,585 | none | 776 | 723,994 | 2,375,905 |
| 1,280,586 | 1,280,525 | 776 | 724,034 | none |

Therefore:

- `1,272,040` and `1,272,041` are siblings, not owner and child.
- `1,280,585` does not own `1,280,586`; the latter belongs to `1,280,525`.

The exact blocker to using either adjacent geometry record for IFC parity is no
longer uncertainty about the element table: the persisted ownership graph
contradicts both proposed joins. Closing those two geometry gaps requires a
different typed relation or decoding the missing elements' own geometry/BRep;
row adjacency is not valid evidence.
