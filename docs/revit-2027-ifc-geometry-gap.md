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

The certified browser mesh audit publishes 31,353 distinct RVT product
candidates: 5,815 direct geometry owners plus 25,538 placed instances. It
matches 25,642 of the IFC's 36,144 distinct numeric geometry Tags.

The remaining 10,502 IFC Tags split into two disjoint persisted-route gaps:

| Missing RVT route | Tags | IFC triangles |
| --- | ---: | ---: |
| no certified direct owner or placement | 8,483 | 449,323 |
| exact placement to an unreplayed owner | 2,019 | 166,472 |

There are 327 distinct unreplayed shared owners behind the second row.

The class distribution is:

| IFC class | Missing tags | No owner/placement | Unreplayed shared owner |
| --- | ---: | ---: | ---: |
| `IfcWallStandardCase` | 7,381 | 7,381 | 0 |
| `IfcDoor` | 1,912 | 0 | 1,912 |
| `IfcMember` | 354 | 354 | 0 |
| `IfcColumn` | 311 | 224 | 87 |
| `IfcRailing` | 215 | 215 | 0 |
| `IfcWall` | 140 | 140 | 0 |
| `IfcStairFlight` | 108 | 108 | 0 |
| `IfcSlab` | 49 | 49 | 0 |
| `IfcWindow` | 20 | 0 | 20 |
| `IfcRamp` | 11 | 11 | 0 |
| `IfcRoof` | 1 | 1 | 0 |

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
not the currently replayed `GElement` marker. Owner 845,328 contains ten
contiguous persisted 105-byte Plane bodies near the end of its 8,297-byte
frame. Those surfaces are positive geometry evidence, but surfaces alone do
not establish the native face-loop-edge ownership required to publish a solid.

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

This inventory therefore sets two separate implementation tracks:

- replay the Revit 2027 FamilySymbol geometry graph to unlock the 2,019 already
  placed doors, windows, and columns;
- locate and replay the system-family geometry route for the 8,483 products
  that have no current direct-owner or shared-placement candidate, especially
  walls.

Adding another surface tessellator cannot by itself fix either ownership gap.
