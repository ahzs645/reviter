import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeSteppedRoomArrivals,
  roomInternalStairForeignLandingLevels,
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

// Stair #1644499 (run #1644524): native routing treads and the old 09-201 Corridor outline
// (level 1450417, Floor 0.5), which reaches onto the B7 floor and holds 84.7% of the treads.
// Slabs clipped to x 96..124, y 440..464: B7 Floor 1 #400238 (level 311, z 0) and the
// B9 Floor 0.5 lobby #1521516 (level 1450417, z -3.28).
const B7_F1 = 311, B9_F05 = 1450417, F05_Z = -3.2808398950131235;
const lobbyTreads: P3[][] = [[113.415, 112.478, -2.1872], [112.478, 111.542, -1.6404], [111.542, 110.606, -1.0936], [110.606, 109.669, -0.5468], [109.669, 108.733, 0]]
  .map(([x1, x0, z]) => [[x1!, 449.474, z!], [x0!, 449.474, z!], [x0!, 457.267, z!], [x1!, 457.267, z!]] as P3[]);
const lobbyStair: NativeStairTreads = { stairElementId: 1644499, treads: lobbyTreads, lowFeet: F05_Z, highFeet: -0.164 };
const corridor: DirectoryRoom = {
  key: "rm-1450417-f65fe5d929e4", levelId: B9_F05, number: "09-201", building: "09", name: "Corridor", labelPointFeet: [139.229, 454.387], confidence: 0.9,
  polygonFeet: [[101.52, 442.96], [106.32, 442.96], [106.72, 444.56], [111.92, 444.16], [111.92, 448.56], [107.92, 448.16], [107.52, 450.16], [114.72, 449.76], [114.72, 446.16], [119.52, 446.16], [119.52, 449.76], [154.32, 449.76], [154.32, 446.16], [163.52, 446.16], [163.52, 449.76], [165.12, 449.76], [165.52, 443.36], [172.72, 442.96], [178.72, 447.76], [178.72, 449.36], [179.92, 450.16], [179.92, 452.96], [174.32, 452.96], [171.92, 455.36], [171.12, 460.96], [161.52, 460.56], [161.12, 459.76], [151.52, 460.56], [148.32, 460.56], [147.92, 459.76], [99.92, 460.56], [99.92, 446.16]],
  holesFeet: [[[107.92, 456.56], [107.92, 458.56], [147.52, 458.16], [147.12, 456.56]]],
};
const lobbyLevels = (b7Lists: boolean) => ({
  nativeLevels: [{ id: B9_F05, elevationFeet: F05_Z }, { id: B7_F1, elevationFeet: 0 }],
  records: [],
  walkingSupport: { floors: [
    { nativeElementId: 400238, elevationFeet: 0, ringsFeet: [[[96, 440], [112.852, 440], [112.852, 448.818], [108.262, 448.818], [108.262, 449.474], [108.741, 449.474], [108.741, 457.799], [107.954, 457.799], [107.954, 460.752], [104.148, 460.752], [104.148, 461.054], [99.727, 461.054], [99.727, 458.437], [96, 458.437]]] as P[][] },
    { nativeElementId: 1521516, elevationFeet: F05_Z, ringsFeet: [[[99.079, 461.054], [99.727, 461.054], [99.727, 458.437], [99.5, 458.437], [99.5, 444.65], [99.766, 444.65], [99.766, 442.435], [107.203, 442.435], [107.203, 442.124], [109.832, 442.124], [109.832, 442.435], [112.852, 442.435], [112.852, 440], [124, 440], [124, 461.556], [109.069, 461.556], [109.069, 462.861], [104.476, 462.861], [104.476, 464], [99.079, 464]]] as P[][] },
  ] },
  nativePhysicalLevels: { levels: [
    { nativeLevelId: B9_F05, elevationFeet: F05_Z, nativeFloorElementIds: [1521516] },
    { nativeLevelId: B7_F1, elevationFeet: 0, nativeFloorElementIds: b7Lists ? [400238] : [] },
  ] },
});
const lobbyElevation = (id: number) => (id === B9_F05 ? F05_Z : id === B7_F1 ? 0 : undefined);

test("a flight joining two native levels is never room-internal (#1644499: B9 Floor 0.5 lobby to B7 Floor 1)", () => {
  // Footprint rule alone: 09-201 holds >=70% of the treads.
  assert.equal(roomInternalStairOwner(lobbyStair, [corridor], lobbyElevation)?.number, "09-201");
  // The head tread lands on B7 slab #400238 of Floor 1, neither 09-201's level nor a physical level of it.
  assert.deepEqual(roomInternalStairForeignLandingLevels(lobbyStair, corridor, lobbyLevels(true)), [B7_F1]);
  assert.equal(roomInternalStairOwner(lobbyStair, [corridor], lobbyElevation, lobbyLevels(true)), undefined);
  // A slab no level lists is not evidence.
  assert.equal(roomInternalStairOwner(lobbyStair, [corridor], lobbyElevation, lobbyLevels(false))?.number, "09-201");
});

test("theatre seating landing on its own and its physical level stays room-internal; a head with no slab within a riser stays too", () => {
  const data = dataset([record(theatreRoom, -3.28)]);
  // Foot on Floor 0.5 (the theatre's physical level), head on Floor 1.25 (its own level).
  assert.deepEqual(roomInternalStairForeignLandingLevels(seating, theatreRoom, data), []);
  assert.equal(roomInternalStairOwner(seating, [theatreRoom, storageRoom], elevation, data)?.key, "theatre");
  // Without the physical-level assignment the Floor 0.5 foot is another level.
  assert.deepEqual(roomInternalStairForeignLandingLevels(seating, theatreRoom, dataset([])), [LOWER]);
  // Raised seating (07-238 shape): head slab more than one riser above the top tread.
  const raised: NativeStairTreads = { ...seating, treads: seating.treads.map(t => t.map(p => [p[0], p[1], p[2] - 1.5] as P3)) };
  const high = dataset([record(theatreRoom, -3.28)]);
  assert.deepEqual(roomInternalStairForeignLandingLevels(raised, { key: "theatre", levelId: 99 }, high), []);
});
