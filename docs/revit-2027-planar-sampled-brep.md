# Revit 2027 planar sampled-BRep adapter

`lib/reviter/revit-2027-planar-sampled-brep.ts` is the first implemented
browser-only handoff from the exact Revit 2027 Face/GEdge/EdgeLoop work into
Reviter's existing neutral BRep tessellator.

It is a deliberately bounded proof of concept. It does not load or translate
the supplied native ELF binaries. Those binaries establish the architecture:

| Native layer | Browser-side counterpart in this checkpoint |
| --- | --- |
| `TB_Geometry` Face/GEdge graph | resolved Face token, loop order, face side, and edge-use direction |
| `libTD_Ge` plane evaluation | `origin + u * xVector + v * yVector` |
| `libTD_BrepBuilder` / `libTD_Br` topology | explicit outer/hole loop and ordered edge uses |
| `libTD_BrepRenderer` sampled trims | persisted GEdge endpoint/interior UV samples |
| renderer triangle output | `tessellatePlanarBrep` and its material-preserving face groups |

The adapter consumes only already decoded values:

- one exact `Plane` body;
- a positive owning Face token;
- loops whose positive tokens and ordered GEdges have already resolved;
- the owning face side (`0` or `1`) for every GEdge;
- explicit edge-use direction (`+1` or `-1`);
- an explicit outer/hole role for every loop;
- optional exact material, marker, and provenance.

For each directed GEdge it selects the owning face's UV pair, orders the first
endpoint, interior samples, and last endpoint, reverses them when requested,
and evaluates those samples on the decoded Plane. Two samples become a line;
more become a polyline. The result is a `NeutralBrep` accepted by the existing
planar tessellator.

This is not arbitrary curve approximation. The points are the finite
double-precision samples persisted by the RVT's `GEdge` body. The adapter does
not choose a tessellation density or use the IFC to create points.

## Fail-closed rules

The adapter rejects the whole BRep when it encounters:

- invalid Face, loop, or edge tokens;
- anything other than one explicit outer loop per neutral face;
- a repeated edge use in one loop;
- a face-side selection that does not reference the owning Face;
- a direction other than `+1` or `-1`;
- non-finite UV values or mapped 3D points;
- consecutive coincident samples;
- adjacent edge uses whose directed endpoints do not agree;
- a final edge that does not close to the first.

It does not infer a hole from winding. In the UNBC audit, 138 loops occur after
their Face's first loop, but they remain candidates until exact containment and
nonintersection are proved. Callers may immediately use the structurally safe
single-loop subset; multi-loop Faces require an independently justified role
for each loop.

The adapter also does not treat `GInfo.gStyleElementId`,
`Face.renderStyleElementId`, an IFC material, or a category material as a
native face-material assignment. `materialId` remains `null` unless the caller
provides an exact decoded relation. This preserves the remaining exact-material
gap instead of hiding it in geometry output.

## Current corpus boundary

The exact topology audit reaches 40,559 closed loops and proves zero
next/previous reciprocity failures. It identifies 40,246 planar Faces with a
complete loop chain and unique sampled-UV orientation. Of those, 40,171 have a
single loop and are the immediate candidate population for this adapter.

That is an input-capability count, not a tessellation or IFC parity result. The
next integration step is to expose the audit's resolved per-owner topology as
library data, adapt every eligible single-loop Face, and compare the resulting
element-level meshes with the supplied IFC by numeric Revit Tag. Until that
pipeline runs, no new RVT-to-IFC triangle coverage is claimed.

Focused verification:

```sh
node --experimental-strip-types --test \
  tests/revit-2027-planar-sampled-brep.test.ts
```

The tests cover a complete square through the neutral tessellator, persisted
interior samples, reversed edge uses, exact material preservation, and the
principal fail-closed paths.
