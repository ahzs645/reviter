import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GHermiteSpline,
  REVIT_2027_GHERMITE_SPLINE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-ghermite-spline.ts";
import {
  createRevit2027GRepReplayRegistry,
} from "../lib/reviter/revit-2027-grep-replay.ts";

function fixture(): Uint8Array {
  const data = new Uint8Array(41 + 2 * 56);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, 42n, true);
  view.setInt32(8, 3, true);
  view.setUint32(16, 7, true);
  view.setFloat64(20, 0, true);
  view.setFloat64(28, 1, true);
  data[36] = 0;
  view.setInt32(37, 2, true);
  let cursor = 41;
  for (const [point, tangent, parameter] of [
    [[0, 0, 0], [1, 0, 0], 0],
    [[1, 1, 0], [0, 1, 0], 1],
  ] as const) {
    [...point, ...tangent, parameter].forEach((value, index) => {
      view.setFloat64(cursor + index * 8, value, true);
    });
    cursor += 56;
  }
  return data;
}

test("decodes a count-bounded Revit 2027 GHermiteSpline", () => {
  const data = fixture();
  const decoded = decodeRevit2027GHermiteSpline(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.endParameters, [0, 1]);
  assert.equal(decoded.value.periodic, false);
  assert.deepEqual(decoded.value.nodes, [
    {
      point: [0, 0, 0],
      tangent: [1, 0, 0],
      parameter: 0,
    },
    {
      point: [1, 1, 0],
      tangent: [0, 1, 0],
      parameter: 1,
    },
  ]);
  assert.equal(decoded.value.endOffset, data.byteLength);
});

test("GHermiteSpline decoder fails closed", () => {
  const data = fixture();
  assert.equal(
    decodeRevit2027GHermiteSpline(data, 0, data.byteLength, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GHermiteSpline(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );
  new DataView(data.buffer).setFloat64(41 + 56 + 48, -1, true);
  assert.equal(
    decodeRevit2027GHermiteSpline(data, 0, data.byteLength, 2027).ok,
    false,
  );
});

test("default Revit 2027 FIFO registry includes GHermiteSpline", () => {
  assert.equal(REVIT_2027_GHERMITE_SPLINE_SOURCE_CLASS_SLOT, 2259);
  assert.equal(
    createRevit2027GRepReplayRegistry().get(
      REVIT_2027_GHERMITE_SPLINE_SOURCE_CLASS_SLOT,
    )?.id,
    "Revit2027GHermiteSpline",
  );
});
