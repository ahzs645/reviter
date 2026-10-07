import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import pc from "polygon-clipping";
import { recoverRegisteredRoomInteriors } from "../lib/reviter/registered-room-presentation.ts";
import {
  containsRoomPoint,
  roomArea,
  type RoomPoint,
} from "../lib/reviter/room-directory.ts";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/unbc-reviewed-prep-office-merge.json", import.meta.url),
    "utf8",
  ),
);
const clone = () => structuredClone(fixture);
const run = (f: typeof fixture) =>
  recoverRegisteredRoomInteriors(
    f.dataset,
    f.annotations,
    f.reference,
    new Map([
      [
        f.geometry.cutElevation ? f.annotations[0].levelId : 1487816,
        f.geometry,
      ],
    ]),
    new Set([f.roomKey]),
    new Map(f.dataset.records.map((r: { key: string }) => [r.key, f.floors])),
  );
const area = (parts: pc.MultiPolygon) =>
  parts.reduce(
    (s, r) =>
      s +
      roomArea(r[0] as RoomPoint[]) -
      r.slice(1).reduce((s, h) => s + roomArea(h as RoomPoint[]), 0),
    0,
  );
const inside = (p: RoomPoint, rings: RoomPoint[][]) =>
  containsRoomPoint(p, rings[0]) &&
  !rings.slice(1).some((h) => containsRoomPoint(p, h));
test("actual reviewed Prep/Research Office merge uses normal registered/native compiler without rewriting source", () => {
  const f = clone(),
    before = JSON.stringify(f),
    out = run(f),
    r = out.rooms.find((r) => r.roomKey === f.roomKey);
  assert.ok(r, JSON.stringify(out.diagnostics));
  for (const key of [f.roomKey, f.donorKey])
    assert.ok(
      inside(
        f.annotations.find((a: { key: string }) => a.key === key)
          .labelPointFeet,
        r.ringsFeet,
      ),
      "Every merged source label must remain inside",
    );
  assert.deepEqual(
    r.sourceProof.modelReviewedDividerIndices,
    [200, 201, 204, 205],
  );
  assert.ok(r.boundaryEvidence.includes("Precise native wall/column faces"));
  assert.ok(r.sourceCoverage > 0.99 && r.cellCoverage > 0.9);
  assert.equal(area(pc.difference(r.ringsFeet, ...f.floors)), 0);
  for (const n of f.baselineSourceClaims)
    assert.ok(
      area(pc.intersection(r.ringsFeet, n.ringsFeet)) <= 0.002,
      n.number,
    );
  for (const w of f.dataset.walls)
    assert.ok(
      area(pc.intersection(r.ringsFeet, w.ringsFeet)) <= 0.002,
      "native wall " + w.nativeElementId,
    );
  for (const i of [200, 201, 204, 205])
    assert.ok(!r.sourceProof.wallSegmentIndices.includes(i));
  assert.equal(JSON.stringify(f), before);
  assert.equal(
    f.annotations.find((a: { key: string }) => a.key === f.donorKey).status,
    "deleted",
  );
});
test("a third authored label cannot be absorbed into the reviewed combined room", () => {
  const f = clone(),
    donor = structuredClone(
      f.annotations.find((a: { key: string }) => a.key === f.donorKey),
    );
  donor.key = "review-third-label";
  donor.number = "08-other";
  donor.status = "active";
  delete donor.mergedInto;
  donor.labelPointFeet = [78, 589];
  donor.polygonFeet = [
    [77.5, 588.5],
    [78.5, 588.5],
    [78.5, 589.5],
    [77.5, 589.5],
  ];
  f.annotations.push(donor);
  f.dataset.records.push({
    ...f.dataset.records.find((r: { key: string }) => r.key === f.roomKey),
    key: donor.key,
    number: donor.number,
    ringsFeet: [donor.polygonFeet],
  });
  assert.equal(run(f).rooms.length, 0);
});
test("stale internal divider evidence cannot recover the combined identity", () => {
  const f = clone();
  f.reference.sections[0].wallSegments[200][0][1] += 0.2;
  const out = run(f);
  assert.equal(out.rooms.length, 0);
});
test("a native floor opening at an original merged label prevents combined recovery", () => {
  const f = clone(),
    p = f.annotations.find(
      (a: { key: string }) => a.key === f.donorKey,
    ).labelPointFeet;
  const hole: pc.Polygon = [
    [
      [p[0] - 1, p[1] - 1],
      [p[0] + 1, p[1] - 1],
      [p[0] + 1, p[1] + 1],
      [p[0] - 1, p[1] + 1],
    ],
  ];
  f.floors = pc.difference(f.floors, hole);
  f.dataset.walkingSupport.floors = f.floors.map(
    (ringsFeet: RoomPoint[][]) => ({
      nativeElementId: 1514723,
      elevationFeet: f.dataset.records[0].elevationFeet,
      ringsFeet,
    }),
  );
  const out = run(f);
  assert.equal(out.rooms.length, 0);
});
