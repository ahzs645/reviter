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

## Earlier direct-owner checkpoint

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
published reader contract. The exact slot-643/644 and native-layout evidence is
recorded in [revit-2027-family-geom-table.md](revit-2027-family-geom-table.md).

- The candidate replay boundary is `+1678` for owners 845,328 and 788,064,
  788,064, 899,478, 863,572, and 1,119,482. A zero `u32` occurs there, but
  the exact division of the FIFO prefix between `GeomStepList` and
  `GeomTable` remains uncertified.
- At `+1682`, all five door symbols have count 4, four GLine selectors at
  `+1686..+1709`, and four signed generator IDs at `+1710..+1725`:
  `16, 0, 0, 0`.
- Owner 2,179,544 cannot share that boundary. Its queue places
  `ParamValueSetInt` and `ParamValueSetElementId` ahead of `GeomStepList` and
  `GeomTable`; `+1011` begins those parameter-map bodies, and `+1015` is the
  five-entry ElementId parameter map rather than a geometry table.
- Source slot 644 declares `m_pGNode` and `m_geomGeneratorId`, but the native
  `OdBmGeomTabEntry` implementation is exactly four bytes and retains only the
  generator ID. `GeomTable` is generated from active `GeomStepList`
  Face/Edge/Curve history maps. The serialized node selectors are replay
  evidence, not a stable drawable ownership bridge.
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

At that earlier checkpoint, the remaining shared-owner gap was 327 owners and
2,019 placed IFC Tags:
1,912 doors, 87 columns, and 20 windows. The three targets above account for
464 of those Tags (222 + 218 + 24). Until the slot-643/644 table representation
and the referenced family-regeneration state are exact, the browser converter
must not infer boxes or solids from the GLine set, `m_refFaces`, generator IDs,
or the IFC export.

## Placement-seeded GRep closure

The earlier diagnosis incorrectly assumed that every placement target absent
from the direct-owner result required family regeneration. A placement can
refer to an ordinary, non-direct GRep definition elsewhere in the same RVT.
The audit now seeds its second bounded scan from both nested-symbol ids and
placement `geometryId` values absent from the completed direct-owner set. It
follows the exact `GInstance.symbolElementId` closure and composes only roots
whose complete drawable-face coverage is certified.

On the exact UNBC RVT:

| Placement-target measure | Result |
| --- | ---: |
| Unique decoded placement geometry owners | 7,808 |
| Initial non-direct placement target ids | 2,395 |
| Placement provenance closure ids | 2,470 |
| Framed / unframed closure ids | 2,467 / 3 |
| Replayed definitions | 2,155 |
| Nested links inside the closure | 150 |
| Definitions with certified local mesh | 2,138 |
| Complete composed roots | 2,136 |
| Partial composed roots | 2 |
| Complete composed-root triangles | 44,531 |
| Partial triangles excluded atomically | 42 |

The combined nested-symbol plus placement-target scan is two passes over 2,593
unique ids: 2,590 are framed, 2,278 replay, and 2,151 contain certified mesh.
Only complete placement roots enter instance resolution. Direct nested roots
also require their complete composition; their direct fragment can never
silently win.

This raises certified placements from 25,538 to 30,093 and their triangle
total from 308,107 to 467,944. Against the reference IFC, matched numeric
geometry Tags rise from 33,198 / 36,144 (`91.8493%`) to
34,867 / 36,144 (`96.4669%`). IFC-only Tags fall from 2,946 to 1,277.

The 1,277 remaining IFC-only Tags are:

| Missing RVT route | Tags | IFC triangles |
| --- | ---: | ---: |
| no direct owner or decoded placement | 925 | 220,357 |
| placement to an unresolved owner | 350 | 56,712 |
| one incomplete nested root | 1 | 516 |
| direct owner without certified mesh | 1 | 824 |

The remaining unresolved placement row is 330 doors and 20 windows across 171
geometry owners. These roots are still fail-closed; the audit does not rebuild
a family or substitute IFC geometry.

### Transform validation

The new route has a separate world-bounds diagnostic so unrelated historical
placement outliers cannot hide a bad definition composition. Of the 4,555
RVT placements resolved through complete non-direct definitions, 1,669 have a
numeric IFC geometry Tag:

- median maximum AABB corner error:
  `1.891635292849969e-9 ft`;
- 95th percentile: `3.441004992055241e-9 ft`;
- 1,628 / 1,669 (`97.54%`) are within `1e-6 ft`;
- all 1,669 are within `1/12 ft`;
- maximum: `0.04725817384786524 ft`.

The largest differences are columns for which the certified RVT graph contains
more tessellated detail than the IFC export. This check proves the recovered
owner-local bounds and persisted placement transform agree spatially; it does
not claim vertex-for-vertex topology equality.

### Production selection contract

Production must not publish every scanned non-direct definition as a scene
owner. The bounded collector handoff is:

1. accept the exact set of placement-referenced geometry owner ids;
2. compute only their recursive symbol-definition closure;
3. compose each requested root using native `outer * inner` transform order;
4. expose only complete roots for placement lookup;
5. mark those roots shared so they cannot render as standalone products;
6. keep any missing, conflicting, partial, cyclic, over-limit, or unsupported
   root on its proxy.

This contract keeps IFC out of conversion and uses the reference IFC only as
the post-decode acceptance oracle.

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

The 110 direct-owner/no-mesh cases are railings with nested persisted
`GInstance` nodes. An earlier 144-byte observational window crossed the
44-byte `GInstance` body into its queued 112-byte `InstanceInfo` body and
misreported the boundary as a non-finite transform. The corrected FIFO readers
now replay all 13,568 eligible roots without failure, including these 110.
They still emit no certified mesh because their drawable geometry must be
resolved through the nested symbol reference and composed transform; that
transition remains fail-closed.

## Production browser handoff

The certified replay is no longer audit-only. `convertRvtBytes` now retains
complete Revit 2027 owner meshes, expands reusable owners through exact
persisted instance transforms after the final scene origin is known, and
replaces a display proxy only after the whole native element is admitted.
IFC is never read by this path.

On the exact UNBC RVT:

| Production measure | Result |
| --- | ---: |
| Complete persisted owners retained | 13,236 |
| Elements emitted with certified native geometry | 32,411 |
| Certified Face meshes after placement expansion | 228,996 |
| Certified native triangles | 503,217 |
| Elements retaining proxy geometry | 4,137 |
| Incomplete owners retaining proxies | 332 |
| Native items rejected by independent RVT-envelope check | 657 |
| Native items without an independent display envelope | 306 |
| Final scene triangles, native plus fallback | 575,269 |

Every positive-loop/topological Face must have a certified mesh; zero-loop
reference faces are recorded separately. Native output is also atomic per
element, capped at 1.25 million stored/output triangles, and checked against
the independently decoded RVT element envelope with a 0.5-foot containment
tolerance. A failed completeness, bounds, or capacity check leaves the proxy
in place.

The exact-model benchmark took 41.25 seconds versus 36.95 seconds for the
prior proxy-only conversion. Peak resident memory measured 2.10 GB versus
2.51 GB in that run; runtime/memory figures are environment-sensitive and are
reported as one local comparison, not a browser guarantee.

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
- resolve and compose the exact nested `GInstance`/`InstanceInfo` symbol
  geometry for the 110 already located railing owners;
- locate the persisted owner routes for the remaining 925 products, led by
  members, columns, stair flights, and railings.

Adding another surface tessellator cannot by itself fix these ownership and
regeneration gaps.
