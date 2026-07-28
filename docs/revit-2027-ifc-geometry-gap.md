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

## FamilySymbol regeneration checkpoint

All offsets below are relative to the start of the independently
length/echo-framed FamilySymbol record, including its 16-byte frame prefix.
The three reproducible target records are:

| Owner | Object length | First queue descriptors | `m_refFaces` descriptors | Face bodies | Plane bodies |
| ---: | ---: | --- | --- | --- | --- |
| 845,328 | 8,297 | `+34`: token `-1`, slot 2,337 `GeomStepList`; `+40`: token `-1`, slot 2,338 `GeomTable` | count 11 at `+247`; tokens 3–13 at `+251..+317` | `+2478..+3116`, 11 × 58 bytes | `+7158..+8313`, 11 × 105 bytes |
| 788,064 | 8,297 | `+34`: token `-1`, slot 2,337; `+40`: token `-1`, slot 2,338 | count 11 at `+247`; tokens 3–13 at `+251..+317` | `+2478..+3116`, 11 × 58 bytes | `+7158..+8313`, 11 × 105 bytes |
| 2,179,544 | 4,570 | `+38`: token `-1`, slot 2,337; `+44`: token `-1`, slot 2,338 | count 16 at `+203`; tokens 3–18 at `+207..+303` | `+1261..+2189`, 16 × 58 bytes | `+2906..+4586`, 16 × 105 bytes |

These are exact byte facts:

- Every Face has a null first loop, zero face regions, null foreground and
  background fillings, and one queued slot-634 `Plane`.
- The Plane representation is the native 32-byte parameter envelope, one
  orientation byte, and three 24-byte vectors. The old surface scan began 32
  bytes into each body and crossed into the next body's envelope; ten scan
  hits therefore represented eleven Plane bodies.
- The three frames contain no property descriptor selecting slot 4,019
  `SnapshotData`, slot 2,343 `Geometry`, slot 2,248 `GGroup`, slot 2,177
  `GBRep`, slot 2,237 `GPolyMesh`, or a complete Face/EdgeLoop/GEdge topology
  graph.
- Owners 845,328 and 788,064 contain four additional slot-1,973 `GLine`
  descriptors, tokens 27–30 at `+1686..+1710`. Their four 84-byte bodies are
  contiguous at `+6822..+7158` and have geometry tags 3, 2, 1, and 0. Lines
  are curve evidence, not face-loop ownership.

The following is the current queue interpretation and is deliberately not a
published reader contract:

- The candidate replay boundary is `+1678` for owners 845,328 and 788,064,
  and `+1011` for owner 2,179,544.
- A zero `u32` at each candidate boundary is consistent with the compact
  empty-`GeomStepList` representation. The next bytes are consistent with
  `GeomTable`: count 4 plus the four GLine descriptors at `+1682` for the two
  door symbols, and count 5 at `+1015` for the column symbol.
- The column's five table records do not decode as CondInt16 properties. The
  first unsupported schema carrier is `GeomTable.m_table`, whose inline slot
  643 `BigArrGeomTabEntryWrapper` owns slot 644 `GeomTabEntry` records.
  `GeomTabEntry` in turn contains `m_pGNode` and
  `m_geomGeneratorId`. Its retained/reference representation must be decoded
  before the replay boundary or table ownership can be certified.
- No slot-4,019 descriptor exists in any target, so the four declared
  `GeomStepList` snapshots—form, adjust, cut-out, and post-cut-out—do not
  provide a persisted fallback geometry graph in these records.

This is also the boundary of the native tessellator layer. `TB_Geometry`
`OdBmGeometryImpl::brepBuilder` (`0x3891c6`) and `brep` (`0x389408`),
`TB_Database` `OdBmModelerGeometryImpl::createBrepRendererImpl`
(`0x221cf42`), and the downstream `libTD_Ge`, `libOdBrepModeler`,
`libTD_BrepBuilder`, `libTD_Br`, and `libTD_BrepRenderer` stack require an
already reconstructed, owned BRep. They do not deserialize
`BigArrGeomTabEntryWrapper`, regenerate a family, or invent loop/coedge
ownership.

The remaining shared-owner gap is 327 owners and 2,019 placed IFC Tags:
1,912 doors, 87 columns, and 20 windows. The three targets above account for
464 of those Tags (222 + 218 + 24). Until the slot-643/644 table representation
and any referenced family-regeneration state are exact, the browser converter
must not infer boxes or solids from the GLine set, `m_refFaces`, or the IFC
export.

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
