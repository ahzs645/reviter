import assert from "node:assert/strict";
import test from "node:test";
import { makePascalScene, makePascalSceneJson, type PascalNode } from "../lib/reviter/export-pascal.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import { parseExtractArguments } from "../scripts/extract-geometry.ts";

type Topology = {
  vertices: { id: string; position: number[] }[];
  edges: { id: string; vertexIds: string[] }[];
  faces: { id: string; vertexIds: string[]; materialSlot?: string }[];
};
function fixture(count = 2051): ConvertResult {
  return {
    fileName: "review.rvt", origin: { x: 0, y: 0, z: 0 },
    bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 20, z: 20 } },
    decoderCoverage: {},
    levels: [{ levelId: 1, elevation: 0 }, { levelId: 2, elevation: 10 }],
    elementBounds: [],
    nativeAssociatedLevelRelations: [{ elementId: 1, levelId: 2 }],
    materials: [{ name: "Glass", baseColorLinear: [1, 0, 0, 0.4], roughness: 0.3, metallic: 0.2, doubleSided: true }],
    meshes: [{
      name: "Sloped", materialIndex: 0,
      positions: new Float32Array([1, 2, 3, 5, 2, 3, 1, 6, 4]),
      indices: new Uint32Array(Array.from({ length: count }, () => [0, 1, 2]).flat()),
      elementIds: new Uint32Array(Array.from({ length: count }, (_, i) => i + 1)),
    }],
  } as unknown as ConvertResult;
}
function blocks(nodes: Record<string, PascalNode>) {
  return Object.values(nodes).filter(n => n.type === "block");
}

test("coincident and closely spaced levels preserve world elevations in both drawn modes", () => {
  const r = fixture(1);
  r.origin.z = 100;
  r.levels = [100, 100, 100.01, 110, 110, 120].map((elevation, i) => ({
    levelId: i + 1, elevation,
  })) as ConvertResult["levels"];
  for (const drawnGrouping of ["review", "element"] as const) {
    for (let levelId = 1; levelId <= r.levels.length; levelId++) {
      r.nativeAssociatedLevelRelations = [{ elementId: 1, levelId, fieldOffset: 0, recordOffset: 0, objectLength: 0, objectMarker: 0, kind: "associated-level", source: "Partitions/Element.m_assocLevelId", evidence: "persisted" }];
      const scene = makePascalScene(r, { geometry: "drawn", drawnGrouping });
      let stack = 0;
      const elevations = new Map<string, number>();
      for (const level of Object.values(scene.nodes).filter(n => n.type === "level")) {
        stack += level.baseElevation as number;
        elevations.set(level.id, stack);
        const expected = (r.levels[level.level as number]!.elevation - r.origin.z) * 0.3048;
        assert.ok(Math.abs(stack - expected) < 1e-12, `datum ${level.id} moved`);
        assert.ok((level.height as number) >= 0.01);
        stack += level.height as number;
      }
      const block = blocks(scene.nodes)[0]!;
      assert.equal(block.parentId, `level_r${levelId}`);
      const position = block.position as number[];
      const topology = block.topology as Topology;
      for (const [i, vertex] of topology.vertices.entries()) {
        const worldY = vertex.position[1]! + position[1]! + elevations.get(block.parentId!)!;
        assert.ok(Math.abs(worldY - r.meshes[0]!.positions[i * 3 + 2]! * 0.3048) < 1e-12);
      }
    }
  }
});

test("review batches preserve every triangle, owner, material, level and winding", () => {
  const r = fixture();
  for (const mirrorPlan of [false, true]) {
    const scene = makePascalScene(r, { geometry: "drawn", drawnGrouping: "review", mirrorPlan });
    const meshes = blocks(scene.nodes);
    assert.equal(meshes.length, 3);
    assert.equal(scene.stats.representedElements, 2051);
    assert.equal(scene.stats.drawnTriangles, 2051);
    const seen = new Set<number>();
    for (const node of meshes) {
      const topology = node.topology as Topology;
      const ranges = node.metadata!.sourceTriangleRanges as [number, number, number][];
      assert.ok(topology.faces.length <= 2048);
      assert.deepEqual(node.slots, { body: "scene:mat_reviter_0" });
      assert.equal(new Set(topology.vertices.map(v => v.id)).size, topology.vertices.length);
      const edges = new Set(topology.edges.map(e => e.vertexIds.slice().sort().join("/")));
      assert.equal(edges.size, topology.edges.length);
      let covered = 0;
      for (const [start, count, owner] of ranges) {
        covered += count;
        assert.equal(node.parentId, owner === 1 ? "level_r2" : "level_r1");
        for (let i = start; i < start + count; i++) {
          const face = topology.faces.find(face => face.id === `f${i}`)!;
          assert.ok(face, "source triangle ranges identify persistent face IDs");
          const sourceTriangle = Number(face.id.slice(1));
          assert.ok(!seen.has(sourceTriangle)); seen.add(sourceTriangle);
          assert.equal(owner, r.meshes[0]!.elementIds![sourceTriangle]);
          const sourceCorners = mirrorPlan ? [2, 1, 0] : [0, 1, 2];
          face.vertexIds.forEach((id, c) => {
            assert.ok(edges.has([id, face.vertexIds[(c + 1) % 3]!].sort().join("/")));
            const v = topology.vertices.find(v => v.id === id)!;
            const position = node.position as number[];
            const world = v.position.map((x, a) => x + position[a]! + (a === 1 && owner === 1 ? 3.048 : 0));
            const source = r.meshes[0]!.positions;
            const j = sourceCorners[c]! * 3;
            const expected = [source[j]! * 0.3048, source[j + 2]! * 0.3048, source[j + 1]! * (mirrorPlan ? 0.3048 : -0.3048)];
            world.forEach((x, a) => assert.ok(Math.abs(x - expected[a]!) < 1e-12));
          });
        }
      }
      assert.equal(covered, topology.faces.length);
    }
    assert.equal(seen.size, 2051);
  }
});

test("review JSON is smaller without rounding coordinates or removing topology edges", () => {
  const r = fixture(200);
  const original = makePascalSceneJson(r, { geometry: "drawn" });
  const review = makePascalSceneJson(r, { geometry: "drawn", drawnGrouping: "review" });
  assert.ok(review.length < original.length * 0.8);
  const scene = JSON.parse(review);
  for (const node of blocks(scene.nodes)) {
    const topology = node.topology as Topology;
    assert.equal(topology.faces[0]!.materialSlot, undefined, "Pascal supplies its body default");
    assert.ok(topology.edges.length > 0);
  }
  assert.equal(blocks(JSON.parse(original).nodes).length, 200, "default keeps element parts");
});

test("review keeps source meshes separate and represents unowned faces explicitly", () => {
  const r = fixture(3);
  r.meshes[0]!.elementIds = new Uint32Array([0, 7, 7]);
  r.meshes.push({ ...r.meshes[0]!, materialIndex: 1 });
  const scene = makePascalScene(r, { geometry: "drawn", drawnGrouping: "review" });
  assert.equal(scene.stats.blocks, 2);
  assert.equal(scene.stats.representedElements, 1);
  for (const node of blocks(scene.nodes)) {
    assert.deepEqual(node.metadata!.sourceTriangleRanges, [[0, 1, null], [1, 2, 7]]);
    assert.deepEqual(node.metadata!.revitElementIds, [7]);
  }
});

test("review rejects corrupt triangle indices and coordinates", () => {
  const r = fixture(1);
  r.meshes[0]!.indices = new Uint32Array([0, 1, 99]);
  assert.throws(() => makePascalScene(r, { geometry: "drawn", drawnGrouping: "review" }), /outside positions/);
  r.meshes[0]!.indices = new Uint32Array([0, 1, 2]);
  r.meshes[0]!.positions[0] = NaN;
  assert.throws(() => makePascalScene(r, { geometry: "drawn", drawnGrouping: "review" }), /nonfinite/);
});

test("CLI exposes review grouping only for drawn Pascal exports", () => {
  const args = ["model.rvt", "--out", "model.pascal.json", "--pascal-geometry", "drawn", "--pascal-grouping", "review"];
  assert.equal(parseExtractArguments(args).pascalGrouping, "review");
  assert.throws(() => parseExtractArguments(args.slice(0, -1).concat("bad")), /element or review/);
  assert.throws(() => parseExtractArguments(["model.rvt", "--out", "model.pascal.json", "--pascal-grouping", "review"]), /requires/);
  assert.throws(() => makePascalScene(fixture(), { drawnGrouping: "review" }), /requires drawn/);
  assert.equal(parseExtractArguments(["model.rvt", "--out", "model.pascal.json.gz"]).format, "pascal");
  assert.throws(() => parseExtractArguments(["model.rvt", "--out", "model.glb.gz", "--format", "glb"]), /Compressed output requires Pascal/);
});

 test("ownership survives face reordering and non-contiguous source triangles", () => {
  const r = fixture(4);
  r.meshes[0]!.elementIds = new Uint32Array([7, 8, 7, 8]);
  const scene = makePascalScene(r, { geometry: "drawn", drawnGrouping: "review" });
  const node = blocks(scene.nodes)[0]!;
  const topology = node.topology as Topology;
  topology.faces.reverse();
  const ranges = node.metadata!.sourceTriangleRanges as [number, number, number][];
  for (const face of topology.faces) {
    const triangle = Number(face.id.slice(1));
    const range = ranges.find(([start, count]) => triangle >= start && triangle < start + count);
    assert.equal(range?.[2], r.meshes[0]!.elementIds![triangle]);
  }
});
