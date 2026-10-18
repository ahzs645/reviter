import assert from "node:assert/strict";
import test from "node:test";
import { nativeTerminalVisibilityPath } from "../lib/reviter/native-terminal-visibility.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import { nativeRationalPathSupported } from "../lib/reviter/native-exact-planar-topology.ts";
import type { RoomPoint } from "../lib/reviter/room-directory.ts";
const rect = (x0: number, y0: number, x1: number, y1: number): RoomPoint[] => [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
test("one exact bent approach works both ways for original door, stair and ramp terminal coordinates", () => {
  const face = nativeRationalOverlay("union", [[[ [0,0],[12,0],[12,3],[3,3],[3,12],[0,12] ]]]);
  const a: RoomPoint = [10,1.5], b: RoomPoint = [1.5,10];
  const before = JSON.stringify([a,b]);
  for (const [from,to] of [[a,b],[b,a]]) {
    const result = nativeTerminalVisibilityPath(face, from!, to!);
    assert.ok(result); assert.ok(nativeRationalPathSupported(result, face));
    assert.deepEqual(result[0], from); assert.deepEqual(result.at(-1), to);
  }
  assert.equal(JSON.stringify([a,b]), before);
});
test("an original hole remains an obstruction and an unsupported landing cannot be admitted", () => {
  const face = nativeRationalOverlay("union", [[rect(0,0,20,20),rect(8,4,12,16)]]);
  const result = nativeTerminalVisibilityPath(face,[2,10],[18,10]);
  assert.ok(result && result.length > 2); assert.ok(nativeRationalPathSupported(result,face));
  assert.equal(nativeTerminalVisibilityPath(face,[10,10],[18,10]),undefined);
});
test("a positive exact gap and another doorway island cannot supply a missing approach", () => {
  const face = nativeRationalOverlay("union", [[rect(0,0,2,2)],[rect(2+2**-40,0,4,2)]]);
  assert.equal(nativeTerminalVisibilityPath(face,[1,1],[3,1]),undefined);
});
test("visibility budgets stay bounded; refusal grants no support", () => {
  const face = nativeRationalOverlay("union", [[rect(0,0,20,20),rect(8,4,12,16)]]);
  assert.equal(nativeTerminalVisibilityPath(face,[2,10],[18,10],{maximumChecks:0}),undefined);
  assert.equal(nativeTerminalVisibilityPath(face,[2,10],[18,10],{maximumVertices:2}),undefined);
  assert.throws(()=>nativeTerminalVisibilityPath(face,[2,10],[18,10],{maximumVertices:-1}));
});
