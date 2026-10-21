import assert from "node:assert/strict";
import test from "node:test";
import { executeCommand, matchingCommands } from "../app/studio/commands.ts";
import { emptyReview, parseWorkspaceReview, dimensionLabel, dimensionValue, sourceHash, type ReviewDimension, type SavedReviewView } from "../app/studio/review-session.ts";
import { DrawingSnapIndex, constrainedPoint, drawingPointAt } from "../app/studio/drawing-precision.ts";
import { rectangleSelects, similarElementIds } from "../app/studio/selection-tools.ts";
import { dwgPrintSvg, dwgSheetGeometry } from "../lib/reviter/dwg-print.ts";
import { dwgSectionSvg, type DwgEntity } from "../lib/reviter/dwg-plan.ts";
import { convertDwgEntities } from "../lib/reviter/dwg-entities.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
import * as THREE from "three";
import { createRecoveredElementsSelection } from "../app/studio/viewer-picking.ts";
import { referenceMeshGroup, overlayMeshGroup } from "../app/studio/three-scene.ts";

const hash = `sha256-${"a".repeat(64)}`;
const dimension = (overrides: Partial<ReviewDimension> = {}): ReviewDimension => ({
  id: "dim-1", mode: "distance", points: [[100, 200, 10], [103, 204, 10]], source: "recovered", space: "model-feet", unit: "feet", feetPerUnit: 1, calibration: 1,
  provenance: "Mesh surface · fixed anchors", createdAt: "2026-10-18T12:00:00Z", ...overrides,
});
const view: SavedReviewView = {
  id: "view-1", name: "Door review", camera: { source: "recovered", position: [15, 25, 40], target: [1, 2, 3], up: [0, 0, 1], fov: 45 },
  section: { enabled: true, mode: "z", offset: .3, reverse: false }, hiddenCategories: ["Walls"], hiddenIds: [11], levelId: 30, isolateLevel: true, renderMode: "xray",
};

test("palette searches aliases/IDs and every caller uses guarded execution", async () => {
  const called: string[] = [];
  const commands = [
    { id: "view.fit", label: "Zoom extents", keywords: "home", run: () => { called.push("fit"); } },
    { id: "element.select", label: "Select by ID", argument: { label: "Object ID", placeholder: "10" }, run: (text: string) => { called.push(text); } },
    { id: "review.export", label: "Export", reason: "Open a model", run: () => { called.push("should not run"); } },
  ];
  assert.equal(matchingCommands(commands, " HOME ")[0]?.id, "view.fit");
  assert.equal(matchingCommands(commands, "select id")[0]?.id, "element.select");
  await executeCommand(commands, "view.fit"); await executeCommand(commands, "element.select", " 10 ");
  await assert.rejects(executeCommand(commands, "review.export"), /Open a model/);
  await assert.rejects(executeCommand(commands, "missing"), /Unknown command/);
  await assert.rejects(executeCommand(commands, "element.select", " "), /object id/);
  assert.deepEqual(called, ["fit", "10"]);
});
test("source identity is a digest of file content, including same-length revisions", async () => {
  const a = await sourceHash(new Blob(["abcd"])), b = await sourceHash(new Blob(["abce"]));
  assert.match(a, /^sha256-[a-f0-9]{64}$/); assert.notEqual(a, b);
});
test("saved views and numeric dimensions survive portable exchange", () => {
  const session = { ...emptyReview(hash), views: [view], dimensions: [dimension()] };
  assert.deepEqual(parseWorkspaceReview(JSON.stringify(session), hash), session);
  assert.throws(() => parseWorkspaceReview(JSON.stringify(session), `sha256-${"b".repeat(64)}`), /different source/);
  assert.throws(() => parseWorkspaceReview(JSON.stringify({ ...session, version: 2 }), hash), /Unsupported/);
  assert.throws(() => parseWorkspaceReview(JSON.stringify({ ...session, dimensions: [dimension(), dimension()] }), hash), /duplicate/);
  assert.throws(() => parseWorkspaceReview(JSON.stringify({ ...session, views: [{ ...view, section: { ...view.section, offset: 10 } }] }), hash), /Invalid saved view/);
  assert.throws(() => parseWorkspaceReview(JSON.stringify({ ...session, dimensions: [dimension({ points: [[0, 0, 0]] })] }), hash), /Invalid dimension/);
  assert.throws(() => parseWorkspaceReview(JSON.stringify({ ...session, dimensions: [dimension({ feetPerUnit: -2 })] }), hash), /Invalid dimension/);
});
test("dimensions retain numeric units, calibration and unknown-unit disclosure", () => {
  assert.equal(dimensionValue(dimension()), 5);
  assert.equal(dimensionLabel(dimension({ unit: "metres" })), "1.524 m");
  assert.equal(dimensionLabel(dimension({ calibration: 2 })), "10.000 ft");
  const drawing = dimension({ source: "drawing", space: "drawing-units", feetPerUnit: null, points: [[0, 0, 0], [3, 4, 0]] });
  assert.equal(dimensionLabel(drawing), "5.000 units");
  assert.equal(dimensionLabel({ ...drawing, feetPerUnit: 1 / 12 }), "0.417 ft");
  const points: ReviewDimension["points"] = [[0, 0, 0], [3, 0, 0], [3, 4, 0], [0, 4, 0]];
  assert.equal(dimensionValue(dimension({ mode: "area", points })), 12);
  assert.equal(dimensionValue(dimension({ mode: "perimeter", points })), 14);
  assert.equal(dimensionValue(dimension({ mode: "angle", points: [[1, 0, 0], [0, 0, 0], [0, 1, 0]] })), 90);
});
const entities: DwgEntity[] = [
  { type: "LINE", layer: "Walls", points: [[0, 0], [10, 0]] },
  { type: "LINE", layer: "Doors", points: [[5, -5], [5, 5]] },
  { type: "CIRCLE", layer: "Furniture", centre: [20, 0], radius: 3 },
];
const bounds = { minX: -10, minY: -10, maxX: 30, maxY: 10 };
test("screen-space snaps are deterministic and respect hidden layers", () => {
  const index = new DrawingSnapIndex(entities, bounds);
  assert.deepEqual(index.snap([.1, .1], .3, new Set(["endpoint"]), new Set())?.point, [0, 0]);
  assert.deepEqual(index.snap([4.9, .1], .3, new Set(["midpoint"]), new Set())?.point, [5, 0]);
  assert.equal(index.snap([4.9, .1], .3, new Set(["intersection"]), new Set())?.kind, "intersection");
  assert.equal(index.snap([.1, .1], .3, new Set(["endpoint"]), new Set(["Walls"])), null);
  assert.deepEqual(index.snap([20.1, .1], .3, new Set(["centre"]), new Set())?.point, [20, 0]);
  assert.deepEqual(index.snap([22.9, 0], .3, new Set(["nearest"]), new Set())?.point, [23, 0]);
  assert.equal(index.snap([1, 1], NaN, new Set(["nearest"]), new Set()), null);
});
test("snap grids stay bounded on translated geometry and extreme rejected candidates", () => {
  const translated: DwgEntity[] = [{ type: "LINE", layer: "0", points: [[1e20, 1e20], [1e20 + 1e6, 1e20]] }];
  const index = new DrawingSnapIndex(translated, { minX: 1e20, minY: 1e20, maxX: 1e20 + 2e6, maxY: 1e20 + 2e6 });
  assert.deepEqual(index.snap([1e20, 1e20], 1, new Set(["endpoint"]), new Set())?.point, [1e20, 1e20]);
  const extreme = new DrawingSnapIndex([{ type: "LINE", layer: "0", points: [[1e308, 1e308], [1e308, 1e308]] }], bounds);
  assert.equal(extreme.snap([0, 0], 1, new Set(["endpoint"]), new Set()), null);
});
test("curve samples cannot masquerade as analytic endpoints or midpoints", () => {
  const sampled = convertDwgEntities([{ type: "LWPOLYLINE", layer: "0", vertices: [{ x: 0, y: 0, bulge: .5 }, { x: 10, y: 0 }] }]);
  assert.equal(sampled[0]?.sampled, true);
  const index = new DrawingSnapIndex(sampled, bounds);
  assert.equal(index.snap([0, 0], 1, new Set(["endpoint", "midpoint"]), new Set()), null);
});
test("arc snap does not extend outside the native angular interval", () => {
  const index = new DrawingSnapIndex([{ type: "ARC", layer: "0", centre: [0, 0], radius: 10, startAngle: 0, endAngle: Math.PI / 2 }], bounds);
  assert.equal(index.snap([-10, 0], .5, new Set(["nearest"]), new Set()), null);
  assert.deepEqual(index.snap([10, .1], .5, new Set(["endpoint"]), new Set())?.point, [10, 0]);
});
test("pointer coordinates account for letterboxing and constraints", () => {
  const box = { left: 100, top: 100, width: 400, height: 400 };
  const at = drawingPointAt([300, 300], box, bounds)!;
  assert.deepEqual(at.point, [10, 0]); assert.equal(at.unitsPerPixel, .1);
  assert.equal(drawingPointAt([300, 105], box, bounds), null);
  assert.deepEqual(constrainedPoint([0, 0], [3, 2], "ortho"), [3, 0]);
  const polar = constrainedPoint([0, 0], [4, 3], "polar");
  assert.ok(Math.abs(polar[0] - polar[1]) < 1e-9);
});
test("window encloses, crossing intersects, similarity excludes hidden objects", () => {
  const box = { minX: 10, maxX: 30, minY: 10, maxY: 30 };
  assert.equal(rectangleSelects(box, [0, 0], [20, 20]), false);
  assert.equal(rectangleSelects(box, [20, 20], [0, 0]), true);
  assert.equal(rectangleSelects(box, [0, 0], [40, 40]), true);
  const records = ifcExportFixture().elementBounds;
  assert.deepEqual([...similarElementIds(records, new Set([10]), new Set())], [10]);
  assert.deepEqual([...similarElementIds(records, new Set([10]), new Set([10]))], []);
});
test("multi-selection scans triangle ownership and IFC visibility preserves pick identities", () => {
  const fixture = ifcExportFixture(), mesh = fixture.meshes[0];
  const reference = [{ name: "Mixed owners", positions: mesh.positions, indices: mesh.indices, elementIds: mesh.elementIds, color: [.5, .5, .5] as [number, number, number], matched: true, diffStatus: "aligned" as const }];
  const root = referenceMeshGroup(reference, "technical", new Set([10]));
  const body = root.children.find(child => (child as THREE.Mesh).isMesh) as THREE.Mesh;
  assert.equal(body.geometry.index?.count, 3);
  assert.deepEqual([...body.userData.elementIds], [11]);
  const selected = createRecoveredElementsSelection(root, new Set([10, 11]), 1)!;
  assert.equal(selected.userData.triangleCount, 1);
  assert.equal(selected.userData.selectedCount, 2);
  const overlay = overlayMeshGroup(fixture, reference, "technical", false, new Set([10]));
  overlay.traverse(object => {
    if ((object as THREE.Mesh).isMesh && object.userData.elementIds) assert.ok(![...object.userData.elementIds].includes(10));
  });
});
test("physical review-sheet scale is measured in millimetres without extra fitting", () => {
  const geometry = dwgSheetGeometry([0, 0, 10, 20], "A4", false, 100, 1);
  assert.ok(Math.abs(geometry.width - 30.48) < 1e-9);
  assert.ok(Math.abs(geometry.height - 60.96) < 1e-9);
  assert.throws(() => dwgSheetGeometry([0, 0, 10, 20], "A4", false, 100, null), /drawing units/);
  assert.throws(() => dwgSheetGeometry([0, 0, 10000, 10000], "A4", false, 10, 1), /does not fit/);
  assert.throws(() => dwgSheetGeometry([0, 0, 0, 10], "A4", false, null, 1), /invalid printable bounds/);
  const svg = dwgSectionSvg(entities, bounds);
  const sheet = dwgPrintSvg(svg, "A4", true, { title: 'Review <script>"', source: "test.dwg", date: "2026-10-18", scale: 100, feetPerUnit: 1, layers: ["Walls", "Doors"] });
  assert.match(sheet, /width="297mm"/); assert.match(sheet, /data-sheet-mm-per-unit="3.048"/);
  assert.match(sheet, /data-scale-bar-feet=/); assert.match(sheet, /Scale 1:100/); assert.match(sheet, /&lt;script&gt;&quot;/); assert.doesNotMatch(sheet, /<script>/);
});
