import test from "node:test";
import assert from "node:assert/strict";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import {
  REVIEWED_PARTITION_LOCAL_EVIDENCE_RULE,
  bindReviewedAreaPartitionEvidence,
  checkReviewedAreaPartition,
  decideReviewedAreaPartitionRebind,
  rebindReviewedAreaPartitions,
  reviewedAreaPartitionEvidenceSha256,
  reviewedAreaPartitionEvidenceStatuses,
  reviewedAreaPartitionGeometrySha256,
  reviewedAreaPartitionLocalEvidence,
  validateReviewedAreaPartitions,
  type ReviewedAreaPartition,
} from "../lib/reviter/reviewed-area-partitions.ts";

type Point = [number, number];
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const model = "a".repeat(64);
const dataset = (walls: IndoorDataset["walls"]) =>
  ({
    source: { modelFileName: "m.rvt", modelSha256: model, roomsSha256: "b".repeat(64) },
    nativeLevels: [{ id: 1, name: "Floor 1", elevationFeet: 0 }],
    walkingSupport: {
      version: 1,
      sourceModelSha256: model,
      floors: [{ nativeElementId: 100, elevationFeet: 0, ringsFeet: [rect(0, 0, 100, 20)] }],
    },
    walls,
    doors: [],
    records: [],
  }) as unknown as IndoorDataset;
const walls: IndoorDataset["walls"] = [
  { levelId: 1, nativeElementId: 200, ringsFeet: [rect(14.8, 0, 0.4, 8)] },
  { levelId: 1, nativeElementId: 201, ringsFeet: [rect(14.8, 12, 0.4, 8)] },
  { levelId: 1, nativeElementId: 900, ringsFeet: [rect(75, 2, 1.3, 2.1)] },
] as IndoorDataset["walls"];
const partition = (hash: string): ReviewedAreaPartition => ({
  id: "front",
  levelId: 1,
  elevationFeet: 0,
  geometrySha256: hash,
  kind: "shutter",
  pointsFeet: [
    [15, 8],
    [15, 12],
  ],
  closed: false,
  status: "applied",
  label: "Front",
  notes: "Selection only.",
  evidence: { kind: "native-endpoints", nativeElementIds: [200, 201], reason: "Native returns." },
  selection: "closed",
  navigation: "unchanged",
});
const drift = (d: IndoorDataset, id: number, dy: number) =>
  dataset(
    d.walls.map((w) =>
      w.nativeElementId === id
        ? { ...w, ringsFeet: [w.ringsFeet[0]!.map(([x, y], i) => (i ? [x, y] : [x, y + dy]) as Point)] }
        : w,
    ),
  );

test("mirrored local binding ignores far drift, stales on local change and re-binds only recovered reviews", async () => {
  const reviewed = dataset(walls);
  const level = await reviewedAreaPartitionGeometrySha256(reviewed, 1);
  const legacy = partition(level);
  const local = await bindReviewedAreaPartitionEvidence(reviewed, legacy);
  assert.equal(local.evidenceBinding, REVIEWED_PARTITION_LOCAL_EVIDENCE_RULE);
  const far = drift(reviewed, 900, 2 ** -48);
  assert.notEqual(await reviewedAreaPartitionGeometrySha256(far, 1), level);
  assert.equal(await reviewedAreaPartitionEvidenceSha256(far, local), local.geometrySha256);
  // One ulp at a cited return: digest differs, the stored snapshot holds within 1e-6 ft.
  const noisy = drift(reviewed, 201, 2 ** -48);
  const tolerant = (await reviewedAreaPartitionEvidenceStatuses(noisy, [local]))[local.id]!;
  assert.equal(tolerant.test, "tolerance");
  assert.equal(checkReviewedAreaPartition(noisy, local, tolerant.digest).valid, true);
  // 1e-4 ft is a real move.
  const near = drift(reviewed, 201, 1e-4);
  const digest = await reviewedAreaPartitionEvidenceSha256(near, local);
  assert.notEqual(digest, local.geometrySha256);
  assert.match(checkReviewedAreaPartition(near, local, digest).errors.join(" "), /evidence window/);
  const source = {
    sha256: "5".repeat(64),
    label: "reviewed master",
    levelEvidenceSha256: level,
    localEvidence: await reviewedAreaPartitionLocalEvidence(reviewed, legacy),
  };
  const rebound = decideReviewedAreaPartitionRebind(
    legacy,
    [source],
    await reviewedAreaPartitionLocalEvidence(far, legacy),
  );
  assert.equal(rebound.outcome, "rebound");
  const migrated = rebindReviewedAreaPartitions(
    { version: 1, sourceModelSha256: model, partitions: [legacy] },
    [rebound],
    "2026-10-11T00:00:00.000Z",
  );
  validateReviewedAreaPartitions(migrated, model);
  assert.equal(migrated.partitions[0]!.reboundFrom?.sourceDatasetSha256, "5".repeat(64));
  const refused = decideReviewedAreaPartitionRebind(
    legacy,
    [source],
    await reviewedAreaPartitionLocalEvidence(near, legacy),
  );
  assert.equal(refused.outcome, "needs-review");
  assert.deepEqual(refused.outcome === "needs-review" ? refused.differences : [], [
    { collection: "walls", key: "201", change: "changed", detail: "geometry" },
  ]);
  assert.equal(decideReviewedAreaPartitionRebind(legacy, [], source.localEvidence).outcome, "needs-review");
});

test("mirrored floor-bound rows: a far row on the same slab is not local, a row at the boundary and a slab edit inside the window are", async () => {
  const slab = (ring: Point[]) => [[ring]];
  const full = rect(0, 0, 100, 20);
  const row = (id: string, body: Point[], ring: Point[] = full) => {
    const binding = [{ nativeElementId: 100, elevationFeet: 0, partsFeet: slab(ring) }];
    return {
      id, levelId: 1, elevationFeet: 0, baseElevationFeet: 0, topElevationFeet: 9, state: "applied",
      partsFeet: [[body]], sourceFloorIds: [100], sourceFloorBindings: binding,
      sourceFloorPartsSha256: JSON.stringify(binding).length.toString(16).padStart(64, "0"),
      drawingBacked: { version: 1, kind: "exact-contact-closure", nativeOwnerIds: [200, 201] },
      evidenceSha256: String(JSON.stringify(ring).length).padStart(64, "1"),
    };
  };
  const strict = (rows: unknown[], ring: Point[] = full) =>
    ({
      ...dataset(walls),
      walkingSupport: { version: 1, sourceModelSha256: model, floors: [{ nativeElementId: 100, elevationFeet: 0, ringsFeet: [ring] }] },
      nativeIndoorEnvelopes: { version: 1, sourceModelSha256: model, geometrySha256: "3".repeat(64), levels: [] },
      nativeProvisionalCornerSeals: {
        version: 1, sourceModelSha256: model, sourceMaterialGeometrySha256: "c".repeat(64), sourceWallPositionRepairsSha256: "d".repeat(64),
        geometrySha256: `${rows.length}`.padStart(64, "e"), completeOriginalPhysicalOwnerCensusSha256: "1".repeat(64), foreignBodies: [], rows,
      },
    }) as unknown as IndoorDataset;
  const body = rect(16, 9, 0.1, 2);
  const local = await bindReviewedAreaPartitionEvidence(strict([row("db:near", body)]), partition("0".repeat(64)));
  const test = async (d: IndoorDataset) => (await reviewedAreaPartitionEvidenceStatuses(d, [local]))[local.id]!.test;
  assert.equal(await test(strict([row("db:near", body), row("db:far", rect(80, 10, 0.1, 0.1))])), "exact");
  assert.equal(await test(strict([])), "changed");
  assert.equal(await test(strict([row("db:near", body), row("db:new", rect(17, 9, 0.1, 2))])), "changed");
  const moved: Point[] = [[0, 0], [100, -1], [100, 20], [0, 20]];
  assert.equal(await test(strict([row("db:near", body, moved)], moved)), "exact");
  const notched: Point[] = [[0, 0], [18, 0], [18, 4], [19, 4], [19, 0], ...full.slice(1)];
  assert.equal(await test(strict([row("db:near", body, notched)], notched)), "changed");
});
