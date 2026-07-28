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

The result contains independent per-Face meshes and structured issues for
unsupported or ambiguous Faces. One bad Face never produces a partial mesh
for that Face and does not hide other safe Faces in the same owner.

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

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-public-grep-replay.ts model.rvt
```

## Boundaries

- Multi-loop Faces remain rejected until exact hole roles and containment are
  certified.
- Cone, cylinder, and SurfRev are decoded but do not enter this planar path.
- The material callback defaults to `null`; callers may supply a value only
  from an independently exact face-material relation.
- Instance placement is deliberately separate. The caller may reuse an owner
  mesh with the already decoded shared-geometry placement instead of
  duplicating vertex buffers.
