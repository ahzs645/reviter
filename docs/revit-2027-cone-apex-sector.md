# Revit 2027 exact cone apex sectors

## Scope

`revit-2027-cone-apex-sector.ts` is a browser-only tessellator for one proven
native Revit cone topology:

- one outer loop and no holes;
- exactly three directed sampled edges;
- two constant-angle generator edges joining the physical apex to one positive
  generator distance;
- one constant-distance, strictly monotone, non-wrapping sampled outer arc.

It is intentionally independent of IFC and of the native DLLs at runtime.
Unsupported cone trims return typed issues and no partial mesh.

## Native parameter contract

The recovered `OdBmConeSurfImpl::evalPoint` behavior is:

```text
P(u, v) =
  center
  + v * (
      sin(halfAngle) * (cos(u) * xVector + sin(u) * yVector)
      + cos(halfAngle) * zVector
    )
```

The determinant branch reverses angular rotation for a left-handed persisted
X/Y/Z frame. The browser evaluator canonicalizes to a right-handed frame with:

```text
canonical yAxis = zAxis × xAxis
canonical angle = handedness * persisted angle
```

This preserves every evaluated position. Surface orientation combines the
persisted `orientFlag` with the frame handedness, matching the cylinder
adapter's proven convention.

The formula also proves an important topology rule:

```text
P(any finite u, 0) = center
```

Distinct angular UV values at `v = 0` are therefore one physical apex. They
are surface-topology-equivalent even though ordinary two-dimensional UV
comparison reports a gap.

## Exact fan construction

Cone generators are straight 3D lines. After validating both generator edges,
the tessellator maps every persisted outer-arc sample with the analytic cone
evaluator. Each adjacent outer sample pair and the single exact apex define
one triangle.

For `N` persisted outer-arc samples:

```text
triangles = N - 1
```

This construction invents no trim samples and has no triangulation choice:
with one apex and one ordered outer boundary, every boundary-only
triangulation is the same fan. Vertices are intentionally duplicated per
triangle so the undefined normal at the mathematical apex can use each
segment's analytic midpoint normal without sharing a false single apex
normal.

## Exact UNBC result

The complete cylinder/cone queue audit reports ten cone faces. Applying the
independent apex-sector contract gives:

| Result | Faces | Owners |
| --- | ---: | ---: |
| Exact apex sector tessellated | 4 | 1 |
| Three-edge trim without an apex | 4 | 1 |
| Four-edge/non-sector trim | 2 | 1 |
| Total | 10 | 3 |

All four supported faces belong to Revit element `1960533`. Each persisted
outer arc contains 42 samples, producing 41 triangles per face:

```text
4 faces × 41 triangles = 164 triangles
```

The four non-apex faces on owner `1420880` contain sampled curved p-curves
rather than two straight generators. The two faces on owner `1718794` contain
four edges, including a sampled non-axis-aligned lower boundary. Neither class
is coerced into an apex fan.

## IFC post-decode comparison

After RVT eligibility and triangle counts were fixed, the numeric Revit Tag
joins owner `1960533` to one `IfcRoof` product:

- exact RVT cone subset: 4 faces and 164 triangles;
- complete IFC product: 824 triangles;
- cone-subset/complete-product ratio: 19.90%.

The ratio is diagnostic rather than an equality target because the IFC count
contains every face of the roof. The same RVT owner also has cylinder and
other surface classes not counted by this cone-only audit. IFC data does not
participate in parameterization, eligibility, orientation, or tessellation.

## Browser API

```ts
import { tessellateRevit2027ConeApexSectors } from
  "./revit-2027-cone-apex-sector.ts";

const result = tessellateRevit2027ConeApexSectors({
  id: "owner-1960533",
  provenance,
  faces: [{
    faceToken,
    surface,
    provenance,
    loops: [{
      loopToken,
      role: "outer",
      edges: directedEdges.map(({ edgeToken, samples }) => ({
        edgeToken,
        samples,
      })),
    }],
  }],
});
```

The returned `NeutralFaceMesh` preserves face groups, material IDs, object
markers, and provenance. The current integration boundary expects directed
face-local samples; the existing queue/topology replay already supplies them.

## Files and commands

- `lib/reviter/revit-2027-cone-apex-sector.ts`
- `tests/revit-2027-cone-apex-sector.test.ts`
- `scripts/audit-revit-2027-cone-apex-sector.ts`
- `scripts/audit-revit-2027-cone-apex-ifc-parity.mjs`

```sh
node --experimental-strip-types --test \
  tests/revit-2027-cone-apex-sector.test.ts

node --experimental-strip-types \
  scripts/audit-revit-2027-cylinder-cone-trims.ts model.rvt \
  > cone-trims.json

node --experimental-strip-types \
  scripts/audit-revit-2027-cone-apex-sector.ts cone-trims.json \
  > cone-apex-sector.json

node scripts/audit-revit-2027-cone-apex-ifc-parity.mjs \
  --ifc reference.ifc \
  --cone-audit cone-apex-sector.json
```

## Remaining transition

The shared neutral `BrepSurface` cone placeholder still lacks X/Y basis
vectors and the general tessellator does not yet dispatch cone faces. This
module proves the exact evaluator, handedness, apex equivalence, normals, and
fan topology needed for that integration without widening the shared contract
during this checkpoint.

General sampled cone p-curve triangulation remains unproven for the other six
faces. Supporting it requires a constrained parameter-domain triangulator
with analytic interior refinement and an explicit native tessellation policy;
using a generic polygon triangulation over boundary samples alone would not
prove cone-surface deviation through the interior.
