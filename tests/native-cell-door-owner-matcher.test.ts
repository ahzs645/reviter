import assert from "node:assert/strict";
import test from "node:test";
import {
  directoryDoorReviews,
  doorCandidates,
  NATIVE_DOOR_OWNER_MAX_GAP_FEET,
  nativeCellDoorOwners,
  type DoorOwnerMatcher,
  type NativeDoorCell,
} from "../lib/reviter/directory-navigation.ts";
import type { DirectoryDoor, DirectoryRoom } from "../lib/reviter/room-directory.ts";

type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (key: string, ring: Point[], extra: Partial<DirectoryRoom> = {}): DirectoryRoom => ({
  key, levelId: 1, name: key, polygonFeet: ring, labelPointFeet: ring[0]!, confidence: 1, ...extra,
});
const cell = (id: string, roomKeys: string[], ...rings: Point[][]): NativeDoorCell => ({ id, roomKeys, ringsFeet: rings });
/** A door in a thin vertical wall at x = 10 (wall faces 9.9 and 10.1). */
const door = (id = 7, y0 = 4, y1 = 7, x = 10): DirectoryDoor => ({
  id,
  point: [x, (y0 + y1) / 2],
  halfWidth: 0.1,
  halfHeight: (y1 - y0) / 2,
  footprint: rect(x - 0.1, y0, x + 0.1, y1),
  normal: [1, 0],
});
const native = (cells: NativeDoorCell[]): DoorOwnerMatcher => ({ mode: "native-cell", cells });

test("thin wall where registered outlines stop short: legacy cannot match, native cells can", () => {
  // Outlines stop 1.4 ft short of each wall face; native cells reach the faces.
  const rooms = [room("corridor", rect(0, 0, 8.5, 10)), room("office", rect(11.5, 0, 20, 10))];
  const cells = [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["office"], rect(10.1, 0, 20, 10))];
  const legacy = directoryDoorReviews(rooms, [door()]);
  assert.equal(legacy[0]!.state, "unmatched");
  assert.equal(legacy[0]!.portal, undefined);
  const owners = nativeCellDoorOwners(rooms, door(), cells);
  assert.equal(owners.kind, "native-pair");
  assert.deepEqual(owners.rooms, ["corridor", "office"]);
  assert.equal(owners.sides[0].cellId, "A");
  assert.equal(owners.sides[1].cellId, "B");
  assert.equal(owners.sides[0].stepFeet, 0.25);
  assert.ok(Math.abs(owners.sides[1].ownerGapFeet! - 1.15) < 1e-9);
  const reviewed = directoryDoorReviews(rooms, [door()], [], [], native(cells));
  assert.equal(reviewed[0]!.state, "connected");
  assert.deepEqual(reviewed[0]!.portal!.rooms, ["corridor", "office"]);
  assert.equal(reviewed[0]!.nativeOwners!.decided, true);
  assert.equal(reviewed[0]!.nativeOwners!.legacyRooms, undefined);
  // Native owners become candidates, so a reviewed link naming them validates.
  assert.deepEqual(doorCandidates(rooms, door(), native(cells)).map((r) => r.key).sort(), ["corridor", "office"]);
  assert.deepEqual(doorCandidates(rooms, door()).map((r) => r.key), []);
});

test("merged cell: the nearest room by outline inside the cell owns the side, not the cell's first key", () => {
  // Cell B was merged across a non-wall partition and carries a closet, two
  // offices and the far office first. The probe lies inside office-1.
  const rooms = [
    room("corridor", rect(0, 0, 9.9, 20)),
    room("office-2", rect(10.1, 8, 20, 20)),
    room("office-1", rect(10.1, 0, 20, 7.6)),
    room("closet", rect(15, 0, 20, 2)),
  ];
  const cells = [cell("A", ["corridor"], rect(0, 0, 9.9, 20)), cell("B", ["office-2", "closet", "office-1"], rect(10.1, 0, 20, 20))];
  const d = door(9, 5, 7.5);
  const owners = nativeCellDoorOwners(rooms, d, cells);
  assert.equal(owners.kind, "native-pair");
  assert.deepEqual(owners.rooms, ["corridor", "office-1"]);
  assert.equal(owners.sides[1].ownerGapFeet, 0);
  const [review] = directoryDoorReviews(rooms, [d], [], [], native(cells));
  assert.deepEqual([...review!.portal!.rooms].sort(), ["corridor", "office-1"]);
});

test("same-cell door: no native wall separates the sides, so the legacy result stands", () => {
  const rooms = [room("lobby", rect(0, 0, 10, 10)), room("lounge", rect(10, 0, 20, 10))];
  const cells = [cell("M", ["lobby", "lounge"], rect(0, 0, 20, 10))];
  const d = door();
  const legacy = directoryDoorReviews(rooms, [d]);
  assert.equal(legacy[0]!.state, "connected", "touching outlines match by proximity");
  const owners = nativeCellDoorOwners(rooms, d, cells);
  assert.equal(owners.kind, "same-cell");
  assert.equal(owners.rooms, undefined);
  const [review] = directoryDoorReviews(rooms, [d], [], [], native(cells));
  assert.deepEqual(review!.portal, legacy[0]!.portal, "legacy portal retained verbatim");
  assert.equal(review!.nativeOwners!.decided, false);
  assert.equal(review!.nativeOwners!.kind, "same-cell");
});

test("exterior door: only one face opens into a native cell, so nothing is invented", () => {
  const rooms = [room("vestibule", rect(0, 0, 9.9, 10))];
  const cells = [cell("V", ["vestibule"], rect(0, 0, 9.9, 10))];
  const owners = nativeCellDoorOwners(rooms, door(), cells);
  assert.equal(owners.kind, "one-side");
  assert.equal(owners.sides[0].owner, "vestibule");
  assert.equal(owners.sides[1].cellId, undefined);
  const [review] = directoryDoorReviews(rooms, [door()], [], [], native(cells));
  assert.equal(review!.state, "unmatched");
  assert.equal(review!.portal, undefined);
});

test("agreement keeps the legacy portal; a disagreement is a reported conflict unless override is requested", () => {
  const rooms = [room("corridor", rect(0, 0, 10, 10)), room("office", rect(10, 0, 20, 10)), room("store", rect(10, 6.9, 20, 10))];
  const d = door(3, 4, 6.5);
  const legacy = directoryDoorReviews(rooms, [d]);
  const agree = directoryDoorReviews(rooms, [d], [], [], native([cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["office", "store"], rect(10.1, 0, 20, 10))]));
  assert.ok(legacy[0]!.portal, "legacy matches this door");
  assert.deepEqual(agree[0]!.portal, legacy[0]!.portal);
  assert.equal(agree[0]!.nativeOwners!.decided, true);
  assert.equal(agree[0]!.nativeOwners!.conflict, false);
  // A merged cell that omits the real room must not silently re-own the door.
  const mergedCells = [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["store"], rect(10.1, 0, 20, 10))];
  const kept = directoryDoorReviews(rooms, [d], [], [], native(mergedCells));
  assert.deepEqual(kept[0]!.portal, legacy[0]!.portal);
  assert.equal(kept[0]!.nativeOwners!.conflict, true);
  assert.equal(kept[0]!.nativeOwners!.decided, false);
  assert.deepEqual(kept[0]!.nativeOwners!.rooms, ["corridor", "store"]);
  const forced = directoryDoorReviews(rooms, [d], [], [], { mode: "native-cell", cells: mergedCells, overrideLegacy: true });
  assert.deepEqual(forced[0]!.portal!.rooms, ["corridor", "store"]);
  assert.equal(forced[0]!.nativeOwners!.decided, true);
  // An optional gap bound refuses a distant nearest owner.
  const far = [room("corridor", rect(0, 0, 8.5, 10)), room("office", rect(11.5, 0, 20, 10))];
  const farCells = [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["office"], rect(10.1, 0, 20, 10))];
  const bounded = nativeCellDoorOwners(far, door(), farCells, { maxOwnerGapFeet: 1 });
  assert.equal(bounded.rooms, undefined);
  assert.match(bounded.sides[0].reason!, /limit 1 ft/);
  // A reviewed link is never overridden by the native rule.
  const link = { doorId: 3, levelId: 1, rooms: ["corridor", "office"] as [string, string] };
  const linked = directoryDoorReviews(rooms, [d], [link], [link], { mode: "native-cell", cells: mergedCells, overrideLegacy: true });
  assert.deepEqual(linked[0]!.portal!.rooms, ["corridor", "office"]);
  assert.equal(linked[0]!.portal!.reviewed, true);
  assert.equal(linked[0]!.nativeOwners!.decided, false);
});

test("ties and non-walkable nearest rooms do not decide", () => {
  const rooms = [room("corridor", rect(0, 0, 9.9, 10)), room("a", rect(11, 0, 20, 10)), room("b", rect(11, 0, 20, 10))];
  const tie = nativeCellDoorOwners(rooms, door(), [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["a", "b"], rect(10.1, 0, 20, 10))]);
  assert.equal(tie.kind, "native-pair");
  assert.equal(tie.rooms, undefined);
  assert.match(tie.sides[1].reason!, /equally near/);
  const voids = [room("corridor", rect(0, 0, 9.9, 10)), room("shaft", rect(10.1, 0, 20, 10), { walkability: "void" })];
  const shaft = nativeCellDoorOwners(voids, door(), [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["shaft"], rect(10.1, 0, 20, 10))]);
  assert.equal(shaft.rooms, undefined);
  assert.match(shaft.sides[1].reason!, /not walkable/);
});

test("holes are excluded and steps beyond a thick jamb are bounded", () => {
  const rooms = [room("corridor", rect(0, 0, 9.9, 10)), room("office", rect(10.1, 0, 20, 10))];
  // Cell B has a hole right past the door face; the probe advances to 0.5 ft.
  const holed = [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["office"], rect(10.1, 0, 20, 10), rect(10.1, 3, 10.45, 8))];
  const owners = nativeCellDoorOwners(rooms, door(), holed);
  assert.equal(owners.sides[1].stepFeet, 0.5);
  assert.deepEqual(owners.rooms, ["corridor", "office"]);
  // A cell more than 1.5 ft past the face is not found.
  const far = [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["office"], rect(11.7, 0, 20, 10))];
  assert.equal(nativeCellDoorOwners(rooms, door(), far).kind, "one-side");
  assert.equal(nativeCellDoorOwners(rooms, { ...door(), normal: undefined }, holed).kind, "missing-threshold");
});

test("default behaviour is unchanged: same output, no native fields", () => {
  const rooms = [room("corridor", rect(0, 0, 10, 10)), room("office", rect(10, 0, 20, 10)), room("far", rect(11.5, 20, 20, 30))];
  const doors = [door(1), door(2, 24, 27, 11)];
  const before = directoryDoorReviews(rooms, doors);
  assert.deepEqual(directoryDoorReviews(rooms, doors, [], [], { mode: "legacy" }), before);
  assert.ok(before.every((r) => !("nativeOwners" in r)));
});

test("the default owner gap refuses an outline more than 2 ft from the side probe", () => {
  // The office outline starts 2.4 ft past the probe: native cells pair the
  // sides, but the default bound refuses to decide.
  const rooms = [room("corridor", rect(0, 0, 9.9, 10)), room("office", rect(12.75, 0, 20, 10))];
  const cells = [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["office"], rect(10.1, 0, 20, 10))];
  assert.equal(NATIVE_DOOR_OWNER_MAX_GAP_FEET, 2);
  const bounded = nativeCellDoorOwners(rooms, door(), cells);
  assert.equal(bounded.rooms, undefined);
  assert.match(bounded.sides[1].reason!, /limit 2 ft/);
  const [review] = directoryDoorReviews(rooms, [door()], [], [], native(cells));
  assert.equal(review!.state, "unmatched");
  const widened = nativeCellDoorOwners(rooms, door(), cells, { maxOwnerGapFeet: 3 });
  assert.deepEqual(widened.rooms, ["corridor", "office"]);
});

const shortOutlines = () => [room("corridor", rect(0, 0, 8.5, 10)), room("office", rect(11.5, 0, 20, 10))];
const wallCells = () => [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["office"], rect(10.1, 0, 20, 10))];
const semanticEvidence = {
  sourceModelSha256: "a".repeat(64),
  exporter: "fixture",
  nativeDoorUniqueId: "door-7-uid",
  phaseUniqueId: "phase-uid",
  fromNativeRoomUniqueId: "corridor-uid",
  toNativeRoomUniqueId: "office-uid",
};

test("a rejected explicit review stays unmatched in native mode, with its record preserved", () => {
  const rooms = shortOutlines(), cells = wallCells();
  // Rejected upstream: absent from the accepted links, kept in explicitReviews.
  const rejected = { doorId: 7, levelId: 1, rooms: ["corridor", "office"] as [string, string], semanticEvidence };
  const [legacy] = directoryDoorReviews(rooms, [door()], [], [rejected]);
  assert.equal(legacy!.state, "unmatched");
  assert.equal(legacy!.portal, undefined);
  assert.equal(legacy!.hasExplicitReview, true);
  assert.ok(!("nativeOwners" in legacy!));
  for (const matcher of [native(cells), { ...native(cells), overrideLegacy: true }]) {
    const [review] = directoryDoorReviews(rooms, [door()], [], [rejected], matcher);
    assert.equal(review!.state, "unmatched");
    assert.equal(review!.portal, undefined);
    assert.equal(review!.hasExplicitReview, true);
    assert.equal(review!.nativeOwners!.decided, false);
    // The native proposal is still reported as evidence, not applied.
    assert.deepEqual(review!.nativeOwners!.rooms, ["corridor", "office"]);
    assert.equal(review!.nativeOwners!.explicitReview!.status, "rejected");
    assert.deepEqual(review!.nativeOwners!.explicitReview!.link, rejected);
    assert.equal(review!.nativeOwners!.explicitReview!.link.semanticEvidence!.nativeDoorUniqueId, "door-7-uid");
    assert.match(review!.nativeOwners!.explicitReview!.reason, /not accepted upstream/);
    // Apart from the native diagnostic, the review equals the legacy one.
    const strip = (r: object) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "nativeOwners" && k !== "candidates"));
    assert.deepEqual(strip(review!), strip(legacy!));
  }
  // Another door on the same call without a review is still filled.
  const other = door(8, 4, 7, 10);
  const reviews = directoryDoorReviews(rooms, [door(), other], [], [rejected], native(cells));
  assert.equal(reviews[0]!.state, "unmatched");
  assert.equal(reviews[1]!.state, "connected");
  assert.equal(reviews[1]!.nativeOwners!.decided, true);
  assert.equal(reviews[1]!.nativeOwners!.explicitReview, undefined);
});

test("a rejected review keeps the legacy outcome even where native owners agree or conflict", () => {
  // Touching outlines: legacy connects, native agrees. Without a review the
  // native rule claims the decision; with a rejected review it does not.
  const touching = [room("corridor", rect(0, 0, 10, 10)), room("office", rect(10, 0, 20, 10)), room("store", rect(10, 6.9, 20, 10))];
  const d = door(3, 4, 6.5);
  const rejected = { doorId: 3, levelId: 1, rooms: ["corridor", "store"] as [string, string] };
  const [legacy] = directoryDoorReviews(touching, [d], [], [rejected]);
  assert.ok(legacy!.portal, "legacy matches this door by proximity (unchanged behaviour)");
  const agreeCells = [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["office", "store"], rect(10.1, 0, 20, 10))];
  const [agree] = directoryDoorReviews(touching, [d], [], [rejected], native(agreeCells));
  assert.deepEqual(agree!.portal, legacy!.portal);
  assert.equal(agree!.nativeOwners!.decided, false);
  assert.equal(agree!.nativeOwners!.explicitReview!.status, "rejected");
  // overrideLegacy never lets the native rule re-own a rejected door.
  const mergedCells = [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["store"], rect(10.1, 0, 20, 10))];
  const [forced] = directoryDoorReviews(touching, [d], [], [rejected], { mode: "native-cell", cells: mergedCells, overrideLegacy: true });
  assert.deepEqual(forced!.portal, legacy!.portal);
  assert.equal(forced!.nativeOwners!.decided, false);
  assert.equal(forced!.nativeOwners!.conflict, true);
});

test("an accepted review is applied as written in native mode", () => {
  const rooms = [room("corridor", rect(0, 0, 10, 10)), room("office", rect(10, 0, 20, 10)), room("store", rect(10, 6.9, 20, 10))];
  const d = door(3, 4, 6.5);
  // Native cells would pick the store; the accepted review names the office.
  const mergedCells = [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["store"], rect(10.1, 0, 20, 10))];
  const link = { doorId: 3, levelId: 1, rooms: ["office", "corridor"] as [string, string], semanticEvidence };
  const [legacy] = directoryDoorReviews(rooms, [d], [link], [link]);
  for (const matcher of [native(mergedCells), { ...native(mergedCells), overrideLegacy: true }]) {
    const [review] = directoryDoorReviews(rooms, [d], [link], [link], matcher);
    assert.equal(review!.state, "connected");
    assert.deepEqual(review!.portal, legacy!.portal);
    assert.deepEqual(review!.portal!.rooms, ["office", "corridor"], "order as reviewed");
    assert.equal(review!.portal!.reviewed, true);
    assert.equal(review!.nativeOwners!.decided, false);
    assert.equal(review!.nativeOwners!.explicitReview!.status, "accepted");
    assert.deepEqual(review!.nativeOwners!.explicitReview!.link, link);
  }
  // Where legacy outlines stop short, an accepted link naming the native
  // owners is applied (the owners are candidates) and marked reviewed.
  const accepted = { doorId: 7, levelId: 1, rooms: ["office", "corridor"] as [string, string] };
  const [short] = directoryDoorReviews(shortOutlines(), [door()], [accepted], [accepted], native(wallCells()));
  assert.equal(short!.state, "connected");
  assert.deepEqual(short!.portal!.rooms, ["office", "corridor"]);
  assert.equal(short!.portal!.reviewed, true);
  assert.equal(short!.nativeOwners!.decided, false);
});

test("the native gap bound is measured from the side probe, not the door centre", () => {
  // Thin wall: door centre x = 10, faces 9.9/10.1, half-width 0.1. The office
  // outline is 2.1 ft from the door centre (and 2.0 ft past the face).
  const rooms = [room("corridor", rect(0, 0, 9.9, 10)), room("office", rect(12.1, 0, 20, 10))];
  const cells = [cell("A", ["corridor"], rect(0, 0, 9.9, 10)), cell("B", ["office"], rect(10.1, 0, 20, 10))];
  // Legacy requires the outline within 2 ft of the centre AND within
  // half-width + 0.6 = 0.7 ft in X: it rejects the office.
  assert.deepEqual(doorCandidates(rooms, door()).map((r) => r.key), ["corridor"]);
  const [legacy] = directoryDoorReviews(rooms, [door()]);
  assert.equal(legacy!.state, "unmatched");
  // Native probes at 10.1 + 0.25 = 10.35 and finds the office 1.75 ft away,
  // inside the 2 ft default: equal numbers, different regions, so the native
  // mode widens reach here.
  const [review] = directoryDoorReviews(rooms, [door()], [], [], native(cells));
  assert.equal(review!.state, "connected");
  assert.deepEqual(review!.portal!.rooms, ["corridor", "office"]);
  assert.ok(Math.abs(review!.nativeOwners!.sides[1].ownerGapFeet! - 1.75) < 1e-9);
  assert.ok(Math.abs(review!.nativeOwners!.sides[1].probeFeet![0] - 10.35) < 1e-9);
  // Effective normal reach from the centre is depth + first step + 2 ft:
  // 0.1 + 0.25 + 2 = 2.35 ft here. Just inside accepts, just outside refuses.
  const at = (x: number) =>
    directoryDoorReviews([room("corridor", rect(0, 0, 9.9, 10)), room("office", rect(x, 0, 20, 10))], [door()], [], [], native(cells))[0]!.state;
  assert.equal(at(12.349), "connected");
  assert.equal(at(12.351), "unmatched");
});
