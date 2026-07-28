# Revit 2027 planar coedge retiming

This checkpoint resolves the remaining nested direct root owner `1844902`
failure without inventing a general Revit BRep tessellator.

## Evidence

The failing geometry belongs to nested symbol definition owner `1845058`.
Its three unresolved faces (`35`, `36`, and `38`) are ordinary `Plane`
surfaces. The relevant reader records contain no `GHermiteSpline` or
`HermiteSurf` instances.

Each failure was a directed coedge endpoint gap of
`0.00038784697` feet (about `0.118` mm) between two native-proven line
segments. The persisted topology links were exact, and the two infinite
planar lines met at one finite intersection.

Static analysis of the native tessellator established the applicable
contract:

- `OdBmGEdgeImpl::getCurveType` identifies a two-point edge as a line
  segment.
- `createParamCurve` and `getParamCurveFixed` construct and validate the
  face-local p-curve.
- `checkCoedgeLoop` evaluates adjacent p-curve endpoints through the surface
  in model space and may intersect/retime them within the BRep filler's
  `0.01`-foot distance tolerance.
- Final modeler validation remains stricter and checks the repaired directed
  curves.

The `0.01` value is therefore used only as a model-space repair bound. It is
not used as a raw UV tolerance because UV units can vary by surface type.

## Browser-safe implementation

The repair is deliberately narrow and fail-closed:

1. Reconstruct the directed edge uses from exact topology.
2. Require both adjacent edges to be native-proven two-point line segments
   on a `Plane`.
3. Intersect the infinite lines in face UV space.
4. Evaluate the original endpoints and candidate intersection through the
   plane.
5. Accept only finite, non-parallel, non-degenerate repairs where each
   endpoint moves no more than `0.01` feet in model space.
6. Pass direction-oriented, count-preserving trim UV overrides to the
   sampled BRep adapter without mutating persisted `GEdge` records.

Interior-sampled curves, splines, parallel lines, non-finite intersections,
degenerate segments, and larger corrections remain unresolved. General
`GHermiteSpline`, `HermiteSurf`, curved BRep, and material handling are
separate tessellator work.

## Exact-model result

For nested definition owner `1845058`, drawable coverage changes from
`9/12` faces and `18` triangles with three issues to `12/12` faces and
`24` triangles with no issues.

For direct root owner `1844902`, the source becomes complete:

- faces: `275` to `278`
- triangles: `554` to `560`
- source issues: `3` to `0`

The full public audit changes nested complete owners from `105` to `106`,
with incomplete owners falling from `5` to `4`. Atomic admission of the
repaired nested root adds `560` nested triangles. Certified direct-owner
triangles increase by four because that metric has a different aggregation
scope.

Against the reference IFC:

- matched tags: `34,864` to `34,865`
- IFC-only tags: `1,280` to `1,279`
- IFC tag coverage: `0.9645861000` to `0.9646137672`
- complete nested tags: `105` to `106`

Owner `1844902` matches `IfcRailing` across 39 occurrences. Its maximum
corner-bound error is `9.42494e-8` feet; all 106 complete nested owners stay
within `1e-6` feet. Triangle counts are not expected to equal IFC triangle
counts because the two exporters may choose different valid triangulations.
