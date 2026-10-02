import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectNativeLiftEvidence,
  liftLabelDisposition,
} from "../lib/reviter/indoor-lift-evidence.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import type { DirectoryRoom } from "../lib/reviter/room-directory.ts";
const room = (key: string, name: string, levelId: number): DirectoryRoom => ({
  key,
  name,
  levelId,
  number: key,
  building: "01",
  labelPointFeet: [2, 2],
  polygonFeet: [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
  confidence: 1,
});
const element = (
  elementId: number,
  categoryName: string | undefined,
  familyName?: string,
) => ({
  elementId,
  categoryName,
  familyName,
  boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 10 } },
});
const model = () =>
  ({
    elementBounds: [
      element(1, "Doors"),
      element(2, undefined),
      element(3, "Generic Models"),
    ],
    nativeIdentity: {
      decodedIdentityCount: 3,
      identities: [{ elementId: 1, uniqueId: "door-1" }],
    },
    nativeHostRelations: [{ elementId: 1, hostId: 12 }],
    nativeAssociatedLevelRelations: [{ elementId: 1, levelId: 1 }],
    elementOwnership: { records: [{ elementId: 1, owningElementId: 12 }] },
    nativeFamilyDefinitions: [{ familyId: 500, name: "Elevator cab" }],
  }) as unknown as ConvertResult;
test("lift equipment and lobby labels cannot become landing entrances", () => {
  assert.equal(
    liftLabelDisposition("Elevator Machine Room"),
    "equipment-room-not-entrance",
  );
  assert.equal(
    liftLabelDisposition("Elevator Control"),
    "equipment-room-not-entrance",
  );
  assert.equal(
    liftLabelDisposition("Lift lobby"),
    "lobby-needs-assembly-and-threshold",
  );
  assert.equal(
    liftLabelDisposition("Elevator"),
    "lift-area-needs-assembly-and-served-floors",
  );
  assert.equal(liftLabelDisposition("Office"), "unrelated");
});
test("vertical label alignment and nearby native doors never generate inferred stops", () => {
  const m = model(),
    rooms = [room("a", "Elevator", 1), room("b", "Elevator", 2)],
    before = JSON.stringify({ m, rooms });
  const result = inspectNativeLiftEvidence(m, rooms);
  assert.equal(result.verifiedStopCount, 0);
  assert.equal(result.verifiedAssemblyCount, 0);
  assert.equal(result.placedCandidates.length, 0);
  assert.equal(result.familyMetadataCandidates.length, 1);
  assert.equal(result.annotations.length, 2);
  assert.deepEqual(result.annotations[0].verifiedServedFloorIds, []);
  const door = result.annotations[1].nearbyDoorsForInspectionOnly[0];
  assert.equal(door.sameDecodedLevel, false);
  assert.equal(door.nativeUniqueId, "door-1");
  assert.equal(door.nativeHostId, 12);
  assert.equal(JSON.stringify({ m, rooms }), before);
});
test("a named placed cab remains a candidate until assembly and stops are exported", () => {
  const m = model();
  m.elementBounds.push(element(4, "Generic Models", "Ascenseur") as never);
  const result = inspectNativeLiftEvidence(m, [
    room("a", "Elevator Control", 1),
  ]);
  assert.equal(result.placedCandidates.length, 1);
  assert.equal(result.verifiedStopCount, 0);
  assert.equal(
    result.annotations[0].disposition,
    "equipment-room-not-entrance",
  );
  assert.match(
    result.limitation,
    /not evidence that physical elevators are absent/,
  );
});
