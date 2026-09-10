import assert from "node:assert/strict";
import test from "node:test";

import { makePascalScene, makePascalSceneJson } from "../lib/reviter/export-pascal.ts";
import type { PascalNode } from "../lib/reviter/export-pascal.ts";
import type { ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";

const FOOT = 0.3048;

function boundsFor(
  min: [number, number, number],
  max: [number, number, number],
): ElementBoundsRecord["boundsFeet"] {
  return {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
  };
}

function record(
  fields: Partial<ElementBoundsRecord> & Pick<ElementBoundsRecord, "elementId" | "boundsFeet">,
): ElementBoundsRecord {
  return {
    stream: "Partitions/1",
    chunkIndex: 0,
    rawOffset: 0,
    recordOffset: 0,
    ...fields,
  };
}

/**
 * Two storeys ten feet apart, one wall on each, a door hosted in the lower one,
 * a floor with a hole, a column and a curtain panel.
 *
 * The model origin is offset from the coordinates so the export's own
 * origin subtraction is exercised rather than cancelling out at zero.
 */
function fixture(): ConvertResult {
  const wall = record({
    elementId: 10,
    categoryId: -2_000_011,
    categoryName: "Walls",
    categorySource: "native-token",
    typeId: 20,
    typeName: "Exterior Wall - 200mm",
    renderGeometryProvenance: "native",
    boundsFeet: boundsFor([100, 200, 10], [140, 201, 20]),
    solid: {
      elementId: 10,
      start: { x: 100, y: 200 },
      end: { x: 140, y: 200 },
      baseElevation: 10,
      topElevation: 20,
      thickness: 1,
    },
  });
  const upperWall = record({
    elementId: 11,
    categoryId: -2_000_011,
    categoryName: "Walls",
    boundsFeet: boundsFor([100, 200, 20], [120, 201, 29]),
    solid: {
      elementId: 11,
      start: { x: 100, y: 200 },
      end: { x: 120, y: 200 },
      baseElevation: 21,
      topElevation: 29,
      thickness: 1,
    },
  });
  const door = record({
    elementId: 12,
    categoryId: -2_000_023,
    categoryName: "Doors",
    typeName: "0915 x 2134 mm",
    boundsFeet: boundsFor([110, 200, 10], [113, 201, 17]),
    // Three feet wide, centred twelve feet along a wall that starts at x=100.
    orientedBox: [
      [110, 200, 10],
      [113, 200, 10],
      [113, 201, 10],
      [110, 201, 10],
      [110, 200, 17],
      [113, 200, 17],
      [113, 201, 17],
      [110, 201, 17],
    ],
  });
  const floor = record({
    elementId: 13,
    categoryId: -2_000_032,
    categoryName: "Floors",
    boundsFeet: boundsFor([100, 200, 9], [140, 240, 10]),
    loops: [
      [
        [100, 200, 10],
        [140, 200, 10],
        [140, 240, 10],
        [100, 240, 10],
      ],
      [
        [110, 210, 10],
        [120, 210, 10],
        [120, 220, 10],
        [110, 220, 10],
      ],
    ],
  });
  const column = record({
    elementId: 14,
    categoryId: -2_000_100,
    categoryName: "Columns",
    boundsFeet: boundsFor([130, 230, 10], [132, 234, 20]),
    orientedBox: [
      [130, 230, 10],
      [132, 230, 10],
      [132, 234, 10],
      [130, 234, 10],
      [130, 230, 20],
      [132, 230, 20],
      [132, 234, 20],
      [130, 234, 20],
    ],
  });
  const panel = record({
    elementId: 15,
    categoryId: -2_000_170,
    categoryName: "Curtain Panels",
    boundsFeet: boundsFor([150, 200, 10], [156, 200.5, 18]),
    orientedBox: [
      [150, 200, 10],
      [156, 200, 10],
      [156, 200.5, 10],
      [150, 200.5, 10],
      [150, 200, 18],
      [156, 200, 18],
      [156, 200.5, 18],
      [150, 200.5, 18],
    ],
  });

  return {
    ok: true,
    fileName: "pascal-export-fixture.rvt",
    byteLength: 64,
    meshes: [],
    materials: [],
    segments: [],
    elementBounds: [wall, upperWall, door, floor, column, panel],
    nativeProfiles: [],
    decoderCoverage: {
      revitVersion: 2027,
      activeDecoders: [],
      nativeCurves: 0,
      nativeProfiles: 0,
      nativeMeshes: 0,
      nativeMaterialDefinitions: 0,
      nativeMaterialAssignments: 0,
      approximateSolids: 0,
      nativeCategorisedElements: 6,
      geometryFidelity: "certified-native-brep-with-proxy-fallback",
      materialFidelity: "native-assigned",
      semanticFidelity: "native-categories",
    },
    origin: { x: 100, y: 200, z: 10 },
    bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 56, y: 40, z: 19 } },
    levels: [
      { elevation: 10, candidates: 4, levelId: 30, source: "assoc-level-id" },
      { elevation: 20, candidates: 1, levelId: 31, source: "assoc-level-id" },
    ],
    stats: {
      streamCount: 1,
      partitionStreams: 1,
      gzipChunks: 1,
      inflatedBytes: 1,
      candidatesFound: 6,
      candidatesFocused: 6,
      candidatesUsed: 6,
      vertexCount: 0,
      triangleCount: 0,
      meshCount: 0,
      boundsRecordsFound: 6,
      solidBoundsRecords: 2,
      durationMs: 1,
    },
    warnings: [],
    method: "native-profile-recovery",
    nativeHostRelations: [{
      elementId: 12,
      hostId: 10,
      fieldOffset: 151,
      recordOffset: 0,
      objectLength: 200,
      objectMarker: 0x07ef,
      kind: "host",
      source: "Partitions/InsertableInst.m_hostId",
      evidence: "persisted",
    }],
    nativeAssociatedLevelRelations: [
      { elementId: 10, levelId: 30 },
      { elementId: 12, levelId: 30 },
      { elementId: 13, levelId: 30 },
      { elementId: 14, levelId: 30 },
      { elementId: 15, levelId: 30 },
      { elementId: 11, levelId: 31 },
    ].map(({ elementId, levelId }) => ({
      elementId,
      levelId,
      fieldOffset: 64 as const,
      recordOffset: elementId,
      objectLength: 200,
      objectMarker: 1,
      kind: "associated-level" as const,
      source: "Partitions/Element.m_assocLevelId" as const,
      evidence: "persisted" as const,
    })),
  };
}

function nodeOfType(nodes: Record<string, PascalNode>, type: string): PascalNode {
  const match = Object.values(nodes).find((node) => node.type === type);
  assert.ok(match, `expected a "${type}" node`);
  return match;
}

test("writes a site → building → level tree Pascal can enter from one root", () => {
  const { nodes, rootNodeIds } = makePascalScene(fixture());

  assert.deepEqual(rootNodeIds, ["site_reviter"]);
  const site = nodes.site_reviter!;
  assert.equal(site.type, "site");
  assert.equal(site.parentId, null);
  assert.deepEqual(site.children, ["building_reviter"]);

  const building = nodes.building_reviter!;
  assert.equal(building.parentId, "site_reviter");
  assert.deepEqual(building.children, ["level_r30", "level_r31"]);

  for (const node of Object.values(nodes)) {
    if (node.parentId == null) continue;
    assert.ok(nodes[node.parentId], `${node.id} names a parent that is not in the file`);
    assert.ok(
      (nodes[node.parentId]!.children ?? []).includes(node.id),
      `${node.parentId} does not list ${node.id} as a child`,
    );
  }
});

test("stacks levels so each storey plane lands on its own Revit elevation", () => {
  const { nodes } = makePascalScene(fixture());

  // Pascal accumulates `height` up the stack and adds `baseElevation`, so only
  // the lowest level states an offset and the storey height is the gap above.
  const lower = nodes.level_r30!;
  assert.equal(lower.level, 0);
  assert.equal(lower.baseElevation, 0);
  assert.ok(Math.abs((lower.height as number) - 10 * FOOT) < 1e-9);

  const upper = nodes.level_r31!;
  assert.equal(upper.level, 1);
  assert.equal(upper.baseElevation, 0);
  assert.equal(upper.metadata?.revitLevelId, 31);
});

test("carries a wall's own location line, thickness and base into level-local metres", () => {
  const { nodes } = makePascalScene(fixture());
  const wall = nodes.wall_e10!;

  assert.equal(wall.parentId, "level_r30");
  // Revit x runs straight into Pascal x; Revit y is negated so the import keeps
  // the building's handedness rather than mirroring it.
  assert.deepEqual(wall.start, [0, -0]);
  assert.deepEqual(wall.end, [40 * FOOT, -0]);
  assert.ok(Math.abs((wall.thickness as number) - FOOT) < 1e-9);
  assert.ok(Math.abs((wall.height as number) - 10 * FOOT) < 1e-9);
  // The wall's base is its level's plane, so it needs no offset off it.
  assert.equal(wall.supportSlabId, "ground");
  assert.ok(Math.abs(wall.supportOffset as number) < 1e-9);
  assert.equal(wall.metadata?.revitElementId, 10);
  assert.equal(wall.metadata?.revitTypeName, "Exterior Wall - 200mm");

  // A wall standing a foot above its storey keeps that foot as an offset,
  // rather than being dropped onto the level plane.
  const raised = nodes.wall_e11!;
  assert.equal(raised.parentId, "level_r31");
  assert.ok(Math.abs((raised.supportOffset as number) - FOOT) < 1e-9);
  assert.ok(Math.abs((raised.height as number) - 8 * FOOT) < 1e-9);
});

test("hangs a door on its persisted host wall in wall-local coordinates", () => {
  const { nodes } = makePascalScene(fixture());
  const door = nodes.door_e12!;

  assert.equal(door.type, "door");
  assert.equal(door.wallId, "wall_e10");
  assert.equal(door.parentId, "wall_e10");
  assert.ok((nodes.wall_e10!.children ?? []).includes("door_e12"));

  const position = door.position as [number, number, number];
  // Centred 11.5 ft along the wall, and Pascal stores an opening's centre
  // height above the wall base — 3.5 ft up a door that spans 10 ft to 17 ft.
  assert.ok(Math.abs(position[0] - 11.5 * FOOT) < 1e-9);
  assert.ok(Math.abs(position[1] - 3.5 * FOOT) < 1e-9);
  assert.ok(Math.abs((door.width as number) - 3 * FOOT) < 1e-9);
  assert.ok(Math.abs((door.height as number) - 7 * FOOT) < 1e-9);
  assert.equal(door.metadata?.revitHostElementId, 10);
});

test("writes a floor's sketch loops as an outline and a hole wound against it", () => {
  const { nodes } = makePascalScene(fixture());
  const slab = nodes.slab_e13!;

  const polygon = slab.polygon as [number, number][];
  const holes = slab.holes as [number, number][][];
  assert.equal(polygon.length, 4);
  assert.equal(holes.length, 1);

  const signedArea = (ring: [number, number][]): number => {
    let total = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index]!;
      const b = ring[(index + 1) % ring.length]!;
      total += a[0] * b[1] - b[0] * a[1];
    }
    return total / 2;
  };
  assert.ok(signedArea(polygon) > 0, "outline should be counter-clockwise");
  assert.ok(signedArea(holes[0]!) < 0, "a hole is wound against its outline");
  assert.ok(Math.abs(Math.abs(signedArea(polygon)) - 1600 * FOOT * FOOT) < 1e-6);

  // The slab is anchored at its walking surface and grows downward.
  assert.ok(Math.abs(slab.elevation as number) < 1e-9);
  assert.ok(Math.abs((slab.thickness as number) - FOOT) < 1e-9);
});

test("places a column on the centre of its own base", () => {
  const { nodes } = makePascalScene(fixture());
  const column = nodes.column_e14!;

  const position = column.position as [number, number, number];
  assert.ok(Math.abs(position[0] - 31 * FOOT) < 1e-9);
  assert.ok(Math.abs(position[1]) < 1e-9);
  assert.ok(Math.abs(position[2] + 32 * FOOT) < 1e-9);
  assert.ok(Math.abs((column.width as number) - 2 * FOOT) < 1e-9);
  assert.ok(Math.abs((column.depth as number) - 4 * FOOT) < 1e-9);
  assert.ok(Math.abs((column.height as number) - 10 * FOOT) < 1e-9);
});

test("keeps curtain panels inside the node kinds every published Pascal knows", () => {
  const withPanels = makePascalScene(fixture());
  assert.equal(withPanels.stats.curtainPanels, 1);
  const panel = withPanels.nodes.wall_panel_e15!;
  assert.equal(panel.type, "wall");
  // The run follows the panel's long edge and its thickness is the short one.
  assert.ok(Math.abs((panel.thickness as number) - 0.5 * FOOT) < 1e-9);
  assert.ok(Math.abs((panel.height as number) - 8 * FOOT) < 1e-9);
  assert.deepEqual(panel.slots, {
    interior: "library:preset-glass",
    exterior: "library:preset-glass",
  });

  const withoutPanels = makePascalScene(fixture(), { extras: "none" });
  assert.equal(withoutPanels.stats.curtainPanels, 0);
  assert.equal(withoutPanels.nodes.wall_panel_e15, undefined);
  for (const node of Object.values(withoutPanels.nodes)) {
    assert.notEqual(node.type, "block");
  }
});

test("writes leftover elements as block solids only when asked for all of them", () => {
  const bare = makePascalScene(fixture());
  assert.equal(bare.stats.blocks, 0);

  const everything = makePascalScene(fixture(), { extras: "all" });
  assert.equal(everything.stats.blocks, 0, "the fixture has no unmapped element");

  const withRailing = fixture();
  withRailing.elementBounds.push(record({
    elementId: 16,
    categoryId: -2_000_126,
    categoryName: "Stairs Railing",
    boundsFeet: boundsFor([160, 200, 10], [164, 200.5, 13]),
  }));
  const withBlocks = makePascalScene(withRailing, { extras: "all" });
  assert.equal(withBlocks.stats.blocks, 1);

  const block = nodeOfType(withBlocks.nodes, "block");
  const topology = block.topology as {
    vertices: { id: string; position: [number, number, number] }[];
    edges: { id: string }[];
    faces: { id: string; vertexIds: string[] }[];
  };
  assert.equal(topology.vertices.length, 8);
  assert.equal(topology.edges.length, 12);
  assert.equal(topology.faces.length, 6);
  for (const face of topology.faces) {
    assert.ok(face.vertexIds.length >= 3);
    for (const vertexId of face.vertexIds) {
      assert.ok(
        topology.vertices.some((vertex) => vertex.id === vertexId),
        `face ${face.id} names a vertex that is not in the topology`,
      );
    }
  }
});

test("writes only what the conversion's own display scene draws", () => {
  const withoutDisplayScene = fixture();
  assert.equal(makePascalScene(withoutDisplayScene).stats.notDrawn, 0);
  assert.ok(makePascalScene(withoutDisplayScene).nodes.column_e14);

  // With a display scene, an element the conversion declined to draw — an
  // unnamed storey-sized plate, a rail-path extension line — is held back the
  // same way the GLB and IFC exports hold it back, because both of those build
  // their products out of `meshes` too.
  const withDisplayScene = fixture();
  withDisplayScene.meshes = [{
    name: "Recovered elements",
    positions: new Float32Array(9),
    indices: new Uint32Array([0, 1, 2]),
    colors: new Float32Array(9),
    materialIndex: 0,
    elementIds: new Uint32Array([10, 11, 12, 13, 15]),
    source: "native-brep",
  }];
  const gated = makePascalScene(withDisplayScene);
  assert.equal(gated.nodes.column_e14, undefined, "the undrawn column is held back");
  assert.equal(gated.stats.columns, 0);
  assert.equal(gated.stats.notDrawn, 1);
  assert.ok(gated.nodes.wall_e10, "a drawn wall still crosses");
  assert.ok(gated.nodes.slab_e13);
});

test("stands a flat plate in for a sloped surface at the middle of its extent", () => {
  const withRamp = fixture();
  // A ramp rising two feet across its run: the extent is mostly rise, not
  // thickness, so taking it as a thickness would stand a block on the model.
  withRamp.elementBounds.push(record({
    elementId: 17,
    categoryId: -2_000_180,
    categoryName: "Ramps",
    boundsFeet: boundsFor([100, 250, 10], [120, 260, 14]),
    loops: [[
      [100, 250, 10],
      [120, 250, 10],
      [120, 260, 10],
      [100, 260, 10],
    ]],
  }));
  const scene = makePascalScene(withRamp);
  const ramp = scene.nodes.slab_e17!;
  assert.equal(scene.stats.flattenedSlopes, 1);
  assert.equal(ramp.metadata?.flattenedSlope, true);
  assert.ok(Math.abs((ramp.metadata?.revitExtentMetres as number) - 4 * FOOT) < 1e-9);
  assert.ok(Math.abs((ramp.thickness as number) - 0.3) < 1e-9);

  // Top of the extent is 4 ft above the level plane; the plate's own top sits
  // half the discarded extent below that.
  const level = scene.nodes[ramp.parentId as string]!;
  assert.equal(level.type, "level");
  const expected = 4 * FOOT - (4 * FOOT - 0.3) / 2;
  assert.ok(Math.abs((ramp.elevation as number) - expected) < 1e-9);

  // A floor of ordinary thickness is untouched.
  assert.equal(scene.nodes.slab_e13!.metadata?.flattenedSlope, undefined);
  assert.ok(Math.abs((scene.nodes.slab_e13!.thickness as number) - FOOT) < 1e-9);
});

test("mirrorPlan reproduces Pascal's own IFC importer convention", () => {
  const kept = makePascalScene(fixture()).nodes.column_e14!;
  const mirrored = makePascalScene(fixture(), { mirrorPlan: true }).nodes.column_e14!;

  const keptPosition = kept.position as [number, number, number];
  const mirroredPosition = mirrored.position as [number, number, number];
  assert.equal(mirroredPosition[0], keptPosition[0]);
  assert.equal(mirroredPosition[1], keptPosition[1]);
  assert.equal(mirroredPosition[2], -keptPosition[2]);
});

test("serialises only the two fields the build format defines", () => {
  const json = JSON.parse(makePascalSceneJson(fixture())) as Record<string, unknown>;
  assert.deepEqual(Object.keys(json).sort(), ["nodes", "rootNodeIds"]);
  assert.ok(Object.keys(json.nodes as Record<string, unknown>).length > 0);
});
