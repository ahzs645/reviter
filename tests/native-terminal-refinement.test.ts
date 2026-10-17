import assert from "node:assert/strict";
import test from "node:test";
import { refineNativeTerminalPath } from "../lib/reviter/native-terminal-refinement.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import { nativeRationalPathSupported } from "../lib/reviter/native-exact-planar-topology.ts";
import type { RoomPoint } from "../lib/reviter/room-directory.ts";

const rectangle = (x0: number, y0: number, x1: number, y1: number): RoomPoint[] =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

test("bounded refinement connects a narrow bent original face without moving its terminals", () => {
  const parts = nativeRationalOverlay("union", [[[
    [0, 0], [3, 0], [3, 0.18], [0.18, 0.18], [0.18, 3], [0, 3],
  ]]]);
  const from: RoomPoint = [2.8, 0.09], to: RoomPoint = [0.09, 2.8];
  const before = JSON.stringify([from, to]);
  const result = refineNativeTerminalPath(parts, from, to);
  assert.ok(result);
  assert.ok(nativeRationalPathSupported(result, parts));
  assert.deepEqual(result[0], from);
  assert.deepEqual(result.at(-1), to);
  assert.equal(JSON.stringify([from, to]), before);
});

test("refinement preserves holes and refuses an unsupported original terminal", () => {
  const parts = nativeRationalOverlay("union", [[rectangle(0, 0, 10, 10), rectangle(4, 4, 6, 6)]]);
  const result = refineNativeTerminalPath(parts, [2, 5], [8, 5]);
  assert.ok(result);
  assert.ok(nativeRationalPathSupported(result, parts));
  assert.equal(refineNativeTerminalPath(parts, [5, 5], [8, 5]), undefined);
});

test("refinement cannot bridge a positive exact gap hidden below raster resolution", () => {
  const parts = nativeRationalOverlay("union", [[rectangle(0, 0, 1, 2)], [rectangle(1 + 2 ** -40, 0, 2, 2)]]);
  assert.equal(refineNativeTerminalPath(parts, [0.5, 1], [1.5, 1]), undefined);
});

test("refinement keeps distant non-straight requests bounded", () => {
  const parts = nativeRationalOverlay("union", [[rectangle(0, 0, 200, 200), rectangle(90, 10, 110, 190)]]);
  assert.equal(refineNativeTerminalPath(parts, [1, 100], [199, 100]), undefined);
});

test("the bounded bent proposal also works in reverse and on rotated source faces", () => {
  const rotate = ([x, y]: RoomPoint): RoomPoint => [x * 0.8 - y * 0.6 + 37, x * 0.6 + y * 0.8 - 19];
  const ring: RoomPoint[] = [[0, 0], [3, 0], [3, 0.24], [0.24, 0.24], [0.24, 3], [0, 3]];
  const parts = nativeRationalOverlay("union", [[ring.map(rotate)]]);
  const a = rotate([2.8, 0.12]), b = rotate([0.12, 2.8]);
  for (const [from, to] of [[a, b], [b, a]]) {
    const path = refineNativeTerminalPath(parts, from!, to!);
    assert.ok(path);
    assert.ok(nativeRationalPathSupported(path, parts));
    assert.deepEqual(path[0], from);
    assert.deepEqual(path.at(-1), to);
  }
});

test("a disconnected neighbouring doorway island cannot support the missing middle", () => {
  const parts = nativeRationalOverlay("union", [[rectangle(0, 0, 2, 2)], [rectangle(2.1, 0, 4.1, 2)], [rectangle(4.2, 0, 6.2, 2)]]);
  assert.equal(refineNativeTerminalPath(parts, [1, 1], [5.2, 1]), undefined);
});
