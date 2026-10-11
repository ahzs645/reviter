import assert from "node:assert/strict";
import test from "node:test";
import { directoryDoorReviews } from "../lib/reviter/directory-navigation.ts";
import { physicalLevelDoorReviews } from "../lib/reviter/native-physical-level-doors.ts";
import { nativeRecordOnPhysicalLevel } from "../lib/reviter/native-physical-level-records.ts";
import type { DirectoryRoom } from "../lib/reviter/room-directory.ts";
type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (key: string, levelId: number, ring: Point[]): DirectoryRoom => ({ key, levelId, name: key, polygonFeet: ring, labelPointFeet: ring[0]!, confidence: 1 });
const rec = (key: string, levelId: number, z: number, ring: Point[]) => ({ key, levelId, elevationFeet: z, ringsFeet: [ring], stair: false, walkable: true });
/** Floor 1 (#1, z 0) holds a corridor; the raised rotunda and its office are
 * registered on Floor 1 but stand on the Floor 1.25 slab (#2, z 3.28). */
function fixture() {
  const data = {
    nativeLevels: [{ id: 1, elevationFeet: 0 }, { id: 2, elevationFeet: 3.28 }],
    records: [rec("corridor", 1, 0, rect(0, 0, 10, 10)), rec("rotunda", 1, 3.28, rect(10, 0, 20, 10)), rec("office", 1, 3.28, rect(20, 0, 30, 10))],
    walkingSupport: { floors: [{ nativeElementId: 10, elevationFeet: 0, ringsFeet: [rect(0, 0, 10, 10)] }, { nativeElementId: 20, elevationFeet: 3.28, ringsFeet: [rect(10, 0, 30, 10)] }] },
    nativePhysicalLevels: { levels: [{ nativeLevelId: 1, elevationFeet: 0, nativeFloorElementIds: [10] }, { nativeLevelId: 2, elevationFeet: 3.28, nativeFloorElementIds: [20] }] },
  };
  const rooms = [room("corridor", 1, rect(0, 0, 10, 10)), room("rotunda", 1, rect(10, 0, 20, 10)), room("office", 1, rect(20, 0, 30, 10)), room("upper-hall", 2, rect(10, 10, 30, 20))];
  const door = { id: 77, point: [20, 5] as Point, halfWidth: 0.3, halfHeight: 1.5, footprint: rect(19.7, 3.5, 20.3, 6.5), normal: [1, 0] as Point };
  return { data, rooms, door };
}
test("a Floor 1.25 door joins rooms labelled on that physical level, identity levels unchanged", () => {
  const { data, rooms, door } = fixture();
  const reviews = directoryDoorReviews(rooms.filter((r) => r.levelId === 2), [door]);
  assert.ok(!reviews[0]!.portal, "identity-level matching finds no room for the door");
  const changed = physicalLevelDoorReviews(data as never, rooms, 2, reviews, [door]);
  assert.deepEqual(changed, [{ doorId: 77, roomKeys: reviews[0]!.portal!.rooms }]);
  assert.deepEqual([...reviews[0]!.portal!.rooms].sort(), ["office", "rotunda"]);
  assert.equal(reviews[0]!.state, "connected");
  assert.ok(rooms.every((r) => r.key === "upper-hall" ? r.levelId === 2 : r.levelId === 1), "room identity levels are untouched");
  for (const key of ["rotunda", "office"]) assert.ok(nativeRecordOnPhysicalLevel(data as never, data.records.find((r) => r.key === key)! as never, 2));
  assert.ok(!nativeRecordOnPhysicalLevel(data as never, data.records[0]! as never, 2), "a Floor 1 corridor is not on Floor 1.25");
});
test("an identity-level portal is kept and rooms on their own level are not re-matched", () => {
  const { data, rooms, door } = fixture();
  const reviews = directoryDoorReviews([room("a", 2, rect(15, 0, 20, 10)), room("b", 2, rect(20, 0, 25, 10))], [door]);
  assert.ok(reviews[0]!.portal);
  const before = JSON.stringify(reviews);
  assert.deepEqual(physicalLevelDoorReviews(data as never, rooms, 2, reviews, [door]), []);
  assert.equal(JSON.stringify(reviews), before);
  // Without physical evidence (no Floor 1.25 slab listed) nothing moves.
  const flat = { ...data, nativePhysicalLevels: { levels: [{ nativeLevelId: 1, elevationFeet: 0, nativeFloorElementIds: [10] }] } };
  const none = directoryDoorReviews([], [door]);
  assert.deepEqual(physicalLevelDoorReviews(flat as never, rooms, 2, none, [door]), []);
});
test("the runtime door-level rule mirrors the compiler", async () => {
  const { data } = fixture();
  const runtime = await import("../../openindoormaps/app/indoor-project/native-physical-level-records.ts");
  for (const r of data.records) for (const level of [1, 2]) assert.equal(runtime.nativeRecordOnPhysicalLevel(data as never, r as never, level), nativeRecordOnPhysicalLevel(data as never, r as never, level));
});
