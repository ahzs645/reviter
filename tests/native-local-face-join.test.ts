import assert from "node:assert/strict";
import test from "node:test";
import { createNativeLocalFace, nativeLocalFaceJoins, acceptNativeLocalFacePiece, nativeLocalFaceParts } from "../lib/reviter/native-local-face-join.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import { nativeRationalPointInParts, nativeRationalAreaCompare } from "../lib/reviter/native-exact-planar-topology.ts";
type P = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// Deterministic pseudo-random sequence (no Math.random in tests).
function* lcg(seed: number) { let s = seed >>> 0; for (;;) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; yield s / 2 ** 32; } }
/** A one-part face: a notched slab with a field of column holes and a staircase edge. */
function face() {
  const outer: P[] = [[0, 0], [40, 0], [40, 10], [30, 10], [30, 12], [26, 12], [26, 10], [20, 10], [20, 30], [18, 30], [18, 31], [16, 31], [16, 30], [0, 30]];
  const holes: P[][] = [];
  for (let x = 2; x < 18; x += 3) for (let y = 2; y < 28; y += 3) holes.push(rect(x, y, x + 0.75, y + 0.75).reverse() as P[]);
  return nativeRationalOverlay("union", [[outer, ...holes]]);
}
const global = (f: ReturnType<typeof face>, piece: P[][][], point: P) => {
  const joined = nativeRationalOverlay("union", f, piece);
  return joined.length === 1 && nativeRationalPointInParts(point, joined);
};
test("windowed join decisions equal the global exact union, piece by piece", () => {
  const f = face();
  const local = createNativeLocalFace(f, 1, 24)!;
  assert.ok(local.tiles.length > 8, "the face is really tiled");
  const rnd = lcg(7);
  const next = () => rnd.next().value as number;
  let joins = 0, refusals = 0;
  const cases: [P[][][], P][] = [
    [[[rect(40, 4, 41, 5)]], [40.5, 4.5]], // shares the east edge
    [[[rect(41, 4, 42, 5)]], [41.5, 4.5]], // detached
    [[[rect(40, 10, 41, 11)]], [40.5, 10.5]], // corner contact only
    [[[rect(2.75, 2.2, 3.1, 2.5)]], [2.9, 2.3]], // inside a column hole edge
    [[[rect(2.1, 2.1, 2.5, 2.5)]], [2.3, 2.3]], // filling part of a hole
    [[[rect(16.5, 31, 17.5, 32)]], [17, 31.5]], // on top of the stair notch
    [[[rect(16.5, 31, 17.5, 32)]], [17, 33]], // point outside the joined region
  ];
  for (let i = 0; i < 160; i++) {
    const x = next() * 44 - 2, y = next() * 34 - 2, w = 0.2 + next() * 1.5, h = 0.2 + next() * 1.5;
    const snap = (v: number) => (next() < 0.5 ? Math.round(v * 4) / 4 : v);
    const piece: P[][][] = [[rect(snap(x), snap(y), snap(x + w), snap(y + h))]];
    cases.push([piece, [snap(x + w / 2), next() < 0.8 ? snap(y + h / 2) : y - 1]]);
  }
  for (const [piece, point] of cases) {
    const expected = global(f, piece, point);
    assert.equal(nativeLocalFaceJoins(local, piece, point), expected, JSON.stringify([piece, point]));
    expected ? joins++ : refusals++;
  }
  assert.ok(joins > 10 && refusals > 10, `${joins} joins, ${refusals} refusals`);
});
test("accepted pieces grow the face exactly as incremental global unions do", () => {
  const f = face();
  const local = createNativeLocalFace(f, 1, 24)!;
  let grown = f;
  const rnd = lcg(11);
  const next = () => rnd.next().value as number;
  for (let i = 0; i < 60; i++) {
    // Pieces hugging the outer edges, some chained onto earlier ones.
    const side = Math.floor(next() * 4), t = next();
    // Offsets in [-0.9, 0.3): most pieces meet the edge, some stay detached.
    const off = () => Math.round((next() * 1.2 - 0.9) * 8) / 8;
    const x = side < 2 ? t * 40 : side === 2 ? -0.6 + off() : 40 - off();
    const y = side === 0 ? -0.6 + off() : side === 1 ? 30 - off() : t * 30;
    const piece: P[][][] = [[rect(x, y, x + 0.6, y + 0.6)]];
    const point: P = [x + 0.3, y + 0.3];
    const joined = nativeRationalOverlay("union", grown, piece);
    const expected = joined.length === 1 && nativeRationalPointInParts(point, joined);
    assert.equal(nativeLocalFaceJoins(local, piece, point), expected);
    if (expected) { grown = joined; acceptNativeLocalFacePiece(local, piece); }
  }
  assert.ok(local.accepted.length > 5);
  assert.equal(nativeRationalAreaCompare(nativeLocalFaceParts(local), grown), 0);
  assert.equal(nativeRationalOverlay("xor", nativeLocalFaceParts(local), grown).length, 0);
});
test("small, multi-part and empty faces keep the global path", () => {
  assert.equal(createNativeLocalFace(face()), undefined, "below the size threshold");
  const two = nativeRationalOverlay("union", [[rect(0, 0, 1, 1)]], [[rect(5, 5, 6, 6)]]);
  assert.equal(createNativeLocalFace(two, 1, 1), undefined);
  assert.equal(createNativeLocalFace([], 1, 1), undefined);
});
