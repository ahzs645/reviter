import type { ElementBoundsRecord } from "./types";

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
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.min(box[2], z);
    box[3] = Math.max(box[3], x);
    box[4] = Math.max(box[4], y);
    box[5] = Math.max(box[5], z);
  };

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

  const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
  if (solids.length) {
    for (const solid of solids) {
      const dx = solid.end.x - solid.start.x;
      const dy = solid.end.y - solid.start.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = (-dy / length) * solid.thickness * 0.5;
      const ny = (dx / length) * solid.thickness * 0.5;
      for (const end of [solid.start, solid.end]) {
        for (const sign of [1, -1]) {
          add(end.x + nx * sign, end.y + ny * sign, solid.baseElevation);
          add(end.x + nx * sign, end.y + ny * sign, solid.topElevation);
        }
      }
    }
    return box;
  }
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
    record.boundsFeet.min.x,
    record.boundsFeet.min.y,
    record.boundsFeet.min.z,
    record.boundsFeet.max.x,
    record.boundsFeet.max.y,
    record.boundsFeet.max.z,
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
