# Revit 2027 geometry-gap inventory

This audit separates missing browser geometry by the persisted RVT route that
must be decoded next. The IFC is a post-decode acceptance oracle only: it is
never read by conversion, used to locate an RVT record, or used to synthesize a
mesh.

## Reproduce

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-public-grep-replay.ts \
  "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt" \
  > /tmp/reviter-public-ifc-gap-inventory.json

node scripts/audit-revit-2027-planar-ifc-parity.mjs \
  --ifc "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library).ifc" \
  --rvt-audit /tmp/reviter-public-ifc-gap-inventory.json \
  --json /tmp/reviter-public-ifc-gap-diagnosis.json
```

The exact IFC SHA-256 is
`adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0`.

## Exact UNBC result

The certified browser mesh audit publishes 38,807 distinct RVT product
candidates: 13,269 direct geometry owners plus 25,538 placed instances. It
matches 33,090 of the IFC's 36,144 distinct numeric geometry Tags, or 91.55%.

The remaining 3,054 IFC Tags split into three disjoint persisted-route gaps:

| Missing RVT route | Tags | IFC triangles |
| --- | ---: | ---: |
| exact placement to an unreplayed owner | 2,019 | 166,472 |
| no certified direct owner or placement | 925 | 220,357 |
| direct geometry owner without a certified mesh | 110 | 80,404 |

There are 327 distinct unreplayed shared owners behind the placement row.

The class distribution is:

| IFC class | Missing tags | No owner/placement | Unreplayed shared owner | Direct owner, no mesh |
| --- | ---: | ---: | ---: | ---: |
| `IfcDoor` | 1,912 | 0 | 1,912 |
| `IfcMember` | 354 | 354 | 0 | 0 |
| `IfcColumn` | 311 | 224 | 87 | 0 |
| `IfcRailing` | 215 | 105 | 0 | 110 |
| `IfcStairFlight` | 108 | 108 | 0 | 0 |
| `IfcWallStandardCase` | 59 | 59 | 0 | 0 |
| `IfcSlab` | 49 | 49 | 0 | 0 |
| `IfcWindow` | 20 | 0 | 20 | 0 |
| `IfcWall` | 14 | 14 | 0 | 0 |
| `IfcRamp` | 11 | 11 | 0 | 0 |
| `IfcRoof` | 1 | 1 | 0 | 0 |

The largest unreplayed owner groups are FamilySymbol-shaped objects:

| Owner element id | Placed tags | IFC class | IFC triangles |
| ---: | ---: | --- | ---: |
| 845,328 | 222 | `IfcDoor` | 15,096 |
| 788,064 | 218 | `IfcDoor` | 14,824 |
| 899,478 | 152 | `IfcDoor` | 10,336 |
| 863,572 | 131 | `IfcDoor` | 8,908 |
| 1,119,482 | 48 | `IfcDoor` | 3,264 |
| 2,179,544 | 24 | `IfcColumn` | 288 |

These owners have the exact Revit 2027 `FamilySymbol` wire marker `0x0810`,
not the currently replayed `GElement` marker. Owner 845,328 contains eleven
contiguous persisted 105-byte Plane bodies near the end of its 8,297-byte
frame. Exact field-order and queue inspection identifies them as
`FamilySymbol.m_refFaces` surfaces. Every owning Face has no first loop or
face region, so these are unbounded reference faces rather than drawable BRep
topology.

## System-wall route correction

The original inventory admitted only a GRep root with one initial `Geometry`
descriptor. This excluded 7,322 `IfcWallStandardCase` products even though the
existing FIFO readers could already replay their full topology. Their exact
root shape is:

```text
[GGroup, GGroup, GGroup, GGroup, Geometry]
```

The release-gated classifier now accepts exactly `[Geometry]` or one-or-more
leading `GGroup` descriptors followed by one terminal `Geometry`. It rejects
`GFilter`, null/unknown descriptors, non-terminal Geometry, and repeated
Geometry. With that caller gate corrected:

- all 7,322 group-prefixed standard-wall roots replay and mesh;
- 7,322 of 7,381 `IfcWallStandardCase` Tags and 126 of 140 `IfcWall` Tags
  enter the certified candidate set;
- certified owner meshes rise to 13,269 owners and 302,235 local triangles;
- overall IFC Tag coverage rises from 70.94% to 91.55%.

The 110 direct-owner/no-mesh cases are railings whose nested persisted
`Trf201120260` currently contains a non-finite scalar. They remain fail-closed
pending an exact transform-semantic decode.

## Consequence

The native `TB_Geometry`, `libTD_Ge`, `libOdBrepModeler`,
`libTD_BrepBuilder`/`libTD_Br`, and `libTD_BrepRenderer` stack operates after
the persisted object graph has supplied:

1. geometry ownership;
2. faces and their oriented loops/coedges;
3. analytic 3D curves and surfaces;
4. geometry tags and material ids;
5. view/tessellation parameters.

The browser implementation follows the same boundary. Its analytic evaluators
and BRep tessellator can consume a certified graph, but must not infer topology
from a collection of plane equations or use the IFC mesh as replacement
topology.

This inventory therefore sets three separate implementation tracks:

- replay the Revit 2027 FamilySymbol geometry graph to unlock the 2,019 already
  placed doors, windows, and columns;
- recover the exact nested-transform semantics for the 110 already located
  railing owners;
- locate the persisted owner routes for the remaining 925 products, led by
  members, columns, stair flights, and railings.

Adding another surface tessellator cannot by itself fix these ownership and
regeneration gaps.
