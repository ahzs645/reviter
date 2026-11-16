import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachNativeCirculation } from "../lib/reviter/native-circulation-links.ts";
import { attachNativeCirculationResumable } from "../scripts/indoor/native-landing-approaches.ts";
import { LANDING_SCOPED_COLLECTIONS, LandingScopeViolation, createLandingPlaneScope } from "../scripts/indoor/landing-approach-scope.ts";
import { nativeIndoorEnvelopeHash } from "../lib/reviter/native-indoor-envelopes.ts";
import { initializeNativeExactGeosOverlay } from "../lib/reviter/native-exact-geos-overlay.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

type P = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const PLANES = [{ id: 1, z: 0, floor: 100 }, { id: 2, z: 12, floor: 200 }, { id: 3, z: 24, floor: 300 }];
const SHA = "a".repeat(64);

/** Strict native campus in miniature: per plane, a generated landing, a
 * corridor with two arrivals, its exact envelope and one reviewed patch wall. */
async function fixture(): Promise<{ model: ConvertResult; data: IndoorDataset }> {
  const records: unknown[] = [], nodes: unknown[] = [], elementBounds: unknown[] = [], levels: unknown[] = [], walls: unknown[] = [];
  for (const p of PLANES) {
    elementBounds.push({ elementId: p.floor, categoryId: -2000032, boundsFeet: { min: { x: 0, y: 0, z: p.z - 1 }, max: { x: 40, y: 10, z: p.z } }, loops: [rect(0, 0, 40, 10).map((q) => [...q, p.z])] });
    const rec = (key: string, x0: number, x1: number, properties = {}) => ({ key, number: key, name: "Corridor", building: "B", levelId: p.id, elevationFeet: p.z, elevationEvidence: "native", surfaceId: `${key}:s`, circulation: true, stair: false, walkable: true, access: "unknown", confidence: 1, ringsFeet: [rect(x0, 0.5, x1, 9.5)], properties });
    records.push(rec(`landing:${p.id}`, 0.5, 8, { nativeFloorId: p.floor, generatedLanding: true }), rec(`hall${p.id}`, 8, 39.5));
    const node = (id: string, roomKey: string, kind: string, x: number) => ({ id, roomKey, kind, levelId: p.id, surfaceId: `${roomKey}:s`, pointFeet: [x, 5, p.z], geographic: [0, 0] });
    nodes.push(node(`landing-node:${p.id}`, `landing:${p.id}`, "connector", 4), node(`hall-near:${p.id}`, `hall${p.id}`, "arrival", 14), node(`hall-far:${p.id}`, `hall${p.id}`, "arrival", 30));
    levels.push({ levelId: p.id, elevationFeet: p.z, partsFeet: [[rect(0.5, 0.5, 39.5, 9.5)]], sourceElementIds: [p.floor], cutElevationsFeet: [p.z + 4, p.z + 8], evidenceSha256: "b".repeat(64) });
    walls.push({ id: `patch:${p.id}`, kind: "wall", levelId: p.id, nativeElementId: 900 + p.id, reviewPatchId: `patch-${p.id}`, ringsFeet: [rect(20, 0.5, 20.4, 3)] });
  }
  const envelopes = { version: 1 as const, sourceModelSha256: SHA, levels };
  const data = {
    source: { modelSha256: SHA }, nativeLevels: PLANES.map((p) => ({ id: p.id, name: "F" + p.id, elevationFeet: p.z })),
    records, nodes, walls, doors: [], edges: [], alignment: { horizontalMetresPerFoot: 0.3048 }, report: {},
    walkingSupport: { version: 1, sourceModelSha256: SHA, floors: PLANES.map((p) => ({ nativeElementId: p.floor, elevationFeet: p.z, ringsFeet: [rect(0, 0, 40, 10)] })) },
    nativeIndoorEnvelopes: { ...envelopes, geometrySha256: await nativeIndoorEnvelopeHash(envelopes as never) },
  } as unknown as IndoorDataset;
  const model = { elementBounds, levels: PLANES.map((p) => ({ levelId: p.id, elevation: p.z })), nativeAssociatedLevelRelations: [], nativeHostRelations: [] } as unknown as ConvertResult;
  return { model, data };
}
const wire = (r: { edges: unknown; diagnostics: unknown }) => JSON.stringify({ edges: r.edges, diagnostics: r.diagnostics });
const run = (model: ConvertResult, data: IndoorDataset, dir: string, extra = {}) =>
  attachNativeCirculationResumable(model, data, { checkpointDir: dir, scopedReuse: true, ...extra });
async function scratch<T>(body: (dir: string) => Promise<T>) {
  await initializeNativeExactGeosOverlay();
  const dir = await mkdtemp(join(tmpdir(), "landing-scope-"));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("scoped landing reuse reproduces serial output and reuses every unchanged pair", () => scratch(async (dir) => {
  const { model, data } = await fixture();
  const serial = attachNativeCirculation(model, data);
  assert.ok(serial.edges.length >= PLANES.length, "fixture produces landing approaches on every plane");
  const t0 = performance.now(), first = await run(model, data, dir), cold = performance.now() - t0;
  assert.equal(wire(first), wire(serial));
  const s = first.receipt.scoped!;
  assert.equal(s.completeEvaluated, 0, "no scope violation in the strict fixture");
  assert.equal(s.scopedEvaluated, first.receipt.evaluated);
  assert.deepEqual(s.planes.map((p) => p.violations), [0, 0, 0]);
  const fresh = await fixture(), t1 = performance.now(), again = await run(fresh.model, fresh.data, dir), warm = performance.now() - t1;
  assert.equal(wire(again), wire(serial));
  assert.equal(again.receipt.evaluated, 0);
  assert.equal(again.receipt.scoped!.reusedScoped, first.receipt.evaluated);
  console.log(JSON.stringify({ fixturePairs: first.receipt.pairs, evaluated: first.receipt.evaluated, coldMs: Math.round(cold), warmMs: Math.round(warm) }));
}));

test("a change on one plane recomputes exactly that plane's pairs", () => scratch(async (dir) => {
  const { model, data } = await fixture();
  const first = await run(model, data, dir);
  const perPlane = first.receipt.evaluated / PLANES.length;
  // Move plane 12's reviewed patch wall so it now blocks its corridor.
  const changed = await fixture();
  (changed.data.walls as { levelId: number; ringsFeet: P[][] }[]).find((w) => w.levelId === 2)!.ringsFeet = [rect(20, 0.5, 20.4, 9.5)];
  const serial = attachNativeCirculation(changed.model, changed.data);
  assert.notEqual(wire(serial), wire(attachNativeCirculation(model, data)), "the change matters to plane 12's results");
  const t0 = performance.now(), second = await run(changed.model, changed.data, dir), ms = performance.now() - t0;
  assert.equal(wire(second), wire(serial));
  assert.equal(second.receipt.scoped!.reusedScoped, first.receipt.evaluated - perPlane, "the other two planes are reused");
  assert.equal(second.receipt.evaluated, perPlane, "only plane 12 is evaluated");
  console.log(JSON.stringify({ oneOfThreePlanesChanged: { evaluated: second.receipt.evaluated, reused: second.receipt.reused, ms: Math.round(ms) } }));
  // Every scoped kind of input on a plane invalidates that plane only.
  for (const edit of [
    (d: IndoorDataset) => { (d.records.find((r) => r.key === "hall1")!.ringsFeet[0]![2] as P)[0] = 39; },
    (d: IndoorDataset) => { d.nodes.find((n) => n.id === "hall-far:1")!.pointFeet[1] = 6; },
    (d: IndoorDataset) => { (d.walls as unknown as { levelId: number; ringsFeet: P[][] }[]).find((w) => w.levelId === 1)!.ringsFeet[0]![0]![1] = 0.6; },
  ]) {
    const variant = await fixture();
    edit(variant.data);
    const r = await run(variant.model, variant.data, dir);
    assert.equal(wire(r), wire(attachNativeCirculation(variant.model, variant.data)));
    assert.ok(r.receipt.evaluated > 0 && r.receipt.evaluated <= perPlane, "only plane 0 can be recomputed: " + JSON.stringify(r.receipt.scoped));
  }
  // Unscoped inputs (here the whole model) invalidate every plane.
  const model2 = await fixture();
  (model2.model.elementBounds[0] as { loops: number[][][] }).loops[0]![1]![0] = 39.9;
  const all = await run(model2.model, model2.data, join(dir, "fresh-model"));
  const allAgain = await run((await fixture()).model, model2.data, join(dir, "fresh-model"));
  assert.equal(allAgain.receipt.evaluated, all.receipt.evaluated, "a model change shares no scoped candidate");
}));

test("an implementation change never reuses scoped candidates", () => scratch(async (dir) => {
  const { model, data } = await fixture();
  const first = await run(model, data, dir);
  const changed = await run(model, data, dir, { algorithmVersionSuffix: ":changed" });
  assert.equal(changed.receipt.reused, 0);
  assert.equal(changed.receipt.evaluated, first.receipt.evaluated);
  assert.notEqual(changed.receipt.scoped!.implementationSha256, first.receipt.scoped!.implementationSha256);
}));

test("a read outside the declared scope is recorded even when caught, and falls back to complete inputs", () => scratch(async (dir) => {
  const { model, data } = await fixture();
  // Declare records without their elevation: the walking region must read it
  // for every record, so every plane's evaluation violates its scope.
  const narrow = { ...LANDING_SCOPED_COLLECTIONS, records: { ...LANDING_SCOPED_COLLECTIONS.records, selectors: ["key", "levelId"] } };
  const scope = createLandingPlaneScope(model, data, 0, "c".repeat(64), narrow);
  const outside = scope.dataset.records.find((r) => r.levelId === 2)!;
  try {
    void outside.elevationFeet;
  } catch {
    // Swallowed on purpose: the violation must still be recorded.
  }
  assert.equal(scope.violations.length, 1);
  assert.ok(scope.violations[0] instanceof LandingScopeViolation);
  assert.equal(outside.key, "landing:2", "selector fields stay readable");
  const serial = attachNativeCirculation(model, data);
  const r = await run(model, data, dir, { scopeCollections: narrow });
  assert.equal(wire(r), wire(serial));
  assert.equal(r.receipt.scoped!.scopedEvaluated, 0);
  assert.equal(r.receipt.scoped!.completeEvaluated, r.receipt.evaluated);
  // Complete-key candidates are reused only for identical complete inputs.
  const again = await run(model, data, dir, { scopeCollections: narrow });
  assert.equal(again.receipt.scoped!.reusedComplete, r.receipt.evaluated);
  const changed = await fixture();
  (changed.data.walls as { levelId: number; ringsFeet: P[][] }[]).find((w) => w.levelId === 3)!.ringsFeet[0]![0]![1] = 0.6;
  const third = await run(changed.model, changed.data, dir, { scopeCollections: narrow });
  assert.equal(third.receipt.reused, 0);
}));
