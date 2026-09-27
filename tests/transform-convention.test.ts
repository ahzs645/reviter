import assert from "node:assert/strict";
import test from "node:test";

import { decodeTrf201120260 } from "../lib/reviter/dynamic-geometry-queue.ts";
import { instanceCorners } from "../lib/reviter/instanced-geometry.ts";

/** Nine rotation scalars as the file writes them, then an origin. */
function trf(values: number[], origin: [number, number, number]): Uint8Array {
  const data = new Uint8Array(96);
  const view = new DataView(data.buffer);
  [...values, ...origin].forEach((value, index) => view.setFloat64(index * 8, value, true));
  return data;
}

test("a stored rotation is read as rows, the same way a placement's basis is", () => {
  // The 2025 RAC sample's solar panel 800280: rotated 37 degrees about z.
  const stored = [
    0.798635510047286, 0.6018150231520577, 0,
    -0.6018150231520576, 0.7986355100472862, 0,
    0, 0, 1,
  ];
  const origin: [number, number, number] = [-54.88940826290079, 10.73313484337773, 3.1470402170076834];
  const decoded = decodeTrf201120260(trf(stored, origin), 0);
  assert.ok(decoded.ok);
  // Local x is the first column.
  assert.deepEqual(decoded.transform.xAxis, [0.798635510047286, -0.6018150231520576, 0]);

  // The same local point lands where the placement reading puts it.
  const apply = (m: readonly number[], p: [number, number, number]) => [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
  const corners = instanceCorners(
    { elementId: 800280, geometryId: 776839, basis: stored, origin },
    { elementId: 776839, min: [-2.75, -0.043, 0], max: [2.75, 3.25, 1.271] },
  );
  const viaMatrix = apply(decoded.transform.matrix, [-2.75, -0.043, 0]);
  corners[0]!.forEach((value, axis) => assert.ok(Math.abs(value - viaMatrix[axis]!) < 1e-9));
  // And that is Autodesk's panel: its box starts at x = -57.10.
  const xs = [[-2.75, -0.043], [2.75, -0.043], [-2.75, 3.25], [2.75, 3.25]]
    .map(([x, y]) => apply(decoded.transform.matrix, [x!, y!, 0])[0]!);
  assert.ok(Math.abs(Math.min(...xs) - -57.11) < 0.02);
  assert.ok(Math.abs(Math.max(...xs) - -50.74) < 0.02);
});
