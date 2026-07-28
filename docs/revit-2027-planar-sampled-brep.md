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
- anything other than exactly one explicit outer loop per neutral face (zero
  or more explicitly classified hole loops are supported);
- a repeated edge use in one loop;
- a face-side selection that does not reference the owning Face;
- a direction other than `+1` or `-1`;
- non-finite UV values or mapped 3D points;
- consecutive coincident samples;
- adjacent edge uses whose directed endpoints do not agree;
- a final edge that does not close to the first.

The adapter itself does not infer a hole from winding. Its Revit 2027 owner
caller supplies roles only when native-corrected UV winding and sampled UV
containment agree on filled regions with direct holes. The owner caller
specifically corrects raw UV area with persisted Face bit `0x2` and
`Surface.orientFlag`; this is a `TB_Geometry` rule, not a planar-renderer
face-forward assumption. When one
persisted Face contains disjoint shells or even-depth nested islands, its
caller supplies one neutral face per connected filled region while preserving
the same source Face identity, material, marker, and provenance. The
tessellator then rechecks strict containment, self-intersection, hole
intersection/nesting, and triangulated area. Callers with another exact
topology source must likewise supply an independently justified role for every
loop.

The adapter also does not treat `GInfo.gStyleElementId`,
`Face.renderStyleElementId`, an IFC material, or a category material as a
native face-material assignment. `materialId` remains `null` unless the caller
provides an exact decoded relation. This preserves the remaining exact-material
gap instead of hiding it in geometry output.

## Current corpus boundary

The exact owner replay reaches 40,632 closed loops and proves zero
next/previous reciprocity failures. The reusable browser path tessellates
40,294 planar Faces into 87,504 triangles. That includes 106 multi-loop Faces,
45 additional filled regions, 111 direct hole loops, and 2,693 triangles. No
uniquely directed multi-loop Face remains rejected.

The combined certified owner and persisted-instance path matches 25,642
numeric Revit Tags in the supplied IFC and emits 318,028 of the IFC's 318,304
triangles on that same matched set (99.91%). This is an oracle comparison
after RVT decoding, not a source of geometry.

Focused verification:

```sh
node --experimental-strip-types --test \
  tests/revit-2027-planar-sampled-brep.test.ts
```

The tests cover a complete square through the neutral tessellator, persisted
interior samples, reversed edge uses, exact material preservation, and the
principal fail-closed paths.
