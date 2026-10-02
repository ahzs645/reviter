import { indoorRegionBlocker } from "./indoor-region.ts";
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
  nativeClearWidthFootprint?: RoomPoint[];
  /** Persisted door direction, before extending its footprint through the host wall. */
  nativeDoorNormal?: RoomPoint;
};
export type GridBranch = {
  from: string;
  to: string;
  points: RoomPoint[];
  roomKeys: string[];
  routingQuality: {
    turnCount: number;
    estimatedRasterClearanceFeet: number;
    clearanceCertified: false;
  };
};
export type GridArrivalRecovery = {
  id: string;
  roomKey: string;
  sourcePointFeet: RoomPoint;
  pointFeet: RoomPoint;
  entranceId: string;
  displacementFeet: number;
  evidence: "room-contained native-floor-supported entrance path";
};
export type GridArrivalRecoveryOptions = {
  /** Explicit arrival identities only. Fixed door and stair anchors never relocate. */
  arrivalTerminalIds: ReadonlySet<string>;
  nativeFloorSupported: (a: RoomPoint, b: RoomPoint) => boolean;
};
/** A wall-tested grid aligned with the region's dominant boundary direction.
 * Multi-source wavefronts connect neighbouring terminals rather than forcing every
 * journey through one root. Shortcuts retain orthogonal turns and test every cell. */
export function buildIndoorGrid(
  scope: readonly DirectoryRoom[],
  masks: readonly DirectoryRoom[],
  terminals: readonly GridTerminal[],
  barriers: DirectoryRouteBarriers,
  openings: readonly RouteOpening[],
  cell = 0.6,
  arrivalRecovery?: GridArrivalRecoveryOptions,
): {
  branches: GridBranch[];
  positions: Map<string, RoomPoint>;
  missing: string[];
  arrivalRecoveries: GridArrivalRecovery[];
} {
  if (!scope.length || !terminals.length)
    return {
      branches: [],
      positions: new Map(),
      missing: terminals.map((t) => t.id),
      arrivalRecoveries: [],
    };
  // Fourfold angles treat parallel and perpendicular walls as one building axis.
  let cosine = 0,
    sine = 0;
  for (const r of scope)
    for (let i = 0; i < r.polygonFeet.length; i++) {
      const a = r.polygonFeet[i]!,
        b = r.polygonFeet[(i + 1) % r.polygonFeet.length]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      cosine += length * Math.cos(4 * angle);
      sine += length * Math.sin(4 * angle);
    }
  const angle =
    Math.hypot(cosine, sine) > 1e-8 ? Math.atan2(sine, cosine) / 4 : 0;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const local = (p: RoomPoint): RoomPoint => [
    p[0] * c + p[1] * s,
    -p[0] * s + p[1] * c,
  ];
  const native = (p: RoomPoint): RoomPoint => [
    p[0] * c - p[1] * s,
    p[0] * s + p[1] * c,
  ];
  const points = scope.flatMap((r) => r.polygonFeet.map(local)),
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
    world = (i: number): RoomPoint =>
      native([
        minX + ((i % width) + 0.5) * cell,
        minY + (Math.floor(i / width) + 0.5) * cell,
      ]);
  const fill = (loops: RoomPoint[][], value: number) => {
    loops = loops.map((loop) => loop.map(local));
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
  const nativeBlocked = nativeRouteBlocker(barriers, openings),
    solidNativeBlocked = nativeRouteBlocker(barriers, []),
    voidBlocked = nativeRouteBlocker(
      {
        walls: [],
        columns: [
          ...scope.flatMap((r) =>
            [...(r.holesFeet ?? []), ...(r.floorOpeningsFeet ?? [])].map(
              (polygon) => ({ polygon }),
            ),
          ),
          ...masks.flatMap((r) =>
            [
              ...(r.floorOpeningsFeet ?? []),
              ...(r.holesFeet?.length ? [] : [r.polygonFeet]),
            ].map((polygon) => ({ polygon })),
          ),
        ],
      },
      [],
    ),
    regionBlocked = indoorRegionBlocker(scope, masks, openings),
    blocked = (a: RoomPoint, b: RoomPoint) =>
      nativeBlocked(a, b) || voidBlocked(a, b) || regionBlocked(a, b),
    usable = new Uint8Array(size);
  for (let i = 0; i < size; i++)
    if (owner[i]! >= 0 && !blocked(world(i), world(i))) usable[i] = 1;
  // Raster distance to blocked cells is a preference, never a passage-width certificate.
  // Thin native dividers are still tested continuously on every candidate step.
  const clearance = new Float64Array(size).fill(Infinity);
  for (let i = 0; i < size; i++) if (!usable[i]) clearance[i] = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x) clearance[i] = Math.min(clearance[i]!, clearance[i - 1]! + cell);
      if (y)
        clearance[i] = Math.min(clearance[i]!, clearance[i - width]! + cell);
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (x + 1 < width)
        clearance[i] = Math.min(clearance[i]!, clearance[i + 1]! + cell);
      if (y + 1 < height)
        clearance[i] = Math.min(clearance[i]!, clearance[i + width]! + cell);
    }
  const clearanceCost = (i: number) =>
    (cell * 0.35) / Math.max(cell, clearance[i]!);
  const positions = new Map<string, RoomPoint>(),
    atCell = new Map<number, GridTerminal[]>(),
    missing: string[] = [];
  for (const t of terminals) {
    const anchor = local(t.point);
    const cx = Math.floor((anchor[0] - minX) / cell),
      cy = Math.floor((anchor[1] - minY) / cell),
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
        const p = world(i);
        // A graph anchor belongs on its room side of the native wall. Keeping
        // it inside an opening makes unrelated corridor branches visit a side
        // doorway, reverse, and retain apparent zigzags at unused doors. The
        // actual door edge alone connects these two safe side anchors.
        if (solidNativeBlocked(p, p)) continue;
        if (t.nativeClearWidthFootprint?.length === 4) {
          const footprint = t.nativeClearWidthFootprint;
          let longest = 0, axis: RoomPoint = [1, 0];
          footprint.forEach((a,k) => {
            const b=footprint[(k+1)%footprint.length]!,length=Math.hypot(b[0]-a[0],b[1]-a[1]);
            if(length>longest){longest=length;axis=[(b[0]-a[0])/length,(b[1]-a[1])/length];}
          });
          // Host depth can exceed door width. The original native aperture
          // normal identifies the jamb axis even after extending through a wall.
          if (t.nativeDoorNormal)
            axis = [-t.nativeDoorNormal[1], t.nativeDoorNormal[0]];
          const width=footprint.map(q=>q[0]*axis[0]+q[1]*axis[1]);
          const projected=p[0]*axis[0]+p[1]*axis[1];
          // A doorway approach stays inside its verified clear width. Lateral
          // snapping past a jamb can otherwise leave a diagonal floor sliver
          // outside both source rooms and the approved threshold envelope.
          if(projected<Math.min(...width)-1e-7||projected>Math.max(...width)+1e-7)continue;
        }
        const
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
    root = new Int32Array(size).fill(-1),
    distance = new Float64Array(size).fill(Infinity);
  const neighbours = (i: number) => {
    const x = i % width,
      y = Math.floor(i / width);
    return [
      x ? i - 1 : -1,
      x + 1 < width ? i + 1 : -1,
      y ? i - width : -1,
      y + 1 < height ? i + width : -1,
    ];
  };
  const heap: { cell: number; cost: number }[] = [];
  const push = (index: number, cost: number) => {
    heap.push({ cell: index, cost });
    let i = heap.length - 1;
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p]!.cost <= cost) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = () => {
    const first = heap[0]!,
      last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1,
          r = l + 1;
        let j = i;
        if (l < heap.length && heap[l]!.cost < heap[j]!.cost) j = l;
        if (r < heap.length && heap[r]!.cost < heap[j]!.cost) j = r;
        if (j === i) break;
        [heap[i], heap[j]] = [heap[j]!, heap[i]!];
        i = j;
      }
    }
    return first;
  };
  for (const seed of atCell.keys()) {
    root[seed] = seed;
    previous[seed] = seed;
    distance[seed] = 0;
    push(seed, 0);
  }
  const meetings = new Map<string, { a: number; b: number; length: number }>();
  while (heap.length) {
    const current = pop(),
      i = current.cell;
    if (current.cost !== distance[i]) continue;
    for (const j of neighbours(i)) {
      if (j < 0 || !usable[j] || blocked(world(i), world(j))) continue;
      const turning = previous[i] !== i && i - previous[i] !== j - i;
      const cost =
        distance[i]! + cell + clearanceCost(j) + (turning ? cell * 1.5 : 0);
      if (
        root[j] === -1 ||
        (root[j] === root[i] && cost + 1e-9 < distance[j]!)
      ) {
        root[j] = root[i]!;
        previous[j] = i;
        distance[j] = cost;
        push(j, cost);
      } else if (root[i] !== root[j]) {
        const key = [root[i]!, root[j]!].sort((a, b) => a - b).join(":");
        const length = distance[i]! + distance[j]! + cell;
        if (length < (meetings.get(key)?.length ?? Infinity))
          meetings.set(key, { a: i, b: j, length });
      }
    }
  }
  const trace = (i: number) => {
    const cells = [i];
    while (previous[i] !== i) {
      i = previous[i]!;
      cells.push(i);
    }
    return cells;
  };
  // Test each axis-aligned grid step, including native dividers narrower than a cell.
  const straight = (a: number, b: number): number[] | null => {
    if (
      a % width !== b % width &&
      Math.floor(a / width) !== Math.floor(b / width)
    )
      return null;
    const step =
      a === b
        ? 0
        : a % width === b % width
          ? Math.sign(b - a) * width
          : Math.sign(b - a);
    const cells = [a];
    for (let i = a; i !== b;) {
      const j = i + step;
      if (!usable[j] || blocked(world(i), world(j))) return null;
      cells.push(j);
      i = j;
    }
    return cells;
  };
  const pathCost = (cells: number[]) =>
    cells.slice(1).reduce((sum, j, k) => {
      const i = cells[k]!;
      return (
        sum +
        cell +
        clearanceCost(j) +
        (k > 0 && i - cells[k - 1] !== j - i ? cell * 1.5 : 0)
      );
    }, 0);
  const simplify = (cells: number[]) => {
    const result = [cells[0]!];
    let cursor = 0;
    while (cursor < cells.length - 1) {
      let found = false;
      for (let end = cells.length - 1; end > cursor + 1; end--) {
        const a = cells[cursor]!,
          b = cells[end]!;
        const elbows = [
          Math.floor(a / width) * width + (b % width),
          Math.floor(b / width) * width + (a % width),
        ];
        for (const elbow of elbows) {
          const first = straight(a, elbow),
            second = first && straight(elbow, b);
          if (
            first &&
            second &&
            pathCost([...first, ...second.slice(1)]) <=
              pathCost(cells.slice(cursor, end + 1)) + 1e-8
          ) {
            result.push(...first.slice(1), ...second.slice(1));
            cursor = end;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) result.push(cells[++cursor]!);
    }
    return result;
  };
  const branches: GridBranch[] = [];
  for (const [cellIndex, ts] of atCell)
    for (const t of ts.slice(1))
      branches.push({
        routingQuality: {
          turnCount: 0,
          estimatedRasterClearanceFeet: clearance[cellIndex]!,
          clearanceCertified: false,
        },
        from: ts[0]!.id,
        to: t.id,
        points: [world(cellIndex), world(cellIndex)],
        roomKeys: [ts[0]!.roomKey, t.roomKey],
      });
  for (const { a, b } of meetings.values()) {
    const cells = simplify([...trace(a).reverse(), ...trace(b)]);
    const bends = cells
      .filter(
        (v, k) =>
          !k ||
          k === cells.length - 1 ||
          v - cells[k - 1]! !== cells[k + 1]! - v,
      )
      .map(world);
    branches.push({
      routingQuality: {
        turnCount: Math.max(0, bends.length - 2),
        estimatedRasterClearanceFeet: Math.min(
          ...cells.map((i) => clearance[i]!),
        ),
        clearanceCertified: false,
      },
      from: atCell.get(root[a]!)![0]!.id,
      to: atCell.get(root[b]!)![0]!.id,
      points: bends,
      roomKeys: [...new Set(cells.map((v) => scope[owner[v]!]!.key))],
    });
  }
  const arrivalRecoveries: GridArrivalRecovery[] = [];
  if (arrivalRecovery) {
    // A drawing label identifies a room, not a surveyed walking coordinate.
    // When it is obstructed, keep the label untouched and choose an arrival on
    // a proved path from that room's existing entrance. This path is added
    // explicitly rather than seeding the floor wavefront at a guessed location.
    for (const t of terminals.filter(t => missing.includes(t.id) && arrivalRecovery.arrivalTerminalIds.has(t.id))) {
      const room = scope.find(r => r.key === t.roomKey);
      if (!room) continue;
      const roomBlocked = indoorRegionBlocker([room], masks, []);
      const previous = new Map<number, number>();
      const entrance = new Map<number, string>();
      const queue: number[] = [];
      for (const [i, seeds] of atCell) {
        const seed = seeds.find(seed => seed.roomKey === room.key && !arrivalRecovery.arrivalTerminalIds.has(seed.id));
        const p = world(i);
        if (!seed || roomBlocked(p,p) || !arrivalRecovery.nativeFloorSupported(p,p)) continue;
        previous.set(i,i); entrance.set(i,seed.id); queue.push(i);
      }
      let best = -1, nearest = Infinity;
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head]!, p = world(i);
        const d = Math.hypot(p[0]-t.point[0],p[1]-t.point[1]);
        if (d < nearest) { best = i; nearest = d; }
        for (const j of neighbours(i)) {
          if (j < 0 || !usable[j] || previous.has(j)) continue;
          const q = world(j);
          if (solidNativeBlocked(q,q) || roomBlocked(p,q) || blocked(p,q) || !arrivalRecovery.nativeFloorSupported(p,q)) continue;
          previous.set(j,i); entrance.set(j,entrance.get(i)!); queue.push(j);
        }
      }
      if (best < 0) continue;
      const cells = [best];
      for (let i = best; previous.get(i) !== i;) { i = previous.get(i)!; cells.push(i); }
      cells.reverse();
      const bends = cells.filter((v,k) => !k || k === cells.length-1 || v-cells[k-1]! !== cells[k+1]!-v).map(world);
      if (bends.length === 1) bends.push(bends[0]!);
      positions.set(t.id,world(best));
      missing.splice(missing.indexOf(t.id),1);
      branches.push({from:entrance.get(best)!,to:t.id,points:bends,roomKeys:[room.key],routingQuality:{turnCount:Math.max(0,bends.length-2),estimatedRasterClearanceFeet:cells.reduce((minimum,i)=>Math.min(minimum,clearance[i]!),Infinity),clearanceCertified:false}});
      arrivalRecoveries.push({id:t.id,roomKey:room.key,sourcePointFeet:[...t.point],pointFeet:world(best),entranceId:entrance.get(best)!,displacementFeet:nearest,evidence:"room-contained native-floor-supported entrance path"});
    }
  }
  return { branches, positions, missing, arrivalRecoveries };
}
