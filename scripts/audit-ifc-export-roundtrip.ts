#!/usr/bin/env node

/**
 * Export a recovered RVT scene to IFC4, reopen the generated file with
 * web-ifc, and compare every tagged product's rendered AABB with the triangles
 * that entered the exporter.
 *
 * This is deliberately a round-trip audit, not a comparison with Autodesk's
 * IFC export. `verify-pair.ts` measures the latter. Here the generated IFC is
 * required to preserve Reviter's own geometry and element ids without a frame,
 * unit, or ownership regression.
 *
 *   node --experimental-strip-types scripts/audit-ifc-export-roundtrip.ts model.rvt
 *   node --experimental-strip-types scripts/audit-ifc-export-roundtrip.ts model.rvt \
 *     --out recovered.ifc --json roundtrip.json
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

import { convertModel } from "./audit-coverage.ts";
import {
  meshBoundsByElement,
  readTruthBoxes,
  summarizeAgreement,
  type Box,
} from "./overlay-diff.ts";
import { optionValue, positionals, writeJsonReport } from "./lib/rvt-harness.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";

const [rvtPath] = positionals("--out", "--json");
const requestedOutput = optionValue("--out");
const jsonPath = optionValue("--json");
if (!rvtPath) {
  throw new Error(
    "usage: audit-ifc-export-roundtrip.ts <model.rvt> [--out recovered.ifc] [--json report.json]",
  );
}

const tempDirectory = requestedOutput ? null : mkdtempSync(join(tmpdir(), "reviter-ifc-roundtrip-"));
const outputPath = requestedOutput ?? join(
  tempDirectory!,
  `${basename(rvtPath).replace(/\.[^.]+$/, "")}-recovered.ifc`,
);

function errors(got: Box, expected: Box): { centre: number; size: number } {
  const centre = [0, 1, 2].map((axis) => Math.abs(
    (got[axis]! + got[axis + 3]!) / 2 -
    (expected[axis]! + expected[axis + 3]!) / 2,
  ));
  const size = [0, 1, 2].map((axis) => Math.abs(
    (got[axis + 3]! - got[axis]!) -
    (expected[axis + 3]! - expected[axis]!),
  ));
  return { centre: Math.max(...centre), size: Math.max(...size) };
}

try {
  const recovered = convertModel(rvtPath);
  const sourceBounds = meshBoundsByElement(recovered.meshes, recovered.origin);
  const sourceElementIds = new Set(sourceBounds.keys());
  const sourceTriangles = recovered.meshes.reduce(
    (total, mesh) => total + Math.floor(mesh.indices.length / 3),
    0,
  );
  const ifc = makeIfc(recovered);
  writeFileSync(outputPath, ifc);

  // Opening the generated file here is the schema/runtime validation. This
  // reader also maps web-ifc's Y-up metres back into the recovered Z-up feet.
  const reopened = await readTruthBoxes(outputPath);
  const reopenedElementIds = new Set(reopened.keys());
  const matched = [...sourceBounds].flatMap(([elementId, source]) => {
    const output = reopened.get(elementId)?.box;
    return output ? [{ elementId, ...errors(source, output) }] : [];
  });
  const missingElementIds = [...sourceElementIds]
    .filter((elementId) => !reopenedElementIds.has(elementId))
    .sort((left, right) => left - right);
  const unexpectedElementIds = [...reopenedElementIds]
    .filter((elementId) => !sourceElementIds.has(elementId))
    .sort((left, right) => left - right);
  const exact = summarizeAgreement(matched, 0.01);
  const halfFoot = summarizeAgreement(matched, 0.5);
  const report = {
    schemaVersion: 1,
    generatedBy: "scripts/audit-ifc-export-roundtrip.ts",
    source: {
      fileName: recovered.fileName,
      triangles: sourceTriangles,
      taggedGeometryElements: sourceElementIds.size,
    },
    output: {
      path: requestedOutput ? outputPath : null,
      bytes: statSync(outputPath).size,
      reopenedTaggedGeometryElements: reopenedElementIds.size,
    },
    agreementWithin001Feet: exact,
    agreementWithin05Feet: halfFoot,
    missingElementIds,
    unexpectedElementIds,
    worst: matched
      .filter((entry) => entry.centre >= 0.01 || entry.size >= 0.01)
      .sort((left, right) =>
        Math.max(right.centre, right.size) - Math.max(left.centre, left.size))
      .slice(0, 30),
  };

  console.log(JSON.stringify(report, null, 2));
  if (jsonPath) writeJsonReport(jsonPath, report);

  // A generated IFC that cannot reproduce the source scene to one hundredth
  // of a foot is not ready for delivery. Anonymous context has no Revit tag and
  // is therefore intentionally outside this identity gate.
  if (
    missingElementIds.length ||
    exact.bothOk !== exact.matched ||
    exact.matched !== sourceElementIds.size
  ) {
    process.exitCode = 1;
  }
} finally {
  if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
}
