# Revit 2027 circular-profile SurfRev subset

## Scope

This checkpoint adds a browser-safe evaluator and tessellator for one
clean-room-proven Revit 2027 subset:

- persisted `SurfRev` surface slot `4283`;
- persisted `GArc` profile slot `2213`;
- right-handed orthonormal surface basis;
- profile arc in the persisted local XZ plane;
- one closed rectangular UV trim whose four sides are explicitly present as
  constant-envelope GEdges;
- trim envelope equal to the persisted surface envelope;
- profile interval equal to the persisted GArc interval.

Every other surface/profile/trim combination fails closed. This is not a
general BRep or surface-of-revolution implementation.

## Native parameterization proof

The implementation follows native call sites, not the reference IFC:

- `TB_GeometryUtils.tx`
  `OdBmSurfRevImpl::createGeSurface` at `0x117fb4` obtains the persisted
  profile, X vector, Z vector, and center, then calls
  `OdGeRevolvedSurface(profile, center, zVector, xVector, ...)`.
- The same binary's `OdBmSurfRevImpl::evalPoint(Point3d&, Point2d const&)` at
  `0x118376` evaluates the profile using the second persisted UV scalar and
  passes the first scalar to the angular evaluator.
- `OdBmSurfRevImpl::evalPoint(Point3d&, double)` at `0x118216` implements the
  signed persisted basis:

  ```text
  P(u, v) =
    center
    + profile(v).z * zVector
    + profile(v).x * (cos(u) * xVector + sin(u) * yVector)
  ```

- `libTD_Ge.so`
  `OdGeRevolvedSurfaceImpl::evaluate` at `0x6ded7a` independently shows that
  public `OdGeRevolvedSurface` evaluates its profile with its first UV scalar
  and uses the second scalar as the revolution angle. The Revit wrapper above
  is therefore the proven UV-order bridge, rather than a naming assumption.
- `TB_Geometry.tx` `OdBmGArcImpl::createGeCurve` at `0x338538` forms the arc
  normal from the persisted X/Y directions and constructs
  `OdGeCircArc3d(center, normal, xDirection, radius, start, end)`. The matching
  browser formula is:

  ```text
  profile(t) =
    center + radius * (cos(t) * xDirection + sin(t) * yDirection)
  ```

`OdBmSurfRevImpl::createGeSurface` also uses the persisted basis determinant,
surface envelope, and orientation flag when it builds the public OdGe surface.
The browser subset preserves the direct persisted basis and reverses triangle
winding/normals only from the persisted orientation flag. It does not repair
or synthesize a basis.

## Exact UNBC element 245109

The targeted FIFO replay for the supplied Revit 2027 file exhausts the owner
exactly:

- partition `325`, chunk `3492`;
- dynamic payload `35531..45859`;
- 60 replayed queue bodies;
- 12 faces, 18 GEdges, 8 EdgeLoops, and 2 GArcs;
- 55 materialized positive tokens and 32 StaticInteger reservations;
- zero bytes left at the owner boundary.

The two circular-profile surfaces are:

| Face | Loop | Profile | Revolution `u` | Profile `v` |
| --- | --- | --- | --- | --- |
| 10 | 44 | 56 | `0..π/2` | `π..2π` |
| 11 | 46 | 57 | `0..π/2` | `0..π` |

Both persist:

- center `(0, 0.03937007874015251, -0.20669291338583545)`;
- X `(0, -1, ~0)`, Y `(0, ~0, -1)`, Z `(1, 0, 0)`;
- profile radius `0.01968503937007874`;
- profile center `(0.03937007874017287, ~0, 0)`;
- profile X `(0, 0, 1)` and Y `(-1, 0, 0)`.

Each face has exactly one closed four-edge loop. The loop and surface
envelopes agree. Each edge's complete persisted endpoint/interior UV sequence
lies on exactly one envelope side within `1e-9`; all four sides occur once.
Opposite sides also carry the same persisted sampling:

- two revolution intervals along `v-min` and `v-max`;
- twelve profile intervals along `u-min` and `u-max`.

This is enough to add the rectangular UV-trim subset without guessing. It
does **not** prove that arbitrary SurfRev GEdge samples encode exact curved UV
trim curves.

Using those persisted interval counts, the two faces produce 48 triangles
each (96 total). Their combined owner-local bounds are approximately:

```text
min = (-0.01968503937007874,
       -0.0196850393700991,
       -0.26574803149608706)
max = ( 0.01968503937007874,
        0.03937007874015278,
       -0.2066929133858351)
```

These are only the two SurfRev faces. Element `245109` owns ten other faces,
so the numbers are not a complete element mesh or complete element bounds.

## IFC oracle result

The IFC was consulted only after the RVT parameterization, trim certificate,
and mesh were complete. It contains no `IfcElement` whose numeric Revit `Tag`
is `245109`; `#245109` in the STEP text is an unrelated IFC express identifier
for an `IFCFACE`. The RVT scan also found no simple persisted
`InstancePlacement` pointing directly to geometry owner `245109`.

Consequently, the current data does not provide an identity-safe IFC product
comparison for this owner. The IFC cannot be used to select a different axis,
UV order, trim, or placement. A later exact model-tree/family-instance binding
must map this local geometry owner to exported products before IFC world-space
parity can be claimed.

## Files and validation

- `lib/reviter/revit-2027-arc-surfrev.ts` — fail-closed evaluator/tessellator.
- `tests/revit-2027-arc-surfrev.test.ts` — formula, mesh, and rejection tests.
- `scripts/audit-revit-2027-surfrev-feasibility.ts` — exact RVT replay and
  rectangular-trim certificate.
- `scripts/audit-ifc-element-geometry.mjs` — post-decode IFC Tag/shape oracle.

Run:

```sh
node --experimental-strip-types --test \
  tests/revit-2027-arc-surfrev.test.ts

node --experimental-strip-types \
  scripts/audit-revit-2027-surfrev-feasibility.ts model.rvt

node scripts/audit-ifc-element-geometry.mjs reference.ifc 245109
```

