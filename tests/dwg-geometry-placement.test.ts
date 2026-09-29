/**
 * Where DWG geometry actually is.
 *
 * Two things placed the survey drawing's linework wrongly, and either one on
 * its own was enough to stop the section splitter cutting the sheet: arcs were
 * bounded by their whole circle, so a shallow curved wall hundreds of metres in
 * radius spanned every margin; and arcs, circles and blocks extruded along -Z —
 * what MIRROR leaves behind — were drawn un-mirrored, off the sheet. Text had
 * no bounds at all, so no label was ever cropped into a plan.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { convertDwgEntities, convertDwgEntity, dwgBlockDefinitions } from "../lib/reviter/dwg-entities.ts";
import { entityBounds } from "../lib/reviter/dwg-plan.ts";

test("an arc is bounded by what it sweeps, not by its whole circle", () => {
  // A shallow curved wall: a few degrees of a very large circle.
  const wall = { type: "ARC", layer: "0", centre: [0, 0] as [number, number], radius: 100_000, startAngle: 1.55, endAngle: 1.59 };
  const box = entityBounds(wall)!;
  assert.ok(box.maxX - box.minX < 5_000, `width ${box.maxX - box.minX}`);
  assert.ok(Math.abs(box.maxY - 100_000) < 1e-6, "the top of the circle is inside the sweep");
  assert.ok(box.minY > 99_000);
  // A sweep across +x from 350 to 10 degrees reaches the +x extreme.
  const wrap = entityBounds({ ...wall, radius: 1, startAngle: (350 * Math.PI) / 180, endAngle: (10 * Math.PI) / 180 })!;
  assert.ok(Math.abs(wrap.maxX - 1) < 1e-9);
  assert.ok(wrap.minX > 0.98);
});

test("text has a place in the drawing, so it is cropped with its plan", () => {
  const label = { type: "ATTRIB", layer: "3_Text", text: "10-2050", centre: [10, 20] as [number, number], anchor: [30, 25] as [number, number] };
  assert.deepEqual(entityBounds(label), { minX: 10, minY: 20, maxX: 30, maxY: 25 });
});

test("an arc or circle extruded along -Z is mirrored into the world", () => {
  // AutoCAD's MIRROR leaves the OCS X axis pointing along world -X.
  const arc = convertDwgEntity({
    type: "ARC", layer: "0", center: { x: -100, y: 5 }, radius: 10,
    startAngle: 0, endAngle: Math.PI / 2, extrusionDirection: { x: 0, y: 0, z: -1 },
  });
  assert.deepEqual(arc?.centre, [100, 5]);
  // OCS 0..90 degrees runs +x to +y; mirrored, it is world 90..180.
  assert.ok(Math.abs(arc!.startAngle! - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(arc!.endAngle! - Math.PI) < 1e-9);

  const upright = convertDwgEntity({
    type: "CIRCLE", layer: "0", center: { x: -100, y: 5 }, radius: 10, extrusionDirection: { x: 0, y: 0, z: 1 },
  });
  assert.deepEqual(upright?.centre, [-100, 5]);
  // LINE is in world coordinates whatever its extrusion says.
  const line = convertDwgEntity({
    type: "LINE", layer: "0", startPoint: { x: -1, y: 0 }, endPoint: { x: -2, y: 0 }, extrusionDirection: { x: 0, y: 0, z: -1 },
  });
  assert.deepEqual(line?.points, [[-1, 0], [-2, 0]]);
});

test("a block reference extruded along -Z places its block mirrored", () => {
  const blocks = dwgBlockDefinitions({
    tables: { BLOCK_RECORD: { entries: [{ name: "TICK", entities: [
      { type: "LINE", layer: "0", startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } },
    ] }] } },
  });
  const [entity] = convertDwgEntities([{
    type: "INSERT", layer: "0", name: "TICK", insertionPoint: { x: -50, y: 7 },
    xScale: 2, yScale: 2, rotation: 0, extrusionDirection: { x: 0, y: 0, z: -1 },
  }], { blocks });
  assert.deepEqual(entity?.points, [[50, 7], [48, 7]]);
});
