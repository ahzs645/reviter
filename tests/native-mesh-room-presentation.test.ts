import test from "node:test";
import assert from "node:assert/strict";
import type { ConvertResult, MeshData } from "../lib/reviter/types.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import type { DirectoryRoom } from "../lib/reviter/room-directory.ts";
import { nativeMeshBarrierCuts } from "../lib/reviter/native-mesh-barrier-cuts.ts";
import { prepareIndoorPresentation } from "../lib/reviter/indoor-presentation.ts";
const rectangle = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
test("legacy models without meshes cannot supply native barrier evidence", () => {
  const model = { elementBounds: [] } as unknown as ConvertResult;
  assert.deepEqual(nativeMeshBarrierCuts(model, 311, 4), []);
});

function fixture() {
  const polygons = [
    rectangle(-0.5, -0.5, 10.5, 0),
    rectangle(10, 0, 10.5, 10.5),
    rectangle(-0.5, 10, 10, 10.5),
    rectangle(-0.5, 0, 0, 10),
  ];
  const positions: number[] = [],
    indices: number[] = [],
    ids: number[] = [];
  for (const [i, ring] of polygons.entries()) {
    const start = positions.length / 3;
    for (const z of [0, 8]) for (const [x, y] of ring) positions.push(x, y, z);
    for (let k = 0; k < 4; k++) {
      const q = (k + 1) % 4;
      indices.push(
        start + k,
        start + q,
        start + q + 4,
        start + k,
        start + q + 4,
        start + k + 4,
      );
      ids.push(i + 1, i + 1);
    }
  }
  const mesh = {
    name: "wall shells",
    source: "native-brep",
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    elementIds: new Uint32Array(ids),
  } as MeshData;
  const model = {
    origin: { x: 0, y: 0, z: 0 },
    levels: [{ levelId: 311, elevation: 0 }],
    elementBounds: polygons.map((_, i) => ({
      elementId: i + 1,
      categoryId: -2000011,
      renderGeometryProvenance: "native",
    })),
    meshes: [mesh],
  } as unknown as ConvertResult;
  const room = {
    key: "office",
    number: "Office",
    name: "Office",
    building: "10",
    levelId: 311,
    elevationFeet: 0,
    circulation: false,
    walkable: true,
    stair: false,
    access: "unknown",
    ringsFeet: [rectangle(1, 1, 9, 9)],
    properties: {},
  };
  // The simplified top wall stops three feet early; the certified mesh contains
  // the real corner and complete wall. This is not an inferred gap closure.
  const walls = polygons.map((ring, i) => ({
    levelId: 311,
    nativeElementId: i + 1,
    kind: "wall",
    approximate: false,
    ringsFeet: [i === 2 ? rectangle(-0.5, 10, 7, 10.5) : ring],
  }));
  const dataset = {
    source: { modelSha256: "model" },
    records: [room],
    walls,
    doors: [],
    nodes: [],
    edges: [],
  } as unknown as IndoorDataset;
  const annotations = [
    {
      key: room.key,
      levelId: 311,
      labelPointFeet: [5, 5],
      polygonFeet: room.ringsFeet[0],
      name: "Office",
      status: "active",
    },
  ] as DirectoryRoom[];
  const options = {
    nativeModel: model,
    floorsByRecord: new Map([["office", [[rectangle(0, 0, 10, 10)]]]]),
  };
  return { model, dataset, annotations, options };
}
test("owned native mesh joins recover a closed display room without changing original barriers or graph", () => {
  const { model, dataset, annotations, options } = fixture(),
    before = JSON.stringify(dataset);
  assert.equal(prepareIndoorPresentation(dataset, annotations).rooms.length, 0);
  const p = prepareIndoorPresentation(dataset, annotations, undefined, options);
  assert.equal(p.rooms.length, 1);
  assert.equal(p.rooms[0]!.boundarySource, "native-mesh-wall-enclosure");
  assert.deepEqual(p.rooms[0]!.meshProof?.nativeElementIds, [1, 2, 3, 4]);
  assert.equal(p.rooms[0]!.meshProof?.cutElevationFeet, 4);
  assert.equal(JSON.stringify(dataset), before);
  assert.equal(nativeMeshBarrierCuts(model, 311, 20).length, 0);
});
test("an actual open wall, missing floor or another room label cannot be hidden by mesh recovery", () => {
  for (const kind of ["open", "floor", "label"] as const) {
    const { model, dataset, annotations, options } = fixture();
    if (kind === "open")
      model.meshes[0]!.elementIds!.forEach((id, i, a) => {
        if (id === 3) a[i] = 999;
      });
    if (kind === "floor")
      options.floorsByRecord.set("office", [
        [rectangle(0, 0, 10, 10), rectangle(3, 3, 4, 4)],
      ]);
    if (kind === "label") {
      dataset.records.push({
        ...dataset.records[0]!,
        key: "other",
        ringsFeet: [rectangle(2, 2, 3, 3)],
      });
      annotations.push({
        ...annotations[0]!,
        key: "other",
        labelPointFeet: [2.5, 2.5],
      });
    }
    assert.equal(
      prepareIndoorPresentation(dataset, annotations, undefined, options).rooms
        .length,
      0,
      kind,
    );
  }
});
test("proxy shells, reconstructed owners, dangling and branched triangle cuts provide no certified barriers", () => {
  for (const kind of [
    "proxy",
    "reconstructed",
    "dangling",
    "branch",
  ] as const) {
    const { model } = fixture();
    if (kind === "proxy") model.meshes[0]!.source = "display-proxy";
    if (kind === "reconstructed")
      for (const r of model.elementBounds)
        r.renderGeometryProvenance = "reconstructed";
    if (kind === "dangling")
      model.meshes[0]!.indices = model.meshes[0]!.indices.slice(0, 3);
    if (kind === "branch") {
      const m = model.meshes[0]!;
      m.positions = new Float32Array([
        ...m.positions,
        0,
        0,
        0,
        0,
        0,
        8,
        5,
        5,
        8,
      ]);
      const offset = m.positions.length / 3 - 3;
      m.indices = new Uint32Array([
        ...m.indices,
        offset,
        offset + 1,
        offset + 2,
      ]);
      m.elementIds = new Uint32Array([...m.elementIds!, 1]);
    }
    const cuts = nativeMeshBarrierCuts(model, 311, 4);
    if (kind === "branch")
      assert.ok(!cuts.some((r) => r.nativeElementId === 1));
    else assert.equal(cuts.length, 0, kind);
  }
});

test("coincident owned extrusion sections are noded without losing holes or multipart material", () => {
  const shell = (ring: [number, number][], top: number) => {
    const positions: number[] = [], indices: number[] = [];
    for (const z of [0, top]) for (const [x, y] of ring) positions.push(x, y, z);
    for (let k = 0; k < ring.length; k++) {
      const q = (k + 1) % ring.length, n = ring.length;
      indices.push(k, q, q + n, k, q + n, k + n);
    }
    return { source: "native-brep", positions, indices, elementIds: indices.filter((_, i) => i % 3 === 0).map(() => 900) };
  };
  const outer = rectangle(0, 0, 4, 4), hole = rectangle(1, 1, 3, 3), detached = rectangle(8, 0, 9, 1);
  const model = {
    origin: { x: 0, y: 0, z: 0 },
    elementBounds: [{ elementId: 900, categoryId: -2000100, renderGeometryProvenance: "native" }],
    meshes: [shell(outer, 8), shell(outer, 12), shell(hole, 8), shell(hole, 12), shell(detached, 8)],
  } as unknown as ConvertResult;
  const cuts = nativeMeshBarrierCuts(model, 311, 4);
  assert.equal(cuts.length, 2);
  const main = cuts.find(c => c.ringsFeet.some(r => r.some(([x]) => x === 4)))!;
  assert.equal(main.ringsFeet.length, 2, "actual nested opening is preserved");
  assert.equal(cuts.filter(c => c.ringsFeet[0]!.some(([x]) => x >= 8)).length, 1);
  // An actual dangling source face still cannot become certified by noding.
  model.meshes.push({ source: "native-brep", positions: [0, 2, 0, 2, 2, 0, 2, 2, 8], indices: [0, 1, 2], elementIds: [900] } as unknown as MeshData);
  assert.deepEqual(nativeMeshBarrierCuts(model, 311, 4), []);
});

test("actual UNBC native joins recover four unfinished rooms while the open office remains unclosed", async () => {
  const { readFile } = await import("node:fs/promises");
  const { recoverNativeMeshRoomInteriors } = await import(
    "../lib/reviter/native-mesh-room-presentation.ts"
  );
  const cases = JSON.parse(
    await readFile(
      new URL("./fixtures/unbc-native-mesh-room-joins.json", import.meta.url),
      "utf8",
    ),
  );
  for (const c of cases) {
    const result = recoverNativeMeshRoomInteriors(
      c.dataset,
      c.annotations,
      c.model,
      new Set([c.key]),
      new Map([[c.key, c.floors]]),
    );
    assert.equal(
      result.rooms.some((r) => r.roomKey === c.key),
      c.number !== "10-1040",
      c.number,
    );
    if (c.number !== "10-1040") {
      const unsupported = recoverNativeMeshRoomInteriors(
        c.dataset,
        c.annotations,
        c.model,
        new Set([c.key]),
        new Map(),
      );
      assert.equal(
        unsupported.rooms.length,
        0,
        `${c.number} needs measured floor support`,
      );
    }
  }
});
