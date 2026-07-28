import assert from "node:assert/strict";
import test from "node:test";

import type { ElementObject } from "../lib/reviter/element-objects.ts";
import {
  decodeRevit2027FramedGRepRoot,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
} from "../lib/reviter/revit-2027-framed-grep-root.ts";

function fixture(): { data: Uint8Array; frame: ElementObject } {
  const elementId = 400_237;
  const objectLength = 154;
  const data = new Uint8Array(objectLength + 20);
  const view = new DataView(data.buffer);

  view.setBigUint64(0, BigInt(elementId), true);
  view.setUint32(12, objectLength, true);
  view.setUint16(16, REVIT_2027_GELEMENT_OBJECT_MARKER, true);

  const bodyOffset = 18;
  view.setBigUint64(bodyOffset, 91n, true);
  view.setUint32(bodyOffset + 20, 0, true);

  const tailOffset = bodyOffset + 20 + 4 + 2 * 48;
  view.setBigInt64(tailOffset, BigInt(elementId), true);
  view.setInt32(tailOffset + 8, 2, true);
  view.setUint32(tailOffset + 12, 0x20, true);
  view.setUint32(objectLength + 16, objectLength, true);

  return {
    data,
    frame: {
      offset: 0,
      elementId,
      objectLength,
      marker: REVIT_2027_GELEMENT_OBJECT_MARKER,
      typeCode: 91,
    },
  };
}

test("Revit 2027 framed GRep root adapter accepts only its release and marker", () => {
  const { data, frame } = fixture();
  const decoded = decodeRevit2027FramedGRepRoot(data, frame, 2027);
  assert.equal(decoded.ok, true);
  if (decoded.ok) {
    assert.equal(decoded.value.ownerElementId, BigInt(frame.elementId));
    assert.deepEqual(decoded.value.children, []);
    assert.equal(decoded.value.dynamicPayloadOffset, frame.objectLength);
  }

  assert.deepEqual(decodeRevit2027FramedGRepRoot(data, frame, 2026), {
    ok: false,
    error: "Revit 2027 framed GRep decoding requires release 2027",
  });

  assert.deepEqual(
    decodeRevit2027FramedGRepRoot(
      data,
      { ...frame, marker: REVIT_2027_GELEMENT_OBJECT_MARKER - 1 },
      2027,
    ),
    {
      ok: false,
      error: "frame is not a Revit 2027 GElement",
    },
  );
});
