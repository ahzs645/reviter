import test from "node:test";
import assert from "node:assert/strict";
import { buildIndoorGrid } from "../lib/reviter/indoor-grid.ts";
import {
  nativeRouteBlocker,
  containsRoomPoint,
  type DirectoryRoom,
  type RoomPoint,
} from "../lib/reviter/room-directory.ts";
const rectangle = (x: number, y: number, w: number, h: number): RoomPoint[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const room = (key: string, polygon: RoomPoint[]): DirectoryRoom => ({
  key,
  levelId: 1,
  building: "01",
  name: "Hallway",
  polygonFeet: polygon,
  labelPointFeet: [1, 1],
  confidence: 1,
});
const terminals = [
  { id: "a", roomKey: "r", point: [1, 5] as RoomPoint, maxSnapFeet: 1 },
  { id: "b", roomKey: "r", point: [9, 5] as RoomPoint, maxSnapFeet: 1 },
];
const connected = (grid: ReturnType<typeof buildIndoorGrid>) => {
  const q = ["a"],
    seen = new Set(q);
  for (let i = 0; i < q.length; i++)
    for (const b of grid.branches) {
      const next = b.from === q[i] ? b.to : b.to === q[i] ? b.from : undefined;
      if (next && !seen.has(next)) {
        seen.add(next);
        q.push(next);
      }
    }
  return seen.has("b");
};
test("thin walls block full grid edges and long portal segments across intermediate bins", () => {
  const barrier = rectangle(5, 0, 0.02, 10),
    r = room("r", rectangle(0, 0, 10, 10));
  assert.equal(
    connected(
      buildIndoorGrid(
        [r],
        [],
        terminals,
        { walls: [{ polygon: barrier }], columns: [] },
        [],
      ),
    ),
    false,
  );
  assert.equal(
    nativeRouteBlocker(
      { walls: [{ polygon: rectangle(15, 0, 0.01, 5) }], columns: [] },
      [],
    )([0, 2], [30, 2]),
    true,
  );
});
test("a verified opening permits only its precise wall footprint", () => {
  const r = room("r", rectangle(0, 0, 10, 10)),
    barriers = {
      walls: [{ polygon: rectangle(4.9, 0, 0.2, 10) }],
      columns: [],
    };
  const opening = {
    rooms: ["r", "r"] as [string, string],
    point: [5, 5] as RoomPoint,
    from: [4, 5] as RoomPoint,
    to: [6, 5] as RoomPoint,
    halfWidth: 1,
    halfHeight: 1,
    footprint: rectangle(4, 4, 2, 2),
  };
  assert.equal(
    connected(buildIndoorGrid([r], [], terminals, barriers, [opening])),
    true,
  );
  assert.equal(nativeRouteBlocker(barriers, [opening])([4, 2], [6, 2]), true);
});
test("void holes and staff masks veto overlapping circulation; corners cannot join", () => {
  const r = {
    ...room("r", rectangle(0, 0, 10, 10)),
    floorOpeningsFeet: [rectangle(4, 0, 2, 10)],
  };
  assert.equal(
    connected(
      buildIndoorGrid([r], [], terminals, { walls: [], columns: [] }, []),
    ),
    false,
  );
  assert.equal(
    connected(
      buildIndoorGrid(
        [room("r", rectangle(0, 0, 10, 10))],
        [room("staff", rectangle(4, 0, 2, 10))],
        terminals,
        { walls: [], columns: [] },
        [],
      ),
    ),
    false,
  );
});
test("forest compression preserves hole detours and rejects unsupported arrival snaps", () => {
  const r = {
    ...room("r", rectangle(0, 0, 10, 10)),
    holesFeet: [rectangle(4, 4, 2, 2)],
  };
  const grid = buildIndoorGrid(
    [r],
    [],
    terminals,
    { walls: [], columns: [] },
    [],
  );
  assert.equal(connected(grid), true);
  for (const branch of grid.branches)
    for (let i = 1; i < branch.points.length; i++) {
      const a = branch.points[i - 1]!,
        b = branch.points[i]!;
      for (let t = 0; t <= 1; t += 0.05)
        assert.equal(
          containsRoomPoint(
            [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
            r.holesFeet[0]!,
          ),
          false,
        );
    }
  const invalid = buildIndoorGrid(
    [r],
    [],
    [{ id: "outside", roomKey: "r", point: [20, 20], maxSnapFeet: 1 }],
    { walls: [], columns: [] },
    [],
  );
  assert.deepEqual(invalid.missing, ["outside"]);
  assert.deepEqual(
    buildIndoorGrid([r], [], terminals, { walls: [], columns: [] }, [])
      .branches,
    grid.branches,
  );
});
