# Browser Revit 2027 planar owner mesh

`lib/reviter/revit-2027-planar-owner-mesh.ts` is the reusable client-side
pipeline behind the UNBC proof of concept. Given an independently framed GRep
root and its bytes, it:

1. runs the exact Revit 2027 dynamic-property FIFO;
2. indexes decoded Face, GEdge, EdgeLoop, and Plane values by native token;
3. resolves one Face side for every directed edge use;
4. follows every Face-local EdgeLoop link and proves each edge cycle;
5. derives direction from unique persisted UV endpoint matches;
6. classifies native-oriented filled regions and their direct holes from the
   renderer's UV winding rule plus sampled UV containment; and
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
| `libTD_BrepBuilder` / `libTD_Br` | directed face-local loops; derived outer/hole topology |
| `libTD_BrepRenderer` | oriented UV loop roles, persisted trim samples, and constrained neutral tessellation |

The native modules are evidence, not client dependencies. The implementation
uses TypeScript, typed arrays, and the existing neutral BRep only.

## Exact model proof

The public-registry corpus audit runs the reusable module over all 5,996
direct Geometry owners:

| Result | Count |
| --- | ---: |
| Complete replay owners | 5,996 / 5,996 |
| Body spans | 248,613 |
| Planar Face meshes | 40,292 |
| Positions | 168,098 |
| Triangles | 87,496 |
| Accepted multi-loop Faces | 104 |
| Additional filled regions | 43 |
| Accepted hole loops | 111 |
| Triangles from accepted multi-loop Faces | 2,685 |

Structured non-mesh results are 491 Faces without a first loop, 148
non-planar surfaces, two multi-loop Faces whose contour roles are not
unambiguous, 24 ambiguous UV links, and four tessellator rejections. The
accepted multi-loop subset spans 46 reusable geometry owners.

The combined certified-owner entry point additionally promotes 123 sampled
Cylinder faces, four exact Cone apex sectors, and the two circular-profile
`SurfRev` faces, for 40,421 meshes, 173,116 positions, and 91,958 triangles.
The remaining planar `unsupported-surface` count becomes 19: six Cone faces
and thirteen Cylinder faces whose trims remain fail-closed. No planar result
changes.

Joining those owner meshes through the 30,608 decoded instance records still
finds 25,538 placed instances and 308,107 placed triangles; the newly promoted
curved owners in this model are direct owner candidates rather than additional
shared placements. In the numeric-Tag IFC oracle, the combined owner plus
placement set reaches 25,642 products and 318,028 of 318,304 IFC triangles
(99.91%), with exactly equal triangle counts on 25,546 of 25,642 matched Tags
(99.63%). Those ratios are diagnostic because RVT and IFC may use different
valid boundary and curved-surface tessellation policies.

Run:

```sh
node --experimental-strip-types \
  scripts/audit-revit-2027-public-grep-replay.ts model.rvt
```

## Boundaries

- Multi-loop Faces enter only when native-oriented UV topology and containment
  agree on one or more filled regions with direct, strictly contained,
  nonintersecting holes. Two unresolved Faces on owner `229170` remain
  rejected.
- Cone, Cylinder, and SurfRev do not enter this planar path. The combined
  owner path separately certifies 123 Cylinder, four Cone apex-sector, and two
  SurfRev faces.
- Positive per-face `MaterialElem` IDs are exact when
  `materialDefinitions` contains the independently decoded framed target.
  GStyle/category/view fallback remains unresolved and therefore null.
- Instance placement is deliberately separate. The caller may reuse an owner
  mesh with the already decoded shared-geometry placement instead of
  duplicating vertex buffers.
