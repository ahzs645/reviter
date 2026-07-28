import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = JSON.parse(
  readFileSync(
    new URL(
      "../docs/generated/unbc-identity-tree-material-gaps.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  inputs: { ifc: { sha256: string; role: string } };
  nativeIdentity: {
    decoded: number;
    uniqueElementIds: number;
    uniqueUniqueIds: number;
    uniqueNumericIfcTags: number;
    numericIfcTagsLinked: number;
  };
  modelGraph: {
    owningElement: { persistedPairs: number; danglingTargets: number };
    host: { comparableIfcFillVoidPairs: number; exactIfcPairs: number };
    associatedLevel: {
      comparableIfcContainedTags: number;
      exactIfcStoreyGroups: number;
      mismatchedIfcStoreyGroups: number;
      missingIfcAssociatedLevels: number;
    };
    nestedGeometry: {
      gInstanceLinks: number;
      pairedInstanceInfoBodies: number;
      semanticSubcomponentMembershipsPublished: number;
    };
    ownerView: { persistedPairsPublished: number };
  };
  materials: {
    elementAssignments: {
      rows: number;
      comparableRows: number;
      exactNameRows: number;
    };
    faceAssignments: {
      decodedFaces: number;
      directPositiveFaces: number;
      directFacesResolvedToNamedMaterial: number;
      fallbackFaces: number;
      newlyExactFallbackFaces: number;
    };
  };
};

test("committed exact-pair audit keeps identity and relationship gates explicit", () => {
  assert.equal(
    report.inputs.ifc.sha256,
    "adb85a6fb3f831e185f23ebc58f7416e3054c4c118f490275aa7e6cd31b599a0",
  );
  assert.equal(report.inputs.ifc.role, "post-decode-audit-oracle-only");
  assert.equal(report.nativeIdentity.decoded, 74_437);
  assert.equal(report.nativeIdentity.uniqueElementIds, 74_437);
  assert.equal(report.nativeIdentity.uniqueUniqueIds, 74_437);
  assert.equal(
    report.nativeIdentity.numericIfcTagsLinked,
    report.nativeIdentity.uniqueNumericIfcTags,
  );
  assert.equal(report.modelGraph.owningElement.persistedPairs, 50_205);
  assert.equal(report.modelGraph.owningElement.danglingTargets, 0);
  assert.equal(
    report.modelGraph.host.exactIfcPairs,
    report.modelGraph.host.comparableIfcFillVoidPairs,
  );
  assert.equal(
    report.modelGraph.associatedLevel.exactIfcStoreyGroups +
      report.modelGraph.associatedLevel.mismatchedIfcStoreyGroups +
      report.modelGraph.associatedLevel.missingIfcAssociatedLevels,
    report.modelGraph.associatedLevel.comparableIfcContainedTags,
  );
  assert.equal(report.modelGraph.associatedLevel.mismatchedIfcStoreyGroups, 0);
});

test("committed material audit preserves unresolved GStyle and semantic boundaries", () => {
  assert.equal(
    report.modelGraph.nestedGeometry.gInstanceLinks,
    report.modelGraph.nestedGeometry.pairedInstanceInfoBodies,
  );
  assert.equal(
    report.modelGraph.nestedGeometry.semanticSubcomponentMembershipsPublished,
    0,
  );
  assert.equal(report.modelGraph.ownerView.persistedPairsPublished, 0);
  assert.equal(
    report.materials.elementAssignments.exactNameRows,
    report.materials.elementAssignments.comparableRows,
  );
  assert.equal(report.materials.faceAssignments.decodedFaces, 139_106);
  assert.equal(
    report.materials.faceAssignments.directFacesResolvedToNamedMaterial,
    report.materials.faceAssignments.directPositiveFaces,
  );
  assert.equal(
    report.materials.faceAssignments.directPositiveFaces +
      report.materials.faceAssignments.fallbackFaces,
    report.materials.faceAssignments.decodedFaces,
  );
  assert.equal(report.materials.faceAssignments.newlyExactFallbackFaces, 0);
});
