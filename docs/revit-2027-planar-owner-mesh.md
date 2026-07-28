# Browser Revit 2027 planar owner mesh

`lib/reviter/revit-2027-planar-owner-mesh.ts` is the reusable client-side
pipeline behind the UNBC proof of concept. Given an independently framed GRep
root and its bytes, it:

1. runs the exact Revit 2027 dynamic-property FIFO;
2. indexes decoded Face, GEdge, EdgeLoop, and Plane values by native token;
3. resolves one Face side for every directed edge use;
4. proves loop closure through the EdgeLoop sentinel;
5. derives direction from unique persisted UV endpoint matches;
6. adapts the safe single-loop Face to `NeutralBrep`; and
7. returns the TypeScript tessellator's `NeutralFaceMesh`.

Both entry points are browser-safe:

- `replayAndMeshRevit2027PlanarSampledOwner(data, root)` performs replay and
  meshing.
- `meshRevit2027PlanarSampledReplay(replay)` consumes an already completed
  replay.

`replayAndMeshRevit2027CertifiedOwner` in
`revit-2027-certified-owner-mesh.ts` is the broader client entry point. It
replays once and combines this planar path with every other independently
certified face subset, currently rectangular sampled Cylinder and
exact Cone apex sector, and circular-profile rectangular `SurfRev`.

The result contains independent per-Face meshes and structured issues for
unsupported or ambiguous Faces. One bad Face never produces a partial mesh
for that Face and does not hide other safe Faces in the same owner.

Passing exact framed `MaterialElem` definitions through
`materialDefinitions` binds a positive persisted
`Face.renderStyleElementId` directly to each mesh group. Explicitly unassigned
and negative system IDs remain `null`; an unmatched positive ID emits a
`material-unresolved` issue instead of falling back to a name, category, or
IFC material. A caller-supplied `materialForFace` remains available for a
separately proven relation.

## Native-kernel correspondence

| Native layer | This module |
| --- | --- |
| `TB_Geometry` | exact Face/GEdge/EdgeLoop token graph |
| `libTD_Ge` | decoded Plane parameter evaluation |
| `libTD_BrepBuilder` / `libTD_Br` | directed face-local loop |
| `libTD_BrepRenderer` | persisted trim samples and neutral tessellation |

The native modules are evidence, not client dependencies. The implementation
uses TypeScript, typed arrays, and the existing neutral BRep only.

## Exact model proof

The public-registry corpus audit runs the reusable module over all 5,996
direct Geometry owners:

| Result | Count |
| --- | ---: |
| Complete replay owners | 5,996 / 5,996 |
| Body spans | 248,613 |
| Planar Face meshes | 40,188 |
| Positions | 165,336 |
| Triangles | 84,811 |

Structured non-mesh results are 491 Faces without a first loop, 148
non-planar surfaces, 108 multi-loop Faces, 22 ambiguous UV links, and four
tessellator rejections. These totals reproduce the independent topology audit.

The combined certified-owner entry point additionally promotes 123 sampled
Cylinder faces, four exact Cone apex sectors, and the two circular-profile
`SurfRev` faces, for 40,317 meshes, 170,354 positions, and 89,273 triangles.
The remaining planar `unsupported-surface` count becomes 19: six Cone faces
and thirteen Cylinder faces whose trims remain fail-closed. No planar result
changes.

Joining those owner meshes through the 30,608 decoded instance records still
finds 25,538 placed instances and 308,107 placed triangles; the newly promoted
curved owners in this model are direct owner candidates rather than additional
shared placements. In the numeric-Tag IFC oracle, the combined owner plus
placement set reaches 25,642 products and 315,907 of 318,304 IFC triangles
(99.25%). That ratio is diagnostic because RVT and IFC may use different valid
curved-surface tessellation policies.

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-public-grep-replay.ts model.rvt
```

## Boundaries

- Multi-loop Faces remain rejected until exact hole roles and containment are
  certified.
- Cone, Cylinder, and SurfRev do not enter this planar path. The combined
  owner path separately certifies 123 Cylinder, four Cone apex-sector, and two
  SurfRev faces.
- Positive per-face `MaterialElem` IDs are exact when
  `materialDefinitions` contains the independently decoded framed target.
  GStyle/category/view fallback remains unresolved and therefore null.
- Instance placement is deliberately separate. The caller may reuse an owner
  mesh with the already decoded shared-geometry placement instead of
  duplicating vertex buffers.
