# Browser BRep tessellator boundary

`lib/reviter/brep-tessellator.ts` is the client-side boundary corresponding to
the native geometry stack identified in the exporter binaries:

| Native responsibility | Browser-side contract |
| --- | --- |
| `TB_Geometry` face/topology objects | `NeutralBrep`, `NeutralBrepFace`, oriented trim loops |
| `libTD_Ge` analytic geometry | `BrepSurface`, 3D trims, and explicit surface p-curves |
| `libTD_Br` BRep traversal | ordered faces and face-local outer/hole loops |
| `BrepRenderer` / tessellator output | `NeutralFaceMesh` with contiguous `groups` |

The contract keeps class/source provenance, object markers, material identities,
face orientation and transforms attached to the triangles they produced. It
does not assign a display material or reinterpret a native material id.

## Supported planar path

`tessellatePlanarBrep` accepts a complete BRep only when every face:

- has a finite orthogonal plane frame;
- has exactly one closed outer loop;
- uses contiguous line or polyline trim curves;
- has finite, non-repeated, coplanar trim vertices;
- has simple loops and strictly contained, non-overlapping holes;
- triangulates to the area of the outer loop minus its holes.

The function projects the validated 3D trims into the plane's local UV frame,
uses Reviter's existing hole-aware polygon triangulator, checks triangle area
coverage, restores 3D positions, applies the face transform and then the BRep
transform, and emits one contiguous group per source face. Positions remain
`Float64Array` at this boundary so conversion to viewer-relative `Float32Array`
can happen later without losing model coordinates.

The transform convention is column-major affine, matching WebGL/Three.js.
`brep.transform * face.transform` is applied to a face-local point.

## Supported cylindrical-chart path

`tessellateNeutralBrep` preserves the planar behavior and additionally accepts
the first verified curved-surface subset. A cylinder must provide:

- finite, positive radius;
- explicit, orthonormal, right-handed `axis`, `xAxis`, and `yAxis`;
- one outer loop and no holes;
- explicit `pcurve-line` or `pcurve-polyline` trims;
- exactly four distinct rectangle corners in a single non-wrapping parameter
  chart;
- an explicit native tessellation policy.

The parameter convention mirrors the recovered native cylinder:

```text
P(u,v) =
  origin
  + radius * u * axis
  + radius * (cos(v) * xAxis + sin(v) * yAxis)
```

U is axial distance normalized by radius and V is angle in radians. P-curves
are necessary because a 3D chord between two cylinder points is generally not
the corresponding curve on the surface. Reinterpreting an ordinary 3D
line/polyline as a surface-space segment would invent geometry.

Axial and angular subdivision uses
[`native-tessellation-policy.ts`](../lib/reviter/native-tessellation-policy.ts).
Axial runs use the recovered cylinder U step; angular runs use the strictest
active native chord, angle, and circular-deviation limit. A cylinder without an
explicit policy is rejected. A zero axial limit can safely use one interval
because the cylinder is exactly linear along its axis; an angular chart with no
active curved limit is rejected.

Vertices are evaluated directly on the analytic cylinder. Smooth per-vertex
normals come from transformed analytic derivatives, so composed affine
transforms, including non-uniform scaling, retain geometrically correct normals.
Face orientation reverses both normals and triangle winding. Each face still
emits one contiguous group carrying its source material, marker, transform, and
both BRep and face provenance.

`tessellateNeutralBrep` accepts mixed planar/cylindrical bodies, offsets every
face group into the combined mesh, and returns no partial mesh when any face is
invalid or unsupported. `tessellatePlanarBrep` remains the compatibility entry
point and continues to reject every curved face.

## Deliberate rejection boundary

The neutral IR can carry cones, NURBS surfaces, 3D arcs and NURBS trim curves,
but the proof-of-concept tessellator rejects them. The cylindrical path also
rejects:

- a full-period chart or any edge with an ambiguous angular wrap;
- a non-rectangular p-curve chart;
- cylinder holes;
- ordinary 3D trims;
- missing or invalid policy values;
- singular/collapsed transformed faces;
- meshes exceeding the caller's vertex bound.

That is intentional. The remaining curved and NURBS paths need independently
verified chord, angular, knot, seam and singularity rules before they can claim
parity with `TB_Geometry`/`libTD_Ge`. Sampling those shapes with an arbitrary
segment count would produce drawable geometry, but it would not establish that
the RVT geometry was decoded correctly.

The next parser layer can therefore populate this IR incrementally:

1. Decode a polymorphic topology or BRep object.
2. Preserve its face ids, trim roles, material ids, markers and provenance.
3. Preserve native surface p-curves separately from 3D edge geometry.
4. Pass fully planar bodies to `tessellatePlanarBrep`.
5. Pass proven non-wrapping rectangular cylinder charts plus their recovered
   policy to `tessellateNeutralBrep`.
6. Keep every other curved body explicitly unsupported until its decoding and
   tessellation contracts are independently verified.

No persisted RVT BRep/modeler-body decoder currently feeds this boundary.
The supplied UNBC model already exercises a separate cylinder-triple wall path,
but promoting those triples into general face/loop topology would be a different
claim. The next missing transition remains lawful decoding of native faces,
loops, p-curves, and material markers into this neutral IR.
