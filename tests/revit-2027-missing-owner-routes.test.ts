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
    publicSyntacticDirectOwnerIds: number;
    baselineDirectOwnerIds: number;
    conditionedGeometry: {
      candidateIfcTags: number;
      completeIfcTags: number;
      ifcBoundsWithinHalfFoot: number;
      exactIfcTriangleCount: number;
      fixedCorpusCandidateOwners: number;
      fixedCorpusCompleteOwners: number;
      fixedCorpusIfcBoundsWithinHalfFoot: number;
      fixedCorpusExactIfcTriangleCount: number;
    };
    embeddedGeometry: {
      candidateOwners: number;
      completeOwners: number;
      productionEmittedOwners: number;
      ifcBoundsWithinHalfFoot: number;
      exactIfcTriangleCount: number;
    };
    boundedTessellator: {
      candidateOwners: number;
      coverageCompleteOwners: number;
      productionEmittedOwners: number;
      remainingWithoutCompleteCertifiedGeometry: number;
      ifcBoundsWithinHalfFoot: number;
      exactIfcTriangleCount: number;
    };
    ifcCertifiedTagCoverage: {
      denominator: number;
      baselineTagPresence: number;
      boundedTessellatorCompleteTags: number;
      tagPresenceTotal: number;
      tagPresenceRatio: number;
      boundedTessellatorIfcBoundsWithinHalfFoot: number;
      ifcSpatialParityTotal: number;
      ifcSpatialParityRatio: number;
    };
  };
  carriers: Record<string, number>;
  byIfcClass: Record<string, {
    tags: number;
    fullFifoCertifiedOwners: number;
    fullFifoBoundsWithinHalfFoot: number;
    gRepShapes: Record<string, number>;
    completeGRepShapes: Record<string, number>;
    halfFootGRepShapes: Record<string, number>;
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
    "own-full-fifo-certified-mesh": 722,
    "own-certified-direct-grep-shape": 112,
    "framed-semantic-record-only": 38,
    "no-framed-partition-record": 18,
    "own-insertable-instance-without-placement": 15,
    "own-uncertified-gelement": 15,
    "host-to-certified-hosted-children": 5,
  });
  assert.equal(report.scope.publicSyntacticDirectOwnerIds, 16_977);
  assert.equal(report.scope.baselineDirectOwnerIds, 13_568);
  assert.deepEqual(report.scope.conditionedGeometry, {
    candidateIfcTags: 474,
    completeIfcTags: 418,
    ifcBoundsWithinHalfFoot: 347,
    exactIfcTriangleCount: 332,
    fixedCorpusCandidateOwners: 508,
    fixedCorpusCompleteOwners: 446,
    fixedCorpusIfcBoundsWithinHalfFoot: 354,
    fixedCorpusExactIfcTriangleCount: 333,
  });
  assert.deepEqual(report.scope.boundedTessellator, {
    candidateOwners: 151,
    coverageCompleteOwners: 141,
    productionEmittedOwners: 141,
    remainingWithoutCompleteCertifiedGeometry: 203,
    ifcBoundsWithinHalfFoot: 119,
    exactIfcTriangleCount: 98,
  });
  assert.deepEqual(report.scope.embeddedGeometry, {
    candidateOwners: 209,
    completeOwners: 169,
    productionEmittedOwners: 169,
    ifcBoundsWithinHalfFoot: 169,
    exactIfcTriangleCount: 56,
  });
  assert.deepEqual(
    {
      denominator: report.scope.ifcCertifiedTagCoverage.denominator,
      baseline: report.scope.ifcCertifiedTagCoverage.baselineTagPresence,
      boundedComplete:
        report.scope.ifcCertifiedTagCoverage.boundedTessellatorCompleteTags,
      presence: report.scope.ifcCertifiedTagCoverage.tagPresenceTotal,
      spatial: report.scope.ifcCertifiedTagCoverage.ifcSpatialParityTotal,
    },
    {
      denominator: 36_144,
      baseline: 35_203,
      boundedComplete: 141,
      presence: 35_931,
      spatial: 35_838,
    },
  );
  assert.equal(
    report.scope.ifcCertifiedTagCoverage.tagPresenceRatio,
    35_931 / 36_144,
  );
  assert.equal(
    report.scope.ifcCertifiedTagCoverage.ifcSpatialParityRatio,
    35_838 / 36_144,
  );
  assert.equal(report.ownedCertifiedChildrenDiagnostic.targetsWithCertifiedChildren, 4);
  assert.equal(report.scan.partitionChunks, 3_666);
  assert.equal(report.scan.failedPartitionChunks, 0);
});

test("full FIFO coverage preserves negative controls before bounds admission", () => {
  const diagnostic = report.requestedOwnerFullFifoDiagnostic;
  assert.equal(diagnostic.requestedOwners, 925);
  assert.equal(diagnostic.completeOwners, 722);
  assert.equal(diagnostic.partialOwners, 203);
  assert.equal(diagnostic.certifiedTriangles, 75_346);
  assert.equal(diagnostic.boundsWithin1e6Feet, 554);
  assert.equal(diagnostic.boundsWithinHalfFoot, 629);
  assert.equal(diagnostic.exactTriangleCount, 486);

  const railingShape = "certified-direct-root-shape";
  assert.equal(report.byIfcClass.IfcRailing?.gRepShapes[railingShape], 105);
  assert.equal(
    report.byIfcClass.IfcRailing?.completeGRepShapes[railingShape],
    97,
  );
  assert.equal(report.byIfcClass.IfcRailing?.fullFifoBoundsWithinHalfFoot, 97);

  const wallShape = "certified-direct-root-shape";
  assert.equal(report.byIfcClass.IfcWallStandardCase?.gRepShapes[wallShape], 24);
  assert.equal(
    report.byIfcClass.IfcWallStandardCase?.completeGRepShapes[wallShape],
    24,
  );
  assert.equal(report.byIfcClass.IfcWall?.gRepShapes[wallShape], 10);
  assert.equal(report.byIfcClass.IfcWall?.completeGRepShapes[wallShape], 10);

  const rampShape = "certified-direct-root-shape";
  assert.equal(
    (report.byIfcClass.IfcRamp?.gRepShapes[rampShape] ?? 0) +
      (report.byIfcClass.IfcSlab?.gRepShapes[rampShape] ?? 0),
    38,
  );
  assert.equal(
    (report.byIfcClass.IfcRamp?.completeGRepShapes[rampShape] ?? 0) +
      (report.byIfcClass.IfcSlab?.completeGRepShapes[rampShape] ?? 0),
    36,
  );
});

test("class-independent descriptor predicate bounds candidate work", () => {
  assert.equal(report.scope.boundedTessellator.candidateOwners, 151);
  assert.equal(report.scope.boundedTessellator.coverageCompleteOwners, 141);
  assert.equal(report.scope.boundedTessellator.ifcBoundsWithinHalfFoot, 119);
  assert.equal(151 - 141, 10);
  assert.equal(
    report.scope.conditionedGeometry.fixedCorpusCompleteOwners,
    446,
  );
  assert.equal(
    report.scope.conditionedGeometry.fixedCorpusCandidateOwners -
      report.scope.conditionedGeometry.fixedCorpusCompleteOwners,
    62,
  );
  assert.equal(report.scope.embeddedGeometry.candidateOwners, 209);
  assert.equal(report.scope.embeddedGeometry.completeOwners, 169);
  assert.equal(209 - 169, 40);
});
