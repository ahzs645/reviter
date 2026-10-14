#!/usr/bin/env node
/**
 * Convert an original RVT without reference-assisted repairs, export its GLB
 * and IFC, and record a geometry fingerprint for before/after comparisons.
 *
 * node --experimental-strip-types --import ./scripts/register-test-typescript.mjs \
 *   scripts/audit-semantic-corpus.ts model.rvt --out work/semantic-audit
 *
 * --baseline compares a prior report from the SAME source bytes. --reference-glb
 * additionally measures surface agreement with a supplied Autodesk export. That
 * comparison registers scale and centre and is not absolute placement proof.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { makeGlb } from "../lib/reviter/export-glb.ts";
import { makeIfc } from "../lib/reviter/export-ifc.ts";
import { compareGlbs } from "./glb-surface-diff.ts";
import { optionValue, positionals } from "./lib/rvt-harness.ts";

const [modelPath] = positionals("--out", "--baseline", "--reference-glb");
const directory = optionValue("--out");
if (!modelPath || !directory) throw new Error(
  "usage: audit-semantic-corpus.ts <model.rvt> --out <directory> [--baseline report.json] [--reference-glb model.glb]",
);
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const bytes = readFileSync(modelPath);
const start = performance.now();
const result = convertRvtBytes(bytes, basename(modelPath), {});
if (!result.ok) throw new Error(result.error);
const conversionMs = performance.now() - start;
const fingerprint = createHash("sha256").update(JSON.stringify(result.origin));
for (const mesh of result.meshes) {
  for (const key of ["positions", "indices", "elementIds"] as const) {
    fingerprint.update(key).update(JSON.stringify(mesh[key]) ?? "undefined");
  }
}
const geometrySha256 = fingerprint.digest("hex");
const sourceSha256 = hash(bytes);
const glb = new Uint8Array(makeGlb(result));
const ifc = makeIfc(result);
const baselinePath = optionValue("--baseline");
const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, "utf8")) as {
  sourceSha256?: string; geometrySha256?: string;
} : undefined;
const preservation = baseline ? {
  sameSource: baseline.sourceSha256 === sourceSha256,
  identicalGeometry: baseline.geometrySha256 === geometrySha256,
} : undefined;
const referencePath = optionValue("--reference-glb");
const surface = referencePath ? compareGlbs(glb, readFileSync(referencePath), 0.5) : undefined;
const report = {
  schemaVersion: 1,
  model: basename(modelPath), sourceSha256, conversionMs, geometrySha256,
  glbSha256: hash(glb), triangles: result.meshes.reduce((n, m) => n + m.indices.length / 3, 0),
  drawnElements: new Set(result.meshes.flatMap(m => Array.from(m.elementIds ?? []))).size,
  elementBounds: result.elementBounds.length,
  identities: result.nativeIdentity?.decodedIdentityCount ?? 0,
  decoderCoverage: result.decoderCoverage,
  nativeRooms: result.nativeRoomCoverage ?? null,
  nativePhases: {
    names: result.nativePhases?.phases.length ?? 0,
    created: result.nativePhases?.relations.filter(relation => relation.createdPhaseId != null).length ?? 0,
    demolished: result.nativePhases?.relations.filter(relation => relation.demolishedPhaseId != null).length ?? 0,
  },
  designOptions: {
    status: result.designOptions?.status ?? "unavailable",
    sets: result.designOptions?.sets.length ?? 0,
    unresolvedSets: result.designOptions?.unresolvedSets.length ?? 0,
  },
  ifcExportSettingOwners: result.nativeIfcExportParameters?.length ?? 0,
  preservation,
  referenceSurface: surface && {
    cellMetres: surface.cellMetres,
    neighbourToleranceMetres: surface.neighbourToleranceMetres,
    registration: surface.registration,
    recoveredCoverage: surface.diff.recoveredCoverage,
    referenceCoverage: surface.diff.referenceCoverage,
    recoveredVoxels: surface.diff.recoveredVoxels,
    referenceVoxels: surface.diff.referenceVoxels,
  },
};
mkdirSync(directory, { recursive: true });
const stem = basename(modelPath).replace(/\.rvt$/i, "");
writeFileSync(join(directory, `${stem}.glb`), glb);
writeFileSync(join(directory, `${stem}.ifc`), ifc);
writeFileSync(join(directory, `${stem}.json`), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (preservation && (!preservation.sameSource || !preservation.identicalGeometry)) process.exitCode = 1;
