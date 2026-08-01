import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSidecarMatchesModel,
  makeCommentsSidecar,
  makeMarkupSidecar,
  mergeComments,
  mergeMarkup,
  parseReviewSidecar,
} from "../app/studio/review-exchange.ts";
import type { MarkupStroke, ModelComment } from "../app/studio/viewer-tools.ts";

const model = { fileName: "School.rvt", byteLength: 42_000 };
const comment: ModelComment = {
  id: "comment-1",
  source: "recovered",
  scenePosition: [1, 2, 3],
  modelPositionFeet: [101, 202, 303],
  elementId: 123,
  text: "Check this wall",
  status: "open",
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
  viewpoint: {
    source: "recovered",
    position: [5, 6, 7],
    target: [1, 2, 3],
    up: [0, 0, 1],
    fov: 45,
  },
};
const stroke: MarkupStroke = {
  id: "markup-1",
  source: "recovered",
  tool: "arrow",
  points: [[1, 2, 3], [4, 5, 6]],
  pointsFeet: [[101, 202, 303], [104, 205, 306]],
  color: "#ef3f45",
  worldWeight: 0.08,
  createdAt: "2026-08-01T12:00:00.000Z",
};

test("comments export separately with anchors and viewpoints intact", () => {
  const parsed = parseReviewSidecar(makeCommentsSidecar(
    model,
    [comment],
    "2026-08-01T13:00:00.000Z",
  ));
  assert.equal(parsed.format, "reviter-comments");
  assert.deepEqual(parsed.model, model);
  assert.deepEqual(parsed.comments, [comment]);
  assert.equal("markup" in parsed, false);
});

test("markup exports separately with canonical model points intact", () => {
  const parsed = parseReviewSidecar(makeMarkupSidecar(
    model,
    [stroke],
    "2026-08-01T13:00:00.000Z",
  ));
  assert.equal(parsed.format, "reviter-markup");
  assert.deepEqual(parsed.markup, [stroke]);
  assert.equal("comments" in parsed, false);
});

test("review sidecars cannot be imported over a different source file", () => {
  const parsed = parseReviewSidecar(makeCommentsSidecar(model, [comment]));
  assert.doesNotThrow(() => assertSidecarMatchesModel(parsed, { ...model, fileName: "Renamed.rvt" }));
  assert.throws(
    () => assertSidecarMatchesModel(parsed, { fileName: "Other.rvt", byteLength: 99 }),
    /belongs to School\.rvt/,
  );
});

test("malformed review data is rejected instead of drawing stray annotations", () => {
  const payload = JSON.parse(makeMarkupSidecar(model, [stroke]));
  payload.markup[0].points = [];
  assert.throws(() => parseReviewSidecar(JSON.stringify(payload)), /invalid stroke/);
  assert.throws(() => parseReviewSidecar("not json"), /not a readable/);
});

test("import merges review data without deleting local annotations", () => {
  const localComment = { ...comment, text: "Local edit", updatedAt: "2026-08-01T14:00:00.000Z" };
  const additionalComment = { ...comment, id: "comment-2", text: "Shared note" };
  assert.deepEqual(
    mergeComments([localComment], [comment, additionalComment]),
    [localComment, additionalComment],
  );

  const additionalStroke = { ...stroke, id: "markup-2" };
  assert.deepEqual(mergeMarkup([stroke], [stroke, additionalStroke]), [stroke, additionalStroke]);
});
