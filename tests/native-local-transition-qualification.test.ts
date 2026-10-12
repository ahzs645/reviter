import assert from "node:assert/strict";
import test from "node:test";
import { nativeStairRunTreads } from "../lib/reviter/indoor-stair-run-surfaces.ts";
import { nativeStairInventoryReconciliation } from "../lib/reviter/native-source-stair-receipts.ts";
import { qualifyNativeLocalTransitions } from "../lib/reviter/native-local-transition-qualification.ts";
import { validNativeSourceStairBinding, nativeStairRouteQualified } from "../lib/reviter/native-source-stair.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
type P2 = [number, number];
const SHA = "a".repeat(64);
const ring = (a: number, b: number, w = 3): P2[] => [[a, 0], [b, 0], [b, w], [a, w]];
/** Rectangle top face as two up-facing triangles at height z. */
const top = (r: P2[], z: number) => [[r[0]!, r[1]!, r[2]!], [r[0]!, r[2]!, r[3]!]].map((t) => t.map((p) => [p[0], p[1], z]));
/** A box body (all six faces) for a foreign element. */
const box = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number) => {
  const q = (a: number[], b: number[], c: number[], d: number[]) => [[a, b, c], [a, c, d]];
  return [
    ...q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), ...q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]),
    ...q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), ...q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]),
  ];
};
function mesh(owned: [number, number[][][]][]) {
  const positions: number[] = [], indices: number[] = [], elementIds: number[] = [];
  for (const [id, tris] of owned) for (const t of tris) { for (const p of t) { indices.push(positions.length / 3); positions.push(p[0]!, p[1]!, p[2]!); } elementIds.push(id); }
  return { name: "native", source: "native-brep", positions, indices, elementIds, colors: [], materialIndex: 0 };
}
/** Floor 1 slab 100 (z 0) | three risers of 0.5 ft | Floor 2 slab 101 (z 1.5).
 * The run's sketch profiles (cache stairTreads) report each tread one riser
 * high; its native BRep up-faces carry the true heights 0.5 and 1.0. The top
 * tread stops 0.05 ft short of slab 101; a 0.15 ft native nosing lip at 1.25 ft
 * spans that riser line. */
function fixture(options: { lip?: boolean; wall?: boolean; finish?: boolean } = {}) {
  const lip = options.lip ?? true;
  const t1 = ring(0.5, 1.5), t2 = ring(1.5, 2.45), nosing = ring(2.4, 2.55);
  const owned: [number, number[][][]][] = [[11, [...top(t1, 0.5), ...top(t2, 1), ...(lip ? top(nosing, 1.25) : [])]]];
  if (options.wall) owned.push([300, box(1.0, 0.5, 1.2, 2.5, 0, 3)]);
  // The run's Treads/Risers finish occupies the run's own bounds: walking body, not foreign.
  if (options.finish) owned.push([12, box(0.5, 0, 2.55, 3, 0, 1.25)]);
  const floors = [{ elementId: 100, z: 0, r: ring(-2, 0.5) }, { elementId: 101, z: 1.5, r: ring(2.5, 5) }];
  const model = {
    origin: { x: 0, y: 0, z: 0 },
    levels: [{ levelId: 1, elevation: 0 }, { levelId: 2, elevation: 1.5 }],
    elementBounds: [
      ...floors.map((f) => ({ elementId: f.elementId, categoryId: -2000032, boundsFeet: { min: { x: f.r[0]![0], y: 0, z: f.z - 0.5 }, max: { x: f.r[2]![0], y: 3, z: f.z } }, loops: [f.r.map((p) => [...p, f.z])] })),
      { elementId: 10, categoryId: -2000120, boundsFeet: { min: { x: 0.5, y: 0, z: 0 }, max: { x: 2.55, y: 3, z: 1.5 } } },
      { elementId: 11, categoryId: -2000919, boundsFeet: { min: { x: 0.5, y: 0, z: 0 }, max: { x: 2.55, y: 3, z: 1.25 } }, stairTreads: [ring(0.5, 1.5), ring(1.5, 2.5)].map((r, i) => r.map((p) => [...p, 1 + 0.5 * i])), stairBeginWithRiser: true, stairEndWithRiser: true },
      ...(options.finish ? [{ elementId: 12, categoryId: -2000921, boundsFeet: { min: { x: 0.5, y: 0, z: 0 }, max: { x: 2.55, y: 3, z: 1.25 } } }] : []),
      ...(options.wall ? [{ elementId: 300, categoryId: -2000011, boundsFeet: { min: { x: 1.0, y: 0.5, z: 0 }, max: { x: 1.2, y: 2.5, z: 3 } } }] : []),
    ],
    meshes: [mesh(owned)],
    nativeStairAssemblies: [{ stairElementId: 10, runAndLandingIds: [11], stringerIds: [], railingIds: [], supportIds: [] }],
    nativeHostRelations: [],
  };
  return { model, floors };
}
async function dataset(f: ReturnType<typeof fixture>) {
  const { prepareIndoorStairDisplay } = await import("../lib/reviter/indoor-stair-display.ts");
  const record = (key: string, levelId: number, z: number, r: P2[]) => ({ key, number: key, name: key, building: "B", levelId, elevationFeet: z, elevationEvidence: "native", surfaceId: `B:${levelId}:${z}`, circulation: true, stair: false, walkable: true, access: "unknown", confidence: 1, ringsFeet: [r], properties: {} });
  const data = {
    source: { modelSha256: SHA }, alignment: { horizontalMetresPerFoot: 0.3048 },
    nativeLevels: [{ id: 1, name: "Floor 1", elevationFeet: 0 }, { id: 2, name: "Floor 2", elevationFeet: 1.5 }],
    records: [record("low", 1, 0, ring(-2, 0.5)), record("high", 2, 1.5, ring(2.5, 5))],
    nodes: [], edges: [], doors: [], walls: [],
    walkingSupport: { version: 1, sourceModelSha256: SHA, floors: f.floors.map((x) => ({ nativeElementId: x.elementId, elevationFeet: x.z, ringsFeet: [x.r], partsFeet: [[x.r]] })) },
    nativeIndoorEnvelopes: { version: 1, sourceModelSha256: SHA, levels: [], geometrySha256: "c".repeat(64) },
  } as unknown as IndoorDataset;
  data.stairDisplay = prepareIndoorStairDisplay(f.model as never, data);
  return data;
}
const recipe = { id: "steps-a", kind: "local-steps" as const, evidence: "user-reported" as const, nativeStairId: 10, floorElementIds: [100, 101] as [number, number], endpoints: [{ building: "B", levelId: 1, point: [0, 1.5] as P2, roomKey: "low" }, { building: "B", levelId: 2, point: [3, 1.5] as P2, roomKey: "high" }] as [never, never] };

test("native BRep tread faces resolve a sketch inventory that sits one riser high", async () => {
  const f = fixture();
  const brep = nativeStairRunTreads(f.model as never).get(11)!;
  assert.deepEqual(brep.map((t) => t.elevationFeet), [0.5, 1]);
  const run = f.model.elementBounds.find((e) => e.elementId === 11) as unknown as { stairTreads: number[][][] };
  const cache = run.stairTreads.map((t: number[][]) => ({ runElementId: 11, elevationFeet: t[0]![2]!, ringFeet: t.map((p: number[]) => [p[0]!, p[1]!] as P2) }));
  const r = nativeStairInventoryReconciliation(brep, cache);
  assert.equal(r.relation, "one-riser-offset");
  assert.equal(r.offsetFeet, 0.5);
  assert.equal(nativeStairInventoryReconciliation(brep, cache.map((t) => ({ ...t, ringFeet: t.ringFeet.map((p) => [p[0] + 0.6, p[1]] as P2) }))).relation, "disagree");
  const data = await dataset(f);
  assert.equal(data.stairDisplay!.sourceFlights![0]!.supportFaces?.length, 1, "the nosing lip is recorded as plan support, not a tread");
});
test("a reviewed local-steps recipe qualifies as a not-step-free native stair connector", async () => {
  const data = await dataset(fixture());
  const { qualified, refused } = qualifyNativeLocalTransitions(fixture().model as never, data, [recipe as never], () => [0, 0]);
  assert.deepEqual(refused, []);
  const { edge, nodes } = qualified[0]!;
  assert.equal(edge.kind, "local-steps");
  assert.equal(edge.accessible, "no");
  assert.deepEqual(nodes.map((n) => [n.roomKey, n.levelId, n.pointFeet[2]]), [["low", 1, 0], ["high", 2, 1.5]]);
  assert.deepEqual(edge.nativeSourceStair!.treads.map((t) => t.elevationFeet), [0.5, 1]);
  assert.equal(edge.nativeSourceStair!.supportFaces?.length, 1);
  const d = { ...data, nodes, edges: [edge] } as IndoorDataset;
  assert.ok(validNativeSourceStairBinding(d, edge) && nativeStairRouteQualified(d, edge));
  const runtime = await import("../../openindoormaps/app/indoor-project/native-source-stair.ts");
  assert.ok(runtime.validNativeSourceStairBinding(d as never, edge as never), "runtime replays the same receipt");
  const tampered = structuredClone(edge);
  tampered.nativeSourceStair!.supportFaces![0]!.ringFeet[0]![0] -= 0.2;
  assert.equal(validNativeSourceStairBinding({ ...d, edges: [tampered] } as IndoorDataset, tampered), false, "a support lip must be the flight's own native face");
  assert.equal(runtime.validNativeSourceStairBinding({ ...d, edges: [tampered] } as never, tampered as never), false);
});
test("the run's own Treads/Risers finish is walking body, not foreign material", async () => {
  const f = fixture({ finish: true });
  const out = qualifyNativeLocalTransitions(f.model as never, await dataset(f), [recipe as never], () => [0, 0]);
  assert.equal(out.qualified.length, 1, JSON.stringify(out.refused));
  assert.ok(!out.qualified[0]!.edge.nativeSourceStair!.foreignMaterial.sourceElementIds.includes(12));
});
test("a riser line without its native lip, foreign material in the path or a wrong recipe slab is refused", async () => {
  for (const [why, f, r] of [
    ["no native lip across the top riser", fixture({ lip: false }), recipe],
    ["a wall crosses the walking path", fixture({ wall: true }), recipe],
    ["recipe names another slab", fixture(), { ...recipe, floorElementIds: [100, 999] }],
  ] as const) {
    const data = await dataset(f);
    const out = qualifyNativeLocalTransitions(f.model as never, data, [r as never], () => [0, 0]);
    assert.equal(out.qualified.length, 0, why);
    assert.equal(out.refused.length, 1, why);
    assert.match(out.refused[0]!.reason, why.startsWith("no native") ? /No complete two-foot/ : why.startsWith("a wall") ? /foreign material crosses the 2 ft walking path: elements 300/ : /recipe names 100\/999/, why);
  }
});
