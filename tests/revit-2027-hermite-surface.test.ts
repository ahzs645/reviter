import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027HermiteSurface,
  REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT,
} from "../lib/reviter/revit-2027-hermite-surface.ts";
import {
  createRevit2027GRepReplayRegistry,
} from "../lib/reviter/revit-2027-grep-replay.ts";

function fixture(): Uint8Array {
  const data = new Uint8Array(40 + 96 + 4 + 16 + 4 + 16);
  const view = new DataView(data.buffer);
  [-1, -2, 3, 4].forEach((value, index) => {
    view.setFloat64(index * 8, value, true);
  });
  data[32] = 1;
  data[33] = 0;
  data[34] = 1;
  data[35] = 1;
  view.setInt32(36, 1, true);
  for (let index = 0; index < 12; index += 1) {
    view.setFloat64(40 + index * 8, index + 0.5, true);
  }
  let cursor = 136;
  view.setInt32(cursor, 2, true);
  cursor += 4;
  view.setFloat64(cursor, 0, true);
  view.setFloat64(cursor + 8, 1, true);
  cursor += 16;
  view.setInt32(cursor, 2, true);
  cursor += 4;
  view.setFloat64(cursor, -2, true);
  view.setFloat64(cursor + 8, 3, true);
  return data;
}

test("decodes a bounded Revit 2027 HermiteSurf", () => {
  const data = fixture();
  const decoded = decodeRevit2027HermiteSurface(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.envelope, {
    firstCorner: [-1, -2],
    secondCorner: [3, 4],
  });
  assert.equal(decoded.value.orientFlag, true);
  assert.deepEqual(decoded.value.periodic, [false, true]);
  assert.equal(decoded.value.constructedOk, true);
  assert.equal(decoded.value.nodes.length, 1);
  assert.deepEqual(decoded.value.nodes[0], {
    point: [0.5, 1.5, 2.5],
    tangents: [
      [3.5, 4.5, 5.5],
      [6.5, 7.5, 8.5],
    ],
    mixedDerivative: [9.5, 10.5, 11.5],
  });
  assert.deepEqual(decoded.value.uParameters, [0, 1]);
  assert.deepEqual(decoded.value.vParameters, [-2, 3]);
  assert.equal(decoded.value.endOffset, data.byteLength);
});

test("HermiteSurf decoder fails closed", () => {
  const data = fixture();
  assert.equal(
    decodeRevit2027HermiteSurface(data, 0, data.byteLength, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027HermiteSurface(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );
  data[33] = 2;
  assert.equal(
    decodeRevit2027HermiteSurface(data, 0, data.byteLength, 2027).ok,
    false,
  );
});

test("default Revit 2027 FIFO registry includes HermiteSurf", () => {
  assert.equal(REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT, 2414);
  assert.equal(
    createRevit2027GRepReplayRegistry().get(
      REVIT_2027_HERMITE_SURFACE_SOURCE_CLASS_SLOT,
    )?.id,
    "Revit2027HermiteSurface",
  );
});
