import type { ElementBoundsRecord } from "../../lib/reviter/types.ts";
export function similarElementIds(records: readonly ElementBoundsRecord[], selected: ReadonlySet<number>, hidden: ReadonlySet<number>): Set<number> {
  const seeds = records.filter(record => selected.has(record.elementId));
  return new Set(records.filter(record => !hidden.has(record.elementId) && seeds.some(seed =>
    seed.categoryName === record.categoryName && (seed.typeId != null ? seed.typeId === record.typeId : seed.typeName === record.typeName && seed.familyName === record.familyName)))
    .map(record => record.elementId));
}
export type ScreenBounds = { minX: number; minY: number; maxX: number; maxY: number };
export function rectangleSelects(box: ScreenBounds, start: [number, number], end: [number, number]): boolean {
  const left = Math.min(start[0], end[0]), right = Math.max(start[0], end[0]);
  const top = Math.min(start[1], end[1]), bottom = Math.max(start[1], end[1]);
  return end[0] >= start[0]
    ? box.minX >= left && box.maxX <= right && box.minY >= top && box.maxY <= bottom
    : box.maxX >= left && box.minX <= right && box.maxY >= top && box.minY <= bottom;
}
