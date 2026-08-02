#!/usr/bin/env node

/** Classify horizontal triangles whose owning RVT element has no decoded category. */
import { writeFileSync } from "node:fs";

import { convertModel } from "./audit-coverage.ts";
import { readTruthBoxes } from "./overlay-diff.ts";

const [rvtPath, ifcPath] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const jsonIndex = process.argv.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : undefined;
if (!rvtPath || !ifcPath) {
  throw new Error(
    "usage: audit-uncategorised-horizontal.ts <model.rvt> <model.ifc> [--json report.json]",
  );
}

const result = convertModel(rvtPath);
const truth = await readTruthBoxes(ifcPath);
const records = new Map(result.elementBounds.map((record) => [record.elementId, record]));

type Census = {
  elementId: number;
  horizontalTriangles: number;
  totalTriangles: number;
  maximumAbsNormalZ: number;
};

const byElement = new Map<number, Census>();
const unownedByMesh = new Map<number, {
  meshIndex: number;
  name: string;
  source: string | null;
  horizontalTriangles: number;
  totalTriangles: number;
}>();
const thresholdCounts = new Map([0.9, 0.98, 0.999].map((threshold) => [threshold, 0]));
for (const [meshIndex, mesh] of result.meshes.entries()) {
  const triangles = mesh.elementIds?.length
    ? Math.min(mesh.elementIds.length, Math.floor(mesh.indices.length / 3))
    : Math.floor(mesh.indices.length / 3);
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const ia = mesh.indices[triangle * 3]! * 3;
    const ib = mesh.indices[triangle * 3 + 1]! * 3;
    const ic = mesh.indices[triangle * 3 + 2]! * 3;
    const abx = mesh.positions[ib]! - mesh.positions[ia]!;
    const aby = mesh.positions[ib + 1]! - mesh.positions[ia + 1]!;
    const abz = mesh.positions[ib + 2]! - mesh.positions[ia + 2]!;
    const acx = mesh.positions[ic]! - mesh.positions[ia]!;
    const acy = mesh.positions[ic + 1]! - mesh.positions[ia + 1]!;
    const acz = mesh.positions[ic + 2]! - mesh.positions[ia + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz);
    if (!(length > 0)) continue;
    const absNormalZ = Math.abs(nz) / length;
    const elementId = mesh.elementIds?.[triangle];
    if (elementId == null) {
      const census = unownedByMesh.get(meshIndex) ?? {
        meshIndex,
        name: mesh.name,
        source: mesh.source ?? null,
        horizontalTriangles: 0,
        totalTriangles: 0,
      };
      census.totalTriangles += 1;
      if (absNormalZ >= 0.98) census.horizontalTriangles += 1;
      unownedByMesh.set(meshIndex, census);
      for (const threshold of thresholdCounts.keys()) {
        if (absNormalZ >= threshold) {
          thresholdCounts.set(threshold, thresholdCounts.get(threshold)! + 1);
        }
      }
      continue;
    }
    const record = records.get(elementId);
    if (!record || record.categoryId != null || record.categoryName) continue;
    const census = byElement.get(elementId) ?? {
      elementId,
      horizontalTriangles: 0,
      totalTriangles: 0,
      maximumAbsNormalZ: 0,
    };
    census.totalTriangles += 1;
    census.maximumAbsNormalZ = Math.max(census.maximumAbsNormalZ, absNormalZ);
    if (absNormalZ >= 0.98) census.horizontalTriangles += 1;
    byElement.set(elementId, census);
    for (const threshold of thresholdCounts.keys()) {
      if (absNormalZ >= threshold) {
        thresholdCounts.set(threshold, thresholdCounts.get(threshold)! + 1);
      }
    }
  }
}

const entries = [...byElement.values()]
  .filter((entry) => entry.horizontalTriangles > 0)
  .map((entry) => {
    const record = records.get(entry.elementId)!;
    const matched = truth.get(entry.elementId);
    const { min, max } = record.boundsFeet;
    const width = max.x - min.x;
    const depth = max.y - min.y;
    const height = max.z - min.z;
    const planArea = width * depth;
    const classification = matched
      ? `ifc:${matched.type}`
      : height <= 1 && planArea >= 4
        ? "unresolved-thin-horizontal-proxy"
        : height <= 1
          ? "unresolved-small-horizontal-part"
          : "unresolved-volumetric-element";
    return {
      ...entry,
      classification,
      ifcType: matched?.type ?? null,
      recordCode: record.recordCode ?? null,
      recordCount: record.recordCount ?? null,
      provenance: record.renderGeometryProvenance ?? null,
      boundsFeet: record.boundsFeet,
      dimensionsFeet: { width, depth, height },
      planAreaSquareFeet: planArea,
    };
  })
  .sort((left, right) => right.horizontalTriangles - left.horizontalTriangles);

const groups = [...new Set(entries.map((entry) => entry.classification))]
  .sort()
  .map((classification) => {
    const members = entries.filter((entry) => entry.classification === classification);
    return {
      classification,
      elements: members.length,
      horizontalTriangles: members.reduce((total, member) => total + member.horizontalTriangles, 0),
      totalTriangles: members.reduce((total, member) => total + member.totalTriangles, 0),
    };
  });
const unownedMeshes = [...unownedByMesh.values()]
  .filter((entry) => entry.horizontalTriangles > 0)
  .sort((left, right) => right.horizontalTriangles - left.horizontalTriangles);

const report = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-uncategorised-horizontal.ts",
  thresholdCounts: Object.fromEntries(
    [...thresholdCounts].map(([threshold, count]) => [String(threshold), count]),
  ),
  elements: entries.length,
  horizontalTriangles:
    entries.reduce((total, entry) => total + entry.horizontalTriangles, 0) +
    unownedMeshes.reduce((total, entry) => total + entry.horizontalTriangles, 0),
  groups,
  unownedMeshes,
  entries,
};

console.log(JSON.stringify({
  ...report,
  unownedMeshes: unownedMeshes.slice(0, 30),
  entries: entries.slice(0, 30),
}, null, 2));
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
