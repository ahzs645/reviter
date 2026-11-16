import test from "node:test";
import assert from "node:assert/strict";
import { serialize } from "node:v8";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalValueSha256 as digest } from "../scripts/indoor/canonical-value-digest.ts";
import { attachNativeCirculation } from "../lib/reviter/native-circulation-links.ts";
import { attachNativeCirculationResumable } from "../scripts/indoor/native-landing-approaches.ts";
import type { IndoorDataset, IndoorRecord, IndoorNode } from "../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";

/** The same values, but every integer re-created by exact arithmetic: V8 then
 * stores it as a heap double instead of a small integer, as in the campus runs. */
const asDouble = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(asDouble)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, asDouble(x)]))
  : typeof v === "number" && Number.isInteger(v) && !Object.is(v, -0) ? (v + 0.5) - 0.5 : v;

test("V8 snapshot bytes depend on number representation; the canonical digest does not", () => {
  const parsed = JSON.parse('{"p":[8,5,0],"xDir":{"x":1,"y":0}}');
  const computed = asDouble(parsed);
  assert.notEqual(serialize(parsed).toString("hex"), serialize(computed).toString("hex"), "fixture reproduces the I/N tag difference");
  assert.equal(digest(parsed), digest(computed));
});

test("every observable difference changes the canonical digest", () => {
  const base = { a: [1, 2, 3], b: { c: "x", d: null, e: true }, f: 0 };
  const variants: unknown[] = [
    { ...base, f: -0 },
    { b: base.b, a: base.a, f: 0 },
    { ...base, a: [1, 2, 3.0000000000000004] },
    { ...base, a: [1, 2] },
    { ...base, a: [1, 2, 3, undefined] },
    { ...base, b: { ...base.b, d: undefined } },
    { ...base, b: { c: "x", e: true } },
    { ...base, b: { ...base.b, c: "y" } },
    { ...base, b: { ...base.b, e: false } },
    { ...base, f: "0" },
    { ...base, f: 0n },
    { ...base, f: new Map([[0, 0]]) },
    { ...base, f: new Set([0]) },
    { ...base, f: new Float64Array([0]) },
    { ...base, f: new Uint8Array(8) },
  ];
  const seen = new Set([digest(base)]);
  for (const v of variants) {
    const h = digest(v);
    assert.ok(!seen.has(h), "distinct digest for " + JSON.stringify(v, (_, x) => typeof x === "bigint" ? x + "n" : x));
    seen.add(h);
  }
  // Holes differ from undefined, and NaN payloads are not observable.
  assert.notEqual(digest([1, , 3]), digest([1, undefined, 3]));
  assert.equal(digest([NaN]), digest([0 / 0]));
  // Aliasing is observable with ===, so it is part of the identity; cycles terminate.
  const point = [1, 2];
  assert.notEqual(digest({ a: point, b: point }), digest({ a: [1, 2], b: [1, 2] }));
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.match(digest(cyclic), /^[a-f0-9]{64}$/);
});

test("values the digest cannot represent are refused, never approximated", () => {
  class Point { x = 1; }
  for (const v of [new Point(), () => 1, Symbol("s"), Object.assign([1], { extra: 2 }), Object.defineProperty({}, "x", { get: () => 1, enumerable: true })])
    assert.throws(() => digest({ v }));
});

// Landing approaches: the same chain fixture as native-landing-approaches.test.ts.
type P2 = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): P2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const record = (key: string, x0: number, x1: number): IndoorRecord =>
  ({ key, number: key, name: "Corridor", building: key, levelId: 1, elevationFeet: 0, elevationEvidence: "native floor", surfaceId: `${key}:1`, circulation: true, stair: false, walkable: true, access: "unknown", confidence: 1, ringsFeet: [rect(x0, 0, x1, 10)], properties: {} }) as IndoorRecord;
const node = (r: IndoorRecord, x: number): IndoorNode =>
  ({ id: `arrival:${r.key}:${x}`, roomKey: r.key, levelId: r.levelId, building: r.building, surfaceId: r.surfaceId, kind: "arrival", pointFeet: [x, 5, 0], geographic: [0, 0] }) as IndoorNode;
const floor = { elementId: 10, categoryId: -2000032, boundsFeet: { min: { x: 0, y: 0, z: -1 }, max: { x: 40, y: 10, z: 0 } }, loops: [rect(0, 0, 40, 10).map((p) => [...p, 0])] };
const levels = [{ id: 1, name: "A", elevationFeet: 0 }];
const model = JSON.parse(JSON.stringify({ elementBounds: [floor], levels: [{ levelId: 1, elevation: 0 }], nativeAssociatedLevelRelations: [], nativeHostRelations: [] })) as ConvertResult;
function chain(): IndoorDataset {
  const a = record("a", 0, 10), b = record("b", 10, 20), c = record("c", 20, 30);
  return JSON.parse(JSON.stringify({ source: { modelSha256: "a".repeat(64) }, nativeLevels: levels, edges: [], alignment: { horizontalMetresPerFoot: 0.3048 }, records: [a, b, c], nodes: [node(a, 8), node(a, 9.5), node(b, 12), node(b, 18), node(c, 22)] })) as IndoorDataset;
}

test("a rerun whose inputs differ only in V8 number representation reuses every landing candidate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "landing-canonical-"));
  try {
    const first = await attachNativeCirculationResumable(model, chain(), { checkpointDir: dir });
    assert.ok(first.receipt.evaluated > 0);
    const m2 = asDouble(model) as ConvertResult, d2 = asDouble(chain()) as IndoorDataset;
    assert.notEqual(serialize(d2).toString("hex"), serialize(chain()).toString("hex"));
    const second = await attachNativeCirculationResumable(m2, d2, { checkpointDir: dir });
    assert.equal(second.receipt.evaluated, 0, "no pair recomputed");
    assert.equal(second.receipt.reused, first.receipt.evaluated);
    assert.equal(second.receipt.bindingSha256, first.receipt.bindingSha256);
    assert.equal(JSON.stringify({ edges: second.edges, diagnostics: second.diagnostics }), JSON.stringify(attachNativeCirculation(model, chain())));
    // Two distinct byte snapshots of each input exist; one candidate file serves both.
    assert.equal((await readdir(join(dir, "inputs"))).length, 4);
    assert.equal((await readdir(join(dir, "landing-approaches"))).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checkpoint reuse identity binds values and algorithm contents, not V8 bytes or checkout location", async () => {
  const { createCheckpointBinding, verifyCheckpointBinding, checkpointIdentity } = await import("../scripts/indoor/bounded-worker-checkpoints.ts");
  const { writeFile, mkdir } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "reuse-identity-"));
  try {
    const value = JSON.parse('{"p":[8,5,0]}'), same = asDouble(value);
    const bind = async (root: string, input: unknown, algorithm = "export const v = 1;\n") => {
      await mkdir(join(root, "lib"), { recursive: true });
      await writeFile(join(root, "lib", "a.ts"), algorithm);
      const path = join(root, "input-" + digest(input).slice(0, 8) + Math.random() + ".bin");
      await writeFile(path, serialize(input));
      return createCheckpointBinding({ immutableInputs: [{ name: "data", path, contentSha256: digest(input) }], algorithmFiles: [join(root, "lib", "a.ts")], algorithmVersion: "test-v1", reuseRoot: root });
    };
    const a = await bind(join(dir, "one"), value), b = await bind(join(dir, "two"), same);
    await verifyCheckpointBinding(a);
    assert.notEqual(a.sha256, b.sha256, "exact file binding still differs");
    assert.equal(checkpointIdentity(a), checkpointIdentity(b), "same values, same algorithm contents at the same relative paths");
    assert.notEqual(checkpointIdentity(await bind(join(dir, "three"), { p: [8, 5, 1] })), checkpointIdentity(a), "changed value");
    assert.notEqual(checkpointIdentity(await bind(join(dir, "four"), value, "export const v = 2;\n")), checkpointIdentity(a), "changed implementation");
    // A forged reuse identity is refused.
    await assert.rejects(verifyCheckpointBinding({ ...a, reuseSha256: "f".repeat(64) }), /Invalid checkpoint binding/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
