#!/usr/bin/env node

/** Diagnose rendered wall dimension disagreements against a paired IFC export. */
import { writeFileSync } from "node:fs";

import { convertModel } from "./audit-coverage.ts";
import {
  drawnBounds,
  meshBoundsByElement,
  readTruthBoxes,
  summarizeAgreement,
  type Box,
} from "./overlay-diff.ts";

const [rvtPath, ifcPath] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const jsonIndex = process.argv.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : undefined;
if (!rvtPath || !ifcPath) {
  throw new Error("usage: audit-wall-residuals.ts <model.rvt> <model.ifc> [--json report.json]");
}

const result = convertModel(rvtPath);
const truth = await readTruthBoxes(ifcPath);
const rendered = meshBoundsByElement(result.meshes, result.origin);
const records = new Map(result.elementBounds.map((record) => [record.elementId, record]));
const axisNames = ["x", "y", "z"] as const;

const errors = (got: Box, expected: Box) => {
  const centreByAxis = axisNames.map((_, axis) => Math.abs(
    (got[axis]! + got[axis + 3]!) / 2 -
    (expected[axis]! + expected[axis + 3]!) / 2,
  ));
  const sizeByAxis = axisNames.map((_, axis) => Math.abs(
    (got[axis + 3]! - got[axis]!) -
    (expected[axis + 3]! - expected[axis]!),
  ));
  return {
    centre: Math.max(...centreByAxis),
    size: Math.max(...sizeByAxis),
    centreByAxis,
    sizeByAxis,
  };
};

const walls = [...truth]
  .filter(([, entry]) => entry.type === "IFCWALLSTANDARDCASE" || entry.type === "IFCWALL")
  .flatMap(([elementId, entry]) => {
    const got = rendered.get(elementId);
    const record = records.get(elementId);
    if (!got || !record) return [];
    const recovered = drawnBounds({
      ...record,
      // Measure the independent proxy route even where native admission won.
      renderGeometryProvenance: "reconstructed",
    });
    const route = record.renderGeometryProvenance === "native"
      ? "native"
      : record.arcs?.length
        ? "arc"
        : record.solids?.length || record.solid
          ? "analytic-solid"
          : record.orientedBox
            ? "oriented-box"
            : "bounds";
    const nativeUnderfillFeet = Math.max(
      0,
      ...axisNames.flatMap((_, axis) => [
        got[axis]! - recovered[axis]!,
        recovered[axis + 3]! - got[axis + 3]!,
      ]),
    );
    const nativeSpanDisagreementFeet = Math.max(...axisNames.map((_, axis) => Math.abs(
      (got[axis + 3]! - got[axis]!) -
      (recovered[axis + 3]! - recovered[axis]!),
    )));
    const nativeCentreDisagreementFeet = Math.max(...axisNames.map((_, axis) => Math.abs(
      (got[axis + 3]! + got[axis]!) / 2 -
      (recovered[axis + 3]! + recovered[axis]!) / 2,
    )));
    const nativeOverfillFeet = Math.max(...axisNames.map((_, axis) =>
      (got[axis + 3]! - got[axis]!) -
      (recovered[axis + 3]! - recovered[axis]!)));
    return [{
      elementId,
      ifcType: entry.type,
      route,
      nativeUnderfillFeet,
      nativeSpanDisagreementFeet,
      nativeCentreDisagreementFeet,
      nativeOverfillFeet,
      categoryName: record.categoryName ?? null,
      recordCode: record.recordCode ?? null,
      bounds: got,
      recovered,
      truth: entry.box,
      ...errors(got, entry.box),
      recoveredErrors: errors(recovered, entry.box),
    }];
  });

const groups = (key: "ifcType" | "route") =>
  [...new Set(walls.map((wall) => wall[key]))].sort().map((value) => {
    const members = walls.filter((wall) => wall[key] === value);
    return {
      [key]: value,
      agreement: summarizeAgreement(members),
      worstAxis: Object.fromEntries(axisNames.map((axis, axisIndex) => [
        axis,
        {
          centre: members.filter((wall) => wall.centreByAxis[axisIndex]! >= 0.5).length,
          size: members.filter((wall) => wall.sizeByAxis[axisIndex]! >= 0.5).length,
        },
      ])),
    };
  });

const report = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-wall-residuals.ts",
  agreement: summarizeAgreement(walls),
  recoveredAgreement: summarizeAgreement(walls.map((wall) => ({
    ...wall,
    ...wall.recoveredErrors,
  }))),
  nativeUnderfillCandidates: (() => {
    const candidates = walls.filter((wall) =>
      wall.route === "native" && wall.nativeUnderfillFeet >= 0.5);
    return {
      elements: candidates.length,
      currentAgreement: summarizeAgreement(candidates),
      recoveredAgreement: summarizeAgreement(candidates.map((wall) => ({
        ...wall,
        ...wall.recoveredErrors,
      }))),
      recoveredSizeBetter: candidates.filter((wall) =>
        wall.recoveredErrors.size < wall.size).length,
      recoveredSizeWorse: candidates.filter((wall) =>
        wall.recoveredErrors.size > wall.size).length,
    };
  })(),
  nativeSpanCandidates: (() => {
    const candidates = walls.filter((wall) =>
      wall.route === "native" && wall.nativeSpanDisagreementFeet >= 0.5);
    return {
      elements: candidates.length,
      currentAgreement: summarizeAgreement(candidates),
      recoveredAgreement: summarizeAgreement(candidates.map((wall) => ({
        ...wall,
        ...wall.recoveredErrors,
      }))),
      recoveredSizeBetter: candidates.filter((wall) =>
        wall.recoveredErrors.size < wall.size).length,
      recoveredSizeWorse: candidates.filter((wall) =>
        wall.recoveredErrors.size > wall.size).length,
    };
  })(),
  nativeCorroboratedSpanCandidates: (() => {
    const candidates = walls.filter((wall) =>
      wall.route === "native" &&
      wall.nativeSpanDisagreementFeet >= 0.5 &&
      wall.nativeCentreDisagreementFeet < 0.25);
    return {
      elements: candidates.length,
      currentAgreement: summarizeAgreement(candidates),
      recoveredAgreement: summarizeAgreement(candidates.map((wall) => ({
        ...wall,
        ...wall.recoveredErrors,
      }))),
      recoveredSizeBetter: candidates.filter((wall) =>
        wall.recoveredErrors.size < wall.size).length,
      recoveredSizeWorse: candidates.filter((wall) =>
        wall.recoveredErrors.size > wall.size).length,
    };
  })(),
  nativeCorroboratedOverfillCandidates: (() => {
    const candidates = walls.filter((wall) =>
      wall.route === "native" &&
      wall.nativeOverfillFeet >= 0.5 &&
      wall.nativeCentreDisagreementFeet < 0.25);
    return {
      elements: candidates.length,
      currentAgreement: summarizeAgreement(candidates),
      recoveredAgreement: summarizeAgreement(candidates.map((wall) => ({
        ...wall,
        ...wall.recoveredErrors,
      }))),
      recoveredSizeBetter: candidates.filter((wall) =>
        wall.recoveredErrors.size < wall.size).length,
      recoveredSizeWorse: candidates.filter((wall) =>
        wall.recoveredErrors.size > wall.size).length,
    };
  })(),
  byIfcType: groups("ifcType"),
  byRoute: groups("route"),
  mismatches: walls
    .filter((wall) => wall.centre >= 0.5 || wall.size >= 0.5)
    .sort((left, right) =>
      Math.max(right.centre, right.size) - Math.max(left.centre, left.size))
    .map((wall) => ({
      ...wall,
      centreByAxis: Object.fromEntries(axisNames.map((axis, index) => [axis, wall.centreByAxis[index]])),
      sizeByAxis: Object.fromEntries(axisNames.map((axis, index) => [axis, wall.sizeByAxis[index]])),
    })),
};

console.log(JSON.stringify({
  ...report,
  mismatchCount: report.mismatches.length,
  mismatches: report.mismatches.slice(0, 20),
}, null, 2));
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
