/**
 * Markup is anchored in the model, so it has to survive the trip through
 * storage without a stroke quietly losing the points that place it there.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { isMarkupStroke, modelMarkupStorageKey } from "../app/studio/model-markup.ts";
import type { MarkupStroke } from "../app/studio/viewer-tools.ts";

const stroke: MarkupStroke = {
  id: "s1",
  source: "recovered",
  tool: "pencil",
  points: [[1, 2, 3], [4, 5, 6]],
  pointsFeet: [[101, 202, 303], [104, 205, 306]],
  color: "#ef3f45",
  worldWeight: 0.08,
  createdAt: "2026-07-31T00:00:00.000Z",
};

test("markup is keyed to the file it was drawn on", () => {
  // Two models open in the same browser must not show each other's redlines,
  // and the same file reopened must show its own.
  assert.equal(
    modelMarkupStorageKey({ fileName: "UNBC-Model.rvt", byteLength: 70336512 }),
    "reviter.model-markup.v1:UNBC-Model.rvt:70336512",
  );
  assert.notEqual(
    modelMarkupStorageKey({ fileName: "a.rvt", byteLength: 1 }),
    modelMarkupStorageKey({ fileName: "a.rvt", byteLength: 2 }),
  );
});

test("a stroke survives a JSON round trip", () => {
  const restored: unknown = JSON.parse(JSON.stringify(stroke));
  assert.equal(isMarkupStroke(restored), true);
  assert.deepEqual(restored, stroke);
});

test("a stroke with no anchors is not markup", () => {
  // The whole point of the type is that the points place it in the room; an
  // empty or malformed list would project to nothing and draw a stray node.
  assert.equal(isMarkupStroke({ ...stroke, points: [] }), false);
  assert.equal(isMarkupStroke({ ...stroke, points: [[1, 2]] }), false);
  assert.equal(isMarkupStroke({ ...stroke, points: [["1", "2", "3"]] }), false);
  assert.equal(isMarkupStroke({ ...stroke, worldWeight: Number.NaN }), false);
  assert.equal(isMarkupStroke({ ...stroke, tool: "delete" }), false, "delete is a gesture, not a stroke");
  assert.equal(isMarkupStroke(null), false);
  assert.equal(isMarkupStroke("[]"), false);
});

test("registered feet are optional but must be well formed when present", () => {
  // A stroke drawn on a source that cannot be registered keeps scene points
  // only, and shows on that source alone.
  const withoutFeet: Record<string, unknown> = { ...stroke };
  delete withoutFeet.pointsFeet;
  assert.equal(isMarkupStroke(withoutFeet), true);
  assert.equal(isMarkupStroke({ ...stroke, pointsFeet: [[1, 2]] }), false);
});
