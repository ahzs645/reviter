import assert from "node:assert/strict";
import test from "node:test";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import * as compiler from "../lib/reviter/reviewed-area-partitions.ts";
import type {
  ReviewedAreaPartition,
  ReviewedAreaPartitionApprovedChangeSet,
} from "../lib/reviter/reviewed-area-partitions.ts";

type Point = [number, number];
const rect = (x: number, y: number, w: number, h: number): Point[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const model = "a".repeat(64);
const base = "7".repeat(64);
const manifest = "e".repeat(64);
/** A shutter front between native returns #200/#201, a far wall #900. */
const dataset = (walls: unknown[], doors: unknown[] = []) =>
  ({
    source: {
      modelFileName: "m.rvt",
      modelSha256: model,
      roomsSha256: "b".repeat(64),
    },
    nativeLevels: [{ id: 1, name: "Floor 1", elevationFeet: 0 }],
    walkingSupport: {
      version: 1,
      sourceModelSha256: model,
      floors: [
        { nativeElementId: 100, elevationFeet: 0, ringsFeet: [rect(0, 0, 100, 20)] },
      ],
    },
    walls,
    doors,
    records: [],
  }) as unknown as IndoorDataset;
const walls = [
  { levelId: 1, nativeElementId: 200, ringsFeet: [rect(14.8, 0, 0.4, 8)] },
  { levelId: 1, nativeElementId: 201, ringsFeet: [rect(14.8, 12, 0.4, 8)] },
  { levelId: 1, nativeElementId: 900, ringsFeet: [rect(75, 2, 1.3, 2.1)] },
];
const partition = (): ReviewedAreaPartition => ({
  id: "front",
  levelId: 1,
  elevationFeet: 0,
  geometrySha256: "0".repeat(64),
  kind: "shutter",
  pointsFeet: [
    [15, 8],
    [15, 12],
  ],
  closed: false,
  status: "applied",
  label: "Front",
  notes: "Selection only.",
  evidence: {
    kind: "native-endpoints",
    nativeElementIds: [200, 201],
    reason: "Native returns.",
  },
  selection: "closed",
  navigation: "unchanged",
});
/** An approved drawn door in host #200: the host is cut and a door is added beside the line. */
const doorId = "door:1:dwg:dwg-door:1:test:200";
const withDrawnDoor = (extra: (w: typeof walls) => typeof walls = (w) => w) =>
  dataset(
    extra(
      walls.map((w) =>
        w.nativeElementId === 200
          ? { ...w, ringsFeet: [rect(14.8, 0, 0.4, 2), rect(14.8, 4, 0.4, 4)] }
          : w,
      ),
    ),
    [
      {
        id: doorId,
        levelId: 1,
        nativeElementId: 4504184608535721,
        hostWallNativeElementId: 200,
        pointFeet: [15, 3],
        footprintFeet: rect(14.8, 2, 0.4, 2),
        normalFeet: [1, 0],
        roomKeys: ["a", "b"],
        state: "connected",
        drawingBackedPatchId: "dwg-door:1:test:200",
      },
    ],
  );
const changeSet: ReviewedAreaPartitionApprovedChangeSet = {
  manifestSha256: manifest,
  changes: [
    {
      id: "dwg-door:1:test:200",
      kind: "drawn-door",
      decisionId: "2026-10-10-round3#Q5.2",
      sha256: "c".repeat(64),
      elements: [
        { collection: "doors", key: doorId },
        { collection: "walls", key: "200" },
      ],
    },
  ],
};

for (const [name, M] of [["compiler", compiler]] as const) {
  test(`${name}: a boundary whose window changed only by approved changes is re-bound with a receipt`, async () => {
    const before = dataset(walls);
    const bound = await M.bindReviewedAreaPartitionEvidence(before, partition());
    const after = withDrawnDoor();
    const current = await M.reviewedAreaPartitionLocalEvidence(after, bound);
    assert.notEqual(current.sha256, bound.geometrySha256, "the door stales the boundary");
    const outcome = await M.decideReviewedAreaPartitionApprovedChangeRebind(
      bound,
      current,
      changeSet,
      base,
    );
    assert.equal(outcome.outcome, "rebound");
    if (outcome.outcome !== "rebound") return;
    const r = outcome.partition.reboundFrom!;
    assert.equal(r.reason, "rebound-after-approved-changes");
    assert.equal(r.previousRule, M.REVIEWED_PARTITION_LOCAL_EVIDENCE_RULE);
    assert.equal(r.geometrySha256, bound.geometrySha256);
    assert.equal(r.sourceDatasetSha256, base);
    assert.equal(r.evidenceTest, "exact");
    assert.deepEqual(r.approvedChanges, {
      manifestSha256: manifest,
      elements: [
        {
          collection: "doors",
          key: doorId,
          change: "added",
          changeIds: ["dwg-door:1:test:200"],
          decisionIds: ["2026-10-10-round3#Q5.2"],
        },
        {
          collection: "walls",
          key: "200",
          change: "changed",
          changeIds: ["dwg-door:1:test:200"],
          decisionIds: ["2026-10-10-round3#Q5.2"],
        },
      ],
    });
    assert.equal(outcome.partition.geometrySha256, current.sha256);
    // Applying the outcome records an auditable rebind transition that validates.
    const value = M.rebindReviewedAreaPartitions(
      { version: 1, sourceModelSha256: model, partitions: [bound] },
      [outcome],
      "2026-10-11T00:00:00.000Z",
    );
    const h = value.history!.at(-1)!;
    assert.equal(h.action, "rebind");
    assert.equal(h.before!.geometrySha256, bound.geometrySha256);
    assert.equal(h.after!.reboundFrom!.reason, "rebound-after-approved-changes");
    // The re-bound boundary checks valid on the changed map.
    const p = value.partitions[0]!;
    const check = M.checkReviewedAreaPartition(
      after,
      p,
      await M.reviewedAreaPartitionEvidenceSha256(after, p),
    );
    assert.deepEqual(check.errors, []);
    assert.equal(check.valid, true);
  });

  test(`${name}: any other local difference keeps the boundary stale and reports it`, async () => {
    const bound = await M.bindReviewedAreaPartitionEvidence(dataset(walls), partition());
    // Same approved door, plus an unapproved edit of the other return #201.
    const after = withDrawnDoor((ws) =>
      ws.map((w) =>
        w.nativeElementId === 201 ? { ...w, ringsFeet: [rect(14.8, 12.5, 0.4, 7.5)] } : w,
      ),
    );
    const current = await M.reviewedAreaPartitionLocalEvidence(after, bound);
    const outcome = await M.decideReviewedAreaPartitionApprovedChangeRebind(
      bound,
      current,
      changeSet,
      base,
    );
    assert.equal(outcome.outcome, "needs-review");
    if (outcome.outcome !== "needs-review") return;
    assert.deepEqual(
      outcome.differences.map((d) => [d.collection, d.key, d.change]),
      [["walls", "201", "changed"]],
    );
    assert.match(outcome.reason, /outside the build's approved changes/);
    // Nothing is applied: the boundary keeps its old digest and stays stale on the changed map.
    const value = M.rebindReviewedAreaPartitions(
      { version: 1, sourceModelSha256: model, partitions: [bound] },
      [outcome],
    );
    assert.deepEqual(value.partitions[0], bound);
    assert.equal(
      M.checkReviewedAreaPartition(
        after,
        bound,
        await M.reviewedAreaPartitionEvidenceSha256(after, bound),
      ).valid,
      false,
    );
  });

  test(`${name}: an unchanged window needs no re-binding; the partition itself can never be an approved change`, async () => {
    const d = dataset(walls);
    const bound = await M.bindReviewedAreaPartitionEvidence(d, partition());
    const same = await M.decideReviewedAreaPartitionApprovedChangeRebind(
      bound,
      await M.reviewedAreaPartitionLocalEvidence(d, bound),
      changeSet,
      base,
    );
    assert.deepEqual(same, { id: "front", outcome: "evidence-holds", evidenceTest: "exact" });
    assert.throws(
      () =>
        M.validateReviewedAreaPartitionApprovedChangeSet({
          manifestSha256: manifest,
          changes: [
            {
              ...changeSet.changes[0]!,
              elements: [{ collection: "partition", key: "front" }],
            },
          ],
        }),
      /Invalid approved change set/,
    );
    // A level-bound (legacy) boundary is never re-bound by this step.
    const legacy = await M.decideReviewedAreaPartitionApprovedChangeRebind(
      partition(),
      await M.reviewedAreaPartitionLocalEvidence(d, partition()),
      changeSet,
      base,
    );
    assert.equal(legacy.outcome, "needs-review");
    // A receipt without approved elements is invalid.
    const broken = {
      ...bound,
      reboundFrom: {
        rule: M.REVIEWED_PARTITION_LOCAL_EVIDENCE_RULE,
        previousRule: M.REVIEWED_PARTITION_LOCAL_EVIDENCE_RULE,
        reason: "rebound-after-approved-changes" as const,
        geometrySha256: "1".repeat(64),
        sourceDatasetSha256: base,
      },
    };
    assert.throws(() =>
      M.validateReviewedAreaPartitions({
        version: 1,
        sourceModelSha256: model,
        partitions: [broken],
      }),
    );
  });
}
