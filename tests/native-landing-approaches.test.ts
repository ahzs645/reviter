import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachNativeCirculation,
  planNativeApproaches,
} from "../lib/reviter/native-circulation-links.ts";
import {
  attachNativeCirculationResumable,
  readLandingApproachCheckpoint,
} from "../scripts/indoor/native-landing-approaches.ts";
import type { IndoorDataset, IndoorRecord, IndoorNode } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

type P2 = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): P2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const record = (key: string, x0: number, x1: number, levelId = 1): IndoorRecord =>
  ({ key, number: key, name: "Corridor", building: key, levelId, elevationFeet: 0, elevationEvidence: "native floor", surfaceId: `${key}:${levelId}`, circulation: true, stair: false, walkable: true, access: "unknown", confidence: 1, ringsFeet: [rect(x0, 0, x1, 10)], properties: {} }) as IndoorRecord;
const node = (r: IndoorRecord, x: number, id = `arrival:${r.key}:${x}`): IndoorNode =>
  ({ id, roomKey: r.key, levelId: r.levelId, building: r.building, surfaceId: r.surfaceId, kind: "arrival", pointFeet: [x, 5, 0], geographic: [0, 0] }) as IndoorNode;
const floor = { elementId: 10, categoryId: -2000032, boundsFeet: { min: { x: 0, y: 0, z: -1 }, max: { x: 40, y: 10, z: 0 } }, loops: [rect(0, 0, 40, 10).map((p) => [...p, 0])] };
const base = { source: { modelSha256: "a".repeat(64) }, nativeLevels: [{ id: 1, name: "A", elevationFeet: 0 }, { id: 2, name: "B", elevationFeet: 0 }], edges: [], alignment: { horizontalMetresPerFoot: 0.3048 } };
const model = { elementBounds: [floor], levels: base.nativeLevels.map((l) => ({ levelId: l.id, elevation: l.elevationFeet })), nativeAssociatedLevelRelations: [], nativeHostRelations: [{ elementId: 30, hostId: 20 }] } as unknown as ConvertResult;

// Chain: a2-b1 joins a2/b1; a1-b1 joins a1; b2-c1 joins; a2-b2 joins both groups,
// so the later a1-b2 and b1-c1 pairs are skipped by earlier joins.
function chain(): IndoorDataset {
  const a = record("a", 0, 10), b = record("b", 10, 20), c = record("c", 20, 30);
  return { ...base, records: [a, b, c], nodes: [node(a, 8), node(a, 9.5), node(b, 12), node(b, 18), node(c, 22)] } as unknown as IndoorDataset;
}
// Generated landing meeting an existing enabled door side (portal pair).
function portal(): { model: ConvertResult; data: IndoorDataset } {
  const landing = { ...record("landing:lower", 0, 9.6), properties: { nativeFloorId: 10, generatedLanding: true } } as IndoorRecord,
    outside = record("outside", 0, 9.6),
    insideRoom = record("inside", 10.4, 20, 2);
  const start = { ...node(landing, 2), id: "landing:arrival", kind: "connector" as const },
    entry = { ...node(outside, 9.85), id: "door:2:30:0", kind: "portal" as const },
    exit = { ...node(insideRoom, 10.6), id: "door:2:30:1", kind: "portal" as const },
    hall = node(outside, 3, "arrival:outside:3");
  const door = { id: "door:2:30", levelId: 2, nativeElementId: 30, pointFeet: [10, 5] as P2, footprintFeet: rect(9.8, 3, 10.2, 7), normalFeet: [1, 0] as P2, roomKeys: [outside.key, insideRoom.key], state: "connected" as const };
  const wall = { elementId: 20, categoryId: -2000011, boundsFeet: { min: { x: 9.8, y: 0, z: 0 }, max: { x: 10.2, y: 10, z: 8 } }, solid: { start: { x: 10, y: 0 }, end: { x: 10, y: 10 }, thickness: 0.4, baseElevation: 0, topElevation: 8 } };
  const data = { ...base, records: [landing, outside, insideRoom], nodes: [start, entry, exit, hall], doors: [door], edges: [{ id: door.id, from: entry.id, to: exit.id, kind: "door", enabled: true }] } as unknown as IndoorDataset;
  return { model: { ...model, elementBounds: [floor, wall] } as unknown as ConvertResult, data };
}
const wire = (v: unknown) => JSON.stringify(v);
async function scratch() {
  return mkdtemp(join(tmpdir(), "landing-approaches-"));
}

test("fixtures exercise skips caused by earlier joins and a portal pair", () => {
  const plan = planNativeApproaches(model, chain());
  const serial = attachNativeCirculation(model, chain());
  assert.ok(plan.pairs.length >= 6);
  assert.ok(serial.edges.length < plan.pairs.length, "at least one pair is skipped after earlier joins");
  assert.equal(serial.edges.length, 4);
  const p = portal();
  const portalPlan = planNativeApproaches(p.model, p.data);
  assert.ok(portalPlan.pairs.some((q) => q.landing && (q.a.kind === "portal" || q.b.kind === "portal")));
  assert.ok(attachNativeCirculation(p.model, p.data).edges.length >= 1);
});

test("in-process resumable replay and two-worker wave replay reproduce serial output exactly", async () => {
  for (const [m, d] of [[model, chain()], [portal().model, portal().data]] as const) {
    const serial = attachNativeCirculation(m, d);
    const progress: number[][] = [], serialProgress: number[][] = [];
    attachNativeCirculation(m, d, (...x) => serialProgress.push(x));
    const dir = await scratch();
    try {
      const local = await attachNativeCirculationResumable(m, d, { checkpointDir: dir, workers: 1, onProgress: (...x) => progress.push(x) });
      assert.equal(wire({ edges: local.edges, diagnostics: local.diagnostics }), wire(serial));
      assert.deepEqual(progress, serialProgress);
      const parallel = await attachNativeCirculationResumable(m, d, { checkpointDir: join(dir, "p"), workers: 2, waveSize: 4 });
      assert.equal(wire({ edges: parallel.edges, diagnostics: parallel.diagnostics }), wire(serial));
      assert.equal(parallel.receipt.workers, 2);
      assert.ok(parallel.receipt.evaluated >= serial.edges.length);
      console.log(JSON.stringify({ fixtureWorkerHeap: parallel.receipt.workerHeapUsedBytesAfterInit, evaluated: parallel.receipt.evaluated, waves: parallel.receipt.waves, unused: parallel.receipt.speculativeUnused, edges: serial.edges.length, pairs: parallel.receipt.pairs }));
      assert.ok(parallel.receipt.speculativeUnused <= parallel.receipt.waves * 4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("a simulated interruption resumes from checkpoint with identical output and only reuses intact current-binding lines", async () => {
  const d = chain(), serial = attachNativeCirculation(model, d), dir = await scratch();
  try {
    await assert.rejects(
      attachNativeCirculationResumable(model, d, { checkpointDir: dir, afterWave: (w) => { if (w === 2) throw Error("simulated crash"); } }),
      /simulated crash/,
    );
    const [file] = (await readdir(join(dir, "landing-approaches"))).filter((f) => f.endsWith(".jsonl"));
    const path = join(dir, "landing-approaches", file!);
    // Torn final line plus forged lines: a foreign binding, and a changed candidate.
    const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
    assert.equal(lines.length, 2);
    const forged = JSON.parse(lines[0]!);
    forged.candidate.path = [[0, 0, 0], [1, 1, 0]];
    const foreign = { ...JSON.parse(lines[1]!), bindingSha256: "f".repeat(64) };
    await writeFile(path, [JSON.stringify(forged), JSON.stringify(foreign), lines[1], '{"format":"reviter-landing'].join("\n"));
    const read = await readLandingApproachCheckpoint(path, file!.slice(0, 64));
    assert.equal(read.entries.size, 1);
    assert.equal(read.ignored, 3);
    const resumed = await attachNativeCirculationResumable(model, d, { checkpointDir: dir });
    assert.equal(wire({ edges: resumed.edges, diagnostics: resumed.diagnostics }), wire(serial));
    assert.equal(resumed.receipt.reused, 1);
    assert.equal(resumed.receipt.ignoredCheckpointLines, 3);
    const again = await attachNativeCirculationResumable(model, d, { checkpointDir: dir });
    assert.equal(wire({ edges: again.edges, diagnostics: again.diagnostics }), wire(serial));
    assert.equal(again.receipt.evaluated, 0, "complete checkpoint is fully reused");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a changed input binds a new checkpoint; stale candidates are never reused", async () => {
  const dir = await scratch();
  try {
    await attachNativeCirculationResumable(model, chain(), { checkpointDir: dir });
    const moved = chain();
    moved.nodes[4] = { ...moved.nodes[4]!, pointFeet: [23, 5, 0] };
    const serial = attachNativeCirculation(model, moved);
    const resumed = await attachNativeCirculationResumable(model, moved, { checkpointDir: dir });
    assert.equal(resumed.receipt.reused, 0);
    assert.equal(wire({ edges: resumed.edges, diagnostics: resumed.diagnostics }), wire(serial));
    assert.equal((await readdir(join(dir, "landing-approaches"))).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
