import assert from "node:assert/strict";
import test from "node:test";
import { applyReviewedCirculationLinks, reviewedCirculationLinkSupport, validReviewedCirculationLinkEdge, validateReviewedCirculationLinks } from "../lib/reviter/reviewed-circulation-links.ts";
import { prepareNativeCirculationGeometry, attachNativeCirculationCellRoutes } from "../lib/reviter/native-circulation-geometry.ts";
import type { IndoorDataset, IndoorRecord } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const SHA = "a".repeat(64);
const record = (key: string, ring: Point[], extra: Partial<IndoorRecord> = {}): IndoorRecord => ({ key, number: key, name: key, building: "B", levelId: 1, elevationFeet: 0, elevationEvidence: "native", surfaceId: "B:1:0", circulation: true, stair: false, walkable: true, access: "unknown", confidence: 1, ringsFeet: [ring], properties: {}, ...extra });
const link = (points: [number, number, number][] = [[16, 5, 0], [5, 5, 0]]) => ({ id: "ramp-top:lobby", fromNodeId: "ramp:top", toNodeId: "a:lobby", pointsFeet: points, decision: { source: "decisions.json", id: "Q-link", summary: "Ramp top joins the lobby." } });
/** A slab 0..20; the certified envelope covers only 0..12 (the ramp head at
 * x 16 lies on the slab beyond it), so no native cell can attach the ramp top. */
async function fixture(links = [link()]) {
  const floor = { elementId: 100, categoryId: -2000032, boundsFeet: { min: { x: 0, y: 0, z: -1 }, max: { x: 20, y: 10, z: 0 } }, loops: [rect(0, 0, 20, 10).map((p) => [p[0], p[1], 0])] };
  const model = { elementBounds: [floor], levels: [{ levelId: 1, elevation: 0 }], nativeAssociatedLevelRelations: [] } as unknown as ConvertResult;
  const data = {
    source: { modelSha256: SHA },
    records: [record("lobby", rect(0, 0, 12, 10)), record("landing", rect(15, 4, 17, 6), { properties: { generatedLanding: true } }), record("office", rect(12, 7, 20, 10), { circulation: false, access: "staff" })],
    nativeLevels: [{ id: 1, name: "Floor 1", elevationFeet: 0 }], walls: [], doors: [],
    nodes: [
      { id: "a:lobby", roomKey: "lobby", kind: "arrival", levelId: 1, surfaceId: "B:1:0", pointFeet: [5, 5, 0] },
      { id: "a:lobby2", roomKey: "lobby", kind: "arrival", levelId: 1, surfaceId: "B:1:0", pointFeet: [2, 5, 0] },
      { id: "ramp:top", roomKey: "landing", kind: "connector", levelId: 1, surfaceId: "C:1:0", pointFeet: [16, 5, 0] },
    ],
    edges: [], alignment: { horizontalMetresPerFoot: 0.3048 }, report: { components: 0, largestComponentArrivals: 0 },
    walkingSupport: { version: 1, sourceModelSha256: SHA, floors: [{ nativeElementId: 100, elevationFeet: 0, ringsFeet: [rect(0, 0, 20, 10)] }] },
    reviewedCirculationLinks: { version: 1, sourceModelSha256: SHA, links },
  } as unknown as IndoorDataset;
  const { nativeIndoorEnvelopeHash } = await import("../lib/reviter/native-indoor-envelopes.ts");
  const source = { version: 1 as const, sourceModelSha256: SHA, levels: [{ levelId: 1, elevationFeet: 0, partsFeet: [[rect(0, 0, 12, 10)]], sourceElementIds: [100], cutElevationsFeet: [4, 8], evidenceSha256: "b".repeat(64) }] };
  data.nativeIndoorEnvelopes = { ...source, geometrySha256: await nativeIndoorEnvelopeHash(source) };
  data.circulationGeometry = prepareNativeCirculationGeometry(model, data).geometry;
  attachNativeCirculationCellRoutes(data);
  return data;
}
const runtimeBlocked = async (data: IndoorDataset) => {
  const { nativeCirculationWalkBlockers } = await import("../../openindoormaps/app/indoor-project/native-circulation.ts");
  const { createImmutableRoutingSession } = await import("../../openindoormaps/app/indoor-project/routing-cache.ts");
  return createImmutableRoutingSession(data as never)(() => nativeCirculationWalkBlockers(data as never));
};
test("a reviewed link joins an unattached ramp head to its lobby along the drawn path", async () => {
  const data = await fixture();
  assert.ok(!data.edges.some((e) => [e.from, e.to].includes("ramp:top")), "the native cells cannot attach the ramp head");
  const { applied, rejected } = applyReviewedCirculationLinks(data);
  assert.deepEqual(rejected, []);
  const edge = applied[0]!;
  assert.equal(edge.id, "reviewed-link:ramp-top:lobby");
  assert.equal(edge.kind, "walk");
  assert.deepEqual(edge.roomKeys, ["landing", "lobby"]);
  assert.equal(edge.accessible, "unknown");
  assert.ok(Math.abs(edge.lengthMetres - 11 * 0.3048) < 1e-9);
  assert.ok(validReviewedCirculationLinkEdge(data, edge));
  assert.ok(!(await runtimeBlocked(data)).has(edge.id), "runtime replays the same physical proof");
  // A rebuilt cell graph keeps the reviewed link identity.
  attachNativeCirculationCellRoutes(data);
  assert.ok(data.edges.some((e) => e.id === edge.id));
});
test("links that leave the slab, cross material or restricted places, or end at staff places are refused", async () => {
  const cases: [string, (d: IndoorDataset) => void, ReturnType<typeof link>[]?][] = [
    ["off the slab", () => {}, [link([[16, 5, 0], [16, 12, 0], [5, 12, 0], [5, 5, 0]])]],
    ["through a native wall", (d) => { d.walls.push({ levelId: 1, nativeElementId: 900, kind: "wall", approximate: false, ringsFeet: [rect(13, 0, 13.4, 10)] } as never); }],
    ["through a staff room", () => {}, [link([[16, 5, 0], [16, 8, 0], [5, 8, 0], [5, 5, 0]])]],
    ["staff end", (d) => { d.records.find((r) => r.key === "landing")!.access = "staff"; }],
    ["not ending at the node", () => {}, [link([[16, 5.5, 0], [5, 5, 0]])]],
    ["through an access zone", (d) => {
      d.records.push({ ...d.records[2]!, key: "staff-hall", ringsFeet: [rect(13, 3, 15, 7)], circulation: false });
      d.nativeAccessZones = { version: 1, sourceModelSha256: SHA, zones: [{ id: "z", levelId: 1, elevationFeet: 0, access: "staff", memberRoomKeys: ["staff-hall"], partsFeet: [[rect(13, 3, 15, 7)]], decision: { source: "d", id: "q", summary: "s" } }] };
    }],
  ];
  for (const [why, edit, links] of cases) {
    const data = await fixture(links);
    edit(data);
    const { applied, rejected } = applyReviewedCirculationLinks(data);
    assert.equal(applied.length, 0, why);
    assert.equal(rejected.length, 1, why);
    assert.equal(reviewedCirculationLinkSupport(data, data.reviewedCirculationLinks!.links[0]!).ok, false, why);
  }
});
test("a prepared link edge that no longer equals its reviewed link is blocked at runtime", async () => {
  const data = await fixture();
  const edge = applyReviewedCirculationLinks(data).applied[0]!;
  edge.pointsFeet = [[16, 5, 0], [10, 6, 0], [5, 5, 0]];
  assert.ok((await runtimeBlocked(data)).has(edge.id));
  assert.throws(() => validateReviewedCirculationLinks({ version: 1, sourceModelSha256: SHA, links: [{ ...link(), fromNodeId: "a:lobby" }] }), /Invalid reviewed circulation links/);
});
