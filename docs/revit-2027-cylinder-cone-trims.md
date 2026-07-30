# Revit 2027 cylinder/cone trim feasibility

## Native evaluator contract

The browser mapping is recovered from the supplied native geometry stack:

- `TB_GeometryUtils.tx`
  `OdBmCylSurfImpl::evalPoint(Point3d&, Point2d const&)` at `0x0faa32`
  reads the first persisted UV scalar as an angle and the second as an axial
  distance:

  ```text
  P(u, v) =
    center
    + abs(radius) * (cos(u) * xVector + sin(u) * yVector)
    + v * zVector
  ```

- The same binary's `OdBmCylSurfImpl::createGeSurface` at `0x0fb3e4`
  passes the persisted center, Z axis, X reference, radius, and envelope into
  `OdGeCylinder`. Its determinant branch changes the signed axis/parameter
  representation for a left-handed persisted X/Y/Z basis and combines that
  handedness with the persisted surface orientation.
- `OdBmConeSurfImpl::evalPoint(Point3d&, Point2d const&)` at `0x0eff7c`
  rotates the persisted X vector around Z by the first parameter, applies the
  persisted half angle, scales the resulting generator by the second
  parameter, and adds the center. In the positive-handed branch:

  ```text
  P(u, v) =
    center
    + v * (
        sin(halfAngle) * (cos(u) * xVector + sin(u) * yVector)
        + cos(halfAngle) * zVector
      )
  ```

  The native determinant branch reverses the angular rotation for a
  left-handed persisted basis.

The IFC was not used to choose these formulas, axes, parameter order, or
orientation.

## Neutral cylinder mapping

Reviter's browser-neutral cylinder contract uses:

```text
P(U, V) =
  origin
  + radius * U * axis
  + radius * (cos(V) * xAxis + sin(V) * yAxis)
```

The Revit adapter therefore maps:

```text
neutral U = persisted axial distance / radius
neutral V = handedness * persisted angle
```

`yAxis` is the neutral right-handed `zVector × xVector`. A persisted
left-handed Y vector is represented by negating the angular parameter and
combining the handedness with `Surface.orientFlag` for the face orientation.
This keeps evaluated positions unchanged while satisfying the neutral BRep
basis invariant.

Each directed GEdge's complete face-local UV sequence is preserved. It is
collapsed to a neutral `pcurve-line` only when every persisted sample is
constant along exactly one parameter axis. A sampled skew/curve remains a
`pcurve-polyline`, which the current rectangular cylinder tessellator rejects.

## Tessellator-layer transition

The recovered browser route mirrors the responsibility split in
`TB_Geometry`, `libTD_Ge`, `libOdBrepModeler`, and
`libTD_BrepBuilder`/`libTD_Br`: persisted face topology and analytic surfaces
enter a tessellator policy, then leave as viewer triangles. It does not load or
ship those native binaries.

The supported cylinder subset now includes non-wrapping orthogonal sampled
p-curve charts, including concave charts and linked holes. It remains
fail-closed unless all of these gates pass:

- every directed GEdge closes in face-local UV and follows exactly one
  parameter axis;
- the angular extent is below one full period and no individual edge has an
  ambiguous greater-than-π wrap;
- axial edges have no unbound persisted subdivision;
- linked loop roles agree with both `OdBmEdgeLoopImpl::isCCW`'s recovered
  correction and sampled UV containment;
- there is exactly one filled region with direct, disjoint holes;
- the generated grid's parameter-space area equals outer area minus hole area;
- native-policy refinement and all generated vertices remain within explicit
  safety bounds.

The loop correction is the same surface-independent `TB_Geometry` rule used by
the planar route:

```text
correctedArea =
  ((Face.faceFlags & 0x2) != 0) == Surface.orientFlag
    ? -rawUvArea
    : rawUvArea
```

A corrected-positive contour must be the contained region's outer loop and a
corrected-negative contour must be a direct hole. Winding and containment
disagreement is rejected instead of guessed.

### Evaluated coedge endpoint tolerance

`libTD_BrepBuilderFiller.so` proves a second, separate transition for small
p-curve endpoint gaps:

- `PointsDists::init` at `0x8e7b6` evaluates adjacent p-curve endpoints
  through the owning surface;
- `PointsDists::add` at `0x8e89c` retains all four squared 3D endpoint
  distances and selects the closest pair;
- `PointsDists::areEndsIntersecting` at `0x8ec2e` admits that pair under the
  filler-wide model-space tolerance;
- `PointsDists::calcCoedgeIntersections` at `0x8ecca` uses that endpoint result
  before attempting a general `OdGeCurveCurveInt2d` intersection;
- `OdBrepBuilderFillerHelper::checkCoedgeLoop` at `0x8f124` applies the result
  while validating the complete loop.

The browser counterpart uses the recovered `0.01` ft filler distance only
after evaluating both persisted UV endpoints through the exact cylinder. It
adds a face-local neutral bridge only when the endpoints differ along exactly
one parameter axis. Both persisted endpoints remain unchanged. Diagonal
repairs, over-distance gaps, greater-than-π periodic ambiguity, and bridges on
linked-loop faces remain rejected. The bridge is explicit neutral topology,
not a fabricated persisted GEdge.

### Sampled non-orthogonal cylinder trims

The remaining fixed-column trim is a real plane-cylinder intersection rather
than a damaged rectangle. For owner `1483370`, face `8`, edge `24` carries
three persisted cylinder p-curve samples:

```text
(1.56613070271513,   0.11672551014495136)
(1.5540370650252902, 0.11043944950551277)
(1.54194342733545,   0.10456488943209719)
```

Evaluating them through the decoded cylinder and evaluating the paired samples
through adjacent plane face `14` agrees within `2e-15` ft. The middle UV sample
is `0.00020575028301156` away from the endpoint chord in its second parameter,
so collapsing this edge to one parameter-space line would discard persisted
geometry.

`libTD_BrepRenderer.so` proves that native trim insertion is not limited to
orthogonal p-curves:

- `WR::getPCurve` at `0x191d10` obtains and validates the actual
  `OdGeCurve2d`;
- `wrSurface::paramOf2` at `0x122404` evaluates that p-curve at the same edge
  parameter used for the 3D edge sample;
- `MeshQuad::addEdgeSegment` at `0x1a7d66` clips every consecutive sampled UV
  segment against adaptive surface cells without an axis-alignment gate;
- `collectPolygons` at `0x1a6a52` triangulates the resulting arbitrary leaf
  contours;
- `SrfTess::findBreakDirection` at `0x1a3c9e`, `MeshQuad::split` at
  `0x1a4d0e`, and `sewCells` at `0x1ab5e8` provide the adaptive split and
  T-junction contracts around that trim insertion.

The browser proof-of-concept therefore admits only one simple, non-wrapping
outer loop with exactly one diagonal GEdge that has persisted interior
samples. It preserves every persisted boundary sample, verifies triangulated
UV area, and bisects only overlong interior triangulation edges under the
recovered cylinder policy. Holes, join bridges, multiple diagonal edges,
ambiguous wraps, self-intersections, and policy-violating persisted boundary
segments remain fail-closed.

This output is deliberately labeled a persisted-sample approximation. Native
code evaluates the full `OdGeCurve2d`, while the decoded record currently
exposes only endpoints and sparse interior samples. Exact native equivalence
requires decoding the underlying p-curve type/control data or proving an error
bound for the persisted samples.

## Earlier direct-owner feasibility audit

The exact-model audit replays all direct geometry queues before analyzing any
surface:

- 3,666 chunks, zero failed chunks;
- 5,996 direct single-Geometry owners;
- 5,996 queues exhausted at their exact owner boundary;
- 42 owners containing cylinder or cone surfaces;
- 136 cylinder faces;
- 10 cone faces.

### Cylinder coverage

| Result | Faces |
| --- | ---: |
| Neutral BRep adapted and tessellated | 123 |
| Four-edge chart with a non-axis-aligned persisted edge | 6 |
| Not a four-edge rectangle | 5 |
| Neutral seam/wrap guard rejection | 2 |
| Total | 136 |

The supported subset is 90.44% of cylinder faces and spans 39 owners. All 123
supported faces have one closed loop, four proven envelope sides, matching
surface/loop envelopes, matching opposite-side sampling, and one persisted
axial interval.

The exact persisted boundary grids imply 4,202 triangles for these faces.
Running the neutral tessellator with an explicitly diagnostic angular policy
that preserves each face's persisted angular interval count also produces
4,202 triangles. This sample-matched policy is not claimed to be the original
renderer LOD policy because that policy is not persisted in `Geometry`.

The two seam/wrap rejections have parameter spans below a full turn but above
π along one explicit unwrapped p-curve edge. They may be supportable after a
separate neutral-chart proof; this checkpoint keeps the existing ambiguity
guard.

### Cone feasibility

No cone face matches the current rectangular neutral-surface subset:

| Rejected trim shape | Faces | Owners |
| --- | ---: | --- |
| Three-edge apex-sector chart | 8 | `1420880`, `1960533` |
| Four-edge chart with non-axis-aligned p-curve | 2 | `1718794` |

The native evaluator proves that every finite `(u, 0)` parameter pair is the
same 3D apex. Applying that exact equivalence closes all eight three-edge
apex-sector loops; they are not UV gaps. All ten Cone faces now have complete
directed p-curve samples. Tessellation still requires an explicit
degenerate-apex topology rule and a Cone evaluator carrying the full X/Y/Z
basis.

The existing neutral cone placeholder stores only origin, axis, and half
angle, so it cannot evaluate the proven native angular reference frame.
Generating those ten faces now would require guessing a missing basis or
silently flattening non-axis-aligned p-curves. They remain rejected.

## IFC post-decode oracle

After RVT eligibility and triangle counts were fixed, the numeric Revit Tag
comparison found:

- 39 RVT owners with certified cylinder faces;
- 23 matching IFC products;
- 16 owner tags without a direct IFC product, including local/shared geometry
  owner `245109`;
- 2,202 certified RVT cylinder triangles on matched tags;
- 4,620 triangles in the matched IFC products' complete meshes.

The resulting 47.66% ratio is diagnostic, not a parity failure: the RVT count
contains only cylinder faces, while each IFC count contains the product's
planes and every other exported face. Some individual sample-matched cylinder
counts exceed an IFC product's complete triangle count because IFC and RVT use
different legal tessellation policies. Triangle equality is not used as
evidence for parameterization or topology.

## Files

- `lib/reviter/revit-2027-cylinder-sampled-brep.ts`
- `lib/reviter/revit-2027-cylinder-owner-mesh.ts`
- `tests/revit-2027-cylinder-sampled-brep.test.ts`
- `tests/revit-2027-cylinder-owner-mesh.test.ts`
- `scripts/audit-revit-2027-cylinder-cone-trims.ts`
- `scripts/audit-revit-2027-cylinder-ifc-parity.mjs`

Run:

```sh
node --experimental-strip-types --test \
  tests/revit-2027-cylinder-sampled-brep.test.ts \
  tests/revit-2027-cylinder-owner-mesh.test.ts \
  tests/brep-tessellator.test.ts

node --experimental-strip-types \
  scripts/audit-revit-2027-cylinder-cone-trims.ts model.rvt \
  > cylinder-cone-trims.json

node scripts/audit-revit-2027-cylinder-ifc-parity.mjs \
  --ifc reference.ifc \
  --rvt-audit cylinder-cone-trims.json
```

The combined browser-owner audit meshes all 123 certified Cylinder faces and
four exact Cone apex sectors directly from the completed FIFO replay.
Together with the planar and SurfRev paths, it returns 40,317 face meshes,
170,354 positions, and 89,273 triangles across 5,996/5,996 direct owners. The
thirteen remaining Cylinder faces are reported as eleven non-rectangular
trims and two guarded wrapping charts; six non-apex-sector Cone faces remain
fail-closed.

## Current full UNBC checkpoint

The production replay over the exact supplied RVT now reports:

- 3,666/3,666 chunks read and 16,977/16,977 eligible owners replayed;
- a valid reader corpus with zero replay failures;
- 1,140 certified sampled-cylinder face meshes, four more than the linked-hole
  checkpoint and 21 more than the preceding orthogonal single-loop checkpoint;
- 745,197 positions and 401,214 triangles across all certified browser mesh
  routes;
- ten linked cylinder faces still rejected because corrected winding and
  containment do not prove one filled region with direct holes;
- 27 non-orthogonal trims, 19 guarded wraps, and 26 unresolved cylinder loops
  still fail closed; all four native-tolerance orthogonal endpoint gaps now
  have certified meshes.

Against the fixed 925-product IFC acceptance population, complete certified
owners increase from 754 to 762 and certified triangles from 82,327 to 85,325.
For `IfcColumn`, all 209 products with a framed GRep now have complete
certified native meshes, up from 201. All 209 are within 0.5 ft of the IFC
bounds and 56 have the exact IFC triangle count. The remaining 15 column
products have no framed GRep definition. IFC is used only as the post-decode
oracle, never to repair RVT topology or choose triangles.
