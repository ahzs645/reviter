# Browser BRep tessellator boundary

`lib/reviter/brep-tessellator.ts` is the client-side boundary corresponding to
the native geometry stack identified in the exporter binaries:

| Native responsibility | Browser-side contract |
| --- | --- |
| `TB_Geometry` face/topology objects | `NeutralBrep`, `NeutralBrepFace`, oriented trim loops |
| `libTD_Ge` analytic geometry | `BrepSurface` and `BrepTrimCurve` discriminated unions |
| `libTD_Br` BRep traversal | ordered faces and face-local outer/hole loops |
| `BrepRenderer` / tessellator output | `NeutralFaceMesh` with contiguous `groups` |

The contract keeps class/source provenance, object markers, material identities,
face orientation and transforms attached to the triangles they produced. It
does not assign a display material or reinterpret a native material id.

## Supported proof-of-concept path

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

## Deliberate rejection boundary

The neutral IR can carry cylinders, cones, NURBS surfaces, arcs and NURBS trim
curves, but the proof-of-concept tessellator rejects them. It also returns no
partial mesh when any face is unsupported or invalid.

That is intentional. Curved and NURBS tessellation needs independently verified
chord, angular, knot, seam and singularity rules before it can claim parity
with `TB_Geometry`/`libTD_Ge`. Sampling those shapes with an arbitrary segment
count would produce drawable geometry, but it would not establish that the RVT
geometry was decoded correctly.

The next parser layer can therefore populate this IR incrementally:

1. Decode a polymorphic topology or BRep object.
2. Preserve its face ids, trim roles, material ids, markers and provenance.
3. Populate analytic surface/curve variants without approximating them.
4. Pass fully planar bodies to `tessellatePlanarBrep`.
5. Keep curved bodies explicitly unsupported until their tessellation contract
   is verified.
