import assert from "node:assert/strict";
import test from "node:test";
import { compareOwnerShapes, measureShape, pointTriangleDistance, sampledSurfaceDistance, type OwnerShape, type Point3, type Triangle3 } from "../scripts/lib/ifc-owner-geometry.ts";

const points: Point3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
const faces = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
test("exact closed tetrahedron has area/volume invariant to large translations", () => {
  const ordinary = measureShape(points, faces);
  assert.equal(ordinary.closedShellVolumeCubicFeet, 1 / 6);
  assert.equal(ordinary.surfaceAreaSquareFeet, (3 + Math.sqrt(3)) / 2);
  assert.equal(ordinary.boundaryEdges, 0);
  const translated = measureShape(points.map(point => point.map(value => value + 1e9) as unknown as Point3), faces);
  assert.equal(translated.closedShellVolumeCubicFeet, ordinary.closedShellVolumeCubicFeet);
});
test("open, inconsistent and non-manifold shapes cannot report closed-shell volume", () => {
  assert.equal(measureShape(points, faces.slice(3)).boundaryEdges, 3);
  assert.equal(measureShape(points, faces.slice(3)).closedShellVolumeCubicFeet, null);
  const reversed = [...faces]; reversed.splice(0, 3, 0, 1, 2);
  assert.equal(measureShape(points, reversed).inconsistentWindingEdges, 3);
  assert.equal(measureShape(points, reversed).closedShellVolumeCubicFeet, null);
  assert.equal(measureShape(points, [...faces, ...faces.slice(0, 3)]).nonManifoldEdges, 3);
  assert.equal(measureShape(points, [...faces, ...faces.slice(0, 3)]).closedShellVolumeCubicFeet, null);
});
test("coincident separately indexed vertices weld exactly but a tiny gap stays open", () => {
  const separate = faces.map(index => points[index]!);
  assert.equal(measureShape(separate, separate.map((_, index) => index)).closedShellVolumeCubicFeet, 1 / 6);
  const gapped = separate.map((point, index) => index === 0 ? [1e-12, point[1], point[2]] as Point3 : point);
  assert.equal(measureShape(gapped, gapped.map((_, index) => index)).closedShellVolumeCubicFeet, null);
});
test("malformed and degenerate triangles are explicit", () => {
  assert.throws(() => measureShape(points, [0, 1]));
  assert.throws(() => measureShape(points, [0, 1, 10]));
  assert.throws(() => measureShape([[NaN, 0, 0]], []));
  assert.equal(measureShape(points, [0, 0, 1]).degenerateTriangles, 1);
});
const owner = (tag: string, globalId = "1G_I00WlX2MBQekqB04dFi"): OwnerShape => ({ tag, globalId,
  ifcType: "IFCCOLUMN", expressId: 1, parts: [measureShape(points, faces)] });
test("owner joins require unique exact Tag and same GlobalId; duplicates cannot overwrite", () => {
  const comparison = compareOwnerShapes([owner("1"), owner("2"), owner("2"), owner("3"), owner("4")],
    [owner("1"), owner("2"), owner("3", "1G_I00WlX2MBQekqB04dCi"), owner("5")]);
  assert.equal(comparison.compared, 1); assert.equal(comparison.ambiguous, 1);
  assert.equal(comparison.identityDisagreements, 1); assert.equal(comparison.outputOnly, 1); assert.equal(comparison.referenceOnly, 1);
  assert.equal(comparison.comparisons[0]!.boundsCornerErrorFeet, 0);
  assert.equal(comparison.comparisons[0]!.areaDelta.relative, 0);
  assert.equal(comparison.comparisons[0]!.closedPartVolumeDelta!.relative, 0);
});

test("surface sampling measures finite triangles and never just their infinite supporting plane", () => {
  const triangle: Triangle3 = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  assert.equal(pointTriangleDistance([0.25, 0.25, 2], triangle), 2);
  assert.equal(pointTriangleDistance([1, 1, 0], triangle), Math.SQRT1_2);
  assert.equal(pointTriangleDistance([0, 0, 1], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]), 1);
  assert.deepEqual(sampledSurfaceDistance([triangle], [triangle]), { maximumFeet: 0, samples: 7 });
  assert.equal(sampledSurfaceDistance([triangle], []), null);
});
