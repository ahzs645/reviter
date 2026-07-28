import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeRevit2027GConditionInt,
  REVIT_2027_GCONDITION_INT_BODY_BYTES,
} from "../lib/reviter/revit-2027-gcondition-int.ts";
import {
  decodeRevit2027GPoint,
  REVIT_2027_GPOINT_BODY_BYTES,
} from "../lib/reviter/revit-2027-gpoint.ts";
import { createRevit2027GRepReplayRegistry } from "../lib/reviter/revit-2027-grep-replay.ts";

test("decodes the complete GPoint GInfo and display fields", () => {
  const data = new Uint8Array(REVIT_2027_GPOINT_BODY_BYTES);
  const view = new DataView(data.buffer);
  view.setBigInt64(0, 91n, true);
  view.setInt32(8, 12, true);
  view.setInt32(12, -3, true);
  view.setUint32(16, 0x8000_0001, true);
  view.setFloat64(20, 1.25, true);
  view.setFloat64(28, -2.5, true);
  view.setFloat64(36, 3.75, true);
  view.setInt32(44, 7, true);
  view.setInt32(48, 2, true);
  view.setInt32(52, 5, true);

  const decoded = decodeRevit2027GPoint(
    data,
    0,
    data.byteLength,
    2027,
  );
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value.gInfo, {
    gStyleElementId: 91n,
    tag: 12,
    controlCommand: -3,
    flags: 0x8000_0001,
  });
  assert.deepEqual(decoded.value.coordinate, [1.25, -2.5, 3.75]);
  assert.equal(decoded.value.size, 7);
  assert.equal(decoded.value.borderSize, 2);
  assert.equal(decoded.value.pointFlags, 5);
});

test("GPoint rejects release, boundary, scalar, and display-size violations", () => {
  const data = new Uint8Array(REVIT_2027_GPOINT_BODY_BYTES);
  const view = new DataView(data.buffer);
  assert.equal(
    decodeRevit2027GPoint(data, 0, data.byteLength, 2026).ok,
    false,
  );
  assert.equal(
    decodeRevit2027GPoint(data, 0, data.byteLength - 1, 2027).ok,
    false,
  );
  view.setFloat64(20, Number.NaN, true);
  assert.equal(
    decodeRevit2027GPoint(data, 0, data.byteLength, 2027).ok,
    false,
  );
  view.setFloat64(20, 0, true);
  view.setInt32(44, -1, true);
  assert.equal(
    decodeRevit2027GPoint(data, 0, data.byteLength, 2027).ok,
    false,
  );
});

test("decodes GConditionInt and registers both FIFO readers", () => {
  const data = new Uint8Array(REVIT_2027_GCONDITION_INT_BODY_BYTES);
  const view = new DataView(data.buffer);
  view.setInt32(0, 4, true);
  view.setInt32(4, -17, true);
  view.setInt32(8, 23, true);
  assert.deepEqual(
    decodeRevit2027GConditionInt(data, 0, data.byteLength, 2027),
    {
      ok: true,
      value: {
        byteOffset: 0,
        endOffset: 12,
        compareMode: 4,
        parameter: -17,
        value: 23,
      },
    },
  );
  assert.equal(
    decodeRevit2027GConditionInt(data, 0, 11, 2027).ok,
    false,
  );

  const registry = createRevit2027GRepReplayRegistry();
  assert.equal(registry.get(2271)?.id, "Revit2027GPoint");
  assert.equal(registry.get(2238)?.id, "Revit2027GConditionInt");
});
