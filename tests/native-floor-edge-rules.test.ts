import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveNativeFloorEdgeRows,
  nativeFloorEdgeCorrectionsAt,
  nativeFloorEdgeRowsSha256,
  validateNativeFloorEdgeRules,
  NATIVE_FLOOR_EDGE_RULE_IDS,
  type NativeFloorEdgeConnector,
  type NativeFloorEdgeRules,
} from "../lib/reviter/native-floor-edge-rules.ts";
import { nativeFloorEdgeConnectors } from "../lib/reviter/native-floor-edge-connectors.ts";
import { supplementNativeIndoorEnvelopes, validateNativeIndoorEnvelopeSupplements } from "../lib/reviter/native-indoor-envelope-supplement.ts";
import { nativeIndoorEnvelopeHash, verifyNativeIndoorEnvelopes, type NativeIndoorEnvelopes } from "../lib/reviter/native-indoor-envelopes.ts";

type P = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const hole = (x0: number, y0: number, x1: number, y1: number): P[] => rect(x0, y0, x1, y1).reverse();
const MODEL = "a".repeat(64);
const settings = (rules: NativeFloorEdgeRules["rules"]): NativeFloorEdgeRules => ({ version: 1, sourceModelSha256: MODEL, rules, decisionId: "owner-decision#floor-edge" });
const ALL = settings(["step", "drop-edge", "void-edge"]);
const e = 0, CUTS = [0.1, 4];
const wall = (id: number, r: P[]) => ({ nativeElementId: id, partsFeet: [[r]] });

/** Run the production supplement for one level with the given walls per cut. */
async function supplement(input: { walls: Record<number, ReturnType<typeof wall>[]>; floors: { nativeElementId: number; elevationFeet: number; partsFeet: P[][][] }[]; floorEdge?: { settings: NativeFloorEdgeRules; connectors: NativeFloorEdgeConnector[] } }) {
  const level = { levelId: 7, elevationFeet: e, partsFeet: [[rect(500, 500, 501, 501)]], sourceElementIds: [99], cutElevationsFeet: CUTS, evidenceSha256: "b".repeat(64) };
  const base = { version: 1 as const, sourceModelSha256: MODEL, levels: [level] };
  const envelopes = { ...base, geometrySha256: await nativeIndoorEnvelopeHash(base) } as NativeIndoorEnvelopes;
  const materialSections = { levels: CUTS.map((c) => ({ levelId: 7, elevationFeet: e, cutElevationFeet: c, sections: input.walls[c]!.map((m) => ({ ...m, kind: "wall" })) })) };
  return supplementNativeIndoorEnvelopes({ envelopes, model: MODEL, materialSections: materialSections as never, walkingSupportFloors: input.floors, doors: [], ...(input.floorEdge ? { floorEdge: input.floorEdge } : {}) });
}

// Lower room x 0..10 (own slab z 0); a platform slab at z +2 ft x 10..20 inside the same walls at +4 ft,
// open to the east under the platform at the ankle cut (the platform's own edge is the only boundary).
const stepWalls = {
  0.1: [wall(1, rect(0, 0, 10, 0.3)), wall(2, rect(0, 0, 0.3, 10)), wall(3, rect(0, 9.7, 10, 10))],
  4: [wall(1, rect(0, 0, 20, 0.3)), wall(2, rect(0, 0, 0.3, 10)), wall(3, rect(0, 9.7, 20, 10)), wall(4, rect(19.7, 0, 20, 10))],
};
const stepFloors = [
  { nativeElementId: 100, elevationFeet: e, partsFeet: [[rect(0, 0, 10, 10)]] },
  { nativeElementId: 200, elevationFeet: e + 2, partsFeet: [[rect(10, 0, 30, 10)]] },
];

test("step rule: a slab within 4 ft above the ankle cut is solid there and closes the lower room", async () => {
  assert.equal((await supplement({ walls: stepWalls, floors: stepFloors })).supplements.length, 0, "without the rule the ankle cut leaks under the platform");
  const r = await supplement({ walls: stepWalls, floors: stepFloors, floorEdge: { settings: settings(["step"]), connectors: [] } });
  assert.equal(r.supplements.length, 1);
  assert.ok(Math.abs(r.supplements[0]!.areaSqFt - 9.7 * 9.4) < 1e-6, `own floor inside the walls only, got ${r.supplements[0]!.areaSqFt}`);
  const row = r.floorEdgeRows.find((x) => x.sourceSlabNativeElementId === 200)!;
  assert.equal(row.rule, NATIVE_FLOOR_EDGE_RULE_IDS.step);
  assert.deepEqual([row.baseElevationFeet, row.topElevationFeet], [-2, 2]);
  assert.equal(nativeFloorEdgeCorrectionsAt(r.floorEdgeRows, 0.1).length, 1);
  assert.equal(nativeFloorEdgeCorrectionsAt(r.floorEdgeRows, 4).length, 0, "the platform is below the +4 ft cut: not solid there");
  const f = r.supplements[0]!.floorEdge!;
  assert.deepEqual(f.rowIds, [row.id]);
  assert.deepEqual(f.rules, [NATIVE_FLOOR_EDGE_RULE_IDS.step]);
  assert.equal(f.decisionId, "owner-decision#floor-edge");
  assert.equal(f.rowsSha256, nativeFloorEdgeRowsSha256([row]));
  assert.ok(!r.supplements[0]!.assumptionIds.includes(row.id), "an adopted rule row is not an unreviewed assumption");
  await verifyNativeIndoorEnvelopes(r.envelopes, MODEL);
  validateNativeIndoorEnvelopeSupplements(r.envelopes);
});

test("step rule yields to a stair that climbs onto the platform; the room stays enclosed", async () => {
  const stair: NativeFloorEdgeConnector = { id: "stair:900", kind: "stair", sources: ["native"], bottomElevationFeet: e, topElevationFeet: e + 2, footprintFeet: [[rect(10, 4, 12, 6)]] };
  // a flight that starts ON the platform and climbs to the next storey does not cross this step
  const unrelated: NativeFloorEdgeConnector = { id: "stair:901", kind: "stair", sources: ["native"], bottomElevationFeet: e + 2, topElevationFeet: e + 14, footprintFeet: [[rect(14, 4, 16, 6)]] };
  const r = await supplement({ walls: stepWalls, floors: stepFloors, floorEdge: { settings: settings(["step"]), connectors: [unrelated, stair] } });
  const row = r.floorEdgeRows[0]!;
  assert.deepEqual(row.yieldedConnectorIds, ["stair:900"], "only a connector spanning the step yields");
  assert.ok(Math.abs(row.areaSqFt - (200 - 4)) < 1e-6, "the stair footprint is removed from the row and nothing else");
  assert.ok(Math.abs(r.supplements[0]!.areaSqFt - 9.7 * 9.4) < 1e-6, "same walking area");
  assert.deepEqual(r.supplements[0]!.floorEdge!.yieldedConnectorIds, ["stair:900"]);
});

// Upper level (own slab x 0..10, z 0) whose east edge drops 3 ft onto a lobby slab x 10..40 that runs
// out under the building; walls bound only the upper floor's west/north/south at both cuts.
const dropWalls = {
  0.1: [wall(1, rect(0, 0, 10, 0.3)), wall(2, rect(0, 0, 0.3, 10)), wall(3, rect(0, 9.7, 10, 10))],
  4: [wall(1, rect(0, 0, 10, 0.3)), wall(2, rect(0, 0, 0.3, 10)), wall(3, rect(0, 9.7, 10, 10))],
};
const dropFloors = (dz: number) => [
  { nativeElementId: 100, elevationFeet: e, partsFeet: [[rect(0, 0, 10, 10)]] },
  { nativeElementId: 300, elevationFeet: e - dz, partsFeet: [[rect(5, 0, 40, 10)]] },
];

test("drop-edge rule: the lower slab beyond this level's own floor bounds it; the own floor is never covered", async () => {
  assert.equal((await supplement({ walls: dropWalls, floors: dropFloors(3) })).supplements.length, 0);
  const r = await supplement({ walls: dropWalls, floors: dropFloors(3), floorEdge: { settings: settings(["drop-edge"]), connectors: [] } });
  const row = r.floorEdgeRows.find((x) => x.rule === NATIVE_FLOOR_EDGE_RULE_IDS["drop-edge"])!;
  assert.ok(Math.abs(row.areaSqFt - 300) < 1e-6, "only the part the own floor does not cover (x 10..40)");
  assert.deepEqual([row.baseElevationFeet, row.topElevationFeet], [0.05, 7]);
  assert.ok(Math.abs(r.supplements[0]!.areaSqFt - 9.7 * 9.4) < 1e-6);
  for (const dz of [0.4, 8.5]) assert.equal(deriveNativeFloorEdgeRows({ levelId: 7, elevationFeet: e, cutElevationsFeet: CUTS, floors: dropFloors(dz), settings: settings(["drop-edge"]) }).length, 0, `a ${dz} ft drop is outside the rule`);
});

test("drop-edge rule yields to a ramp down the edge; a gap the connector leaves stays bounded by the rest of the row", async () => {
  const ramp: NativeFloorEdgeConnector = { id: "ramp:950", kind: "ramp", sources: ["native", "recipe"], bottomElevationFeet: -3, topElevationFeet: 0, footprintFeet: [[rect(10, 4, 16, 6)]], attachmentsFeet: [[rect(16, 4, 17, 6)]] };
  const r = await supplement({ walls: dropWalls, floors: dropFloors(3), floorEdge: { settings: settings(["drop-edge"]), connectors: [ramp] } });
  const row = r.floorEdgeRows[0]!;
  assert.deepEqual(row.yieldedConnectorIds, ["ramp:950"]);
  assert.ok(Math.abs(row.areaSqFt - (300 - 14)) < 1e-6, "footprint and attachment both stay clear");
  assert.ok(Math.abs(r.supplements[0]!.areaSqFt - 9.7 * 9.4) < 1e-6);
});

test("void-edge rule: an unfilled own-slab hole is a barrier at every cut up to +7 ft; a filled hole is floor", () => {
  const slab = { nativeElementId: 500, elevationFeet: e, partsFeet: [[rect(0, 0, 20, 20), hole(5, 5, 15, 15)]] };
  const rows = deriveNativeFloorEdgeRows({ levelId: 7, elevationFeet: e, cutElevationsFeet: CUTS, floors: [slab], settings: settings(["void-edge"]) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, `${NATIVE_FLOOR_EDGE_RULE_IDS["void-edge"]}:7:500:0.1`);
  assert.deepEqual(rows[0]!.sourceHole, { partIndex: 0, ringIndex: 1 });
  assert.ok(Math.abs(rows[0]!.areaSqFt - 100) < 1e-9);
  for (const dz of [-0.4, 2]) {
    const filled = deriveNativeFloorEdgeRows({ levelId: 7, elevationFeet: e, cutElevationsFeet: CUTS, floors: [slab, { nativeElementId: 501, elevationFeet: e + dz, partsFeet: [[rect(5, 5, 15, 15)]] }], settings: settings(["void-edge"]) });
    assert.equal(filled.filter((r) => r.rule === NATIVE_FLOOR_EDGE_RULE_IDS["void-edge"]).length, 0, `dz ${dz}`);
  }
  const deep = deriveNativeFloorEdgeRows({ levelId: 7, elevationFeet: e, cutElevationsFeet: CUTS, floors: [slab, { nativeElementId: 502, elevationFeet: e - 11, partsFeet: [[rect(0, 0, 20, 20)]] }], settings: settings(["void-edge"]) });
  assert.equal(deep.length, 1, "a floor a full storey below does not fill an atrium");
  const stairWell: NativeFloorEdgeConnector = { id: "stair:960", kind: "stair", sources: ["native"], bottomElevationFeet: -11, topElevationFeet: 0, footprintFeet: [[rect(5, 5, 8, 15)]] };
  const yielded = deriveNativeFloorEdgeRows({ levelId: 7, elevationFeet: e, cutElevationsFeet: CUTS, floors: [slab], connectors: [stairWell], settings: settings(["void-edge"]) });
  assert.deepEqual(yielded[0]!.yieldedConnectorIds, ["stair:960"]);
  assert.ok(Math.abs(yielded[0]!.areaSqFt - 70) < 1e-9);
  // a flight whose last tread stops a tread thickness (0.164 ft) short of the slab top it arrives on
  // still ends at this edge; one that stops 0.6 ft short (a landing below) does not
  const short = (dz: number) => deriveNativeFloorEdgeRows({ levelId: 7, elevationFeet: e, cutElevationsFeet: CUTS, floors: [slab], settings: settings(["void-edge"]),
    connectors: [{ ...stairWell, id: "stair:961", topElevationFeet: e - dz }] })[0]!.yieldedConnectorIds;
  assert.deepEqual(short(0.164), ["stair:961"]);
  assert.deepEqual(short(0.6), []);
});

test("rows are deterministic: input order does not change ids, geometry or checksum", () => {
  const floors = [...stepFloors, ...dropFloors(3).slice(1), { nativeElementId: 500, elevationFeet: e, partsFeet: [[rect(50, 0, 70, 20), hole(55, 5, 65, 15)]] }];
  const connectors: NativeFloorEdgeConnector[] = [
    { id: "stair:900", kind: "stair", sources: ["native"], bottomElevationFeet: e, topElevationFeet: e + 2, footprintFeet: [[rect(10, 4, 12, 6)]] },
    { id: "ramp:950", kind: "ramp", sources: ["recipe"], bottomElevationFeet: -3, topElevationFeet: 0, footprintFeet: [[rect(30, 4, 36, 6)]] },
  ];
  const a = deriveNativeFloorEdgeRows({ levelId: 7, elevationFeet: e, cutElevationsFeet: CUTS, floors, connectors, settings: ALL });
  const b = deriveNativeFloorEdgeRows({ levelId: 7, elevationFeet: e, cutElevationsFeet: [...CUTS].reverse(), floors: [...floors].reverse(), connectors: [...connectors].reverse(), settings: ALL });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(nativeFloorEdgeRowsSha256(a), nativeFloorEdgeRowsSha256(b));
  assert.deepEqual(a.map((r) => r.rule).sort(), [NATIVE_FLOOR_EDGE_RULE_IDS["drop-edge"], NATIVE_FLOOR_EDGE_RULE_IDS["void-edge"], NATIVE_FLOOR_EDGE_RULE_IDS.step].sort());
  assert.ok(a.every((r) => r.decisionId === ALL.decisionId && r.id.startsWith(`${r.rule}:7:`)));
});

test("settings and provenance are validated; untagged rule rows are refused", async () => {
  assert.throws(() => validateNativeFloorEdgeRules({ ...ALL, rules: ["step", "guess" as never] }), /Invalid native floor-edge/);
  assert.throws(() => validateNativeFloorEdgeRules({ ...ALL, decisionId: " " }), /Invalid native floor-edge/);
  assert.throws(() => validateNativeFloorEdgeRules(ALL, "c".repeat(64)), /Invalid native floor-edge/);
  validateNativeFloorEdgeRules(undefined);
  await assert.rejects(supplement({ walls: stepWalls, floors: stepFloors.map(({ nativeElementId: _, ...f }) => f) as never, floorEdge: { settings: ALL, connectors: [] } }), /native element id/);
  const r = await supplement({ walls: stepWalls, floors: stepFloors, floorEdge: { settings: settings(["step"]), connectors: [] } });
  const tamper = (edit: (s: Record<string, unknown>) => void) => {
    const copy = structuredClone(r.envelopes) as unknown as { levels: { supplements?: Record<string, unknown>[] }[] };
    edit(copy.levels[0]!.supplements![0]!);
    return () => validateNativeIndoorEnvelopeSupplements(copy as unknown as NativeIndoorEnvelopes);
  };
  assert.throws(tamper((s) => { delete s.floorEdge; }), /without their provenance/);
  assert.throws(tamper((s) => { (s.floorEdge as { rowIds: string[] }).rowIds = []; }), /floor-edge provenance/);
  assert.throws(tamper((s) => { s.assumptionIds = [...(s.correctionIds as string[])]; }), /floor-edge provenance/);
});

test("native and recipe connectors come from the source stairs and ramps only", () => {
  const model = {
    elementBounds: [
      { elementId: 10, categoryId: -2000120, boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 2, z: 2 } } },
      { elementId: 11, categoryId: -2000919, boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 2, z: 2 } }, stairTreads: [[[0, 0, 0.5], [1, 0, 0.5], [1, 2, 0.5], [0, 2, 0.5]], [[1, 0, 1], [2, 0, 1], [2, 2, 1], [1, 2, 1]]] },
      { elementId: 20, categoryId: -2000180, boundsFeet: { min: { x: 10, y: 0, z: -3 }, max: { x: 16, y: 2, z: 0 } }, loops: [[[10, 0, -3], [16, 0, 0], [16, 2, 0], [10, 2, -3]]] },
      { elementId: 30, categoryId: -2000032, boundsFeet: { min: { x: 0, y: 0, z: 0 }, max: { x: 9, y: 9, z: 0 } }, loops: [[[0, 0, 0], [9, 0, 0], [9, 9, 0]]] },
    ],
    nativeStairAssemblies: [{ stairElementId: 10, runAndLandingIds: [11], stringerIds: [], railingIds: [], supportIds: [], evidence: "runs", spiralRunIds: [], shape: "undetermined" }],
  };
  const c = nativeFloorEdgeConnectors(model as never, { localStairIds: [10] });
  assert.deepEqual(c.map((x) => [x.id, x.kind, x.sources, x.bottomElevationFeet, x.topElevationFeet, x.footprintFeet.length]), [
    ["stair:10", "stair", ["native", "recipe"], 0, 2, 2],
    ["ramp:20", "ramp", ["native"], -3, 0, 1],
  ]);
});
