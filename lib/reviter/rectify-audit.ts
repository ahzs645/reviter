/**
 * Floor by floor, what the wing transforms left behind.
 *
 * A wing's membership is a hull test on one point per element, so an element
 * standing at the edge of a wing can fail it while everything it is joined to
 * passes. In a voxel build that shows up as a leak; in a plan it shows up as a
 * wall driven through the rooms that moved without it. Two questions, per
 * level:
 *
 * **Broken joins** — the element was TOUCHING something that moved, and did
 * not move with it. That is the strongest evidence a hull test got one wrong:
 * two walls that met at a corner in the source model no longer meet.
 *
 * **Clashes** — after the move, the element's plan footprint crosses one that
 * moved. That is what a reader sees: a wall through a room.
 *
 * Both are computed on wall location lines and floor sketch rings, which is
 * what the plan draws.
 */
import type { ConvertResult, ElementBoundsRecord } from "./types.ts";

export type Segment = { a: [number, number]; b: [number, number] };

export type AuditFinding = {
  elementId: number;
  categoryId?: number;
  categoryName?: string;
  /** Plan position, in model feet. */
  at: [number, number];
  /** How many moved elements it was joined to / now crosses. */
  count: number;
};

export type LevelAudit = {
  levelId: number;
  elevation: number;
  /** Elements the plan draws on this level. */
  drawn: number;
  moved: number;
  /** Stayed put, but was touching something that moved. */
  brokenJoins: AuditFinding[];
  /** Stayed put, and now crosses something that did. */
  clashes: AuditFinding[];
};

const WALL_CATEGORY_IDS = new Set([-2_000_011, -2_000_170, -2_000_171]);
const COLUMN_CATEGORY_IDS = new Set([-2_000_100, -2_001_330]);

/** The location lines the plan draws this element as, in model feet. */
export function planSegments(record: ElementBoundsRecord): Segment[] {
  const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
  if (solids.length) {
    return solids.map((solid) => ({
      a: [solid.start.x, solid.start.y] as [number, number],
      b: [solid.end.x, solid.end.y] as [number, number],
    }));
  }
  const box = record.boundsFeet;
  if (!box) return [];
  // A column or a family instance is a footprint, not a run: its own diagonal
  // is a stand-in that crosses whatever it sits in the middle of.
  return [{ a: [box.min.x, box.min.y], b: [box.max.x, box.max.y] }];
}

function centre(segments: Segment[]): [number, number] {
  let x = 0; let y = 0;
  for (const segment of segments) {
    x += (segment.a[0] + segment.b[0]) / 2;
    y += (segment.a[1] + segment.b[1]) / 2;
  }
  return [x / segments.length, y / segments.length];
}

function segmentsCross(left: Segment, right: Segment): boolean {
  const side = (a: [number, number], b: [number, number], p: [number, number]) =>
    Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  const d1 = side(left.a, left.b, right.a);
  const d2 = side(left.a, left.b, right.b);
  const d3 = side(right.a, right.b, left.a);
  const d4 = side(right.a, right.b, left.b);
  // Proper crossing only. Touching end to end is a join, not a clash.
  return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0 && d1 !== d2 && d3 !== d4;
}

function nearestDistance(left: Segment, right: Segment): number {
  const distance = (p: [number, number], s: Segment) => {
    const dx = s.b[0] - s.a[0]; const dy = s.b[1] - s.a[1];
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0
      : Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / length));
    return Math.hypot(p[0] - (s.a[0] + t * dx), p[1] - (s.a[1] + t * dy));
  };
  return Math.min(
    distance(left.a, right), distance(left.b, right),
    distance(right.a, left), distance(right.b, left));
}

/** A coarse plan grid, so neither question is quadratic in the whole level. */
function bucket(items: { id: number; segments: Segment[] }[], cell: number) {
  const cells = new Map<string, typeof items>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const segment of item.segments) {
      const minX = Math.min(segment.a[0], segment.b[0]);
      const maxX = Math.max(segment.a[0], segment.b[0]);
      const minY = Math.min(segment.a[1], segment.b[1]);
      const maxY = Math.max(segment.a[1], segment.b[1]);
      for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x += 1) {
        for (let y = Math.floor(minY / cell); y <= Math.floor(maxY / cell); y += 1) {
          const key = `${x},${y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const list = cells.get(key);
          if (list) list.push(item); else cells.set(key, [item]);
        }
      }
    }
  }
  return cells;
}

function neighbours(cells: ReturnType<typeof bucket>, segments: Segment[], cell: number) {
  const out = new Map<number, { id: number; segments: Segment[] }>();
  for (const segment of segments) {
    const minX = Math.min(segment.a[0], segment.b[0]);
    const maxX = Math.max(segment.a[0], segment.b[0]);
    const minY = Math.min(segment.a[1], segment.b[1]);
    const maxY = Math.max(segment.a[1], segment.b[1]);
    for (let x = Math.floor(minX / cell) - 1; x <= Math.floor(maxX / cell) + 1; x += 1) {
      for (let y = Math.floor(minY / cell) - 1; y <= Math.floor(maxY / cell) + 1; y += 1) {
        for (const item of cells.get(`${x},${y}`) ?? []) out.set(item.id, item);
      }
    }
  }
  return [...out.values()];
}

export type AuditInput = {
  /** The model as recovered. */
  before: ConvertResult;
  /** The same model with the wing transforms applied. */
  after: ConvertResult;
  /** Element ids a wing moved. */
  movedIds: ReadonlySet<number>;
  /** Elements the plan draws on each level. */
  drawnByLevel: ReadonlyMap<number, { elevation: number; elementIds: number[] }>;
  /** How close counts as joined, in feet. */
  joinFeet?: number;
};

export function auditLevels(input: AuditInput): LevelAudit[] {
  const joinFeet = input.joinFeet ?? 0.5;
  const cell = 40;
  const beforeById = new Map(input.before.elementBounds.map((r) => [r.elementId, r]));
  const afterById = new Map(input.after.elementBounds.map((r) => [r.elementId, r]));

  const audits: LevelAudit[] = [];
  for (const [levelId, level] of input.drawnByLevel) {
    const structural = level.elementIds.filter((id) => {
      const record = beforeById.get(id);
      const category = record?.categoryId ?? 0;
      return WALL_CATEGORY_IDS.has(category) || COLUMN_CATEGORY_IDS.has(category);
    });
    const movedBefore: { id: number; segments: Segment[] }[] = [];
    const movedAfter: { id: number; segments: Segment[] }[] = [];
    const stayed: { id: number; segments: Segment[] }[] = [];
    for (const id of structural) {
      const before = beforeById.get(id);
      const after = afterById.get(id);
      if (!before || !after) continue;
      const segments = planSegments(before);
      if (!segments.length) continue;
      if (input.movedIds.has(id)) {
        movedBefore.push({ id, segments });
        movedAfter.push({ id, segments: planSegments(after) });
      } else {
        stayed.push({ id, segments });
      }
    }

    const beforeCells = bucket(movedBefore, cell);
    const afterCells = bucket(movedAfter, cell);
    const brokenJoins: AuditFinding[] = [];
    const clashes: AuditFinding[] = [];
    for (const item of stayed) {
      const record = beforeById.get(item.id)!;
      let joined = 0;
      for (const other of neighbours(beforeCells, item.segments, cell)) {
        if (item.segments.some((left) =>
          other.segments.some((right) => nearestDistance(left, right) <= joinFeet))) joined += 1;
      }
      let crossed = 0;
      for (const other of neighbours(afterCells, item.segments, cell)) {
        if (item.segments.some((left) =>
          other.segments.some((right) => segmentsCross(left, right)))) crossed += 1;
      }
      const finding: AuditFinding = {
        elementId: item.id, categoryId: record.categoryId,
        categoryName: record.categoryName, at: centre(item.segments), count: 0,
      };
      if (joined) brokenJoins.push({ ...finding, count: joined });
      if (crossed) clashes.push({ ...finding, count: crossed });
    }
    audits.push({
      levelId, elevation: level.elevation, drawn: structural.length,
      moved: movedBefore.length,
      brokenJoins: brokenJoins.sort((a, b) => b.count - a.count),
      clashes: clashes.sort((a, b) => b.count - a.count),
    });
  }
  return audits.sort((a, b) => a.elevation - b.elevation);
}
