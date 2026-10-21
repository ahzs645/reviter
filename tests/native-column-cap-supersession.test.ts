import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { proposeNativeColumnCapSupersession } from "../lib/reviter/native-column-cap-supersession.ts";
import {
  validNativeContinuation,
  type NativeBoundaryPatch,
  type BoundaryWall,
} from "../lib/reviter/native-boundary-patches.ts";
type CurrentColumn = Parameters<typeof proposeNativeColumnCapSupersession>[1];
type OriginalCapPatch = NativeBoundaryPatch & { continuationProof: NonNullable<NativeBoundaryPatch["continuationProof"]> };
type CurrentCapFixture = { originalPatch: OriginalCapPatch; currentSourceSections: CurrentColumn[] };
function actual() {
  return JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/native-column-cap-south-contact.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}
test("the actual rounded/notched column needs a full-width chain instead of rebinding the historical square evidence", () => {
  const { originalPatch, currentColumn } = actual(),
    before = JSON.stringify({ originalPatch, currentColumn });
  const rebound = structuredClone(originalPatch);
  rebound.wallEvidence[1].ringsFeet = structuredClone(currentColumn.ringsFeet);
  assert.equal(validNativeContinuation(rebound), false);
  const result = proposeNativeColumnCapSupersession(
    originalPatch,
    currentColumn,
  );
  assert.ok(result.ok, result.ok ? undefined : result.blockers.join(";"));
  const p = result.replacementPatches[0]!;
  assert.ok(validNativeContinuation(p));
  assert.deepEqual(
    p.continuationProof!.sourceCapFeet,
    originalPatch.continuationProof.sourceCapFeet,
  );
  assert.deepEqual(p.wallEvidence[0], originalPatch.wallEvidence[0]);
  assert.deepEqual(p.wallEvidence[1]!.ringsFeet, currentColumn.ringsFeet);
  assert.ok(p.continuationProof!.targetContactPathFeet!.length >= 5);
  assert.ok(p.widthFeet > originalPatch.widthFeet);
  assert.equal(result.physicalApproval, false);
  assert.equal(p.status, "proposed");
  assert.equal(JSON.stringify({ originalPatch, currentColumn }), before);
  assert.deepEqual(result.completeOldRecipe, originalPatch);
});
test("a middle notch cannot be skipped or bypassed by selecting only the two endpoint rays", () => {
  const source: NativeBoundaryPatch["ringsFeet"] = [
      [
        [0, -0.5],
        [2, -0.5],
        [2, 0.5],
        [0, 0.5],
      ],
    ],
    box: NativeBoundaryPatch["ringsFeet"] = [
      [
        [-3, -1],
        [-1, -1],
        [-1, 1],
        [-3, 1],
      ],
    ];
  const old: NativeBoundaryPatch = {
    id: "native-cap",
    levelId: 1,
    sourceModelSha256: "a".repeat(64),
    status: "applied",
    widthFeet: 1,
    ringsFeet: [
      [
        [0.0002, -0.5],
        [0.0002, 0.5],
        [-1.0002, 0.5],
        [-1.0002, -0.5],
      ],
    ],
    wallEvidence: [
      { nativeElementId: 1, ringsFeet: source },
      { nativeElementId: 2, kind: "column", ringsFeet: box },
    ],
    nativeDoorIds: [],
    continuationProof: {
      sourceWallId: 1,
      sourceCapFeet: [
        [0, -0.5],
        [0, 0.5],
      ],
      targetContactFeet: [
        [-1, -0.5],
        [-1, 0.5],
      ],
      evidenceSha256: "b".repeat(64),
    },
    notes: "Original full-width cap",
  };
  assert.ok(validNativeContinuation(old));
  const target: BoundaryWall & { geometrySource: string } = {
    levelId: 1,
    nativeElementId: 2,
    kind: "column",
    geometrySource: "original-native-material-section",
    ringsFeet: [
      [
        [-3, -1],
        [-1, -1],
        [-1, -0.2],
        [-2, -0.2],
        [-2, 0.2],
        [-1, 0.2],
        [-1, 1],
        [-3, 1],
      ],
    ],
  };
  const result = proposeNativeColumnCapSupersession(old, target);
  assert.equal(result.ok, false);
});
test("foreign identities, floors, approximate rows, holes and self-intersections refuse", () => {
  for (const change of [
    (c: CurrentColumn) => c.nativeElementId++,
    (c: CurrentColumn) => c.levelId++,
    (c: CurrentColumn) => (c.approximate = true),
    (c: CurrentColumn) => (c.reviewPatchId = "another-patch"),
    (c: CurrentColumn) => (c.geometrySource = "display"),
    (c: CurrentColumn) =>
      c.ringsFeet.push([
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    (c: CurrentColumn) =>
      (c.ringsFeet = [
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      ]),
    (c: CurrentColumn) => {
      const r = c.ringsFeet[0];
      [r[3], r[15]] = [r[15], r[3]];
    },
  ]) {
    const { originalPatch, currentColumn } = actual();
    change(currentColumn);
    assert.equal(
      proposeNativeColumnCapSupersession(originalPatch, currentColumn).ok,
      false,
    );
  }
});
test("incomplete caps or changed original operation kinds cannot become replacement approvals", () => {
  for (const change of [
    (p: OriginalCapPatch) => (p.continuationProof.sourceCapFeet[1][1] -= 0.1),
    (p: OriginalCapPatch) => (p.status = "proposed"),
    (p: OriginalCapPatch) => (p.nativeDoorIds = [10]),
    (p: OriginalCapPatch) => (p.wallEvidence[0].kind = "column"),
  ]) {
    const { originalPatch, currentColumn } = actual();
    change(originalPatch);
    assert.equal(
      proposeNativeColumnCapSupersession(originalPatch, currentColumn).ok,
      false,
    );
  }
});

test("exact current original source-cap supersession retains old history and uses a complete actual exposed edge", async () => {
  const { proposeNativeColumnSourceCapSupersession } = await import(
    "../lib/reviter/native-column-cap-supersession.ts"
  );
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/native-column-source-cap-exact-contact.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const { originalPatch, currentColumn, currentSourceSections } = fixture;
  const before = JSON.stringify(fixture);
  const result = proposeNativeColumnSourceCapSupersession(
    originalPatch,
    currentColumn,
    currentSourceSections,
  );
  assert.ok(result.ok, result.ok ? undefined : result.blockers.join(";"));
  assert.equal(result.kind, "native-column-cap-current-source");
  const p = result.replacementPatches[0]!;
  assert.ok(validNativeContinuation(p));
  assert.notDeepEqual(
    p.continuationProof!.sourceCapFeet,
    originalPatch.continuationProof.sourceCapFeet,
  );
  assert.deepEqual(p.continuationProof!.sourceCapFeet, [
    currentSourceSections[0].ringsFeet[0][0],
    currentSourceSections[0].ringsFeet[0][3],
  ]);
  assert.deepEqual(result.completeOldRecipe, originalPatch);
  assert.deepEqual(result.completeCurrentSourceSections, currentSourceSections);
  assert.equal(result.sourceCapDerivation.noToleranceEquivalenceClaimed, true);
  assert.equal(result.checks.unchangedFullSourceCapAndAxis, false);
  assert.equal(result.physicalApproval, false);
  assert.equal(JSON.stringify(fixture), before);
});

test("current source-cap proposals reject other owners/floors, inexact physical provenance and incomplete source edges", async () => {
  const { proposeNativeColumnSourceCapSupersession } = await import(
    "../lib/reviter/native-column-cap-supersession.ts"
  );
  for (const mutate of [
    (f: CurrentCapFixture) => f.currentSourceSections[0].nativeElementId++,
    (f: CurrentCapFixture) => f.currentSourceSections[0].levelId++,
    (f: CurrentCapFixture) => (f.currentSourceSections[0].geometrySource = "display"),
    (f: CurrentCapFixture) => (f.currentSourceSections[0].approximate = true),
    (f: CurrentCapFixture) => (f.currentSourceSections[0].reviewPatchId = "previous-review"),
    (f: CurrentCapFixture) =>
      f.currentSourceSections[0].ringsFeet.push([
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    (f: CurrentCapFixture) => (f.originalPatch.continuationProof.sourceCapFeet[0][0] += 0.01),
    (f: CurrentCapFixture) => (f.currentSourceSections = []),
  ]) {
    const f = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/native-column-source-cap-exact-contact.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    mutate(f);
    assert.equal(
      proposeNativeColumnSourceCapSupersession(
        f.originalPatch,
        f.currentColumn,
        f.currentSourceSections,
      ).ok,
      false,
    );
  }
});
