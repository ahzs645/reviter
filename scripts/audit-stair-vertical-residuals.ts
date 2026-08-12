#!/usr/bin/env node

/** Attribute tolerance-hidden Autodesk stair-riser residuals to native RVT ids. */
import { readFileSync } from "node:fs";

import { meshBoundsByElement } from "../lib/reviter/mesh-element-bounds.ts";
import { convertModel } from "./audit-coverage.ts";
import {
  isEntryPoint,
  numberOption,
  optionValue,
  positionals,
  writeJsonReport,
} from "./lib/rvt-harness.ts";
import {
  attributeResidualComponentsToElements,
  compareGlbs,
  registeredRvtElementBounds,
} from "./glb-surface-diff.ts";

const STAIRS_RUN_CATEGORY = -2_000_919;

export type IfcStairFlightCounts = {
  risers: number;
  treads: number;
};

export function readIfcStairFlightCounts(text: string): Map<number, IfcStairFlightCounts> {
  const counts = new Map<number, IfcStairFlightCounts>();
  for (const line of text.split(/\r?\n/u)) {
    if (!line.includes("=IFCSTAIRFLIGHT(")) continue;
    const match = line.match(/,'(\d+)',(\d+),(\d+),/u);
    if (!match) continue;
    const elementId = Number(match[1]);
    const next = { risers: Number(match[2]), treads: Number(match[3]) };
    const existing = counts.get(elementId);
    if (!existing || (existing.risers === next.risers && existing.treads === next.treads)) {
      counts.set(elementId, next);
    }
  }
  return counts;
}

export function auditStairVerticalResiduals(
  rvtPath: string,
  recoveredGlbPath: string,
  referenceGlbPath: string,
  cellMetres = 0.25,
  ifcPath?: string,
) {
  const recovered = convertModel(rvtPath);
  const ifcCounts = ifcPath
    ? readIfcStairFlightCounts(readFileSync(ifcPath, "utf8"))
    : new Map<number, IfcStairFlightCounts>();
  const renderedBounds = meshBoundsByElement(recovered.meshes);
  const comparison = compareGlbs(
    readFileSync(recoveredGlbPath),
    readFileSync(referenceGlbPath),
    cellMetres,
  );
  const recordById = new Map(recovered.elementBounds.map((record) => [record.elementId, record]));
  const stairElements = recovered.elementBounds.flatMap((record) => {
    if (record.categoryId !== STAIRS_RUN_CATEGORY) return [];
    const box = renderedBounds.get(record.elementId);
    if (!box) return [];
    return [{
      elementId: record.elementId,
      bounds: registeredRvtElementBounds(box, comparison.registration),
    }];
  });
  const attributed = attributeResidualComponentsToElements(
    comparison.missingVerticalStairRiserIndices,
    comparison.grid,
    stairElements,
  );
  const elements = attributed.assignments.map((assignment) => {
    const record = recordById.get(assignment.elementId);
    const ifc = ifcCounts.get(assignment.elementId) ?? null;
    const treadCells = record?.stairTreads?.length ?? 0;
    const treadElevations = new Set(
      (record?.stairTreads ?? []).map((tread) => tread[0]![2].toFixed(5)),
    ).size;
    return {
      elementId: assignment.elementId,
      voxels: assignment.indices.length,
      components: assignment.components,
      treadCells,
      treadElevations,
      ifcStairFlight: ifc,
      nativeTreadSequenceComplete: ifc != null && treadElevations === ifc.treads,
      boundsFeet: record?.boundsFeet ?? null,
      source: record == null ? null : {
        stream: record.stream,
        chunkIndex: record.chunkIndex,
        recordOffset: record.recordOffset,
      },
    };
  });
  return {
    schemaVersion: 1,
    cellMetres,
    totalDetectorVoxels: comparison.missingVerticalStairRiserIndices.length,
    attributedVoxels: elements.reduce((total, element) => total + element.voxels, 0),
    unassignedVoxels: attributed.unassignedIndices.length,
    renderedStairRuns: stairElements.length,
    elements,
  };
}

if (isEntryPoint(import.meta.url)) {
  const [rvtPath, recoveredGlbPath, referenceGlbPath] = positionals();
  if (!rvtPath || !recoveredGlbPath || !referenceGlbPath) {
    throw new Error(
      "usage: audit-stair-vertical-residuals.ts model.rvt recovered.glb reference.glb " +
      "[--cell 0.25] [--ifc model.ifc] [--json report.json]",
    );
  }
  const cellMetres = numberOption("--cell", 0.25);
  if (cellMetres <= 0) throw new Error("--cell must be positive.");
  const report = auditStairVerticalResiduals(
    rvtPath,
    recoveredGlbPath,
    referenceGlbPath,
    cellMetres,
    optionValue("--ifc") ?? undefined,
  );
  const jsonPath = optionValue("--json");
  if (jsonPath) writeJsonReport(jsonPath, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
