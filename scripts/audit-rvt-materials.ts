#!/usr/bin/env node

/**
 * Read-only proof of concept for native Revit 2027 material definitions.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-rvt-materials.ts \
 *     --rvt model.rvt --ifc reference.ifc --json report.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import CFB from "cfb";

import {
  declareUsage,
  decodeIfcString,
  requirePath,
  sha256,
} from "./lib/rvt-harness.ts";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { scanMaterialElementRecords } from "../lib/reviter/material-records.ts";
import {
  resolveGeometryMaterialAssignments,
  scanPersistedRelationshipCandidates,
  type GeometryMaterialCandidate,
} from "../lib/reviter/family-material-relations.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitStoredPageOffset,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

declareUsage(
  "audit-rvt-materials.ts --rvt model.rvt --ifc model.ifc --json report.json",
);

const paths = {
  rvt: requirePath("--rvt"),
  ifc: requirePath("--ifc"),
  json: requirePath("--json"),
};

function readIfcMaterialNames(text: string): string[] {
  const names: string[] = [];
  const material = /^#\d+ *= *IFCMATERIAL\('((?:''|[^'])*)'\);\s*$/gm;
  for (let match = material.exec(text); match; match = material.exec(text)) {
    names.push(decodeIfcString(match[1]!));
  }
  return names;
}

const rvtBytes = readFileSync(paths.rvt);
const ifcBytes = readFileSync(paths.ifc);
const cfb = CFB.read(rvtBytes, { type: "buffer" });
const definitions = new Map<number, {
  elementId: number;
  name: string;
  stream: string;
  chunkIndex: number;
  storedOffset: number;
  recordOffset: number;
  objectLength: number;
  evidence:
    | "framed-material-element-name"
    | "framed-nested-material-name";
}>();
let framedMaterialElements = 0;
let namedMaterialElementRecords = 0;
let partitionStreams = 0;
let gzipChunks = 0;
let inflatedBytes = 0;
const referencedGeometryIds = new Set<number>();
const geometryMaterialCandidates: GeometryMaterialCandidate[] = [];

for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  partitionStreams += 1;
  const data = stripRevitPageChecksums(asBytes(cfb.FileIndex[entryIndex]!.content));
  const offsets = gzipOffsets(data);
  let window: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      data,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      window,
    );
    const inflated = read ??
      salvageRevitChunk(data, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    if (!inflated) continue;
    if (read) window = revitWindowTail(read);
    gzipChunks += 1;
    inflatedBytes += inflated.byteLength;

    const scan = scanMaterialElementRecords(inflated, 2027);
    geometryMaterialCandidates.push(
      ...scanPersistedRelationshipCandidates(inflated, 2027).geometryMaterialCandidates,
    );
    const view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    for (let offset = 0; offset + 320 <= inflated.byteLength; offset += 1) {
      if (
        view.getUint32(offset + 4, true) !== 0 ||
        view.getUint32(offset + 12, true) !== 300 ||
        view.getUint32(offset + 316, true) !== 300 ||
        view.getUint32(offset + 304, true) !== 0
      ) {
        continue;
      }
      const geometryId = view.getUint32(offset + 300, true);
      if (geometryId) referencedGeometryIds.add(geometryId);
      offset += 319;
    }
    framedMaterialElements += scan.framedMaterialElements;
    namedMaterialElementRecords += scan.namedMaterialElements;
    for (const definition of scan.definitions) {
      if (definitions.has(definition.elementId)) continue;
      definitions.set(definition.elementId, {
        elementId: definition.elementId,
        name: definition.name,
        stream: path.replace(/^Root Entry\//, ""),
        chunkIndex,
        storedOffset: revitStoredPageOffset(offsets[chunkIndex]!),
        recordOffset: definition.recordOffset,
        objectLength: definition.objectLength,
        evidence: definition.evidence,
      });
    }
  }
}

const ifcText = ifcBytes.toString("latin1");
const ifcNames = readIfcMaterialNames(ifcText);
const uniqueIfcNames = new Set(ifcNames);
const uniqueRvtNames = new Set([...definitions.values()].map((definition) => definition.name));
const exactNameMatches = [...uniqueIfcNames]
  .filter((name) => uniqueRvtNames.has(name))
  .sort((a, b) => a.localeCompare(b));
const missingIfcNames = [...uniqueIfcNames]
  .filter((name) => !uniqueRvtNames.has(name))
  .sort((a, b) => a.localeCompare(b));
const materialAssociationRelations =
  ifcText.match(/^#\d+ *= *IFCRELASSOCIATESMATERIAL\(/gm)?.length ?? 0;
const assignments = resolveGeometryMaterialAssignments(
  geometryMaterialCandidates,
  new Set(definitions.keys()),
  referencedGeometryIds,
);
const conversion = convertRvtBytes(
  new Uint8Array(rvtBytes.buffer, rvtBytes.byteOffset, rvtBytes.byteLength),
  basename(paths.rvt),
  { revitVersion: 2027, maxSegments: 1 },
);
if (!conversion.ok) throw new Error(`Material assignment conversion failed: ${conversion.error}`);
const elementAssignments = conversion.nativeElementMaterialAssignments ?? [];
const assignedElements = new Set(
  elementAssignments.map((assignment) => assignment.elementId),
);

const result = {
  schemaVersion: 2,
  generatedBy: "scripts/audit-rvt-materials.ts",
  inputs: {
    rvt: { name: basename(paths.rvt), bytes: rvtBytes.length, sha256: sha256(rvtBytes) },
    ifc: { name: basename(paths.ifc), bytes: ifcBytes.length, sha256: sha256(ifcBytes) },
  },
  scan: {
    revitVersion: 2027,
    partitionStreams,
    gzipChunks,
    inflatedBytes,
    materialElementMarker: "0x0ad3",
    framedMaterialElements,
    namedMaterialElementRecords,
    namedMaterialDefinitions: definitions.size,
    duplicateNamedMaterialRecords: namedMaterialElementRecords - definitions.size,
    unnamedOrUnsupportedNameLayout:
      framedMaterialElements - namedMaterialElementRecords,
    uniqueDecodedNames: uniqueRvtNames.size,
    definitions: [...definitions.values()].sort((a, b) => a.elementId - b.elementId),
  },
  ifcReference: {
    materialEntities: ifcNames.length,
    uniqueMaterialNames: uniqueIfcNames.size,
    materialAssociationRelations,
    exactDecodedNameMatches: exactNameMatches.length,
    exactDecodedNameCoverage: uniqueIfcNames.size
      ? exactNameMatches.length / uniqueIfcNames.size
      : null,
    exactNameMatches,
    missingIfcNames,
  },
  assignments: {
    decodedElementAssignments: assignedElements.size,
    decodedPlacedElementRelations: elementAssignments.length,
    decodedSharedGeometryAssignments:
      new Set(assignments.map((assignment) => assignment.geometryId)).size,
    decodedPrimitiveAssignments: 0,
    decodedRelations: assignments.length,
    assignedMaterialDefinitions: new Set(
      assignments.map((assignment) => assignment.materialId),
    ).size,
    status: elementAssignments.length
      ? "placed-element-shared-geometry-decoded"
      : assignments.length
      ? "shared-geometry-decoded"
      : "not-decoded",
    reason:
      "Persisted placement ids join placed elements to MaterialElem ids through three " +
      "release-gated shared-geometry layouts. They are exact element/shared-geometry " +
      "assignments, not yet per-BRep-face, per-triangle, " +
      "category-style, or view-override assignments.",
  },
};

mkdirSync(dirname(paths.json), { recursive: true });
writeFileSync(paths.json, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  `RVT: ${framedMaterialElements} framed material elements; ` +
  `${definitions.size} named definitions; ${uniqueRvtNames.size} unique names`,
);
console.log(
  `IFC: ${ifcNames.length} material entities; ${uniqueIfcNames.size} unique names; ` +
  `${exactNameMatches.length} exact name matches`,
);
console.log(
  `Assignments: ${assignments.length} shared-geometry relations across ` +
  `${new Set(assignments.map((assignment) => assignment.geometryId)).size} sources; ` +
  `${assignedElements.size} placed elements`,
);
console.log(`Wrote ${paths.json}`);
