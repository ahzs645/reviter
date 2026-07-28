import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = JSON.parse(
  readFileSync(
    new URL(
      "../docs/generated/unbc-revit-2027-missing-owner-routes.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  inputs: {
    ifc: { sha256: string; role: string };
  };
  scope: {
    missingNoDirectOwnerOrPlacementTags: number;
    ifcTriangles: number;
    tagSha256: string;
    allNativeIdentitiesResolved: boolean;
  };
  carriers: Record<string, number>;
  byIfcClass: Record<string, {
    tags: number;
    fullFifoCertifiedOwners: number;
    fullFifoBoundsWithinHalfFoot: number;
    gRepShapes: Record<string, number>;
    completeGRepShapes: Record<string, number>;
  }>;
  ownedCertifiedChildrenDiagnostic: {
    targetsWithCertifiedChildren: number;
  };
  requestedOwnerFullFifoDiagnostic: {
    requestedOwners: number;
    completeOwners: number;
    partialOwners: number;
    certifiedTriangles: number;
    boundsWithin1e6Feet: number;
    boundsWithinHalfFoot: number;
    exactTriangleCount: number;
  };
  scan: {
    partitionChunks: number;
    failedPartitionChunks: number;
  };
};

test("exact missing-owner corpus resolves to native identities and disjoint route counts", () => {
  assert.equal(
    report.inputs.ifc.sha256,
    "adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0",
  );
  assert.equal(
    report.inputs.ifc.role,
    "post-decode-geometry-population-oracle-only",
  );
  assert.equal(report.scope.missingNoDirectOwnerOrPlacementTags, 925);
  assert.equal(report.scope.ifcTriangles, 220_357);
  assert.equal(report.scope.allNativeIdentitiesResolved, true);
  assert.equal(
    report.scope.tagSha256,
    "4b7264d4653717a4ff9abf8c01677392749be7d229fd36c2d4a83f67f4b13b6a",
  );
  assert.deepEqual(report.carriers, {
    "own-uncertified-gelement": 709,
    "own-full-fifo-certified-mesh": 140,
    "framed-semantic-record-only": 41,
    "no-framed-partition-record": 18,
    "own-insertable-instance-without-placement": 15,
    "host-to-certified-hosted-children": 2,
  });
  assert.equal(report.ownedCertifiedChildrenDiagnostic.targetsWithCertifiedChildren, 2);
  assert.equal(report.scan.partitionChunks, 3_666);
  assert.equal(report.scan.failedPartitionChunks, 0);
});

test("full FIFO coverage preserves negative controls before bounds admission", () => {
  const diagnostic = report.requestedOwnerFullFifoDiagnostic;
  assert.equal(diagnostic.requestedOwners, 925);
  assert.equal(diagnostic.completeOwners, 140);
  assert.equal(diagnostic.partialOwners, 785);
  assert.equal(diagnostic.certifiedTriangles, 44_822);
  assert.equal(diagnostic.boundsWithin1e6Feet, 103);
  assert.equal(diagnostic.boundsWithinHalfFoot, 118);
  assert.equal(diagnostic.exactTriangleCount, 97);

  const railingShape = "3:2215,4:2215,5:2343";
  assert.equal(report.byIfcClass.IfcRailing?.gRepShapes[railingShape], 105);
  assert.equal(
    report.byIfcClass.IfcRailing?.completeGRepShapes[railingShape],
    96,
  );
  assert.equal(report.byIfcClass.IfcRailing?.fullFifoBoundsWithinHalfFoot, 96);

  const wallShape =
    "3:2254,4:2254,5:2254,6:2254,7:2248,8:2248,9:2248,10:2248,11:2343";
  assert.equal(report.byIfcClass.IfcWallStandardCase?.gRepShapes[wallShape], 24);
  assert.equal(
    report.byIfcClass.IfcWallStandardCase?.completeGRepShapes[wallShape],
    24,
  );
  assert.equal(report.byIfcClass.IfcWall?.gRepShapes[wallShape], 10);
  assert.equal(report.byIfcClass.IfcWall?.completeGRepShapes[wallShape], 10);

  const rampShape = "3:2215,4:2215,5:2343,6:2343";
  assert.equal(
    (report.byIfcClass.IfcRamp?.gRepShapes[rampShape] ?? 0) +
      (report.byIfcClass.IfcSlab?.gRepShapes[rampShape] ?? 0),
    12,
  );
  assert.equal(
    (report.byIfcClass.IfcRamp?.completeGRepShapes[rampShape] ?? 0) +
      (report.byIfcClass.IfcSlab?.completeGRepShapes[rampShape] ?? 0),
    10,
  );
});
