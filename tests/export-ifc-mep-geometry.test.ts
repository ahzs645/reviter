import assert from "node:assert/strict";
import test from "node:test";
import { IfcAPI } from "web-ifc";
import { IfcParser } from "@ifc-lite/parser";
import { emitNativePipeShape, type NativePipeShapeContext } from "../lib/reviter/export-ifc-mep-geometry.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";
import type { NativeMepDimensions } from "../lib/reviter/native-mep.ts";

const context: NativePipeShapeContext = { bodyContext: 1, categoryId: -2008044, categorySource: "element-header", origin: { x: 100, y: 200, z: 10 }, expectedBounds: { min: { x: 100, y: 199.9, z: 9.9 }, max: { x: 110, y: 200.1, z: 10.1 } } };
const dimension: NativeMepDimensions = { elementId: 10, lengthFeet: 10, pipeInnerDiameterFeet: .16, pipeOuterDiameterFeet: .2, pipeAxis: { startFeet: [100, 200, 10], endFeet: [110, 200, 10], radiusFeet: .1 }, sources: [{ decoder: "RE-131", revitVersion: 2025, stream: "Partitions/7", chunkIndex: 1, byteOffset: 10 }, { decoder: "RE-157", revitVersion: 2025, stream: "Partitions/7", chunkIndex: 1, byteOffset: 100 }] };
function recorder() { const entities: string[] = []; return { entities, add(s: string) { entities.push(s); return entities.length; } }; }
function pipeDocument(d: NativeMepDimensions = dimension, c: NativePipeShapeContext = context) {
  const base = makeIfc(ifcExportFixture()), data = base.slice(base.indexOf("\nDATA;") + 6, base.lastIndexOf("ENDSEC;"));
  let id = Math.max(...[...data.matchAll(/#(\d+)=/g)].map((m) => Number(m[1])));
  const emitted: string[] = [], writer = { add(expression: string) { emitted.push(`#${++id}=${expression};`); return id; } };
  const bodyContext = Number(/#(\d+)=IFCGEOMETRICREPRESENTATIONSUBCONTEXT\('Body'/.exec(data)![1]);
  const owner = Number(/#(\d+)=IFCOWNERHISTORY\(/.exec(data)![1]);
  const origin = writer.add("IFCCARTESIANPOINT((0.,0.,0.))"), axis = writer.add(`IFCAXIS2PLACEMENT3D(#${origin},$,$)`), placement = writer.add(`IFCLOCALPLACEMENT($,#${axis})`);
  const shape = emitNativePipeShape(writer, d, { ...c, bodyContext }); assert.ok(shape);
  const pipeId = writer.add(`IFCPIPESEGMENT('0000000000000000000001',#${owner},'Verified pipe',$,$,#${placement},#${shape.shapeId},'10',.RIGIDSEGMENT.)`);
  return { text: base.replace("\nENDSEC;\nEND-ISO-10303-21;", `\n${emitted.join("\n")}\nENDSEC;\nEND-ISO-10303-21;`), pipeId };
}
test("verified pipe emits a hollow sweep in metres with explicit reconstruction provenance", () => {
  const writer = recorder(), shape = emitNativePipeShape(writer, dimension, context); assert.ok(shape);
  assert.equal(shape.geometryExact, false); assert.equal(shape.provenance, "reconstructed");
  assert.ok(writer.entities.some((e) => e.startsWith("IFCCIRCLEHOLLOWPROFILEDEF")));
  const circle = writer.entities.find((e) => e.startsWith("IFCCIRCLEHOLLOWPROFILEDEF"))!;
  const nums = circle.match(/,([^,()]+),([^,()]+)\)$/)!;
  assert.ok(Math.abs(Number(nums[1]) - .03048) < 1e-12);
  assert.ok(Math.abs(Number(nums[2]) - .006096) < 1e-12);
  assert.ok(writer.entities.some((e) => e === "IFCCARTESIANPOINT((0.,0.,0.))"));
});
test("wrong category, non-native category evidence, absent proof, and conflicting bounds fail before writes", () => {
  for (const [d, c] of [
    [dimension, { ...context, categoryId: -2008000 }],
    [dimension, { ...context, categorySource: "record-code-consensus" }],
    [{ ...dimension, sources: [] }, context],
    [{ ...dimension, pipeInnerDiameterFeet: .3 }, context],
    [{ ...dimension, pipeOuterDiameterFeet: .4 }, context],
    [dimension, { ...context, expectedBounds: { ...context.expectedBounds, max: { x: 11, y: .1, z: .1 } } }],
    [{ ...dimension, pipeAxis: { ...dimension.pipeAxis!, endFeet: [100, 200, 10] } }, context],
  ] as [NativeMepDimensions, NativePipeShapeContext][]) {
    const writer = recorder(); assert.equal(emitNativePipeShape(writer, d, c), null); assert.equal(writer.entities.length, 0);
  }
});
test("angled native pipe creates a stable perpendicular frame and reconstructs its oblique bounds", () => {
  const start: [number, number, number] = [0, 0, 0], end: [number, number, number] = [3, 4, 12], u = end.map((v) => v / 13);
  const extent = u.map((v) => .1 * Math.sqrt(1 - v * v));
  const box = { min: { x: -extent[0]!, y: -extent[1]!, z: -extent[2]! }, max: { x: 3 + extent[0]!, y: 4 + extent[1]!, z: 12 + extent[2]! } };
  const writer = recorder();
  const shape = emitNativePipeShape(writer, { ...dimension, lengthFeet: 13, pipeAxis: { startFeet: start, endFeet: end, radiusFeet: .1 } }, { ...context, origin: { x: 0, y: 0, z: 0 }, expectedBounds: box });
  assert.ok(shape); assert.equal(shape.lengthFeet, 13);
  const directions = writer.entities.filter((e) => e.startsWith("IFCDIRECTION")).map((e) => e.slice(14, -2).split(",").map(Number));
  const z = directions[0]!, x = directions[1]!;
  assert.ok(Math.abs(z.reduce((sum, v, k) => sum + v * x[k]!, 0)) < 1e-12);
  assert.ok(Math.abs(x.reduce((sum, v) => sum + v * v, 0) - 1) < 1e-12);
});
test("web-ifc tessellates the hollow sweep and an independent IFC reader retains its product body", async () => {
  const { text, pipeId } = pipeDocument(), bytes = new TextEncoder().encode(text);
  const api = new IfcAPI(); await api.Init(); const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
  try {
    const mesh = api.GetFlatMesh(model, pipeId); assert.ok(mesh.geometries.size() > 0);
    let triangles = 0;
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const placed = mesh.geometries.get(i), geometry = api.GetGeometry(model, placed.geometryExpressID);
      triangles += geometry.GetIndexDataSize() / 3; geometry.delete();
    }
    assert.ok(triangles > 20); if (typeof mesh.delete === "function") mesh.delete();
  } finally { api.CloseModel(model); api.Dispose(); }
  const log = console.log; console.log = (...args: unknown[]) => { if (!String(args[0]).startsWith("[parseLite]")) log(...args); };
  try {
    const store = await new IfcParser().parseColumnar(bytes.buffer);
    assert.equal(store.entities.getTypeName(pipeId), "IfcPipeSegment"); assert.equal(store.entities.hasGeometry(pipeId), true);
  } finally { console.log = log; }
});

function exportPipeFixture() {
  const result = ifcExportFixture(), record = result.elementBounds[0]!;
  record.categoryId = -2008044; record.categoryName = "Pipes"; record.categorySource = "element-header";
  record.renderGeometryProvenance = "bounds-fallback"; record.boundsFeet = context.expectedBounds;
  result.meshes[0]!.source = "display-proxy";
  result.nativeMepEvidence = { revitVersion: 2025, systems: [], connections: [], dimensions: [dimension], limitations: [] };
  return result;
}
test("pipe reconstruction is an IFC opt-in that preserves the source scene buffers", () => {
  const result = exportPipeFixture(), positions = result.meshes[0]!.positions.slice(), indices = result.meshes[0]!.indices.slice();
  const ordinary = makeIfc(result), reconstructed = makeIfc(result, { reconstructPipeGeometry: true });
  assert.doesNotMatch(ordinary, /IFCCIRCLEHOLLOWPROFILEDEF/); assert.match(reconstructed, /IFCCIRCLEHOLLOWPROFILEDEF/);
  assert.match(reconstructed, /native-connector-axis-and-pipe-diameters/);
  assert.match(reconstructed, /'GeometryProvenance',\$,IFCTEXT\('reconstructed'\)/);
  assert.deepEqual(result.meshes[0]!.positions, positions); assert.deepEqual(result.meshes[0]!.indices, indices);
  assert.equal(result.elementBounds[0]!.renderGeometryProvenance, "bounds-fallback");
});
test("IFC opt-in leaves certified native and reference mesh bodies intact", () => {
  for (const source of ["native-brep", "reference-ifc"] as const) {
    const result = exportPipeFixture(); result.meshes[0]!.source = source;
    result.elementBounds[0]!.renderGeometryProvenance = source === "native-brep" ? "native" : "reference-assisted";
    const text = makeIfc(result, { reconstructPipeGeometry: true });
    assert.doesNotMatch(text, /IFCCIRCLEHOLLOWPROFILEDEF/); assert.match(text, /IFCTRIANGULATEDFACESET/);
  }
});
