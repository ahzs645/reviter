# Revit 2027 GGroup static and nested-FIFO boundary

This checkpoint is release-gated to the exact UNBC Revit 2027 model. It does
not apply a Revit 2026 class name to a same-numbered 2027 source slot.

## Complete slot-2248 static body

`BasicFileInfo` records `Format: 2027`. In that file's inflated
`Formats/Latest`, the recursive definition at byte 265,814 is:

```text
GElement
  GRep
    GGroup version 1, field count 1
      m_subNodes  descriptor 0e 51 00 00 00 00 00 00
    GRep version 6, field count 5
      m_bBox, m_tightbBox, m_elementId, m_gElemType, m_flags
```

The five GRep fields are in the derived GRep layer. They are not a suffix of a
scoped GGroup object. The complete selector-free source-slot 2,248 GGroup body
is therefore:

```text
GNode/GInfo                         20 bytes
GGroup m_subNodes count             int32
each m_subNodes descriptor          int32 token
non-null descriptor                 int16 source slot
```

There are zero additional GGroup static or derived-suffix bytes.
`decodeRevit2027GGroupStatic` exposes that complete boundary. The exact audit
decodes it for all 17,038 roots whose first dynamic entry is source slot
2,248.

## Nested FIFO position

Static inspection of `TB_LoaderBase.tx` establishes the queue transition:

- `OdBmDynamicQueue::addProperty` hooks a new node at the list tail at
  `0x173630`;
- `readPropertyToken` selects the list front at `0x17541b`;
- the scoped child reader runs at `0x175a54`;
- only after it returns is the front node unhooked at
  `0x175600`–`0x175619`.

Nested properties discovered while reading the first GGroup are therefore
appended behind every initial GRep sibling already in the queue. Their bodies
do not begin at the GGroup static end unless no older sibling remains.

`locateRevit2027FirstGGroupNestedFifo` consumes only the three independently
certified 2027 body readers available at this checkpoint:

- source slot 2,248: schema-complete GGroup;
- source slot 2,215: exact 144-byte GArray;
- source slot 1,973: exact 84-byte GLine.

It validates the global append-token sequence and returns the first nested
body offset without consuming or naming that body.

## Exact-model coverage

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-ggroup-fifo.ts model.rvt
```

The exact UNBC model reports:

| Measure | Result |
| --- | ---: |
| First-entry slot-2,248 roots | 17,038 |
| Complete GGroup static bodies | 17,038 |
| Complete GGroups with no nested child | 3,422 |
| Complete-body coverage | 100% |
| FIFO positions covered using only 1,973/2,215/2,248 sibling readers | 7,730 |
| Covered non-empty first groups | 4,494 |
| Covered first-nested source slots | 2,248: 4,466; 2,343: 19; 2,215: 9 |
| Failed chunks | 0 of 3,666 |

The remaining FIFO positions stop before consuming an uncertified initial
sibling:

| Blocking initial sibling slot | Roots |
| ---: | ---: |
| 2,343 | 7,572 |
| 2,254 | 1,441 |
| 2,213 | 291 |
| 2,244 | 4 |

These failures are deliberate. Adjacency cannot replace the missing reader
because each sibling may have variable static bytes and may append more queue
entries.

## Tessellator and IFC handoff

The native tessellator layer (`TB_Geometry`, `libTD_Ge`,
`libOdBrepModeler`, `libTD_BrepBuilder`, `libTD_Br`, and
`libTD_BrepRenderer`) becomes relevant only after replay reaches an owned,
release-certified solid or stored-mesh body. The dedicated source-slot 2,343
reader now decodes all 19 first-nested `Geometry` static bodies and exposes
their owned face and edge queues. The queued face, edge, loop, curve, and
surface bodies remain the boundary before a browser tessellator can emit
triangles.

The reference IFC contains 9,371 `IFCFACETEDBREP`/`IFCCLOSEDSHELL` bodies,
93,749 `IFCFACE` records, and 93,874 `IFCPOLYLOOP` records. This GGroup route
still binds zero tessellated RVT solids or meshes to those IFC bodies, so geometry
parity remains 0 of 9,371 rather than an inferred match.

The kernel-facing blocker is precise: first add release-certified readers for
the blocking initial siblings above, continue FIFO replay to a genuinely
owned BRep or mesh class, and only then feed its decoded topology to a
browser-safe tessellator or compare its triangles with the IFC oracle.
