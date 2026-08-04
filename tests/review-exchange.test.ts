import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSidecarMatchesModel,
  makeCommentsSidecar,
  makeMarkupSidecar,
  makeRoomReviewSidecar,
  mergeComments,
  mergeMarkup,
  parseReviewSidecar,
} from "../app/studio/review-exchange.ts";
import type { MarkupStroke, ModelComment } from "../app/studio/viewer-tools.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { RoomReviewState } from "../lib/reviter/room-review.ts";

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

test("room reviews round-trip with durable details, decisions, and a structural fingerprint", () => {
  const source = {
    ...model,
    origin: { x: 0, y: 0, z: 0 },
    elementBounds: [],
    nativeIdentity: { identities: [{ uniqueId: "model-room-identity" }] },
  } as unknown as ConvertResult;
  const timestamp = "2026-08-04T12:00:00.000Z";
  const review: RoomReviewState = {
    rooms: [{
      roomId: "room-101", candidateKey: "candidate-101", levelId: 100, closure: "near-closed", disposition: "accepted",
      geometry: { areaSquareFeet: 100, centroidFeet: [5, 5], loopsFeet: [[[0, 0], [10, 0], [10, 10], [0, 10]]] },
      gapIds: ["gap-1"],
      details: { number: "101", name: "Classroom", longName: "", description: "", department: "Teaching", occupancyType: "Classroom", accessibility: "Accessible", notes: "", heightFeet: 9 },
      ifc: { export: true, predefinedType: "INTERNAL" }, createdAt: timestamp, updatedAt: timestamp,
    }],
    gaps: [{ id: "gap-1", levelId: 100, endpoints: [[0, 0], [1, 0]], widthFeet: 1, orientation: "horizontal", classification: "unknown-opening", disposition: "treat-as-closed", note: "Reviewed", updatedAt: timestamp }],
  };
  const parsed = parseReviewSidecar(makeRoomReviewSidecar(source, review, timestamp));
  assert.equal(parsed.format, "reviter-room-review");
  assert.deepEqual(parsed.rooms, review.rooms);
  assert.deepEqual(parsed.gaps, review.gaps);
  assert.doesNotThrow(() => assertSidecarMatchesModel(parsed, source));
  assert.match(parsed.model.fingerprint, /^fnv1a32-/);
});
