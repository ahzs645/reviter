# Exporting a recovered model to Pascal

[Pascal](https://github.com/pascalorg/editor) is an open-source, local-first 3D
building editor. It is not a viewer: its scene is a graph of *typed building
nodes* — walls with a location line and a thickness, slabs with an outline,
doors hosted on a wall — that a person edits in place. Getting an RVT into it is
therefore a different problem from getting one into a GLB or an OBJ. A mesh
export answers "what does this building look like"; Pascal asks "what is this
building made of", and every piece of that answer Reviter cannot supply, Pascal
has to guess.

This is the record of how that mapping was arrived at, what it is founded on,
and where it stops.

## Why not go through IFC

Reviter already exports IFC4, and Pascal already imports IFC — its
`@pascal-app/ifc-converter` reads a file with `web-ifc` and emits the same node
graph. That route works, and it throws away most of what Reviter knows.

Pascal's IFC importer has to *reconstruct* the semantics IFC flattened. It
recovers a wall's centreline from an `IfcShapeRepresentation` whose identifier is
`Axis`, its thickness from the profile of an `IfcExtrudedAreaSolid`, and, when a
wall carries a Brep body instead — which plain `IfcWall` "frequently" does, in
the importer's own comment — falls back to measuring the mesh, and then to the
editor's default wall. Its slabs take their elevation from the placement origin.
Its levels come from `IfcBuildingStorey`.

None of that reconstruction is necessary here, because the RVT states all of it
and Reviter has already decoded it:

| What Pascal needs | Where it comes from | Evidence |
| --- | --- | --- |
| Wall location line, thickness, base and top | `WallSolid`, rebuilt from the element's own attributed plane triples | [Wall bodies](unbc-wall-surfaces-and-solids-2026-07-28.md) |
| Curved wall centre, radius and sweep | `WallArc`, rebuilt from the element's own cylinder triples | same |
| Floor, ceiling, landing and ramp outlines | The element's own sketch boundary rings | [Drawn but not elements](unbc-drawn-but-not-elements-2026-07-28.md) |
| Which wall a door or window is in | `InsertableInst.m_hostId` | [Host relations](rvt-host-relations.md) |
| Which storey an element is on | `Element.m_assocLevelId` | [Associated level relations](rvt-associated-level-relations.md) |
| What an element *is* | The native `BuiltInCategory` token, or its record-code consensus | [Enumeration tables](revit-enumeration-tables.md) |
| Type and family names | The element's type element and `FamilyBase` | [Family symbol materials](rvt-family-symbol-materials.md) |

So `lib/reviter/export-pascal.ts` writes Pascal's nodes directly. There is no
intermediate format, nothing to re-derive, and no place for a default to creep
in unnoticed.

The output is Pascal's **build JSON** — `{ nodes, rootNodeIds }` — which is what
its editor's *Load Build* accepts and what its own `validateBuildJson` is written
to check. That validator's doc comment names its three sources as "drag-drop, IFC
converter output, hand-edited files"; this is a fourth, and it is held to the
same contract.

## Coordinates

Revit is Z-up and works in decimal feet. Pascal is Y-up, works in metres, and
stores a plan position as a two-tuple `[x, z]`. The mapping is

```
pascal.x =  (revit.x - origin.x) * 0.3048
pascal.y =  (revit.z - origin.z) * 0.3048    // up
pascal.z = -(revit.y - origin.y) * 0.3048
```

`origin` is the conversion's own centring offset, the same one the GLB and IFC
exporters subtract, so a Pascal scene lands near its origin rather than out at a
survey coordinate.

**The negation on Y is deliberate, and it is the one place this exporter departs
from Pascal's own IFC importer.** That importer copies IFC `+Y` straight into
Pascal `+Z`:

```ts
const s0 = worldToScene(transformPoint3(worldMat, axisPts[0]))
start = [s0[0], s0[1]]
```

The basis change `(x, y, z) → (x, z, y)` has determinant −1. It is a reflection,
not a rotation, so a building imported through it is *mirrored*: its stairs turn
the wrong way, its plan reads backwards, and no amount of rotating in the editor
puts it right. Negating Y instead gives determinant +1, and puts north at −Z,
which is also what a north-up plan looks like in a top view. `--mirror-plan`
restores the IFC importer's convention for anyone comparing the two imports of
one building side by side.

Because the mapping reverses the sign of a ring's signed area, every polygon is
rewound on the way out: outlines counter-clockwise, holes against them.

## Levels

Pascal *stacks* storeys. `getLevelElevations` walks levels in ordinal order and
computes each plane as

```
baseY = (running total for this building) + level.baseElevation
running total = baseY + level.height
```

so a level's plane is not stated anywhere; it is the sum of everything below it.
Writing measured Revit elevations into that model means giving the lowest level a
`baseElevation` equal to its own elevation and giving every level a `height`
equal to the gap to the one above. Each plane then lands exactly on its measured
elevation and `baseElevation` is zero the rest of the way up.

Elements are then placed against *their own level's plane*, because that is the
frame Pascal renders a level's children in.

The bands Reviter recovers are elevation datums, not necessarily architectural
storeys — the UNBC model yields twelve, some only a metre apart, because a Revit
project routinely carries a top-of-footing or top-of-steel datum alongside its
floor levels. That is a faithful reading of the file, and it costs nothing:
what matters is that each element's absolute height is right, and it is.

## Element mapping

| Revit category | Pascal node | Carried across |
| --- | --- | --- |
| Walls | `wall` | Location line, thickness, height, base offset from the level plane; one node per recovered solid, so a run modelled in segments stays segmented |
| Walls (curved) | `wall` + `curveOffset` | The sagitta at the arc's midpoint, measured from the rebuilt arc rather than re-derived from its sweep, so a mirrored export keeps the bulge on the right side |
| Doors, Windows | `door`, `window` | Width and height measured *in the host wall's frame*; distance along the wall from its start; centre height above the wall's base; `wallId` from the persisted host relation |
| Floors, Landings, Ramps, Roofs | `slab` | Outer sketch ring as the outline, inner rings as holes, walking surface as `elevation`, mass depth as `thickness` |
| Ceilings | `ceiling` | Outline and holes, plane height above the level |
| Columns, Structural Columns | `column` | Base centre, plan rotation, width, depth and height from the oriented box |
| Runs (stair) | `stair` + one `stair-segment` | Direction of travel, tread width, total rise, step count, tread thickness |
| Curtain Panels | `wall` (thin, glazed) | The panel's long edge as the run, its short edge as the thickness |
| everything else | `block` | The footprint extruded as a prism, under `--extras all` |

A wall carries `supportSlabId: "ground"` and a `supportOffset`. Without it Pascal
elects whichever slab lies under a wall and lifts the wall onto it — sensible
when a person is drawing, wrong when the RVT has already said where the base is.
The sentinel pins the wall to its level's plane and the offset states the rest.

### Why curtain panels are walls and not blocks

Pascal's `block` — a topology-backed editable solid — is the honest node for an
element with no building meaning in Pascal's vocabulary. But `block` is newer
than the current npm release of `@pascal-app/core`, and a file containing one is
rejected outright there as an unknown type. A curtain panel is a flat vertical
slab of enclosure, which is what a thin wall is, so panels go across as walls
and a curtain-wall building keeps its façade on *every* Pascal. `--extras all`
adds blocks for the rest and needs an editor built from the repository.

## What does not cross

- **Materials.** Reviter decodes 69 native material definitions and assigns them
  by four separate routes, and none of that comes across yet: Pascal paints from
  its own material library, keyed by slot, and there is no evidence-backed
  mapping from a Revit `MaterialElem` to a library id. Curtain panels are given
  `library:preset-glass` because they are glazing by definition, and that is the
  only appearance this exporter asserts. Every element's decoded material name is
  still in the audit JSON.
- **Doors hosted on a curtain system.** A door whose `m_hostId` names a curtain
  wall rather than a basic wall has nowhere to hang in Pascal's wall-child model,
  and is skipped rather than guessed onto the nearest wall.
- **Stair railings, balusters and stringers.** They are recovered — a railing as
  a swept rail path — but Pascal generates its own railings from a stair's
  `railingMode`, and a swept path is not that. Under `--extras all` they arrive
  as blocks.
- **Rooms.** Reviter derives and reviews rooms, and Pascal has a `zone` node.
  Nothing joins them yet.
- **Parameters.** The per-element Revit parameter tables go into the IFC export
  and the audit JSON, not into Pascal's `metadata`, which would multiply the file
  size for data the editor has nowhere to show.

Each node does carry its `revitElementId`, category and evidence, type and
family names, and geometry provenance in `metadata`, so anything above can be
rejoined later from the audit JSON by element id.

## Measurements on the supplied model, 2026-09-10

The 67 MB Revit 2027 UNBC project, converted and exported in one run:

| `--extras` | Nodes | Composition | `validateBuildJson` |
| --- | --- | --- | --- |
| `none` | 11,814 | 9,184 walls (68 curved), 1,898 doors, 20 windows, 135 slabs, 45 ceilings, 304 columns, 107 stairs, 12 levels | **ok**, 0 errors, 0 warnings |
| `curtain-panels` (default) | 18,052 | the above plus 6,238 panels as walls | **ok**, 0 errors, 0 warnings |
| `all` | 39,336 | the above plus 21,284 blocks | 21,284 unknown-type nodes on the published `@pascal-app/core`; **0 schema failures** against the repository's own schemas |

Those two verdicts are from Pascal's own validator, not a local re-implementation
of it: the first two rows through `validateBuildJson` from `@pascal-app/core` on
npm, the third through `AnyNode.safeParse` from `packages/core/src/schema` in the
Pascal repository, where `block` exists.

The coordinate mapping was checked by overlaying, for storey `311`, the wall
centrelines read straight from the conversion in model feet against the `start`
and `end` of the wall nodes written into the Pascal scene, each drawn in its own
convention — the first north-up from raw feet, the second the way Pascal's top
view shows it. The 1,944 recovered centrelines and the 1,979 exported walls
coincide. (The 35 extra are walls whose storey came from the elevation fallback
rather than from `m_assocLevelId`, which the overlay's filter does not include.)

The storey stacking was checked by re-running Pascal's own `getLevelElevations`
rule over the exported scene — ordinal order, running total, plus each level's
`baseElevation` — and comparing every wall's resulting absolute base and top
against the elevations the RVT states. All twelve storey planes reproduce exactly
(0.000, 1.200, 2.200, 3.200, 5.200, 6.600, 8.100, 9.600, 11.350, 12.600, 14.400,
15.600 m above the datum), and across 9,116 walls the worst base and top errors
are both zero to floating-point precision.

243 elements with usable geometry were skipped at `--extras none`, 1,634 at
`--extras all`; the difference is elements whose only evidence is a degenerate or
zero-height envelope.

## Using it

```sh
npm run extract -- model.rvt --out model.pascal.json
npm run extract -- model.rvt --out model.pascal.json --extras all
npm run extract -- model.rvt --out model.pascal.json --extras none --mirror-plan
```

The compound `.pascal.json` suffix selects the format, because `model.json` is
already the audit report. In the browser studio the same export is the **Pascal**
button in the export list.

In Pascal, open the settings panel and use **Save & Load → Load Build**. The
editor shows what it found in the file before committing, and the import becomes
the undo floor: it replaces the open scene, and undo will not step back past it.
