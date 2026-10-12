import assert from "node:assert/strict";
import test from "node:test";
import { prepareNativeCirculationGeometry, attachNativeCirculationCellRoutes, nativeCirculationGeometryKey } from "../lib/reviter/native-circulation-geometry.ts";
import { nativeAccessZoneBinding } from "../lib/reviter/native-access-zones.ts";
import type { IndoorDataset, IndoorRecord } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const record = (key: string, ring: Point[], extra: Partial<IndoorRecord> = {}): IndoorRecord => ({ key, number: key, name: key, building: "B", levelId: 1, elevationFeet: 0, elevationEvidence: "native", surfaceId: "B:1:0", circulation: true, stair: false, walkable: true, access: "unknown", confidence: 1, ringsFeet: [ring], properties: {}, ...extra });
const node = (id: string, roomKey: string, p: Point) => ({ id, roomKey, kind: "arrival", levelId: 1, surfaceId: "B:1:0", pointFeet: [p[0], p[1], 0] });
const SHA = "a".repeat(64);
const zone = (members = ["staffA", "staffB"], parts = [[rect(20, 0, 40, 10)]]) => ({
  version: 1 as const, sourceModelSha256: SHA,
  zones: [{ id: "access-zone:1:staff-halls", levelId: 1, elevationFeet: 0, access: "staff" as const, memberRoomKeys: members, staffCirculationRoomKeys: members.filter((k) => k.startsWith("staff")), partsFeet: parts, decision: { source: "decisions.json", id: "Q-staff", summary: "Staff halls are one staff area carved out of the shared face." } }],
});
/** One open native slab: two public halls west, two staff halls east, no wall
 * between them. Without a reviewed zone the staff majority rejects the face. */
async function fixture(zones?: ReturnType<typeof zone>) {
  const floor = { elementId: 100, categoryId: -2000032, boundsFeet: { min: { x: 0, y: 0, z: -1 }, max: { x: 40, y: 10, z: 0 } }, loops: [rect(0, 0, 40, 10).map((p) => [p[0], p[1], 0])] };
  const model = { elementBounds: [floor], levels: [{ levelId: 1, elevation: 0 }], nativeAssociatedLevelRelations: [] } as unknown as ConvertResult;
  const data = {
    source: { modelSha256: SHA },
    records: [record("hallA", rect(0, 0, 10, 10)), record("hallB", rect(10, 0, 20, 10)), record("staffA", rect(20, 0, 30, 10), { access: "staff", circulation: false }), record("staffB", rect(30, 0, 40, 10), { access: "staff", circulation: false })],
    nativeLevels: [{ id: 1, name: "Floor 1", elevationFeet: 0 }], walls: [], doors: [],
    nodes: [node("a:hallA", "hallA", [5, 5]), node("a:hallB", "hallB", [15, 5]), node("a:staffA", "staffA", [25, 5]), node("a:staffB", "staffB", [35, 5])],
    edges: [], alignment: { horizontalMetresPerFoot: 0.3048 }, report: { components: 0, largestComponentArrivals: 0 },
    walkingSupport: { version: 1, sourceModelSha256: SHA, floors: [{ nativeElementId: 100, elevationFeet: 0, ringsFeet: [rect(0, 0, 40, 10)] }] },
    ...(zones ? { nativeAccessZones: zones } : {}),
  } as unknown as IndoorDataset;
  const { nativeIndoorEnvelopeHash } = await import("../lib/reviter/native-indoor-envelopes.ts");
  const source = { version: 1 as const, sourceModelSha256: SHA, levels: [{ levelId: 1, elevationFeet: 0, partsFeet: [[rect(0, 0, 40, 10)]], sourceElementIds: [100], cutElevationsFeet: [4, 8], evidenceSha256: "b".repeat(64) }] };
  data.nativeIndoorEnvelopes = { ...source, geometrySha256: await nativeIndoorEnvelopeHash(source) };
  data.circulationGeometry = prepareNativeCirculationGeometry(model, data).geometry;
  return data;
}
const runtime = async (data: IndoorDataset) => {
  const { nativeCirculationCells, nativeCirculationWalkBlockers } = await import("../../openindoormaps/app/indoor-project/native-circulation.ts");
  const { createImmutableRoutingSession } = await import("../../openindoormaps/app/indoor-project/routing-cache.ts");
  const { projectLinkPolicy } = await import("../../openindoormaps/app/indoor-project/route-policy.ts");
  const session = createImmutableRoutingSession(data as never);
  const cells = session(() => nativeCirculationCells(data as never)).map((c) => c.id);
  const blocked = session(() => nativeCirculationWalkBlockers(data as never));
  const records = new Map(data.records.map((r) => [r.key, r]));
  const policy = (id: string) => session(() => projectLinkPolicy(records as never, data.edges.find((e) => e.id === id)! as never, [], true, "public", SHA, data as never));
  return { cells, blocked, policy };
};
const between = (data: IndoorDataset, a: string, b: string) => data.edges.find((e) => e.nativeCellId && [e.from, e.to].includes(a) && [e.from, e.to].includes(b));

test("without a reviewed zone a staff-majority shared face keeps no circulation at all", async () => {
  const data = await fixture();
  assert.equal(data.circulationGeometry!.cells.length, 0);
});
test("a reviewed staff zone carves the shared face: public remainder routes, zone is staff-only circulation", async () => {
  const data = await fixture(zone());
  const cells = data.circulationGeometry!.cells;
  const publicCell = cells.find((c) => !c.accessZoneId)!, staffCell = cells.find((c) => c.accessZoneId)!;
  assert.deepEqual(publicCell.roomKeys, ["hallA", "hallB"]);
  assert.equal(staffCell.accessZoneId, "access-zone:1:staff-halls");
  assert.deepEqual(staffCell.roomKeys, ["staffA", "staffB"]);
  attachNativeCirculationCellRoutes(data);
  const pub = between(data, "a:hallA", "a:hallB"), staff = between(data, "a:staffA", "a:staffB");
  assert.ok(pub && staff, "both the public remainder and the staff zone get walking branches");
  assert.deepEqual(pub.roomKeys, ["hallA", "hallB"]);
  assert.deepEqual(staff.roomKeys, ["staffA", "staffB"], "zone branches carry every zone identity");
  assert.ok(!data.edges.some((e) => e.nativeCellId && [e.from, e.to].some((id) => id.includes("staff")) && [e.from, e.to].some((id) => id.includes("hall"))), "no branch crosses between the remainder and the zone");
  const r = await runtime(data);
  assert.deepEqual(r.cells.sort(), cells.map((c) => c.id).sort(), "runtime accepts the remainder and the bound zone cell");
  assert.ok(!r.blocked.has(pub.id) && !r.blocked.has(staff.id), "both branches replay physically");
  assert.equal(r.policy(pub.id).blockers.length, 0, "the public remainder branch is open publicly");
  assert.ok(r.policy(staff.id).blockers.some((b) => b.kind === "staff"), "the zone branch is staff-only on the public profile");
});
test("staff circulation members are marked as metadata only", async () => {
  const { applyNativeAccessZoneMetadata } = await import("../lib/reviter/native-access-zones.ts");
  const data = await fixture(zone());
  applyNativeAccessZoneMetadata(data);
  const staffA = data.records.find((r) => r.key === "staffA")!;
  assert.deepEqual(staffA.properties.staffCirculation, { zoneId: "access-zone:1:staff-halls", decisionId: "Q-staff" });
  assert.equal(staffA.access, "staff");
  assert.equal(staffA.circulation, false);
});
test("an incomplete, public, unrestricted or misplaced zone is refused and the face stays rejected", async () => {
  for (const [why, z] of [
    ["unlisted staff identity inside the zone", zone(["staffA"])],
    ["no restricted member", zone(["hallB"], [[rect(10, 0, 20, 10)]])],
    ["member mostly outside", zone(["staffA", "staffB", "hallB"])],
    ["public member", (() => { const v = zone(); return v; })()],
  ] as const) {
    const data = await fixture(z as never);
    if (why === "public member") {
      data.records.find((r) => r.key === "staffB")!.access = "public";
      data.circulationGeometry = prepareNativeCirculationGeometry({ elementBounds: [{ elementId: 100, categoryId: -2000032, boundsFeet: { min: { x: 0, y: 0, z: -1 }, max: { x: 40, y: 10, z: 0 } }, loops: [rect(0, 0, 40, 10).map((p) => [p[0], p[1], 0])] }], levels: [{ levelId: 1, elevation: 0 }], nativeAssociatedLevelRelations: [] } as never, data).geometry;
    }
    const binding = nativeAccessZoneBinding(data);
    assert.equal(binding.zones.length, 0, why);
    assert.ok(binding.issues.length > 0, why);
    assert.ok(!data.circulationGeometry!.cells.some((c) => c.accessZoneId), why);
    assert.ok(!data.circulationGeometry!.cells.some((c) => c.roomKeys.includes("hallA") && c.roomKeys.includes("staffA")), why);
  }
});
test("runtime refuses a stale public cell that straddles a zone and a zone cell that dropped an identity", async () => {
  const plain = await fixture();
  const stale = await fixture(zone());
  // A face compiled without the zone cannot be reused once the zone exists:
  // the geometry key changes, so no prepared branch survives.
  assert.notEqual(nativeCirculationGeometryKey(plain), nativeCirculationGeometryKey(stale));
  const tampered = await fixture(zone());
  attachNativeCirculationCellRoutes(tampered);
  const staffCell = tampered.circulationGeometry!.cells.find((c) => c.accessZoneId)!;
  staffCell.roomKeys = ["staffA"];
  const r = await runtime(tampered);
  assert.ok(!r.cells.includes(staffCell.id), "zone cell without every zone identity is refused");
  const straddle = await fixture(zone());
  const pub = straddle.circulationGeometry!.cells.find((c) => !c.accessZoneId)!;
  pub.exactFaceId = straddle.circulationGeometry!.cells.find((c) => c.accessZoneId)!.exactFaceId;
  const s = await runtime(straddle);
  assert.ok(!s.cells.includes(pub.id), "a non-zone cell over zone parts is refused");
});
