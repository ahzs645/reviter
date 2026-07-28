import assert from "node:assert/strict";
import test from "node:test";

import {
  assessRevit2027BrepHandoff,
  CURRENT_REVIT_2027_BREP_HANDOFF_ASSESSMENT,
  CURRENT_REVIT_2027_BREP_HANDOFF_EVIDENCE,
  REVIT_2027_BREP_HANDOFF_SOURCE_SLOTS,
  type Revit2027BrepHandoffEvidence,
} from "../lib/reviter/revit-2027-brep-handoff.ts";

test("records the exact Revit 2027 source slots feeding the BRep handoff", () => {
  assert.deepEqual(REVIT_2027_BREP_HANDOFF_SOURCE_SLOTS, {
    geometry: 2343,
    face: 1825,
    gEdge: 1423,
    edgeLoop: 1434,
    edgeLoopWithChainEnvelopes: 1437,
    plane: 634,
    cone: 900,
    cylinder: 1144,
    surfaceOfRevolution: 4283,
    surfaceOfRevolutionProfileArc: 2213,
  });
});

test("current exact corpus coverage reaches the persisted graph", () => {
  const assessment = CURRENT_REVIT_2027_BREP_HANDOFF_ASSESSMENT;
  assert.equal(assessment.highestReadyStage, "persisted-graph");
  assert.equal(assessment.ready["persisted-graph"], true);
  assert.equal(assessment.ready["native-builder-equivalent"], false);
  assert.equal(assessment.ready["browser-renderer"], false);
  assert.equal(assessment.ifcParityEligible, false);
  assert.deepEqual(
    assessment.issues
      .filter((issue) => issue.stage === "persisted-graph")
      .map((issue) => [issue.capability, issue.code]),
    [],
  );
  assert.equal(
    CURRENT_REVIT_2027_BREP_HANDOFF_EVIDENCE["ordered-coedges"],
    "exact-rvt",
  );
  assert.equal(
    CURRENT_REVIT_2027_BREP_HANDOFF_EVIDENCE["coedge-direction"],
    "exact-rvt",
  );
  assert.equal(
    CURRENT_REVIT_2027_BREP_HANDOFF_EVIDENCE["surface-pcurves-2d"],
    "sampled-rvt",
  );
  assert.equal(
    CURRENT_REVIT_2027_BREP_HANDOFF_EVIDENCE["edge-curves-3d"],
    "sampled-rvt",
  );
  assert.equal(
    CURRENT_REVIT_2027_BREP_HANDOFF_EVIDENCE["face-materials"],
    "partial-exact-rvt",
  );
  assert.ok(
    assessment.issues.some(
      (issue) =>
        issue.capability === "face-materials" &&
        issue.code === "partial-only",
    ),
  );
});

test("stages are cumulative and exact RVT evidence unlocks IFC parity only after rendering", () => {
  const exact = Object.fromEntries(
    Object.keys(CURRENT_REVIT_2027_BREP_HANDOFF_EVIDENCE).map((capability) => [
      capability,
      "exact-rvt",
    ]),
  ) as Revit2027BrepHandoffEvidence;

  const ready = assessRevit2027BrepHandoff(exact);
  assert.equal(ready.highestReadyStage, "exact-material-output");
  assert.deepEqual(ready.ready, {
    "persisted-graph": true,
    "native-builder-equivalent": true,
    "browser-renderer": true,
    "exact-material-output": true,
  });
  assert.equal(ready.ifcParityEligible, true);
  assert.deepEqual(ready.issues, []);

  const noMaterial = assessRevit2027BrepHandoff({
    ...exact,
    "face-materials": "missing",
  });
  assert.equal(noMaterial.highestReadyStage, "browser-renderer");
  assert.equal(noMaterial.ifcParityEligible, true);
  assert.equal(noMaterial.ready["exact-material-output"], false);
});

test("IFC can validate output but never satisfies an RVT reader requirement", () => {
  const evidence: Revit2027BrepHandoffEvidence = {
    ...CURRENT_REVIT_2027_BREP_HANDOFF_EVIDENCE,
    "ordered-coedges": "ifc-oracle",
    "coedge-direction": "ifc-oracle",
  };
  const assessment = assessRevit2027BrepHandoff(evidence);
  assert.equal(assessment.ready["persisted-graph"], false);
  assert.ok(
    assessment.issues.some(
      (issue) =>
        issue.capability === "ordered-coedges" &&
        issue.code === "ifc-is-not-rvt-evidence",
    ),
  );
});
