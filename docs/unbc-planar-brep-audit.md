# UNBC planar BRep closure audit

This audit tests whether Reviter can safely turn the analytic plane patches
already decoded from the RVT into closed meshes without the native ODA
tessellator.

The test is intentionally strict. It:

1. removes only byte-identical repeated faces;
2. orients each persisted plane as a half-space;
3. intersects every non-parallel plane triple;
4. retains vertices inside every half-space;
5. requires every source plane to produce a face; and
6. requires every reconstructed face vertex to remain inside that plane's
   persisted `u/v` trim rectangle.

This is a useful client-side subset of BRep tessellation: when it succeeds, the
result is a closed convex polyhedron derived entirely from persisted analytic
geometry. Open, non-convex, fragmented, or ambiguously coplanar sets are
reported rather than filled.

## Exact UNBC result

Against:

```text
UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt
```

the audit read all 3,666 compressed chunks and 421,867,755 inflated partition
bytes:

| Measure | Count |
| --- | ---: |
| Elements owning one or more decoded planes | 12,169 |
| Closed convex meshes accepted | 0 |
| Native triangles emitted by this path | 0 |
| Too few distinct planes | 3,051 |
| Distinct trim regions on one plane | 4,078 |
| Unbounded or empty half-space intersection | 4,699 |
| A source plane did not bound a face | 73 |
| Reconstructed face left its persisted trim | 268 |

The zero is an important negative result. Drawing the stored trim rectangles
directly also produced zero edge-closed face sets. Plane equations alone are
therefore insufficient for this model: the missing serialized topology must
provide ordered loops/coedges, coplanar region unioning, face orientation, and
non-convex shell membership. Automatically closing these sets would invent
geometry and cannot be counted as IFC parity.

`lib/reviter/convex-facets.ts` keeps the validated convex subset available for
other RVT/RFA files. `scripts/audit-convex-facets.ts` makes the rejection
reasons reproducible, and its unit tests cover a valid closed body, duplicate
faces, open sets, clipped trims, and ambiguous coplanar regions.

## Reproduce

```sh
node --experimental-strip-types scripts/audit-convex-facets.ts \
  "/path/to/UNBC Model - 2026-06-30 - FINAL (Fixed Library) (1).rvt"

node --experimental-strip-types --test tests/convex-facets.test.ts
```
