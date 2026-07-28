# Persisted Revit host relationships

This client-side TypeScript decoder adds one genuine model-graph relation:
`hosted element → host element`. It does not infer membership from geometry,
element-id proximity, partition adjacency, or IFC.

## Field identity

Three independent observations identify the field:

1. The RVT's embedded schema declares `InsertableInst.m_hostId`, preceded by
   `m_hostParam` and followed by the extra/explicit host-id arrays.
2. Static native API inventory exposes
   `OdBmInsertableInst::getBaseHostId()`,
   `OdBmFamilyInstance::getHostId()`, and the internal base-host accessor.
3. In Revit 2027 framed `0x07ef` objects, the corresponding 64-bit object id is
   at `+151`. A versioned optional-field layout moves it to `+153`.

The browser decoder reads `+151` first and accepts it only when the target is a
separately framed element. It considers `+153` only when `+151` does not
resolve. This ordering matters: the overlapping `+153` byte window looks like a
live element id in 26,589 ordinary records but is the real host field in only
the alternate layout.

## Exact UNBC validation

The supplied IFC is used only as an independent oracle. Its
`IfcRelFillsElement` and `IfcRelVoidsElement` chains provide 1,820
opening/door/window-to-wall host expectations.

- 27,568 persisted RVT host relationships resolve overall;
- 27,498 use `+151`, and 70 use the alternate `+153` layout;
- all 1,820 IFC host expectations decode from the RVT;
- exact host-id matches: 1,820;
- mismatches: 0;
- missing: 0.

Offset controls demonstrate why the field-specific decoder is needed:

- `+150`: 27,498 raw windows, zero framed targets;
- `+152`: 450 framed targets, zero IFC host matches;
- unrestricted `+153`: 26,589 framed targets but 1,653 IFC mismatches;
- primary-then-alternate decoding: 1,820 matches, zero mismatches.

## Model-tree parity

The host edge remains distinct from `OwningElementId`; both are exported in the
model graph. Projecting either persisted relation as tree membership improves
the exact comparable IFC coverage:

| Projection | Comparable members | Coverage |
| --- | ---: | ---: |
| `OwningElementId` only | 25,884 / 38,063 | 68.0% |
| `OwningElementId` plus host | 29,526 / 38,063 | 77.6% |

The host relation contributes 3,642 comparable members not already covered by
persisted ownership.

This is not associated-level/storey membership, assembly membership, or nested
family ownership. Those remain separate relation kinds and are not synthesized
from the host edge.
