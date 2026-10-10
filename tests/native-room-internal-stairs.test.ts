import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeSteppedRoomArrivals,
  roomInternalStairOwner,
  type NativeStairTreads,
} from "../lib/reviter/native-room-internal-stairs.ts";
import type { DirectoryRoom } from "../lib/reviter/room-directory.ts";
import type { IndoorDataset, IndoorRecord } from "../lib/reviter/indoor-contract.ts";

type P = [number, number];
type P3 = [number, number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const LOWER = 1, UPPER = 2;
const elevation = (id: number) => (id === LOWER ? -3.28 : id === UPPER ? 3.28 : undefined);
// Twelve seating treads rising from -3.28 (x = 4) to +3.28 (x = 40) inside the theatre outline.
const treads: P3[][] = Array.from({ length: 12 }, (_, i) => {
  const x0 = 4 + i * 3, z = -3.28 + (6.56 * (i + 1)) / 12;
  return [[x0, 2, z], [x0 + 3, 2, z], [x0 + 3, 18, z], [x0, 18, z]] as P3[];
});
const seating: NativeStairTreads = { stairElementId: 500, treads, lowFeet: -3.28, highFeet: 3.28 };
const theatreRoom: DirectoryRoom = { key: "theatre", levelId: UPPER, number: "08-166", building: "08", name: "Lecture Theatre", polygonFeet: rect(0, 0, 50, 20), labelPointFeet: [20, 10], confidence: 1 };
const storageRoom: DirectoryRoom = { key: "storage", levelId: UPPER, number: "08-162", building: "08", name: "AV Support Storage", polygonFeet: rect(0, 20, 10, 30), labelPointFeet: [5, 25], confidence: 1 };

test("steps held by one non-stair room are room-internal; a stair room of their own or a split footprint keeps them a flight", () => {
  assert.equal(roomInternalStairOwner(seating, [theatreRoom, storageRoom], elevation)?.key, "theatre");
  const stairRoom: DirectoryRoom = { ...storageRoom, key: "stair", name: "Stair 4", polygonFeet: rect(4, 2, 10, 18) };
  assert.equal(roomInternalStairOwner(seating, [theatreRoom, stairRoom], elevation), undefined);
  const listed: DirectoryRoom = { ...storageRoom, key: "s2", name: "Stair 5", stairFlightIds: [500] };
  assert.equal(roomInternalStairOwner(seating, [theatreRoom, listed], elevation), undefined);
  // Footprint split 50/50 between two rooms: neither holds 70%.
  const west: DirectoryRoom = { ...theatreRoom, key: "west", polygonFeet: rect(0, 0, 22, 20) };
  const east: DirectoryRoom = { ...theatreRoom, key: "east", polygonFeet: rect(22, 0, 50, 20) };
  assert.equal(roomInternalStairOwner(seating, [west, east], elevation), undefined);
  // A room on a floor outside the flight's span cannot own it.
  const above: DirectoryRoom = { ...theatreRoom, key: "above", levelId: 9 };
  assert.equal(roomInternalStairOwner(seating, [above], (id) => (id === 9 ? 14.4 : elevation(id))), undefined);
});

const record = (r: DirectoryRoom, elevationFeet: number): IndoorRecord => ({
  key: r.key, number: r.number ?? "", name: r.name ?? "", building: "08", levelId: r.levelId, elevationFeet,
  elevationEvidence: "Recovered slab #10", surfaceId: "", circulation: false, stair: false, access: "unknown",
  walkable: true, confidence: 1, ringsFeet: [r.polygonFeet], properties: {},
});
const model = {
  elementBounds: [{ elementId: 501, categoryId: -2000044, boundsFeet: { min: { x: 4, y: 2, z: -3.28 }, max: { x: 40, y: 18, z: 3.28 } }, stairTreads: treads }],
  nativeStairAssemblies: [{ stairElementId: 500, runAndLandingIds: [501], stringerIds: [], railingIds: [] }],
} as never;
const dataset = (records: IndoorRecord[]) => ({
  nativeLevels: [{ id: LOWER, name: "Floor 0.5", elevationFeet: -3.28 }, { id: UPPER, name: "Floor 1.25", elevationFeet: 3.28 }],
  records,
  walkingSupport: { version: 1, sourceModelSha256: "x", floors: [
    { nativeElementId: 10, elevationFeet: -3.28, ringsFeet: [rect(0, 0, 40, 30)] },
    { nativeElementId: 11, elevationFeet: 3.28, ringsFeet: [rect(40, 0, 60, 30)] },
  ] },
  nativePhysicalLevels: { version: 1, sourceModelSha256: "x", displayAliases: [], levels: [
    { nativeLevelId: LOWER, sourceName: "Floor 0.5", elevationFeet: -3.28, nativeFloorElementIds: [10], nativeStairElementIds: [500], annotationLevel: true },
    { nativeLevelId: UPPER, sourceName: "Floor 1.25", elevationFeet: 3.28, nativeFloorElementIds: [11], nativeStairElementIds: [], annotationLevel: true },
  ] },
}) as unknown as Pick<IndoorDataset, "nativeLevels" | "records" | "walkingSupport" | "nativePhysicalLevels">;

test("a stepped theatre arrives on its top aisle at the identity level; a relabelled room without steps keeps its source arrival", () => {
  const arrivals = nativeSteppedRoomArrivals(model, dataset([record(theatreRoom, -3.28), record(storageRoom, -3.28)]), [theatreRoom, storageRoom]);
  assert.deepEqual([...arrivals.keys()], ["theatre"]);
  const a = arrivals.get("theatre")!;
  assert.equal(a.levelId, UPPER);
  assert.equal(a.elevationFeet, 3.28);
  assert.deepEqual(a.stairElementIds, [500]);
  assert.deepEqual(a.aisleNativeFloorIds, [11]);
  // Inside the top aisle (outline ∩ Floor 1.25 slab = 40..50 x 0..20), never on the steps.
  assert.ok(a.pointFeet[0] > 40 && a.pointFeet[0] < 50 && a.pointFeet[1] > 0 && a.pointFeet[1] < 20, JSON.stringify(a.pointFeet));
  // A room that is supported at its own level is not stepped even if it holds the steps.
  const flat = dataset([record(theatreRoom, 3.28)]);
  (flat.walkingSupport!.floors[1] as { ringsFeet: P[][] }).ringsFeet = [rect(0, 0, 60, 30)];
  assert.equal(nativeSteppedRoomArrivals(model, flat, [theatreRoom]).size, 0);
});
