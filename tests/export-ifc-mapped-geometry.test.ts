import assert from "node:assert/strict";
import test from "node:test";
import { IfcAPI } from "web-ifc";
import { IfcParser } from "@ifc-lite/parser";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { planMappedGeometry } from "../lib/reviter/export-ifc-mapped-geometry.ts";
import { ifcExportFixture } from "./fixtures/ifc-export-fixture.ts";

function repeatedFixture() {
  const result = ifcExportFixture();
  const positions: number[] = [], indices: number[] = [], owners: number[] = [];
  result.elementBounds = [];
  for (let instance = 0; instance < 16; instance += 1) {
    const id = 100 + instance, start = positions.length / 3;
    for (let i = 0; i < 48; i += 1) {
      const angle = i * Math.PI * 2 / 48;
      const radius = 2 + Math.cos(angle * 3) / 2;
      positions.push(instance * 8 + Math.cos(angle) * radius, Math.sin(angle) * radius, i % 3);
    }
    for (let i = 1; i < 47; i += 1) {
      indices.push(start, start + i, start + i + 1); owners.push(id);
    }
    result.elementBounds.push({ ...ifcExportFixture().elementBounds[0]!, elementId: id,
      typeId: 20, boundsFeet: { min: { x: instance * 8 + 97, y: 197, z: 10 }, max: { x: instance * 8 + 103, y: 203, z: 12 } },
    });
  }
  // Float32 translations of arbitrary vertices need not preserve their local
  // shape exactly. Use doubles representable after translation to establish a
  // real positive witness instead of a quantized near-match.
  result.meshes = [{ name: "Repeated asymmetric native body", positions: new Float32Array(positions.map(value => Math.round(value * 64) / 64)),
    indices: new Uint32Array(indices), elementIds: new Uint32Array(owners), colors: new Float32Array(positions.length),
    materialIndex: 0, source: "native-brep" }];
  result.nativeHostRelations = [];
  result.nativeCompoundLayerMaterialAssignments = [];
  result.nativeElementMaterialAssignments = [];
  return result;
}

async function reopenedGeometry(source: string) {
  const api = new IfcAPI(); await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(source), { COORDINATE_TO_ORIGIN: false });
  assert.ok(model >= 0);
  const byTag = new Map<number, { triangles: number; faces: string[]; colors: string[] }>();
  try {
    api.StreamAllMeshes(model, mesh => {
      const line = api.GetLine(model, mesh.expressID), tag = Number(line.Tag?.value);
      if (!Number.isSafeInteger(tag)) return;
      const record = { triangles: 0, faces: [] as string[], colors: [] as string[] };
      for (let part = 0; part < mesh.geometries.size(); part += 1) {
        const placed = mesh.geometries.get(part), matrix = placed.flatTransformation;
        const geometry = api.GetGeometry(model, placed.geometryExpressID);
        const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        const point = (index: number) => {
          const x = vertices[index * 6]!, y = vertices[index * 6 + 1]!, z = vertices[index * 6 + 2]!;
          return [matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
            matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
            matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!].map(value => Math.round(value * 1e5)).join(",");
        };
        for (let i = 0; i < indices.length; i += 3) record.faces.push([point(indices[i]!), point(indices[i + 1]!), point(indices[i + 2]!)].sort().join(";"));
        record.triangles += indices.length / 3;
        record.colors.push(JSON.stringify(placed.color)); geometry.delete();
      }
      record.faces.sort(); record.colors.sort(); byTag.set(tag, record);
    });
    return byTag;
  } finally { api.CloseModel(model); api.Dispose(); }
}

test("mapped native tessellations retain asymmetric triangles, owners, translated placement and material in two readers", async () => {
  const fixture = repeatedFixture();
  const ordinary = makeIfc(fixture), mapped = makeIfc(fixture, { reuseMappedGeometry: true });
  assert.equal((mapped.match(/=IFCREPRESENTATIONMAP\(/g) ?? []).length, 1);
  assert.equal((mapped.match(/=IFCMAPPEDITEM\(/g) ?? []).length, 16);
  assert.equal((mapped.match(/=IFCTRIANGULATEDFACESET\(/g) ?? []).length, 1);
  assert.ok(mapped.length < ordinary.length * 0.8, `${mapped.length} vs ${ordinary.length}`);
  assert.deepEqual(await reopenedGeometry(mapped), await reopenedGeometry(ordinary));
  const bytes = new TextEncoder().encode(mapped);
  const parsed = await new IfcParser().parseColumnar(bytes.buffer);
  assert.equal(parsed.schemaVersion, "IFC4");
  assert.equal(parsed.entityCount, mapped.split("\n").filter(line => /^#\d+=/.test(line)).length);
});

test("sharing refuses different topology, materials, source/type ownership and near-identical geometry", () => {
  const result = ifcExportFixture();
  const fragment = { positions: [0, 0, 0, 1, 0, 0, 0, 2, 1], indices: [1, 2, 3], materialIndex: 0, source: "native-brep" as const };
  result.elementBounds[1]!.typeId = 20;
  const plan = (other = fragment) => planMappedGeometry(result, new Map([[10, [fragment]], [11, [other]]]));
  assert.equal(plan().size, 2);
  assert.equal(plan({ ...fragment, positions: [0, 0, 0, 1, 0, 0, 0, 2, 1.0000000001] }).size, 0);
  assert.equal(plan({ ...fragment, indices: [1, 3, 2] }).size, 0);
  assert.equal(plan({ ...fragment, materialIndex: 1 }).size, 0);
  result.elementBounds[1]!.typeId = 21; assert.equal(plan().size, 0);
  delete result.elementBounds[1]!.typeId; assert.equal(plan().size, 0);
  result.elementBounds[1]!.typeId = 20;
  result.elementBounds.push({ ...result.elementBounds[1]!, typeId: 99 }); assert.equal(plan().size, 0);
  result.elementBounds.pop();
  assert.equal(planMappedGeometry(result, new Map([[10, [{ ...fragment, source: "display-proxy" }]], [11, [{ ...fragment, source: "display-proxy" }]]])).size, 0);
  assert.equal(planMappedGeometry(result, new Map([[998, [fragment]], [999, [fragment]]])).size, 0);
});

test("source-backed rotations reuse one asymmetric map while independently reopened placement and colors agree", async () => {
  const fixture = repeatedFixture();
  fixture.nativeInstancePlacements = [];
  const mesh = fixture.meshes[0]!;
  for (let instance = 0; instance < 16; instance++) {
    const quarter = instance % 4, c = [1, 0, -1, 0][quarter]!, s = [0, 1, 0, -1][quarter]!;
    const basis = [c, -s, 0, s, c, 0, 0, 0, 1];
    fixture.nativeInstancePlacements.push({ elementId: 100 + instance, geometryId: 987, basis, origin: [instance * 8 + 100, 200, 10] });
    for (let vertex = instance * 48; vertex < (instance + 1) * 48; vertex++) {
      const x = mesh.positions[vertex * 3]! - instance * 8, y = mesh.positions[vertex * 3 + 1]!;
      mesh.positions[vertex * 3] = instance * 8 + c * x - s * y;
      mesh.positions[vertex * 3 + 1] = s * x + c * y;
    }
  }
  const ordinary = makeIfc(fixture), mapped = makeIfc(fixture, { reuseMappedGeometry: true });
  assert.equal((mapped.match(/=IFCREPRESENTATIONMAP\(/g) ?? []).length, 1);
  assert.equal((mapped.match(/=IFCMAPPEDITEM\(/g) ?? []).length, 16);
  assert.deepEqual(await reopenedGeometry(mapped), await reopenedGeometry(ordinary));
  const parsed = await new IfcParser().parseColumnar(new TextEncoder().encode(mapped).buffer); assert.equal(parsed.schemaVersion, "IFC4");
});

test("rotation reuse needs matching native geometry identity and rigid source bases", () => {
  const fixture = ifcExportFixture(); fixture.elementBounds[1]!.typeId = 20;
  fixture.nativeInstancePlacements = [{ elementId: 10, geometryId: 7, origin: [0, 0, 0], basis: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, { elementId: 11, geometryId: 7, origin: [0, 0, 0], basis: [0, -1, 0, 1, 0, 0, 0, 0, 1] }];
  const a = { positions: [0, 0, 0, 1, 0, 0, 0, 2, 1], indices: [1, 2, 3], materialIndex: 0, source: "native-brep" as const };
  const b = { ...a, positions: [0, 0, 0, 0, 1, 0, -2, 0, 1] };
  const fragments = new Map([[10, [a]], [11, [b]]]); assert.equal(planMappedGeometry(fixture, fragments).size, 2);
  fixture.nativeInstancePlacements[1]!.geometryId = 8; assert.equal(planMappedGeometry(fixture, fragments).size, 0);
  fixture.nativeInstancePlacements[1]!.geometryId = 7; fixture.nativeInstancePlacements[1]!.basis[0] = .01; assert.equal(planMappedGeometry(fixture, fragments).size, 0);
  fixture.nativeInstancePlacements[1]!.basis = [0, 1, 0, 1, 0, 0, 0, 0, 1]; assert.equal(planMappedGeometry(fixture, fragments).size, 0);
});
