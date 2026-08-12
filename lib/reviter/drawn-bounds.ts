import type { ElementBoundsRecord } from "./types.ts";

export type Box = [number, number, number, number, number, number];

/**
 * Bounds of the geometry the viewer actually emits for a recovered record.
 *
 * This deliberately follows `buildBoundsMeshes` precedence. Comparing the
 * record envelope would make oriented families, sketch slabs, curved walls,
 * and swept railings appear to agree even when the visible geometry does not.
 */
export function drawnBounds(record: ElementBoundsRecord): Box {
  const box: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, z: number) => {
    box[0] = Math.min(box[0]!, x); box[3] = Math.max(box[3]!, x);
    box[1] = Math.min(box[1]!, y); box[4] = Math.max(box[4]!, y);
    box[2] = Math.min(box[2]!, z); box[5] = Math.max(box[5]!, z);
  };
  // A swept railing is drawn as its rail path, not its envelope, and measuring
  // the envelope made a real error invisible: the sweep used to pick up a
  // neighbour's path a storey away, and 21 of 70 railings were drawn 8.04 ft
  // from the railing they belong to while this table reported 100.0%. A metric
  // that does not follow the drawing precedence is not measuring the drawing.
  if (record.railPath) {
    for (const polyline of record.railPath.polylines) {
      for (const [x, y, z] of polyline) {
        add(x, y, z);
        add(x, y, z + record.railPath.guardHeightFeet);
      }
    }
    return box;
  }
  if (record.loops?.length) {
    // The ring gives the plan and the record gives the thickness; adding the
    // record's own corner to carry the top also widened the plan to the
    // record's, which is the thing the ring is there to replace.
    for (const ring of record.loops) {
      for (const [x, y] of ring) {
        add(x, y, record.boundsFeet.min.z);
        add(x, y, record.boundsFeet.max.z);
      }
    }
    return box;
  }
  if (record.orientedBox) {
    for (const [x, y, z] of record.orientedBox) add(x, y, z);
    return box;
  }
  // Native faces are no longer drawn: measured across every class that owns
  // them the element's own envelope is closer for 168 of the 225 concerned.
  const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
  if (solids.length) {
    // A solid is drawn as an *oriented* box — `solidGeometry` offsets the
    // centreline by half a thickness along its own normal. Adding half a
    // thickness to both x and y instead, as this did, measures a box a full
    // thickness longer than the one on screen: for a 25.242 ft wall 1.148 ft
    // thick it reported 26.390. Correcting the measurement alone, with no
    // change to what is drawn, took `IfcWallStandardCase` size agreement from
    // 55.3% to 83.4% and `IfcWall` from 40.2% to 59.1% — more than half of the
    // "wall size" gap this file used to explain away was the metric.
    for (const solid of solids) {
      const dx = solid.end.x - solid.start.x;
      const dy = solid.end.y - solid.start.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = (-dy / length) * solid.thickness * 0.5;
      const ny = (dx / length) * solid.thickness * 0.5;
      const start = solid.startCorners ?? [
        { x: solid.start.x + nx, y: solid.start.y + ny },
        { x: solid.start.x - nx, y: solid.start.y - ny },
      ];
      const end = solid.endCorners ?? [
        { x: solid.end.x + nx, y: solid.end.y + ny },
        { x: solid.end.x - nx, y: solid.end.y - ny },
      ];
      for (const corner of [...start, ...end]) {
        add(corner.x, corner.y, solid.baseElevation);
        add(corner.x, corner.y, solid.topElevation);
      }
    }
    return box;
  }
  // A curved wall is drawn as the annulus sector its cylinder triple describes,
  // so measuring its envelope would measure the rectangle the arc replaced.
  if (record.arcs?.length) {
    for (const arc of record.arcs) {
      const sweep = arc.endAngle - arc.startAngle;
      const segments = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 32)));
      for (let step = 0; step <= segments; step += 1) {
        const angle = arc.startAngle + (sweep * step) / segments;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const ux = cos * arc.xDir.x + sin * arc.yDir.x;
        const uy = cos * arc.xDir.y + sin * arc.yDir.y;
        for (const radius of [arc.radius - arc.thickness / 2, arc.radius + arc.thickness / 2]) {
          for (const z of [arc.baseElevation, arc.topElevation]) {
            add(arc.centre.x + radius * ux, arc.centre.y + radius * uy, z);
          }
        }
      }
    }
    return box;
  }
  return [
    record.boundsFeet.min.x, record.boundsFeet.min.y, record.boundsFeet.min.z,
    record.boundsFeet.max.x, record.boundsFeet.max.y, record.boundsFeet.max.z,
  ];
}

export function boxDifference(a: Box, b: Box): {
  centreErrorFeet: number;
  sizeErrorFeet: number;
} {
  let centreErrorFeet = 0;
  let sizeErrorFeet = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const aCentre = (a[axis]! + a[axis + 3]!) * 0.5;
    const bCentre = (b[axis]! + b[axis + 3]!) * 0.5;
    const aSize = a[axis + 3]! - a[axis]!;
    const bSize = b[axis + 3]! - b[axis]!;
    centreErrorFeet = Math.max(centreErrorFeet, Math.abs(aCentre - bCentre));
    sizeErrorFeet = Math.max(sizeErrorFeet, Math.abs(aSize - bSize));
  }
  return { centreErrorFeet, sizeErrorFeet };
}
