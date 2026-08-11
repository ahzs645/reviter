import assert from "node:assert/strict";
import test from "node:test";

import { convertDwgEntities, dwgBlockDefinitions } from "../lib/reviter/dwg-entities.ts";

/** A one-unit horizontal line at the origin, as a block's whole contents. */
const unitLine = [{
  type: "LINE",
  layer: "0",
  startPoint: { x: 0, y: 0 },
  endPoint: { x: 1, y: 0 },
}];

const database = (blocks: Record<string, unknown[]>) => ({
  tables: {
    BLOCK_RECORD: {
      entries: [
        { name: "*Model_Space", handle: "22", entities: [] },
        ...Object.entries(blocks).map(([name, entities]) => ({ name, entities })),
      ],
    },
  },
});

const round = (value: number) => Math.round(value * 1e6) / 1e6;

test("block contents come off the block record, not the entity list", () => {
  const blocks = dwgBlockDefinitions(database({ DOOR: unitLine, EMPTY: [] }));
  assert.deepEqual([...blocks.keys()], ["DOOR"], "empty blocks and the spaces are skipped");
});

test("a block reference draws its block, moved into place", () => {
  const blocks = dwgBlockDefinitions(database({ DOOR: unitLine }));
  const [entity] = convertDwgEntities([
    { type: "INSERT", layer: "A", name: "DOOR", insertionPoint: { x: 10, y: 5 }, xScale: 2, yScale: 2, rotation: Math.PI / 2 },
  ], { blocks });

  assert.ok(entity);
  // Scaled by two, turned a quarter turn, then moved to (10,5).
  assert.deepEqual(entity.points?.map((p) => [round(p[0]), round(p[1])]), [[10, 5], [10, 7]]);
  // The layer is the block's own, which is what controls its ink.
  assert.equal(entity.layer, "0");
});

test("without block definitions a reference draws nothing rather than a stand-in", () => {
  const out = convertDwgEntities([
    { type: "INSERT", layer: "A", name: "DOOR", insertionPoint: { x: 0, y: 0 } },
  ], {});
  assert.deepEqual(out, []);
});

test("one reference can stamp a grid of copies", () => {
  const blocks = dwgBlockDefinitions(database({ TICK: unitLine }));
  const out = convertDwgEntities([{
    type: "INSERT", layer: "A", name: "TICK",
    insertionPoint: { x: 0, y: 0 }, xScale: 1, yScale: 1, rotation: 0,
    columnCount: 3, rowCount: 2, columnSpacing: 10, rowSpacing: 20,
  }], { blocks });

  assert.equal(out.length, 6);
  const origins = out.map((entity) => [round(entity.points![0]![0]), round(entity.points![0]![1])]);
  assert.deepEqual(origins.sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!), [
    [0, 0], [0, 20], [10, 0], [10, 20], [20, 0], [20, 20],
  ]);
});

test("a block inside a block is placed through both transforms", () => {
  const blocks = dwgBlockDefinitions(database({
    LEAF: unitLine,
    DOOR: [{ type: "INSERT", name: "LEAF", insertionPoint: { x: 5, y: 0 }, xScale: 1, yScale: 1, rotation: 0 }],
  }));
  const [entity] = convertDwgEntities([
    { type: "INSERT", layer: "A", name: "DOOR", insertionPoint: { x: 100, y: 0 }, xScale: 2, yScale: 2, rotation: 0 },
  ], { blocks });

  assert.ok(entity);
  // The inner offset of 5 is scaled by the outer 2 before the outer move.
  assert.deepEqual(entity.points?.map((p) => [round(p[0]), round(p[1])]), [[110, 0], [112, 0]]);
});

test("a cycle between blocks ends instead of running forever", () => {
  const blocks = dwgBlockDefinitions(database({
    A: [{ type: "INSERT", name: "B", insertionPoint: { x: 1, y: 0 } }, ...unitLine],
    B: [{ type: "INSERT", name: "A", insertionPoint: { x: 1, y: 0 } }],
  }));
  const out = convertDwgEntities([
    { type: "INSERT", layer: "A", name: "A", insertionPoint: { x: 0, y: 0 } },
  ], { blocks });
  assert.ok(out.length > 0 && out.length < 100, `bounded, got ${out.length}`);
});

test("an arc in a rotated block keeps its sweep, and a mirrored one reverses", () => {
  const arc = [{
    type: "ARC", layer: "0", center: { x: 0, y: 0 }, radius: 1,
    startAngle: 0, endAngle: Math.PI / 2,
  }];
  const blocks = dwgBlockDefinitions(database({ SWING: arc }));

  const [turned] = convertDwgEntities([
    { type: "INSERT", layer: "A", name: "SWING", insertionPoint: { x: 0, y: 0 }, xScale: 1, yScale: 1, rotation: Math.PI },
  ], { blocks });
  assert.ok(turned);
  assert.equal(round(turned.startAngle!), round(Math.PI));
  assert.equal(round(turned.endAngle!), round(Math.PI * 1.5));

  const [mirrored] = convertDwgEntities([
    { type: "INSERT", layer: "A", name: "SWING", insertionPoint: { x: 0, y: 0 }, xScale: -1, yScale: 1, rotation: 0 },
  ], { blocks });
  assert.ok(mirrored, "a uniform mirror is still drawable");
  // Mirroring swaps which end leads, so the sweep still runs the short way.
  assert.equal(round(mirrored.startAngle!), round(-Math.PI / 2));
  assert.equal(round(mirrored.endAngle!), 0);
});

test("a circle under an uneven scale is dropped rather than drawn wrong", () => {
  const blocks = dwgBlockDefinitions(database({
    DOT: [{ type: "CIRCLE", layer: "0", center: { x: 0, y: 0 }, radius: 1 }],
  }));
  const squashed = convertDwgEntities([
    { type: "INSERT", layer: "A", name: "DOT", insertionPoint: { x: 0, y: 0 }, xScale: 3, yScale: 1 },
  ], { blocks });
  assert.deepEqual(squashed, [], "an ellipse cannot be held as a circle");

  const [even] = convertDwgEntities([
    { type: "INSERT", layer: "A", name: "DOT", insertionPoint: { x: 4, y: 0 }, xScale: 3, yScale: 3 },
  ], { blocks });
  assert.equal(even?.radius, 3);
  assert.deepEqual(even?.centre, [4, 0]);
});

test("the blank a block leaves for a value is not printed over the value", () => {
  // The filled-in ATTRIB is a sibling of the INSERT in model space and is drawn
  // from there; drawing the block's ATTDEF too would stamp the prompt text.
  const blocks = dwgBlockDefinitions(database({
    ROOM: [
      { type: "ATTDEF", layer: "0", startPoint: { x: 0, y: 0 }, text: "ROOM NAME", height: 1 },
      ...unitLine,
    ],
  }));
  const out = convertDwgEntities([
    { type: "INSERT", layer: "A", name: "ROOM", insertionPoint: { x: 0, y: 0 } },
  ], { blocks });
  assert.equal(out.length, 1);
  assert.equal(out[0]?.text, undefined);
});
