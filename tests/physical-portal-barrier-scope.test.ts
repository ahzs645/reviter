import assert from "node:assert/strict";
import test from "node:test";
import { physicalPortalBarrierScope } from "../lib/reviter/physical-portal-barrier-scope.ts";
import { nativeRouteBlocker, type DirectoryRouteBarriers, type RoomPoint, type RouteOpening } from "../lib/reviter/room-directory.ts";
const rectangle = (x0: number, y0: number, x1: number, y1: number): RoomPoint[] =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const aperture: RouteOpening = {
  rooms: ["raised-room", "raised-hall"], point: [5, 3],
  from: [3.5, 3], to: [6.5, 3], halfWidth: 1, halfHeight: 1,
  footprint: rectangle(4, 2, 6, 4),
};
const a: RoomPoint = [3.5, 3], b: RoomPoint = [6.5, 3];
const geometry: DirectoryRouteBarriers = { walls: [{polygon: rectangle(4, 0, 6, 8)}], columns: [] };

test("a raised room's physical doorway uses its real plane and own aperture", () => {
  const physical = new Map([["door:physical", 20]]);
  const geometries = new Map([[10, geometry], [20, geometry]]);
  const openings = new Map([[10, []], [20, [aperture]]]);
  assert.equal(nativeRouteBlocker(geometries.get(10), openings.get(10)!)(a, b), true);
  const scope = physicalPortalBarrierScope("door:physical", physical, geometries, openings);
  assert.ok(scope);
  assert.equal(scope.levelId, 20);
  assert.equal(nativeRouteBlocker(scope.geometry, scope.openings)(a, b), false);
  // No opening still means a solid host on the correct physical plane.
  assert.equal(nativeRouteBlocker(scope.geometry, [])(a, b), true);
});

test("the physical plane retains foreign columns and wall material outside the opening", () => {
  const physical = new Map([["door:physical", 20]]);
  for (const foreign of [
    { walls: geometry.walls, columns: [{ polygon: rectangle(3.55, 2.8, 3.7, 3.2) }] },
    { walls: [...geometry.walls, { polygon: rectangle(6.2, 2.8, 6.35, 3.2) }], columns: [] },
  ]) {
    const scope = physicalPortalBarrierScope("door:physical", physical, new Map([[20, foreign]]), new Map([[20, [aperture]]]));
    assert.ok(scope);
    assert.equal(nativeRouteBlocker(scope.geometry, scope.openings)(a, b), true);
  }
});

test("unknown physical scope never falls back to a clear identity floor", () => {
  const geometries = new Map([[10, {walls: [], columns: []}]]), openings = new Map<number, typeof aperture[]>([[10, []]]);
  assert.equal(physicalPortalBarrierScope("door", new Map(), geometries, openings), undefined);
  assert.equal(physicalPortalBarrierScope("door", new Map([["door", 20]]), geometries, openings), undefined);
  assert.equal(physicalPortalBarrierScope("door", new Map([["door", 10]]), geometries, new Map()), undefined);
});
