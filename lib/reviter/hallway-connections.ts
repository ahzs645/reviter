import polygonClipping from "polygon-clipping";
import type { ArchitecturalPlanGeometry } from "./architectural-plan.ts";
import { containsDirectoryRoomPoint, hallwayRouteComponents, isHallway, isWalkable, roomBuilding, type DirectoryRoom, type DirectoryElevations, type RoomPoint, type RoomPortal } from "./room-directory.ts";

/** Recover unlabelled circulation only where native slab geometry supplies a floor,
 * with recovered walls/columns and private rooms acting as obstacles. The added
 * strip is a reviewed route footprint, not a claim about the full hallway width. */
export function connectHallwaysThroughFloor(rooms: readonly DirectoryRoom[], portals: readonly RoomPortal[], geometry: ArchitecturalPlanGeometry, contextRooms: readonly DirectoryRoom[] = [], elevations:DirectoryElevations = {}): { rooms: DirectoryRoom[]; added: number; unresolvedNetworks: number } {
  const split=rooms.filter(r=>isWalkable(r)&&elevations[r.key]!=null&&Math.abs(elevations[r.key]!.elevation-(geometry.cutElevation-4))>.05);
  if(split.length){
    // A slab projection cannot turn a sunken lounge into a flat floor passage.
    const excluded=new Set(split.map(r=>r.key));
    const masked=rooms.map(r=>excluded.has(r.key)?{...r,walkability:"void" as const}:r);
    const result=connectHallwaysThroughFloor(masked,portals,geometry,contextRooms);
    return {...result,rooms:[...rooms,...result.rooms.filter(r=>!rooms.some(o=>o.key===r.key))],unresolvedNetworks:result.unresolvedNetworks+hallwayRouteComponents(split,portals,elevations).length};
  }
  const components = hallwayRouteComponents(rooms, portals, {}, geometry);
  if (components.length <= 1 || !geometry.floors.length) return { rooms: [...rooms], added: 0, unresolvedNetworks: components.length };
  const hallways = rooms.filter(r=>isWalkable(r)&&isHallway(r)); const levelId = hallways[0]!.levelId;
  if (hallways.some((r) => r.levelId !== levelId)) throw new Error("Connect hallways on one floor at a time.");
  const points = rooms.flatMap((r) => r.polygonFeet); const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs) - 4; const minY = Math.min(...ys) - 4; const spanX = Math.max(...xs) - minX + 4; const spanY = Math.max(...ys) - minY + 4;
  const cell = Math.max(.4, Math.sqrt(spanX * spanY / 350_000)); const width = Math.ceil(spanX / cell); const height = Math.ceil(spanY / cell); const size = width * height;
  const floor = new Uint8Array(size); const walls = new Uint8Array(size); const columns = new Uint8Array(size); const doors = new Uint8Array(size); const privateRooms = new Uint8Array(size);
  const owner = new Int32Array(size); owner.fill(-1);
  const world = (i: number): RoomPoint => [minX + (i % width + .5) * cell, minY + (Math.floor(i / width) + .5) * cell];
  function fill(loops: readonly RoomPoint[][], put: (i: number) => void) {
    if (!loops[0]?.length) return;
    const lo = Math.max(0, Math.floor((Math.min(...loops[0].map((p) => p[1])) - minY) / cell));
    const hi = Math.min(height - 1, Math.ceil((Math.max(...loops[0].map((p) => p[1])) - minY) / cell));
    for (let y = lo; y <= hi; y++) {
      const wy = minY + (y + .5) * cell; const hits: number[] = [];
      for (const loop of loops) loop.forEach((a, i) => { const b = loop[(i + 1) % loop.length]!; if ((a[1] > wy) !== (b[1] > wy)) hits.push(a[0] + (b[0] - a[0]) * (wy - a[1]) / (b[1] - a[1])); });
      hits.sort((a, b) => a - b);
      for (let h = 0; h + 1 < hits.length; h += 2) {
        const x0 = Math.max(0, Math.ceil((hits[h]! - minX) / cell - .5)); const x1 = Math.min(width - 1, Math.floor((hits[h + 1]! - minX) / cell - .5));
        for (let x = x0; x <= x1; x++) put(y * width + x);
      }
    }
  }
  for (const loops of geometry.floors) fill(loops, (i) => { floor[i] = 1; });
  for (const item of geometry.walls) fill([item.polygon], (i) => { walls[i] = 1; });
  for (const item of geometry.columns) fill([item.polygon], (i) => { columns[i] = 1; });
  // Do not use AABB-only door fallbacks to punch holes in the wall mask.
  for (const door of geometry.doors.filter((d) => !d.approximate)) fill([door.polygon], (i) => { doors[i] = 1; });
  for (const room of rooms.filter((r) => !isWalkable(r)||!isHallway(r))) fill([room.polygonFeet, ...room.holesFeet ?? []], (i) => { privateRooms[i] = 1; });
  // A native slab can span several buildings. An adjoining building's mapped
  // hallway is not unassigned floor that this building can claim as a new strip.
  // Keep those connections at their actual door/landing endpoints.
  for (const room of contextRooms.filter(r => r.status !== "deleted" && r.levelId === levelId && roomBuilding(r) !== roomBuilding(hallways[0]!))) {
    fill([room.polygonFeet, ...room.holesFeet ?? []], i => { privateRooms[i] = 1; });
  }
  for (let component = 0; component < components.length; component++) for (const key of components[component]!) {
    const room = hallways.find((r) => r.key === key)!; fill([room.polygonFeet, ...room.holesFeet ?? []], (i) => { owner[i] = component; });
  }
  const walkable = new Uint8Array(size);
  for (let i = 0; i < size; i++) walkable[i] = floor[i] && (!walls[i] || doors[i]) && !columns[i] && !privateRooms[i] ? 1 : 0;
  // Intersect the entire step with obstacle edges, including thin walls that
  // fall between raster centres. Only persisted door footprints open walls.
  const obstacles = [...geometry.walls.map((o) => ({ ...o, openingAllowed: true })), ...geometry.columns.map((o) => ({ ...o, openingAllowed: false }))];
  const boxes = obstacles.map((o) => ({ o, minX: Math.min(...o.polygon.map((p) => p[0])), maxX: Math.max(...o.polygon.map((p) => p[0])), minY: Math.min(...o.polygon.map((p) => p[1])), maxY: Math.max(...o.polygon.map((p) => p[1])) }));
  const openingAt = (p: RoomPoint) => geometry.doors.some((door) => !door.approximate && containsDirectoryRoomPoint(p, { polygonFeet: door.polygon } as DirectoryRoom));
  const crossesObstacle = (a: number, b: number) => {
    const p = world(a); const q = world(b); const dx = q[0] - p[0]; const dy = q[1] - p[1];
    for (const box of boxes) {
      if (Math.min(p[0], q[0]) > box.maxX || Math.max(p[0], q[0]) < box.minX || Math.min(p[1], q[1]) > box.maxY || Math.max(p[1], q[1]) < box.minY) continue;
      for (let i = 0; i < box.o.polygon.length; i++) {
        const u = box.o.polygon[i]!; const v = box.o.polygon[(i + 1) % box.o.polygon.length]!; const ex = v[0] - u[0]; const ey = v[1] - u[1];
        const denominator = dx * ey - dy * ex; if (Math.abs(denominator) < 1e-10) continue;
        const ox = u[0] - p[0]; const oy = u[1] - p[1]; const t = (ox * ey - oy * ex) / denominator; const s = (ox * dy - oy * dx) / denominator;
        if (t < 0 || t > 1 || s < 0 || s > 1) continue;
        if (!box.o.openingAllowed || !openingAt([p[0] + t * dx, p[1] + t * dy])) return true;
      }
    }
    return false;
  };
  const connected = new Set([0]); const extra: DirectoryRoom[] = [];
  const adjacent = (i: number) => { const x = i % width; const y = Math.floor(i / width); return [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1]; };
  while (connected.size < components.length) {
    const previous = new Int32Array(size); previous.fill(-1); const queue = new Int32Array(size); let head = 0; let tail = 0;
    for (let i = 0; i < size; i++) if (walkable[i] && connected.has(owner[i]!)) { previous[i] = i; queue[tail++] = i; }
    let target = -1;
    while (head < tail && target < 0) {
      const i = queue[head++]!;
      for (const next of adjacent(i)) {
        if (next < 0 || !walkable[next] || previous[next] >= 0 || crossesObstacle(i, next)) continue;
        previous[next] = i; queue[tail++] = next;
        if (owner[next]! >= 0 && !connected.has(owner[next]!)) { target = next; break; }
      }
    }
    if (target < 0) break;
    const cells = [target]; for (let i = target; previous[i] !== i; ) { i = previous[i]!; cells.push(i); } cells.reverse();
    const strip = new Uint8Array(size); const reach = Math.max(2, Math.ceil(1.2 / cell));
    for (const i of cells) {
      const x = i % width; const y = Math.floor(i / width);
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const xx = x + dx; const yy = y + dy; if (xx < 0 || xx >= width || yy < 0 || yy >= height || Math.hypot(dx, dy) > reach) continue;
        const j = yy * width + xx; if (walkable[j]) strip[j] = 1;
      }
    }
    const rectangles: RoomPoint[][][] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!strip[y * width + x]) continue; const from = x; while (x + 1 < width && strip[y * width + x + 1]) x++;
      rectangles.push([[[minX + from * cell, minY + y * cell], [minX + (x + 1) * cell, minY + y * cell], [minX + (x + 1) * cell, minY + (y + 1) * cell], [minX + from * cell, minY + (y + 1) * cell]]]);
    }
    const shape = polygonClipping.union(rectangles[0]!, ...rectangles.slice(1));
    if (shape.length !== 1) break;
    const fromComponent = owner[cells[0]!]!; const toComponent = owner[target]!;
    const key = `floor-passage:${levelId}:${components[fromComponent]![0]}:${components[toComponent]![0]}`;
    extra.push({ key, levelId, number: `${roomBuilding(hallways[0]!)}-LINK-${extra.length + 1}`, name: "Connecting passage", polygonFeet: shape[0]![0]!.slice(0, -1) as RoomPoint[], holesFeet: shape[0]!.slice(1).map((h) => h.slice(0, -1) as RoomPoint[]), labelPointFeet: world(cells[Math.floor(cells.length / 2)]!), confidence: .65,
      source: { polygon: "native-floor-connection" }, boundaryReview: { method: "native-floor-connection", cellSizeFeet: cell, roomKeys: [...components[fromComponent]!, ...components[toComponent]!], pathFeet: cells.filter((_, i) => i === 0 || i === cells.length - 1 || cells[i]! - cells[i - 1]! !== cells[i + 1]! - cells[i]!).map(world), note: "Inferred walkable connection; strip width is not the surveyed hallway width." } });
    connected.add(toComponent);
  }
  return { rooms: [...rooms, ...extra], added: extra.length, unresolvedNetworks: components.length - extra.length };
}
