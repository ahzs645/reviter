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

## Exact UNBC audit

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
