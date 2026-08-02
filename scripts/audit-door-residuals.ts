#!/usr/bin/env node

/** Diagnose the remaining rendered-door extent disagreements against an IFC oracle. */
import { writeFileSync } from "node:fs";

import { convertModel } from "./audit-coverage.ts";
import { meshBoundsByElement, readTruthBoxes, summarizeAgreement, type Box } from "./overlay-diff.ts";

const [rvtPath, ifcPath] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const jsonIndex = process.argv.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : undefined;
if (!rvtPath || !ifcPath) {
  throw new Error("usage: audit-door-residuals.ts <model.rvt> <model.ifc> [--json report.json]");
}

const result = convertModel(rvtPath);
const truth = await readTruthBoxes(ifcPath);
const rendered = meshBoundsByElement(result.meshes, result.origin);
const records = new Map(result.elementBounds.map((record) => [record.elementId, record]));

const cornersBox = (corners: [number, number, number][]): Box => [
  Math.min(...corners.map((corner) => corner[0])),
  Math.min(...corners.map((corner) => corner[1])),
  Math.min(...corners.map((corner) => corner[2])),
  Math.max(...corners.map((corner) => corner[0])),
  Math.max(...corners.map((corner) => corner[1])),
  Math.max(...corners.map((corner) => corner[2])),
];

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

const doors = [...truth]
  .filter(([, entry]) => entry.type === "IFCDOOR")
  .flatMap(([elementId, entry]) => {
    const got = rendered.get(elementId);
    const record = records.get(elementId);
    if (!got || !record) return [];
    const reconstructed = record.orientedBox ? cornersBox(record.orientedBox) : null;
    return [{
      elementId,
      route: record.doorLeafSource ?? "none",
      typeName: record.typeName ?? null,
      bounds: got,
      reconstructed,
      truth: entry.box,
      ...errors(got, entry.box),
      reconstructedErrors: reconstructed ? errors(reconstructed, entry.box) : null,
    }];
  });

const routes = [...new Set(doors.map((door) => door.route))].sort().map((route) => {
  const members = doors.filter((door) => door.route === route);
  return {
    route,
    agreement: summarizeAgreement(members),
    worstAxis: Object.fromEntries(axisNames.map((axis, axisIndex) => [
      axis,
      {
        centre: members.filter((door) => door.centreByAxis[axisIndex]! >= 0.5).length,
        size: members.filter((door) => door.sizeByAxis[axisIndex]! >= 0.5).length,
      },
    ])),
  };
});

const report = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-door-residuals.ts",
  agreement: summarizeAgreement(doors),
  routes,
  reconstructedAgreement: summarizeAgreement(doors.flatMap((door) =>
    door.reconstructedErrors
      ? [{ ...door, ...door.reconstructedErrors }]
      : [])),
  mismatches: doors
    .filter((door) => door.centre >= 0.5 || door.size >= 0.5)
    .sort((left, right) =>
      Math.max(right.centre, right.size) - Math.max(left.centre, left.size))
    .map((door) => ({
      ...door,
      centreByAxis: Object.fromEntries(axisNames.map((axis, index) => [axis, door.centreByAxis[index]])),
      sizeByAxis: Object.fromEntries(axisNames.map((axis, index) => [axis, door.sizeByAxis[index]])),
    })),
};

console.log(JSON.stringify({
  ...report,
  mismatchCount: report.mismatches.length,
  mismatches: report.mismatches.slice(0, 20),
}, null, 2));
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
