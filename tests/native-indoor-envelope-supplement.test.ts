import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveNativeIndoorEnvelopeSupplement,
  mergeNativeIndoorEnvelopeSupplements,
  nativeBoundedFaces,
  nativeEnvelopeBarrierFromDataset,
  nativeIndoorEnvelopeAuthored,
  supplementNativeIndoorEnvelopes,
  validateNativeIndoorEnvelopeSupplements,
} from "../lib/reviter/native-indoor-envelope-supplement.ts";
import { nativeIndoorEnvelopeHash, verifyNativeIndoorEnvelopes, type NativeIndoorEnvelopes } from "../lib/reviter/native-indoor-envelopes.ts";

type P = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const MODEL = "a".repeat(64);
const z = 3.2808398950131235;
/** 20 x 10 ft room, 0.3 ft walls. The north wall is split into two finite members with a 49 mm
 * (0.1623 ft) joint at x = 10, like a curtain-member/wall corner that stops short. */
const GAP = 0.1623;
const wallsWithGap = (gap: number) => [
  { nativeElementId: 1, partsFeet: [[rect(0, 0, 20, 0.3)]] },
  { nativeElementId: 2, partsFeet: [[rect(0, 0, 0.3, 10)]] },
  { nativeElementId: 3, partsFeet: [[rect(19.7, 0, 20, 10)]] },
  { nativeElementId: 4, partsFeet: [[rect(0, 9.7, 10, 10)]] },
  { nativeElementId: 5, partsFeet: [[rect(10 + gap, 9.7, 20, 10)]] },
];
const slab = [[rect(-5, -5, 25, 15)]];
const area = (parts: P[][][]) => parts.reduce((s, p) => s + p.reduce((a, r, i) => a + (i ? -1 : 1) * Math.abs(r.reduce((v, q, j) => { const w = r[(j + 1) % r.length]!; return v + q[0] * w[1] - w[0] * q[1]; }, 0)) / 2, 0), 0);

test("closed room is enclosed at every cut; supplement stays inside native walking support", () => {
  const cuts = [z + 0.1, z + 4].map((c) => ({ cutElevationFeet: c, material: wallsWithGap(0), doorClosures: [], corrections: [] }));
  const s = deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts, walkingSupportPartsFeet: slab, authoredPartsFeet: [] });
  assert.ok(Math.abs(s.areaSqFt - 19.4 * 9.4) < 1e-6, `interior only, got ${s.areaSqFt}`);
  const partialSlab = [[rect(-5, -5, 25, 5)]];
  const t = deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts, walkingSupportPartsFeet: partialSlab, authoredPartsFeet: [] });
  assert.ok(Math.abs(t.areaSqFt - 19.4 * 4.7) < 1e-6, "never extends beyond original slab support");
});

test("a 49 mm joint keeps the face open; only an explicitly reviewed correction closes it and its labels propagate", () => {
  const open = [z + 0.1, z + 4].map((c) => ({ cutElevationFeet: c, material: wallsWithGap(GAP), doorClosures: [], corrections: [] }));
  assert.equal(deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts: open, walkingSupportPartsFeet: slab, authoredPartsFeet: [] }).areaSqFt, 0, "no tolerance or dilation closes a real joint");
  const seal = { id: "drawing-backed-seal:7:4-5:dwg#1112", assumption: true, partsFeet: [[rect(10 - 1e-5, 9.7, 10 + GAP + 1e-5, 10)]] };
  const sealed = open.map((c) => ({ ...c, corrections: [seal] }));
  const s = deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts: sealed, walkingSupportPartsFeet: slab, authoredPartsFeet: [] });
  assert.ok(s.areaSqFt > 180);
  assert.deepEqual(s.assumptionIds, [seal.id]);
  assert.deepEqual(s.correctionIds, [seal.id]);
});

test("a seal applied at only one cut is not enough (facade must close at every cut)", () => {
  const seal = { id: "s", assumption: true, partsFeet: [[rect(10 - 1e-5, 9.7, 10 + GAP + 1e-5, 10)]] };
  const cuts = [
    { cutElevationFeet: z + 0.1, material: wallsWithGap(GAP), doorClosures: [], corrections: [seal] },
    { cutElevationFeet: z + 4, material: wallsWithGap(GAP), doorClosures: [], corrections: [] },
  ];
  assert.equal(deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts, walkingSupportPartsFeet: slab, authoredPartsFeet: [] }).areaSqFt, 0);
});

test("parapet-only terrace (bounded at the ankle cut only) is not admitted", () => {
  const parapet = [{ nativeElementId: 9, partsFeet: [[rect(0, 0, 20, 10), rect(0.3, 0.3, 19.7, 9.7)]] }];
  const cuts = [
    { cutElevationFeet: z + 0.1, material: parapet, doorClosures: [], corrections: [] },
    { cutElevationFeet: z + 4, material: [], doorClosures: [], corrections: [] },
  ];
  assert.equal(deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts, walkingSupportPartsFeet: slab, authoredPartsFeet: [] }).areaSqFt, 0);
});

test("door footprints close openings for enclosure only; a doorless opening stays open", () => {
  const withOpening = [
    { nativeElementId: 1, partsFeet: [[rect(0, 0, 8, 0.3)]] },
    { nativeElementId: 11, partsFeet: [[rect(11, 0, 20, 0.3)]] },
    ...wallsWithGap(0).slice(1),
  ];
  const doorless = [z + 0.1, z + 4].map((c) => ({ cutElevationFeet: c, material: withOpening, doorClosures: [], corrections: [] }));
  assert.equal(deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts: doorless, walkingSupportPartsFeet: slab, authoredPartsFeet: [] }).areaSqFt, 0);
  const door = { nativeElementId: 50, footprintFeet: rect(8, 0, 11, 0.3) };
  const closed = doorless.map((c) => ({ ...c, doorClosures: [door] }));
  assert.ok(deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts: closed, walkingSupportPartsFeet: slab, authoredPartsFeet: [] }).areaSqFt > 180);
});

test("islands inside a cavity stay solid and authored parts are subtracted, not replaced", () => {
  const column = { nativeElementId: 6, partsFeet: [[rect(15, 5, 16, 6)]] };
  const cuts = [z + 0.1, z + 4].map((c) => ({ cutElevationFeet: c, material: [...wallsWithGap(0), column], doorClosures: [], corrections: [] }));
  const authored = [[rect(0.3, 0.3, 10, 9.7)]];
  const s = deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts, walkingSupportPartsFeet: slab, authoredPartsFeet: authored });
  assert.ok(Math.abs(s.areaSqFt - (19.4 * 9.4 - 1 - 9.7 * 9.4)) < 1e-6, `got ${s.areaSqFt}`);
  assert.equal(nativeBoundedFaces([]).length, 0);
});

test("approximate curtain-host footprints are excluded by the dataset adapter", () => {
  const data = {
    doors: [],
    nativeMaterialSections: { levels: [{ levelId: 7, elevationFeet: z, cutElevationFeet: z + 4, sections: [
      ...wallsWithGap(GAP).map((w) => ({ ...w, kind: "wall" })),
      { nativeElementId: 99, kind: "wall", partsFeet: [[rect(9, 9.7, 12, 10)]], sourceAssemblyChildIds: [5] },
    ] }] },
  };
  const b = nativeEnvelopeBarrierFromDataset(data as never, 7, z + 4, []);
  assert.ok(!b.material.some((m) => m.nativeElementId === 99));
  assert.equal(deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts: [b], walkingSupportPartsFeet: slab, authoredPartsFeet: [] }).areaSqFt, 0);
});

test("merge keeps authored parts byte-identical, appends evidence and passes checksum verification", async () => {
  const authoredLevel = { levelId: 7, elevationFeet: z, partsFeet: [[rect(30, 0, 40, 10)]], sourceElementIds: [77], cutElevationsFeet: [z + 0.1, z + 4], evidenceSha256: "b".repeat(64) };
  const base = { version: 1 as const, sourceModelSha256: MODEL, levels: [authoredLevel] };
  const env = { ...base, geometrySha256: await nativeIndoorEnvelopeHash(base) } as NativeIndoorEnvelopes;
  const cuts = [z + 0.1, z + 4].map((c) => ({ cutElevationFeet: c, material: wallsWithGap(0), doorClosures: [], corrections: [] }));
  const s = deriveNativeIndoorEnvelopeSupplement({ levelId: 7, elevationFeet: z, cuts, walkingSupportPartsFeet: slab, authoredPartsFeet: authoredLevel.partsFeet });
  const merged = await mergeNativeIndoorEnvelopeSupplements(env, [s], MODEL);
  await verifyNativeIndoorEnvelopes(merged, MODEL);
  assert.deepEqual(merged.levels[0]!.partsFeet[0], authoredLevel.partsFeet[0]);
  assert.equal(merged.levels[0]!.partsFeet.length, 1 + s.partsFeet.length);
  assert.ok(Math.abs(area(merged.levels[0]!.partsFeet.slice(1) as P[][][]) - s.areaSqFt) < 1e-9);
  assert.notEqual(merged.geometrySha256, env.geometrySha256);
  assert.deepEqual(merged.levels[0]!.sourceElementIds, [77], "authored sources stay byte-identical; the supplement records its own");
  validateNativeIndoorEnvelopeSupplements(merged);
  assert.equal(JSON.stringify(await nativeIndoorEnvelopeAuthored(merged)), JSON.stringify(env), "authored envelope is recovered exactly (source/prepared parity)");
  await assert.rejects(mergeNativeIndoorEnvelopeSupplements(merged, [s], MODEL), /never authored/);
  const tampered = structuredClone(merged) as typeof merged;
  tampered.levels[0]!.partsFeet[0] = [rect(30, 0, 41, 10)];
  await assert.rejects(nativeIndoorEnvelopeAuthored(tampered), /does not preserve the authored envelope/);
});

test("an intermediate-level cut closes another storey's physical door only when its leaf spans the cut", () => {
  const withOpening = [
    { nativeElementId: 1, kind: "wall", partsFeet: [[rect(0, 0, 8, 0.3)]] },
    { nativeElementId: 11, kind: "wall", partsFeet: [[rect(11, 0, 20, 0.3)]] },
    ...wallsWithGap(0).slice(1).map((w) => ({ ...w, kind: "wall" })),
  ];
  const upper = 3.2808398950131235;
  const data = {
    doors: [{ levelId: 311, nativeElementId: 70, footprintFeet: rect(8, 0, 11, 0.3) }],
    nativeMaterialSections: { levels: [1, 4].map((o) => ({ levelId: 1487816, elevationFeet: upper, cutElevationFeet: upper + o, sections: withOpening })) },
  };
  const extent = (d: { levelId?: number }) => (d.levelId === 311 ? ([0, 6.9] as [number, number]) : undefined);
  const lowOwn = nativeEnvelopeBarrierFromDataset(data as never, 1487816, upper + 1, []);
  assert.equal(lowOwn.doorClosures.length, 0, "default: only the level's own doors");
  assert.equal(deriveNativeIndoorEnvelopeSupplement({ levelId: 1487816, elevationFeet: upper, cuts: [lowOwn], walkingSupportPartsFeet: slab, authoredPartsFeet: [] }).areaSqFt, 0);
  const lowSpanning = nativeEnvelopeBarrierFromDataset(data as never, 1487816, upper + 1, [], { doorVerticalExtentFeet: extent as never });
  assert.equal(lowSpanning.doorClosures.length, 1);
  assert.ok(deriveNativeIndoorEnvelopeSupplement({ levelId: 1487816, elevationFeet: upper, cuts: [lowSpanning], walkingSupportPartsFeet: slab, authoredPartsFeet: [] }).areaSqFt > 180);
  const above = nativeEnvelopeBarrierFromDataset(data as never, 1487816, upper + 4, [], { doorVerticalExtentFeet: extent as never });
  assert.equal(above.doorClosures.length, 0, "a cut above the door head does not inherit the closure");
});

test("compiler step consumes applied reviewed correction rows by height, other storeys' spanning doors and subtracts reviewed exclusions", async () => {
  const authoredLevel = { levelId: 7, elevationFeet: z, partsFeet: [[rect(30, 0, 40, 10)]], sourceElementIds: [77], cutElevationsFeet: [z + 0.1, z + 4], evidenceSha256: "b".repeat(64) };
  const base = { version: 1 as const, sourceModelSha256: MODEL, levels: [authoredLevel] };
  const envelopes = { ...base, geometrySha256: await nativeIndoorEnvelopeHash(base) } as NativeIndoorEnvelopes;
  const sections = (material: { nativeElementId: number; partsFeet: P[][][] }[]) => ({ levels: [z + 0.1, z + 4].map((c) => ({ levelId: 7, elevationFeet: z, cutElevationFeet: c, sections: material.map((m) => ({ ...m, kind: "wall" })) })) });
  const seal = { id: "db:7:q1:4-5", state: "applied", baseElevationFeet: z, topElevationFeet: z + 10, partsFeet: [[rect(10 - 1e-5, 9.7, 10 + GAP + 1e-5, 10)]], assumption: { kind: "drawing-backed" } };
  const common = { envelopes, model: MODEL, materialSections: sections(wallsWithGap(GAP)) as never, walkingSupportFloors: [{ elevationFeet: z, partsFeet: slab }], doors: [] };
  const none = await supplementNativeIndoorEnvelopes(common);
  assert.equal(none.envelopes, envelopes, "without the reviewed row nothing is added");
  const proposed = await supplementNativeIndoorEnvelopes({ ...common, provisionalRows: [{ ...seal, state: "proposed" }] });
  assert.equal(proposed.envelopes, envelopes, "proposed rows never close an envelope");
  const lowOnly = await supplementNativeIndoorEnvelopes({ ...common, provisionalRows: [{ ...seal, topElevationFeet: z + 1 }] });
  assert.equal(lowOnly.envelopes, envelopes, "a row must span every authored cut");
  const sealed = await supplementNativeIndoorEnvelopes({ ...common, provisionalRows: [seal] });
  assert.equal(sealed.supplements.length, 1);
  assert.ok(Math.abs(sealed.supplements[0]!.areaSqFt - 19.4 * 9.4) < 1e-6);
  assert.deepEqual(sealed.supplements[0]!.assumptionIds, [seal.id]);
  await verifyNativeIndoorEnvelopes(sealed.envelopes, MODEL);
  const excluded = await supplementNativeIndoorEnvelopes({ ...common, provisionalRows: [seal], exclusions: [{ id: "pin", levelId: 7, elevationFeet: z, partsFeet: [[rect(0, 0, 5, 10)]] }] });
  assert.ok(Math.abs(excluded.supplements[0]!.areaSqFt - (19.4 * 9.4 - 4.7 * 9.4)) < 1e-6, "reviewed exclusions stay out");
  const opening = [{ nativeElementId: 1, partsFeet: [[rect(0, 0, 8, 0.3)]] }, { nativeElementId: 11, partsFeet: [[rect(11, 0, 20, 0.3)]] }, ...wallsWithGap(0).slice(1)];
  const door = { levelId: 311, nativeElementId: 70, footprintFeet: rect(8, 0, 11, 0.3) };
  const doorBase = { ...common, materialSections: sections(opening) as never };
  assert.equal((await supplementNativeIndoorEnvelopes({ ...doorBase, doors: [{ ...door, verticalExtentFeet: [z - 3, z + 2] as [number, number] }] })).envelopes, envelopes, "a doorway below the upper cut stays open there");
  const spanning = await supplementNativeIndoorEnvelopes({ ...doorBase, doors: [{ ...door, verticalExtentFeet: [z - 3, z + 7] as [number, number] }] });
  assert.ok(spanning.supplements[0]!.areaSqFt > 180, "another storey's door leaf spanning both cuts closes the enclosure only");
});

test("a point contact between two material parts is not a passage; a gap of 1e-9 ft is", () => {
  const ring = (gapAtCorner: number) => [
    [rect(0, 0, 10, 1)], [rect(10 + gapAtCorner, 1, 11, 11)], [rect(0, 10, 10, 11)], [rect(-1, 1, 0, 10)], [rect(-1, 0, 0, 1)], [rect(10, 11, 11, 12)],
  ];
  const pinched = nativeBoundedFaces(ring(0));
  assert.equal(pinched.length, 1, "corner-to-corner contacts close the room");
  assert.equal(nativeBoundedFaces(ring(1e-9)).length, 0, "no tolerance closes a real gap");
  const withIsland = nativeBoundedFaces([...ring(0), [rect(4, 4, 5, 5)]]);
  assert.equal(withIsland.length, 1);
  assert.equal(withIsland[0]!.length, 2, "an island inside a pinched room stays solid");
});
