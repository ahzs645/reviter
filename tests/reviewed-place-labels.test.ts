import assert from "node:assert/strict";
import test from "node:test";
import { parseRoomDirectory } from "../lib/reviter/room-directory.ts";
import { validateReviewedPlaceLabels } from "../lib/reviter/reviewed-place-labels.ts";

const room = (key: string, number: string, levelId = 1) => ({
  key, levelId, number, name: "Office",
  polygonFeet: [[0, 0], [10, 0], [10, 10], [0, 10]], labelPointFeet: [5, 5], confidence: 1,
});
const labels = {
  version: 1, sourceModelSha256: "a".repeat(64),
  labels: [{ id: "place-label:b", roomKey: "b", number: "03-1059", action: "alias", placeRoomKey: "a",
    decisionId: "2026-10-09-round2#f2-4", evidence: "user-reported", reason: "One office with two numbers." }],
};
const data = (l: unknown, annotations = [room("a", "03-1058"), room("b", "03-1059")]) => JSON.stringify({
  format: "reviter-room-annotations", version: 1, coordinateSystem: "revit-model-feet", model: { fileName: "m.rvt" },
  annotations, reviewedPlaceLabels: l,
});

test("room annotations carry owner-reviewed place labels bound to their room number and level", () => {
  assert.deepEqual(parseRoomDirectory(data(labels)).reviewedPlaceLabels, labels);
  assert.throws(() => parseRoomDirectory(data(labels, [room("a", "03-1058"), room("b", "03-1060")])), /no longer matches/);
  assert.throws(() => parseRoomDirectory(data(labels, [room("a", "03-1058", 2), room("b", "03-1059")])), /another level/);
  assert.throws(() => validateReviewedPlaceLabels(labels, [room("a", "03-1058"), room("b", "03-1059")], "b".repeat(64)), /version, model/);
  const retired = structuredClone(labels);
  (retired.labels[0] as { action: string }).action = "retire";
  parseRoomDirectory(data(retired));
});
