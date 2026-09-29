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
  // The filled-in ATTRIB hangs off the INSERT and is drawn from there; drawing
  // the block's ATTDEF too would stamp the prompt text.
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

/**
 * A room tag as LibreDWG hands it back from the UNBC survey drawing: the block
 * holds only ATTDEFs, and the values ride on the INSERT as `attribs`, with the
 * text nested under `text` and positions already in model space.
 */
const roomTag = (handle: string, number: string, use: string, at: [number, number]) => ({
  type: "INSERT", handle, layer: "0_room_data", name: "room_data", ownerBlockRecordSoftId: "22",
  insertionPoint: { x: at[0], y: at[1] }, xScale: 0.5, yScale: 0.5, rotation: 0,
  attribs: [
    {
      type: "ATTRIB", handle: `${handle}1`, ownerBlockRecordSoftId: handle, layer: "3_Text",
      tag: "ROOMNUM", flags: 0, alignmentPoint: { x: at[0], y: at[1] },
      text: {
        text: number, textHeight: 230, halign: 1, valign: 2,
        startPoint: { x: at[0] - 460, y: at[1] - 115 }, endPoint: { x: at[0], y: at[1] },
      },
    },
    {
      type: "ATTRIB", handle: `${handle}2`, ownerBlockRecordSoftId: handle, layer: "3_Text",
      tag: "ROOMUSE", flags: 0, alignmentPoint: { x: at[0], y: at[1] - 383 },
      text: {
        text: use, textHeight: 230, halign: 1, valign: 2,
        startPoint: { x: at[0] - 900, y: at[1] - 498 }, endPoint: { x: at[0], y: at[1] - 383 },
      },
    },
  ],
});

const roomTagBlock = database({
  room_data: [
    { type: "ATTDEF", layer: "3_Text", tag: "ROOMNUM", prompt: "Room number", text: { startPoint: { x: -918, y: -172 }, textHeight: 345 } },
    { type: "ATTDEF", layer: "3_Text", tag: "ROOMUSE", prompt: "Room use", text: { startPoint: { x: -900, y: -700 }, textHeight: 345 } },
  ],
});

test("a block reference's attribute values are read, tagged and anchored", () => {
  const out = convertDwgEntities([roomTag("DD565", "02-110", "High Voltage Service", [124883, 115113])], {
    ownerHandle: "22",
    blocks: dwgBlockDefinitions(roomTagBlock),
  });
  assert.deepEqual(out.map((entity) => [entity.tag, entity.text]), [
    ["ROOMNUM", "02-110"],
    ["ROOMUSE", "High Voltage Service"],
  ]);
  const [number] = out;
  assert.equal(number?.type, "ATTRIB");
  assert.equal(number?.layer, "3_Text", "the attribute's own layer, not the reference's");
  assert.equal(number?.height, 230);
  // Positions are model space already: the INSERT's 0.5 scale is not applied.
  assert.deepEqual(number?.centre, [124423, 114998]);
  assert.deepEqual(number?.anchor, [124883, 115113], "centred text pins to its alignment point");
  assert.equal(number?.block, "room_data");
  assert.equal(number?.insert, "DD565", "both attributes name the reference that pairs them");
  assert.equal(out[1]?.insert, "DD565");
});

test("an attribute is drawn once, whether or not model space can be told apart", () => {
  const tag = roomTag("DD565", "02-110", "Office", [0, 0]);
  // LibreDWG lists each attribute twice: on the INSERT, and in the entity list
  // owned by the INSERT's handle.
  const raw = [tag, ...tag.attribs];
  const blocks = dwgBlockDefinitions(roomTagBlock);
  for (const ownerHandle of ["22", null]) {
    const out = convertDwgEntities(raw, { ownerHandle, blocks });
    assert.deepEqual(out.map((entity) => entity.text), ["02-110", "Office"], `owner ${ownerHandle}`);
  }
  // Without block definitions the values still come through; nothing else does.
  assert.equal(convertDwgEntities([tag], {}).length, 2);
});

test("an invisible attribute prints nothing", () => {
  const tag = roomTag("A1", "10-2050", "Office", [0, 0]);
  tag.attribs[1]!.flags = 1;
  const out = convertDwgEntities([tag], {});
  assert.deepEqual(out.map((entity) => entity.text), ["10-2050"]);
});

test("attributes of a block nested in a block move with the outer reference", () => {
  const blocks = dwgBlockDefinitions(database({
    ...Object.fromEntries([["room_data", roomTagBlock.tables.BLOCK_RECORD.entries[1]!.entities]]),
    // A wing drawn once and placed twice: its room tags are in the wing's space.
    WING: [roomTag("B1", "08-101", "Office", [10, 0])],
  }));
  const out = convertDwgEntities([
    { type: "INSERT", handle: "W1", layer: "0", name: "WING", insertionPoint: { x: 1_000, y: 0 }, xScale: 1, yScale: 1, rotation: 0 },
  ], { blocks });
  const number = out.find((entity) => entity.tag === "ROOMNUM");
  assert.deepEqual(number?.anchor, [1_010, 0]);
  assert.equal(number?.insert, "W1", "the model-space reference, not the one inside the block");
  assert.equal(number?.block, "WING");
});
