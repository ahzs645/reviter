import {
  containsDirectoryRoomPoint,
  nativeRouteBlocker,
  type DirectoryRoom,
  type DirectoryRouteBarriers,
  type RoomPoint,
  type RouteOpening,
} from "./room-directory.ts";

export type GridTerminal = {
  id: string;
  roomKey: string;
  point: RoomPoint;
  maxSnapFeet: number;
};
export type GridBranch = {
  from: string;
  to: string;
  points: RoomPoint[];
  roomKeys: string[];
};
/** Four-neighbour, wall-tested forest. Degree-two cells are compressed without smoothing.
 * One BFS tree per component provides repeatable, safe paths; it is not a full shortest-path mesh. */
export function buildIndoorGrid(
  scope: readonly DirectoryRoom[],
  masks: readonly DirectoryRoom[],
  terminals: readonly GridTerminal[],
  barriers: DirectoryRouteBarriers,
  openings: readonly RouteOpening[],
  cell = 0.6,
): {
  branches: GridBranch[];
  positions: Map<string, RoomPoint>;
  missing: string[];
} {
  if (!scope.length || !terminals.length)
    return {
      branches: [],
      positions: new Map(),
      missing: terminals.map((t) => t.id),
    };
  const points = scope.flatMap((r) => r.polygonFeet),
    minX = Math.min(...points.map((p) => p[0])) - cell,
    minY = Math.min(...points.map((p) => p[1])) - cell;
  const width = Math.ceil(
      (Math.max(...points.map((p) => p[0])) - minX + cell) / cell,
    ),
    height = Math.ceil(
      (Math.max(...points.map((p) => p[1])) - minY + cell) / cell,
    ),
    size = width * height;
  if (size > 2_000_000)
    throw new Error(
      "Routing region exceeds two million cells. Split its floor or use a coarser grid.",
    );
  const owner = new Int32Array(size).fill(-1),
    world = (i: number): RoomPoint => [
      minX + ((i % width) + 0.5) * cell,
      minY + (Math.floor(i / width) + 0.5) * cell,
    ];
  const fill = (loops: RoomPoint[][], value: number) => {
    if (!loops[0]?.length) return;
    const lo = Math.max(
        0,
        Math.floor((Math.min(...loops[0].map((p) => p[1])) - minY) / cell),
      ),
      hi = Math.min(
        height - 1,
        Math.ceil((Math.max(...loops[0].map((p) => p[1])) - minY) / cell),
      );
    for (let y = lo; y <= hi; y++) {
      const wy = minY + (y + 0.5) * cell,
        hits: number[] = [];
      for (const loop of loops)
        for (let k = 0; k < loop.length; k++) {
          const a = loop[k]!,
            b = loop[(k + 1) % loop.length]!;
          if (a[1] > wy !== b[1] > wy)
            hits.push(a[0] + ((b[0] - a[0]) * (wy - a[1])) / (b[1] - a[1]));
        }
      hits.sort((a, b) => a - b);
      for (let k = 0; k + 1 < hits.length; k += 2) {
        const x0 = Math.max(0, Math.ceil((hits[k]! - minX) / cell - 0.5)),
          x1 = Math.min(
            width - 1,
            Math.floor((hits[k + 1]! - minX) / cell - 0.5),
          );
        for (let x = x0; x <= x1; x++) owner[y * width + x] = value;
      }
    }
  };
  scope.forEach((r, i) => fill([r.polygonFeet, ...(r.holesFeet ?? [])], i));
  for (const r of masks) fill([r.polygonFeet, ...(r.holesFeet ?? [])], -1);
  for (const r of [...scope, ...masks])
    for (const h of r.floorOpeningsFeet ?? []) fill([h], -1);
  const blocked = nativeRouteBlocker(barriers, openings),
    usable = new Uint8Array(size);
  for (let i = 0; i < size; i++)
    if (owner[i]! >= 0 && !blocked(world(i), world(i))) usable[i] = 1;
  const positions = new Map<string, RoomPoint>(),
    atCell = new Map<number, GridTerminal[]>(),
    missing: string[] = [];
  for (const t of terminals) {
    const cx = Math.floor((t.point[0] - minX) / cell),
      cy = Math.floor((t.point[1] - minY) / cell),
      radius = Math.ceil(t.maxSnapFeet / cell) + 1;
    let best = -1,
      distance = Infinity;
    for (
      let y = Math.max(0, cy - radius);
      y <= Math.min(height - 1, cy + radius);
      y++
    )
      for (
        let x = Math.max(0, cx - radius);
        x <= Math.min(width - 1, cx + radius);
        x++
      ) {
        const i = y * width + x;
        if (!usable[i]) continue;
        const p = world(i),
          room = scope.find((r) => r.key === t.roomKey);
        if (!room || !containsDirectoryRoomPoint(p, room)) continue;
        const d = Math.hypot(p[0] - t.point[0], p[1] - t.point[1]);
        // A portal can snap inside the opening; an arrival cannot jump across a divider.
        if (d <= t.maxSnapFeet && d < distance && !blocked(t.point, p)) {
          best = i;
          distance = d;
        }
      }
    if (best < 0) {
      missing.push(t.id);
      continue;
    }
    positions.set(t.id, world(best));
    atCell.set(best, [...(atCell.get(best) ?? []), t]);
  }
  const previous = new Int32Array(size).fill(-1),
    queue = new Int32Array(size),
    forest = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!forest.has(a)) forest.set(a, new Set());
    if (!forest.has(b)) forest.set(b, new Set());
    forest.get(a)!.add(b);
    forest.get(b)!.add(a);
  };
  for (const seed of atCell.keys()) {
    if (previous[seed] !== -1) continue;
    let head = 0,
      tail = 1;
    queue[0] = seed;
    previous[seed] = seed;
    const targets: number[] = [];
    while (head < tail) {
      const i = queue[head++]!;
      if (atCell.has(i)) targets.push(i);
      const x = i % width,
        y = Math.floor(i / width);
      for (const j of [
        x ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ]) {
        if (
          j < 0 ||
          previous[j] !== -1 ||
          !usable[j] ||
          blocked(world(i), world(j))
        )
          continue;
        previous[j] = i;
        queue[tail++] = j;
      }
    }
    for (const target of targets) {
      let i = target;
      while (i !== seed) {
        const p = previous[i]!;
        if (forest.get(i)?.has(p)) break;
        link(i, p);
        i = p;
      }
    }
  }
  const branches: GridBranch[] = [],
    vertex = new Map<number, string>();
  for (const [cellIndex, ts] of atCell) {
    vertex.set(cellIndex, ts[0]!.id);
    for (const t of ts.slice(1))
      branches.push({
        from: ts[0]!.id,
        to: t.id,
        points: [world(cellIndex), world(cellIndex)],
        roomKeys: [ts[0]!.roomKey, t.roomKey],
      });
  }
  const prefix = terminals[0]!.id;
  for (const [i, ns] of forest)
    if (ns.size !== 2 && !vertex.has(i)) {
      const id = `${prefix}:grid:${i}`;
      vertex.set(i, id);
      positions.set(id, world(i));
    }
  const used = new Set<string>();
  for (const [a, from] of vertex)
    for (const first of forest.get(a) ?? []) {
      if (used.has(`${a}:${first}`)) continue;
      const cells = [a];
      let p = a,
        i = first;
      while (true) {
        used.add(`${p}:${i}`);
        used.add(`${i}:${p}`);
        cells.push(i);
        if (vertex.has(i)) break;
        const next = [...(forest.get(i) ?? [])].find((n) => n !== p);
        if (next == null) break;
        p = i;
        i = next;
      }
      const to = vertex.get(i);
      if (!to) continue;
      const bends = cells
        .filter(
          (v, k) =>
            !k ||
            k === cells.length - 1 ||
            v - cells[k - 1] !== cells[k + 1]! - v,
        )
        .map(world);
      branches.push({
        from,
        to,
        points: bends,
        roomKeys: [...new Set(cells.map((v) => scope[owner[v]!]!.key))],
      });
    }
  return { branches, positions, missing };
}
