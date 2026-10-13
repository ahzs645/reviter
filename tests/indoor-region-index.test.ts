import assert from "node:assert/strict";
import test from "node:test";
import { indoorRegionBlocker } from "../lib/reviter/indoor-region.ts";
import type { DirectoryRoom, RoomPoint, RouteOpening } from "../lib/reviter/room-directory.ts";
import { referenceIndoorRegionBlocker } from "./fixtures/indoor-region-reference.ts";

/** Deterministic pseudo-random numbers, so a failure is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const room = (polygonFeet: RoomPoint[], holesFeet: RoomPoint[][] = []): DirectoryRoom =>
  ({ key: `r${polygonFeet.length}`, polygonFeet, holesFeet }) as unknown as DirectoryRoom;
/** A star-shaped polygon with many vertices around (cx, cy). */
function star(r: () => number, cx: number, cy: number, n: number, radius: number): RoomPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n, d = radius * (0.6 + 0.4 * r());
    return [cx + d * Math.cos(a), cy + d * Math.sin(a)] as RoomPoint;
  });
}
const box = (x0: number, y0: number, x1: number, y1: number): RoomPoint[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test("the indexed region check answers exactly as the full edge scan", () => {
  const r = rng(20261013);
  // a giant circulation cell (about 12,000 edges) with holes, small rooms, a protected mask and door footprints
  const giant = room(star(r, 0, 0, 12_000, 300), [box(-20, -20, 20, 20), star(r, 120, 40, 300, 25)]);
  const scope = [giant, room(box(310, -10, 340, 10)), room(star(r, -150, 150, 900, 40))];
  const masks = [room(box(-60, 80, -40, 100))];
  const openings = [{ footprint: box(298, -2, 312, 2) }, { footprint: box(-5, 150, 5, 160) }] as unknown as RouteOpening[];
  const fast = indoorRegionBlocker(scope, masks, openings), slow = referenceIndoorRegionBlocker(scope, masks, openings);
  const vertex = giant.polygonFeet;
  let blocked = 0, open = 0;
  for (let k = 0; k < 6_000; k++) {
    let a: RoomPoint, b: RoomPoint;
    if (k % 5 === 0) {
      // endpoints on vertices and edge midpoints: the boundary and tie cases
      const i = Math.floor(r() * vertex.length), u = vertex[i]!, v = vertex[(i + 1) % vertex.length]!;
      a = k % 10 === 0 ? u : [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
      b = [a[0] + (r() - 0.5) * 6, a[1] + (r() - 0.5) * 6];
    } else {
      a = [(r() - 0.5) * 700, (r() - 0.5) * 700];
      const len = k % 3 === 0 ? 200 * r() : 4 * r();
      const ang = 2 * Math.PI * r();
      b = [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)];
    }
    const want = slow(a, b);
    assert.equal(fast(a, b), want, `segment ${JSON.stringify([a, b])}`);
    if (want) blocked++; else open++;
  }
  // both outcomes are exercised
  assert.ok(blocked > 100 && open > 100, `blocked ${blocked}, open ${open}`);
});

test("an axis-aligned grid walk across shared edges matches the full scan", () => {
  // grid walks run along x and y and often touch ring edges and vertices exactly
  const scope = [room(box(0, 0, 50, 50), [box(10, 10, 20, 20)]), room(box(50, 0, 100, 50))];
  const fast = indoorRegionBlocker(scope, [], []), slow = referenceIndoorRegionBlocker(scope, [], []);
  for (let x = -2; x <= 102; x += 0.5)
    for (let y = -2; y <= 52; y += 0.5) {
      const a: RoomPoint = [x, y];
      for (const b of [[x + 0.5, y], [x, y + 0.5], [x + 0.5, y + 0.5]] as RoomPoint[]) assert.equal(fast(a, b), slow(a, b), JSON.stringify([a, b]));
    }
});
