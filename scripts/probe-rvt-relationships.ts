#!/usr/bin/env node

/**
 * Read-only clean-room probe for persisted object-id relationships in Revit
 * partition objects.
 *
 * This intentionally reports raw, structurally framed evidence. A referenced
 * id is not called a family symbol or material assignment until its target
 * class and the paired IFC corroborate that interpretation.
 *
 * Usage:
 *   node --experimental-strip-types scripts/probe-rvt-relationships.ts \
 *     --rvt model.rvt --ifc reference.ifc
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import CFB from "cfb";

import {
  splitStepArgs,
  stepReferences,
} from "./lib/rvt-harness.ts";

import { scanMaterialElementRecords } from "../lib/reviter/material-records.ts";
import {
  resolveFamilySymbolRelations,
  resolveGeometryMaterialAssignments,
  scanPersistedRelationshipCandidates,
  type FamilySymbolCandidate,
  type GeometryMaterialCandidate,
} from "../lib/reviter/family-material-relations.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { summariseSchema } from "../lib/reviter/schema.ts";

const argv = process.argv.slice(2);
const rvtIndex = argv.indexOf("--rvt");
if (rvtIndex < 0 || !argv[rvtIndex + 1]) {
  throw new Error("Missing --rvt");
}
const rvtPath = resolve(argv[rvtIndex + 1]!);
const ifcIndex = argv.indexOf("--ifc");
const ifcPath = ifcIndex >= 0 && argv[ifcIndex + 1]
  ? resolve(argv[ifcIndex + 1]!)
  : null;

type FramedObject = {
  elementId: number;
  marker: number;
  offset: number;
  objectLength: number;
};

function framedObjects(data: Uint8Array): FramedObject[] {
  const result: FramedObject[] = [];
  if (data.byteLength < 64) return result;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 24 <= data.byteLength; offset += 1) {
    if (view.getUint32(offset + 4, true) !== 0) continue;
    const elementId = view.getUint32(offset, true);
    if (!elementId) continue;
    const objectLength = view.getUint32(offset + 12, true);
    if (objectLength < 40 || objectLength > 0xffff) continue;
    const echo = offset + objectLength + 16;
    if (echo + 4 > data.byteLength || view.getUint32(echo, true) !== objectLength) continue;
    result.push({
      elementId,
      marker: view.getUint16(offset + 16, true),
      offset,
      objectLength,
    });
    offset += objectLength + 19;
  }
  return result;
}

function add<K>(map: Map<K, number>, key: K, count = 1): void {
  map.set(key, (map.get(key) ?? 0) + count);
}

function quoted(source = ""): string | null {
  const match = /^'((?:''|[^'])*)'$/.exec(source.trim());
  if (!match) return null;
  return match[1]!
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_match, hex: string) => {
      let decoded = "";
      for (let index = 0; index + 3 < hex.length; index += 4) {
        decoded += String.fromCharCode(Number.parseInt(hex.slice(index, index + 4), 16));
      }
      return decoded;
    })
    .replace(/\\X\\([0-9A-F]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)))
    .replaceAll("''", "'");
}

function readIfcReference(path: string | null): {
  typesByRevitTag: Map<number, string>;
  materialsByRevitTag: Map<number, Set<string>>;
} {
  const typesByRevitTag = new Map<number, string>();
  const materialsByRevitTag = new Map<number, Set<string>>();
  if (!path) return { typesByRevitTag, materialsByRevitTag };
  const text = readFileSync(path, "latin1");
  const entities = new Map<number, { type: string; fields: string[] }>();
  const relations: Array<{ related: number[]; typeObject: number }> = [];
  const materialNodes = new Map<number, { name: string | null; refs: number[] }>();
  const materialRelations: Array<{ related: number[]; material: number }> = [];
  const entity = /^#(\d+) *= *([A-Z0-9_]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    const id = Number(match[1]);
    const type = match[2]!;
    const fields = splitStepArgs(match[3]!);
    entities.set(id, { type, fields });
    if (type === "IFCRELDEFINESBYTYPE") {
      relations.push({
        related: stepReferences(fields[4]),
        typeObject: stepReferences(fields[5])[0] ?? 0,
      });
    } else if (type.startsWith("IFCMATERIAL")) {
      materialNodes.set(id, {
        name: type === "IFCMATERIAL" ? quoted(fields[0]) : null,
        refs: stepReferences(match[3]),
      });
    } else if (type === "IFCRELASSOCIATESMATERIAL") {
      materialRelations.push({
        related: stepReferences(fields[4]),
        material: stepReferences(fields[5])[0] ?? 0,
      });
    }
  }
  const typeByProduct = new Map<number, number>();
  for (const relation of relations) {
    for (const product of relation.related) typeByProduct.set(product, relation.typeObject);
  }
  const materialNameMemo = new Map<number, Set<string>>();
  const materialNames = (root: number, visiting = new Set<number>()): Set<string> => {
    if (!root || visiting.has(root)) return new Set<string>();
    const memo = materialNameMemo.get(root);
    if (memo) return memo;
    const node = materialNodes.get(root);
    if (!node) return new Set<string>();
    visiting.add(root);
    const names = new Set<string>();
    if (node.name) names.add(node.name);
    for (const child of node.refs) {
      for (const name of materialNames(child, visiting)) names.add(name);
    }
    visiting.delete(root);
    materialNameMemo.set(root, names);
    return names;
  };
  const materialNamesByObject = new Map<number, Set<string>>();
  for (const relation of materialRelations) {
    const names = materialNames(relation.material);
    for (const related of relation.related) {
      const values = materialNamesByObject.get(related) ?? new Set<string>();
      for (const name of names) values.add(name);
      materialNamesByObject.set(related, values);
    }
  }
  for (const [productId, typeObject] of typeByProduct) {
    const product = entities.get(productId);
    const type = entities.get(typeObject);
    if (!product || !type) continue;
    const numericTag = quoted(product.fields.at(-1));
    const typeName = quoted(type.fields[2]);
    if (numericTag && /^\d+$/u.test(numericTag) && typeName) {
      const tag = Number(numericTag);
      typesByRevitTag.set(tag, typeName);
      const names = new Set<string>();
      for (const name of materialNamesByObject.get(productId) ?? []) names.add(name);
      for (const name of materialNamesByObject.get(typeObject) ?? []) names.add(name);
      if (names.size) materialsByRevitTag.set(tag, names);
    }
  }
  return { typesByRevitTag, materialsByRevitTag };
}

const bytes = readFileSync(rvtPath);
const cfb = CFB.read(bytes, { type: "buffer" });
const ifcReference = readIfcReference(ifcPath);
const ifcTypeByRevitTag = ifcReference.typesByRevitTag;
const schemaEntry = cfb.FileIndex
  .map((entry, index) => ({ entry, path: cfb.FullPaths[index] ?? "" }))
  .find(({ entry, path }) => entry.size > 0 && /\/Formats\/Latest$/i.test(path));
let schemaSummary: ReturnType<typeof summariseSchema> | null = null;
if (schemaEntry) {
  const stored = stripRevitPageChecksums(asBytes(schemaEntry.entry.content));
  const firstOffset = gzipOffsets(stored, 1)[0];
  const inflated = firstOffset == null ? null : inflateRevitChunk(stored, firstOffset);
  if (inflated) schemaSummary = summariseSchema(inflated);
}
const markerByElement = new Map<number, number>();
const lengthByElement = new Map<number, number>();
const geometryReferenceRows: Array<{ elementId: number; targetId: number }> = [];
const materialIds = new Set<number>();
const materialNameById = new Map<number, string>();
const decodedFamilyElementIds = new Set<number>();
const decodedFamilyCandidates: FamilySymbolCandidate[] = [];
const decodedMaterialCandidates: GeometryMaterialCandidate[] = [];
const instanceSamples: Array<{ elementId: number; bytes128To320: string }> = [];
let chunks = 0;

for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  const data = stripRevitPageChecksums(asBytes(cfb.FileIndex[entryIndex]!.content));
  const offsets = gzipOffsets(data);
  let window: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(data, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    const inflated = read ??
      salvageRevitChunk(data, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    if (!inflated) continue;
    if (read) window = revitWindowTail(read);
    chunks += 1;

    for (const definition of scanMaterialElementRecords(inflated, 2027).definitions) {
      materialIds.add(definition.elementId);
      materialNameById.set(definition.elementId, definition.name);
    }
    const relationshipScan = scanPersistedRelationshipCandidates(inflated, 2027);
    for (const familyId of relationshipScan.familyElementIds) decodedFamilyElementIds.add(familyId);
    decodedFamilyCandidates.push(...relationshipScan.familySymbolCandidates);
    decodedMaterialCandidates.push(...relationshipScan.geometryMaterialCandidates);
    const view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    for (const object of framedObjects(inflated)) {
      if (!markerByElement.has(object.elementId)) {
        markerByElement.set(object.elementId, object.marker);
        lengthByElement.set(object.elementId, object.objectLength);
      }
      if (object.objectLength !== 300) continue;
      const targetAt = object.offset + object.objectLength;
      if (targetAt + 8 > inflated.byteLength || view.getUint32(targetAt + 4, true) !== 0) continue;
      const targetId = view.getUint32(targetAt, true);
      if (targetId) {
        geometryReferenceRows.push({ elementId: object.elementId, targetId });
        if (instanceSamples.length < 3) {
          instanceSamples.push({
            elementId: object.elementId,
            bytes128To320: Buffer.from(
              inflated.subarray(object.offset + 128, object.offset + 320),
            ).toString("hex"),
          });
        }
      }
    }
  }
}

const targetMarkers = new Map<string, number>();
const targetLengths = new Map<number, number>();
let missingTargets = 0;
for (const row of geometryReferenceRows) {
  const marker = markerByElement.get(row.targetId);
  const length = lengthByElement.get(row.targetId);
  if (marker == null) {
    missingTargets += 1;
    continue;
  }
  add(targetMarkers, `0x${marker.toString(16).padStart(4, "0")}`);
  if (length != null) add(targetLengths, length);
}

const geometryTargetIds = new Set(geometryReferenceRows.map((row) => row.targetId));
const ifcTypeSetsByReferenceTarget = new Map<number, Set<string>>();
for (const row of geometryReferenceRows) {
  const ifcType = ifcTypeByRevitTag.get(row.elementId);
  if (!ifcType) continue;
  const types = ifcTypeSetsByReferenceTarget.get(row.targetId) ?? new Set<string>();
  types.add(ifcType);
  ifcTypeSetsByReferenceTarget.set(row.targetId, types);
}
const ifcFamilyByReferenceTarget = new Map<number, string>();
for (const [targetId, types] of ifcTypeSetsByReferenceTarget) {
  if (types.size !== 1) continue;
  const typeName = [...types][0]!;
  const separator = typeName.indexOf(":");
  if (separator > 0) ifcFamilyByReferenceTarget.set(targetId, typeName.slice(0, separator));
}
const ifcMaterialsByReferenceTarget = new Map<number, Set<string>>();
for (const row of geometryReferenceRows) {
  const names = ifcReference.materialsByRevitTag.get(row.elementId);
  if (!names) continue;
  const targetNames = ifcMaterialsByReferenceTarget.get(row.targetId) ?? new Set<string>();
  for (const name of names) targetNames.add(name);
  ifcMaterialsByReferenceTarget.set(row.targetId, targetNames);
}
const decodedFamilyRelations = resolveFamilySymbolRelations(
  decodedFamilyCandidates,
  decodedFamilyElementIds,
  geometryTargetIds,
);
const decodedMaterialAssignments = resolveGeometryMaterialAssignments(
  decodedMaterialCandidates,
  materialIds,
  geometryTargetIds,
);
const familyNamesByDecodedFamilyId = new Map<number, Set<string>>();
let decodedFamilyRelationsWithIfc = 0;
for (const relation of decodedFamilyRelations) {
  const name = ifcFamilyByReferenceTarget.get(relation.symbolId);
  if (!name) continue;
  decodedFamilyRelationsWithIfc += 1;
  const names = familyNamesByDecodedFamilyId.get(relation.familyId) ?? new Set<string>();
  names.add(name);
  familyNamesByDecodedFamilyId.set(relation.familyId, names);
}
let decodedAssignmentsWithIfc = 0;
let decodedAssignmentNameMatches = 0;
for (const assignment of decodedMaterialAssignments) {
  const names = ifcMaterialsByReferenceTarget.get(assignment.geometryId);
  if (!names?.size) continue;
  decodedAssignmentsWithIfc += 1;
  const decodedName = materialNameById.get(assignment.materialId);
  if (decodedName && names.has(decodedName)) decodedAssignmentNameMatches += 1;
}

type FamilyCandidate = {
  sources: Set<number>;
  familyNamesByTarget: Map<number, Set<string>>;
  targetMarkers: Map<string, number>;
};
const familyCandidates = new Map<string, FamilyCandidate>();

function addFamilyCandidate(
  key: string,
  sourceId: number,
  familyName: string,
  targetId: number,
): void {
  const candidate = familyCandidates.get(key) ?? {
    sources: new Set<number>(),
    familyNamesByTarget: new Map<number, Set<string>>(),
    targetMarkers: new Map<string, number>(),
  };
  candidate.sources.add(sourceId);
  const names = candidate.familyNamesByTarget.get(targetId) ?? new Set<string>();
  names.add(familyName);
  candidate.familyNamesByTarget.set(targetId, names);
  const targetMarker = markerByElement.get(targetId);
  add(
    candidate.targetMarkers,
    targetMarker == null ? "missing" : `0x${targetMarker.toString(16).padStart(4, "0")}`,
  );
  familyCandidates.set(key, candidate);
}

const instanceReferenceOffsets = new Map<number, number>();
const instanceOffsetTargets = new Map<number, Map<string, number>>();
const materialReferenceOffsets = new Map<string, number>();
let materialReferenceObjects = 0;
type MaterialCandidate = {
  sources: Set<number>;
  occurrences: number;
  withIfcMaterial: number;
  exactNameMatches: number;
  materialIds: Set<number>;
};
const materialCandidates = new Map<string, MaterialCandidate>();
const familySymbolSamples: Array<{
  symbolId: number;
  familyId: number;
  objectLength: number;
  bytes420To480: string;
}> = [];

for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  const data = stripRevitPageChecksums(asBytes(cfb.FileIndex[entryIndex]!.content));
  const offsets = gzipOffsets(data);
  let window: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(data, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    const inflated = read ??
      salvageRevitChunk(data, offsets[chunkIndex]!, offsets[chunkIndex + 1], window);
    if (!inflated) continue;
    if (read) window = revitWindowTail(read);

    const view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    for (const object of framedObjects(inflated)) {
      if (
        object.marker === 0x0810 &&
        geometryTargetIds.has(object.elementId) &&
        object.offset + 480 <= inflated.byteLength &&
        view.getUint32(object.offset + 453, true) === 0
      ) {
        const familyId = view.getUint32(object.offset + 449, true);
        if (familyId && familySymbolSamples.length < 10) {
          familySymbolSamples.push({
            symbolId: object.elementId,
            familyId,
            objectLength: object.objectLength,
            bytes420To480: Buffer.from(
              inflated.subarray(object.offset + 420, object.offset + 480),
            ).toString("hex"),
          });
        }
      }
      let objectHasMaterialReference = false;
      const end = Math.min(inflated.byteLength, object.offset + object.objectLength + 20);
      for (let at = object.offset + 18; at + 8 <= end; at += 1) {
        if (view.getUint32(at + 4, true) !== 0) continue;
        const targetId = view.getUint32(at, true);
        if (!targetId || targetId === object.elementId) continue;

        const sourceFamily = ifcFamilyByReferenceTarget.get(object.elementId);
        if (sourceFamily && geometryTargetIds.has(object.elementId) && markerByElement.has(targetId)) {
          const relativeOffset = at - object.offset;
          const fromEnd = at - (object.offset + object.objectLength);
          const prefix = `source=0x${object.marker.toString(16).padStart(4, "0")}`;
          addFamilyCandidate(
            `${prefix} start=${relativeOffset}`,
            object.elementId,
            sourceFamily,
            targetId,
          );
          addFamilyCandidate(
            `${prefix} end=${fromEnd}`,
            object.elementId,
            sourceFamily,
            targetId,
          );
        }

        if (object.objectLength === 300 && markerByElement.has(targetId)) {
          const relativeOffset = at - object.offset;
          add(instanceReferenceOffsets, relativeOffset);
          const targets = instanceOffsetTargets.get(relativeOffset) ?? new Map<string, number>();
          const targetMarker = markerByElement.get(targetId)!;
          add(targets, `0x${targetMarker.toString(16).padStart(4, "0")}`);
          instanceOffsetTargets.set(relativeOffset, targets);
        }

        if (materialIds.has(targetId)) {
          objectHasMaterialReference = true;
          const key =
            `source=0x${object.marker.toString(16).padStart(4, "0")}` +
            ` offset=${at - object.offset}`;
          add(materialReferenceOffsets, key);
          if (geometryTargetIds.has(object.elementId)) {
            for (const field of [
              `source=0x${object.marker.toString(16).padStart(4, "0")} start=${at - object.offset}`,
              `source=0x${object.marker.toString(16).padStart(4, "0")} end=${at - (object.offset + object.objectLength)}`,
            ]) {
              const candidate = materialCandidates.get(field) ?? {
                sources: new Set<number>(),
                occurrences: 0,
                withIfcMaterial: 0,
                exactNameMatches: 0,
                materialIds: new Set<number>(),
              };
              candidate.sources.add(object.elementId);
              candidate.occurrences += 1;
              candidate.materialIds.add(targetId);
              const ifcNames = ifcMaterialsByReferenceTarget.get(object.elementId);
              if (ifcNames?.size) {
                candidate.withIfcMaterial += 1;
                const materialName = materialNameById.get(targetId);
                if (materialName && ifcNames.has(materialName)) candidate.exactNameMatches += 1;
              }
              materialCandidates.set(field, candidate);
            }
          }
        }
      }
      if (objectHasMaterialReference) materialReferenceObjects += 1;
    }
  }
}

const topInstanceReferenceOffsets = [...instanceReferenceOffsets]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)
  .map(([offset, count]) => ({
    offset,
    count,
    targetMarkers: [...(instanceOffsetTargets.get(offset) ?? [])]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
  }));
const instanceReferenceOffsetsByPosition = [...instanceReferenceOffsets]
  .filter(([, count]) => count >= 25)
  .sort((a, b) => a[0] - b[0])
  .map(([offset, count]) => ({
    offset,
    count,
    targetMarkers: [...(instanceOffsetTargets.get(offset) ?? [])]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10),
  }));

const ifcTypesByReferenceTarget = new Map<number, Map<string, number>>();
let referenceRowsWithIfcType = 0;
for (const row of geometryReferenceRows) {
  const ifcType = ifcTypeByRevitTag.get(row.elementId);
  if (!ifcType) continue;
  referenceRowsWithIfcType += 1;
  const types = ifcTypesByReferenceTarget.get(row.targetId) ?? new Map<string, number>();
  add(types, ifcType);
  ifcTypesByReferenceTarget.set(row.targetId, types);
}
let pureReferenceTargets = 0;
let impureReferenceTargets = 0;
let pureReferenceRows = 0;
const impureReferenceSamples: Array<{
  targetId: number;
  marker: string | null;
  ifcTypes: Array<[string, number]>;
}> = [];
for (const [targetId, types] of ifcTypesByReferenceTarget) {
  const rows = [...types.values()].reduce((sum, count) => sum + count, 0);
  if (types.size === 1) {
    pureReferenceTargets += 1;
    pureReferenceRows += rows;
  } else {
    impureReferenceTargets += 1;
    if (impureReferenceSamples.length < 20) {
      const marker = markerByElement.get(targetId);
      impureReferenceSamples.push({
        targetId,
        marker: marker == null ? null : `0x${marker.toString(16).padStart(4, "0")}`,
        ifcTypes: [...types].sort((a, b) => b[1] - a[1]),
      });
    }
  }
}

const familyCandidateSummary = [...familyCandidates].flatMap(([field, candidate]) => {
  const familyNames = new Set<string>();
  let pureTargets = 0;
  for (const names of candidate.familyNamesByTarget.values()) {
    for (const name of names) familyNames.add(name);
    if (names.size === 1) pureTargets += 1;
  }
  const targetsByFamily = new Map<string, Set<number>>();
  for (const [targetId, names] of candidate.familyNamesByTarget) {
    for (const name of names) {
      const targets = targetsByFamily.get(name) ?? new Set<number>();
      targets.add(targetId);
      targetsByFamily.set(name, targets);
    }
  }
  const oneTargetPerFamily =
    [...targetsByFamily.values()].filter((targets) => targets.size === 1).length;
  if (
    candidate.sources.size < 5 ||
    familyNames.size < 2 ||
    pureTargets !== candidate.familyNamesByTarget.size
  ) {
    return [];
  }
  return [{
    field,
    sources: candidate.sources.size,
    targets: candidate.familyNamesByTarget.size,
    families: familyNames.size,
    oneTargetPerFamily,
    targetMarkers: [...candidate.targetMarkers].sort((a, b) => b[1] - a[1]).slice(0, 8),
  }];
}).sort((a, b) =>
  b.sources - a.sources ||
  b.oneTargetPerFamily - a.oneTargetPerFamily ||
  a.field.localeCompare(b.field)
);
const familyCandidateSummaryBySourceMarker = Object.fromEntries(
  [...new Set(markerByElement.values())]
    .map((marker) => `0x${marker.toString(16).padStart(4, "0")}`)
    .filter((marker) => targetMarkers.has(marker))
    .map((marker) => [
      marker,
      familyCandidateSummary
        .filter((candidate) => candidate.field.startsWith(`source=${marker} `))
        .slice(0, 25),
    ])
    .filter(([, candidates]) => (candidates as unknown[]).length > 0),
);
const materialCandidateSummary = [...materialCandidates]
  .map(([field, candidate]) => ({
    field,
    sources: candidate.sources.size,
    occurrences: candidate.occurrences,
    withIfcMaterial: candidate.withIfcMaterial,
    exactNameMatches: candidate.exactNameMatches,
    exactNamePrecision: candidate.withIfcMaterial
      ? candidate.exactNameMatches / candidate.withIfcMaterial
      : null,
    distinctMaterialIds: candidate.materialIds.size,
  }))
  .filter((candidate) => candidate.sources >= 5 && candidate.withIfcMaterial >= 5)
  .sort((a, b) =>
    (b.exactNamePrecision ?? 0) - (a.exactNamePrecision ?? 0) ||
    b.exactNameMatches - a.exactNameMatches ||
    b.sources - a.sources
  );
const materialCandidateSummaryBySourceMarker = Object.fromEntries(
  [...new Set(markerByElement.values())]
    .map((marker) => `0x${marker.toString(16).padStart(4, "0")}`)
    .filter((marker) => targetMarkers.has(marker))
    .map((marker) => [
      marker,
      materialCandidateSummary
        .filter((candidate) => candidate.field.startsWith(`source=${marker} `))
        .slice(0, 25),
    ])
    .filter(([, candidates]) => (candidates as unknown[]).length > 0),
);

console.log(JSON.stringify({
  chunks,
  framedElements: markerByElement.size,
  distinctMarkers: new Set(markerByElement.values()).size,
  namedMaterialElementIds: materialIds.size,
  exactLength300References: geometryReferenceRows.length,
  distinctReferenceTargets: new Set(geometryReferenceRows.map((row) => row.targetId)).size,
  missingTargets,
  targetMarkers: [...targetMarkers].sort((a, b) => b[1] - a[1]).slice(0, 20),
  targetLengths: [...targetLengths].sort((a, b) => b[1] - a[1]).slice(0, 20),
  familySymbolMarker0811: [...markerByElement.values()].filter((marker) => marker === 0x0811).length,
  targetMarker0811: targetMarkers.get("0x0811") ?? 0,
  decoderResolution: {
    referencedSymbolIds: geometryTargetIds.size,
    familyElements: decodedFamilyElementIds.size,
    familySymbolRelations: decodedFamilyRelations.length,
    familySymbolRelationsWithIfcFamily: decodedFamilyRelationsWithIfc,
    familyRelationsWithIfcFamily: [...familyNamesByDecodedFamilyId.values()]
      .reduce((sum, names) => sum + (names.size ? 1 : 0), 0),
    familyTargetsWithMixedIfcNames: [...familyNamesByDecodedFamilyId.values()]
      .filter((names) => names.size > 1).length,
    materialAssignments: decodedMaterialAssignments.length,
    materialAssignmentSources: new Set(
      decodedMaterialAssignments.map((assignment) => assignment.geometryId),
    ).size,
    assignedMaterialIds: new Set(
      decodedMaterialAssignments.map((assignment) => assignment.materialId),
    ).size,
    assignmentsWithIfcMaterial: decodedAssignmentsWithIfc,
    exactIfcMaterialNameMatches: decodedAssignmentNameMatches,
    exactIfcMaterialNamePrecision: decodedAssignmentsWithIfc
      ? decodedAssignmentNameMatches / decodedAssignmentsWithIfc
      : null,
  },
  ifcTypeCorroboration: {
    ifcTypedRevitTags: ifcTypeByRevitTag.size,
    referenceRowsWithIfcType,
    distinctReferenceTargets: ifcTypesByReferenceTarget.size,
    pureReferenceTargets,
    impureReferenceTargets,
    pureReferenceRows,
    pureReferenceRowRatio: referenceRowsWithIfcType
      ? pureReferenceRows / referenceRowsWithIfcType
      : null,
    impureReferenceSamples,
  },
  familyCandidateSummary: familyCandidateSummary.slice(0, 100),
  familyCandidateSummaryBySourceMarker,
  familySymbolSamples,
  materialCandidateSummary: materialCandidateSummary.slice(0, 100),
  materialCandidateSummaryBySourceMarker,
  relevantSchemaClasses: (schemaSummary?.taggedClasses ?? []).filter((entry) =>
    ["Family", "FamilyBase", "FamilyInstance", "FamilySymbol", "InsertableInst", "InsertableObj"]
      .includes(entry.name) ||
    [0x0810, 0x0811, 0x10dc, 0x10dd, 0x10de, 0x10df].includes(entry.tag)),
  relevantSchemaReferences: (schemaSummary?.referencedClasses ?? []).filter((entry) =>
    ["Family", "FamilyBase", "FamilyInstance", "FamilySymbol", "InsertableInst", "InsertableObj"]
      .includes(entry.name) ||
    [0x0810, 0x0811, 0x10dc, 0x10dd, 0x10de, 0x10df].includes(entry.tagReference)),
  instanceSamples,
  topInstanceReferenceOffsets,
  instanceReferenceOffsetsByPosition,
  materialReferenceObjects,
  materialReferenceOffsets: [...materialReferenceOffsets]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50),
}, null, 2));
