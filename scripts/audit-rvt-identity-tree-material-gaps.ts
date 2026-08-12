#!/usr/bin/env node

/**
 * Bounded exact-pair audit for native identity, typed model relationships, and
 * material assignment after the Face -> Geometry -> GStyle fallback.
 *
 * IFC is an audit oracle only. RVT identities, relationships, geometry owners,
 * and materials are fully decoded before any IFC comparison is performed.
 *
 * Usage:
 *   node --experimental-strip-types \
 *     scripts/audit-rvt-identity-tree-material-gaps.ts \
 *     --rvt model.rvt --ifc reference.ifc --json report.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import CFB from "cfb";
import { IfcAPI } from "web-ifc";

import {
  declareUsage,
  increment,
  requirePath,
  sha256,
  splitStepArgs,
  stepReferences,
} from "./lib/rvt-harness.ts";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  scanMaterialElementRecords,
  type NativeMaterialDefinition,
} from "../lib/reviter/material-records.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";
import { isRevit2027DirectGeometryRoot } from "../lib/reviter/revit-2027-direct-geometry-root.ts";
import {
  REVIT_2027_FACE_SOURCE_CLASS_SLOT,
  REVIT_2027_GELEMENT_OBJECT_MARKER,
  REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT,
  REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT,
  REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT,
  decodeRevit2027FramedGRepRoot,
} from "./lib/revit-2027-decoders.ts";
import type {
  Revit2027FaceStatic,
  Revit2027GeometryStatic,
} from "./lib/revit-2027-decoders.ts";
import {
  replayRevit2027GRepFifo,
  type Revit2027GRepReplaySpan,
} from "../lib/reviter/revit-2027-grep-replay.ts";
import {
  bindRevit2027FaceGStyleMaterialFallback,
  scanRevit2027GStyleElementRecords,
  type Revit2027GStyleElementRecord,
} from "../lib/reviter/revit-2027-gstyle-material.ts";

declareUsage(
  "audit-rvt-identity-tree-material-gaps.ts --rvt model.rvt --ifc model.ifc --json report.json",
);

const paths = {
  rvt: requirePath("--rvt"),
  ifc: requirePath("--ifc"),
  json: requirePath("--json"),
};

function sortedCounts<K extends string | number | bigint>(
  map: ReadonlyMap<K, number>,
): Record<string, number> {
  return Object.fromEntries(
    [...map]
      .sort(([left], [right]) =>
        String(left).localeCompare(String(right), undefined, { numeric: true }))
      .map(([key, count]) => [String(key), count]),
  );
}

function quoted(source = ""): string | null {
  const match = /^'((?:''|[^'])*)'$/.exec(source.trim());
  if (!match) return null;
  return match[1]!
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_match, hex: string) => {
      let decoded = "";
      for (let index = 0; index + 3 < hex.length; index += 4) {
        decoded += String.fromCharCode(
          Number.parseInt(hex.slice(index, index + 4), 16),
        );
      }
      return decoded;
    })
    .replace(/\\X\\([0-9A-F]{2})/gi, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)))
    .replaceAll("''", "'");
}

type IfcEntity = { type: string; fields: string[]; source: string };

type IfcOracle = {
  elementCount: number;
  numericTags: Set<number>;
  typePairs: Set<string>;
  containmentStoreyByTag: Map<number, number>;
  aggregatePairs: Set<string>;
  hostPairs: Set<string>;
  materialNamesByTag: Map<number, Set<string>>;
};

async function readIfcOracle(bytes: Uint8Array): Promise<IfcOracle> {
  const text = Buffer.from(bytes).toString("latin1");
  const entities = new Map<number, IfcEntity>();
  const entityPattern = /^#(\d+) *= *([A-Z0-9_]+)\(([\s\S]*?)\);\s*$/gm;
  for (
    let match = entityPattern.exec(text);
    match;
    match = entityPattern.exec(text)
  ) {
    entities.set(Number(match[1]), {
      type: match[2]!,
      fields: splitStepArgs(match[3]!),
      source: match[3]!,
    });
  }

  const api = new IfcAPI();
  await api.Init();
  const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
  if (model < 0) throw new Error("web-ifc could not open the IFC oracle");
  const numericTags = new Set<number>();
  const elementLineIds = new Set<number>();
  const tagByLine = new Map<number, number | null>();
  const tag = (lineId: number): number | null => {
    if (tagByLine.has(lineId)) return tagByLine.get(lineId) ?? null;
    const raw = api.GetLine(model, lineId, false)?.Tag;
    const value = raw != null && typeof raw === "object" && "value" in raw
      ? raw.value
      : raw;
    const apiResult =
      typeof value === "string" && /^\d+$/u.test(value)
        ? Number(value)
        : null;
    const persistedField = quoted(entities.get(lineId)?.fields[7]);
    const result = apiResult ??
      (persistedField != null && /^\d+$/u.test(persistedField)
        ? Number(persistedField)
        : null);
    tagByLine.set(lineId, result);
    return result;
  };

  let elementCount = 0;
  for (const typeCode of api.GetIfcEntityList(model)) {
    if (!api.IsIfcElement(typeCode)) continue;
    const ids = api.GetLineIDsWithType(model, typeCode, false);
    for (let index = 0; index < ids.size(); index += 1) {
      const lineId = ids.get(index);
      elementLineIds.add(lineId);
      elementCount += 1;
      const numericTag = tag(lineId);
      if (numericTag != null) numericTags.add(numericTag);
    }
  }

  const typePairs = new Set<string>();
  const containmentStoreyByTag = new Map<number, number>();
  const aggregatePairs = new Set<string>();
  const voidHostByOpening = new Map<number, number>();
  const typeLineByElementLine = new Map<number, number>();
  const materialTargetLines = new Set<number>();
  const materialNodes = new Map<
    number,
    { name: string | null; references: number[] }
  >();

  for (const [lineId, entity] of entities) {
    if (entity.type === "IFCRELDEFINESBYTYPE") {
      const typeLine = stepReferences(entity.fields[5])[0] ?? 0;
      const typeTag = tag(typeLine);
      for (const childLine of stepReferences(entity.fields[4])) {
        typeLineByElementLine.set(childLine, typeLine);
        const childTag = tag(childLine);
        if (childTag != null && typeTag != null) {
          typePairs.add(`${childTag}:${typeTag}`);
        }
      }
    } else if (entity.type === "IFCRELCONTAINEDINSPATIALSTRUCTURE") {
      const storeyLine = stepReferences(entity.fields[5])[0] ?? 0;
      if (!storeyLine) continue;
      for (const childLine of stepReferences(entity.fields[4])) {
        const childTag = tag(childLine);
        if (childTag != null) {
          containmentStoreyByTag.set(childTag, storeyLine);
        }
      }
    } else if (
      entity.type === "IFCRELAGGREGATES" ||
      entity.type === "IFCRELNESTS"
    ) {
      const ownerTag = tag(stepReferences(entity.fields[4])[0] ?? 0);
      if (ownerTag == null) continue;
      for (const childLine of stepReferences(entity.fields[5])) {
        const childTag = tag(childLine);
        if (childTag != null) aggregatePairs.add(`${childTag}:${ownerTag}`);
      }
    } else if (entity.type === "IFCRELVOIDSELEMENT") {
      const hostLine = stepReferences(entity.fields[4])[0] ?? 0;
      const openingLine = stepReferences(entity.fields[5])[0] ?? 0;
      if (hostLine && openingLine) voidHostByOpening.set(openingLine, hostLine);
    } else if (entity.type === "IFCRELASSOCIATESMATERIAL") {
      for (const target of stepReferences(entity.fields[4])) {
        materialTargetLines.add(target);
      }
    }
    if (entity.type.startsWith("IFCMATERIAL")) {
      materialNodes.set(lineId, {
        name: entity.type === "IFCMATERIAL"
          ? quoted(entity.fields[0])
          : null,
        references: stepReferences(entity.source),
      });
    }
  }

  const hostPairs = new Set<string>();
  for (const entity of entities.values()) {
    if (entity.type !== "IFCRELFILLSELEMENT") continue;
    const openingLine = stepReferences(entity.fields[4])[0] ?? 0;
    const fillingLine = stepReferences(entity.fields[5])[0] ?? 0;
    const hostLine = voidHostByOpening.get(openingLine) ?? 0;
    const fillingTag = tag(fillingLine);
    const hostTag = tag(hostLine);
    if (fillingTag != null && hostTag != null) {
      hostPairs.add(`${fillingTag}:${hostTag}`);
    }
  }

  const materialMemo = new Map<number, Set<string>>();
  const materialNames = (
    lineId: number,
    visiting = new Set<number>(),
  ): Set<string> => {
    const memo = materialMemo.get(lineId);
    if (memo) return memo;
    const node = materialNodes.get(lineId);
    if (!node || visiting.has(lineId)) return new Set<string>();
    visiting.add(lineId);
    const names = new Set<string>();
    if (node.name) names.add(node.name);
    for (const reference of node.references) {
      for (const name of materialNames(reference, visiting)) names.add(name);
    }
    visiting.delete(lineId);
    materialMemo.set(lineId, names);
    return names;
  };
  const namesByTargetLine = new Map<number, Set<string>>();
  for (const entity of entities.values()) {
    if (entity.type !== "IFCRELASSOCIATESMATERIAL") continue;
    const materialLine = stepReferences(entity.fields[5])[0] ?? 0;
    const names = materialNames(materialLine);
    for (const targetLine of stepReferences(entity.fields[4])) {
      const values = namesByTargetLine.get(targetLine) ?? new Set<string>();
      for (const name of names) values.add(name);
      namesByTargetLine.set(targetLine, values);
    }
  }
  const materialNamesByTag = new Map<number, Set<string>>();
  for (const elementLine of elementLineIds) {
    const elementTag = tag(elementLine);
    if (elementTag == null) continue;
    const names = new Set(namesByTargetLine.get(elementLine) ?? []);
    const typeLine = typeLineByElementLine.get(elementLine);
    for (const name of namesByTargetLine.get(typeLine ?? 0) ?? []) {
      names.add(name);
    }
    if (names.size) materialNamesByTag.set(elementTag, names);
  }
  // Retain the independently observed targets as a consistency gate.
  if (
    [...namesByTargetLine.keys()].some((lineId) =>
      !materialTargetLines.has(lineId))
  ) {
    throw new Error("IFC material target collection disagrees with its graph");
  }
  api.CloseModel(model);
  api.Dispose();
  return {
    elementCount,
    numericTags,
    typePairs,
    containmentStoreyByTag,
    aggregatePairs,
    hostPairs,
    materialNamesByTag,
  };
}

function owningGeometry(
  span: Revit2027GRepReplaySpan,
  spansByReplayIndex: ReadonlyMap<number, Revit2027GRepReplaySpan>,
): Revit2027GeometryStatic | null {
  let parentReplayIndex = span.parentReplayIndex;
  while (parentReplayIndex != null) {
    const parent = spansByReplayIndex.get(parentReplayIndex);
    if (!parent) return null;
    if (
      parent.propertySourceClassSlot ===
      REVIT_2027_GEOMETRY_SOURCE_CLASS_SLOT
    ) {
      return parent.value as Revit2027GeometryStatic;
    }
    parentReplayIndex = parent.parentReplayIndex;
  }
  return null;
}

type FallbackFace = {
  renderStyleElementId: bigint;
  faceGStyleElementId: bigint;
  geometryGStyleElementId: bigint;
};

const rvtBytes = readFileSync(paths.rvt);
const ifcBytes = readFileSync(paths.ifc);
const conversion = convertRvtBytes(
  new Uint8Array(rvtBytes.buffer, rvtBytes.byteOffset, rvtBytes.byteLength),
  basename(paths.rvt),
  { revitVersion: 2027, maxSegments: 1 },
);
if (!conversion.ok) throw new Error(conversion.error);
if (conversion.decoderCoverage.revitVersion !== 2027) {
  throw new Error(
    `expected Revit 2027, received ${conversion.decoderCoverage.revitVersion}`,
  );
}

const cfb = CFB.read(rvtBytes, { type: "buffer" });
const materialDefinitions = new Map<number, NativeMaterialDefinition>();
const styles = new Map<number, Revit2027GStyleElementRecord>();
const directFaceMaterials: Array<{
  ownerElementId: number;
  materialElementId: number;
}> = [];
const fallbackFaces: FallbackFace[] = [];
const replayFailures = new Map<string, number>();
const nestedOwners = new Set<bigint>();
let chunks = 0;
let failedChunks = 0;
let geometryOwners = 0;
let decodedFaces = 0;
let facesWithoutGeometryParent = 0;
let gInstanceSpans = 0;
let instanceInfoSpans = 0;

for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const path = cfb.FullPaths[entryIndex] ?? "";
  const entry = cfb.FileIndex[entryIndex]!;
  if (entry.size <= 0 || !/\/Partitions\/[^/]+$/i.test(path)) continue;
  const stored = stripRevitPageChecksums(asBytes(entry.content));
  const offsets = gzipOffsets(stored);
  let dictionary: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      dictionary,
    );
    const inflated = read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        dictionary,
      );
    if (!inflated) {
      failedChunks += 1;
      continue;
    }
    if (read) dictionary = revitWindowTail(read);
    chunks += 1;
    for (
      const definition of scanMaterialElementRecords(inflated, 2027).definitions
    ) {
      materialDefinitions.set(definition.elementId, definition);
    }
    for (
      const style of scanRevit2027GStyleElementRecords(inflated, 2027).records
    ) {
      styles.set(style.elementId, style);
    }
    for (const frame of scanFramedElementObjects(inflated)) {
      if (frame.marker !== REVIT_2027_GELEMENT_OBJECT_MARKER) continue;
      const root = decodeRevit2027FramedGRepRoot(inflated, frame, 2027);
      if (!root.ok || !isRevit2027DirectGeometryRoot(root.value)) continue;
      const replay = replayRevit2027GRepFifo(inflated, root.value);
      if (!replay.ok) {
        increment(replayFailures, replay.error);
        continue;
      }
      geometryOwners += 1;
      const spansByReplayIndex = new Map(
        replay.value.spans.map((span) => [span.replayIndex, span]),
      );
      for (const span of replay.value.spans) {
        if (
          span.propertySourceClassSlot ===
          REVIT_2027_GINSTANCE_SOURCE_CLASS_SLOT
        ) {
          gInstanceSpans += 1;
          nestedOwners.add(replay.value.ownerElementId);
        } else if (
          span.propertySourceClassSlot ===
          REVIT_2027_INSTANCE_INFO_SOURCE_CLASS_SLOT
        ) {
          instanceInfoSpans += 1;
        }
        if (
          span.propertySourceClassSlot !== REVIT_2027_FACE_SOURCE_CLASS_SLOT
        ) {
          continue;
        }
        decodedFaces += 1;
        const face = span.value as Revit2027FaceStatic;
        if (face.renderStyleElementId > 0n) {
          if (face.renderStyleElementId <= BigInt(Number.MAX_SAFE_INTEGER)) {
            directFaceMaterials.push({
              ownerElementId: Number(replay.value.ownerElementId),
              materialElementId: Number(face.renderStyleElementId),
            });
          }
          continue;
        }
        const geometry = owningGeometry(span, spansByReplayIndex);
        if (!geometry) facesWithoutGeometryParent += 1;
        fallbackFaces.push({
          renderStyleElementId: face.renderStyleElementId,
          faceGStyleElementId: face.gInfo.gStyleElementId,
          geometryGStyleElementId:
            geometry?.gInfo.gStyleElementId ?? -1n,
        });
      }
    }
  }
}

const fallbackStatuses = new Map<string, number>();
const fallbackReasons = new Map<string, number>();
const fallbackSources = new Map<string, number>();
let newlyExactFallbackFaces = 0;
for (const face of fallbackFaces) {
  const binding = bindRevit2027FaceGStyleMaterialFallback(
    face,
    styles,
    materialDefinitions,
  );
  increment(fallbackStatuses, binding.status);
  if ("reason" in binding) increment(fallbackReasons, binding.reason);
  if ("source" in binding) increment(fallbackSources, binding.source);
  if (binding.status === "exact-material") newlyExactFallbackFaces += 1;
}

// IFC is deliberately opened only after the RVT conversion and face/style
// material graph above are complete.
const ifc = await readIfcOracle(
  new Uint8Array(ifcBytes.buffer, ifcBytes.byteOffset, ifcBytes.byteLength),
);

const identity = conversion.nativeIdentity;
const ownership = conversion.elementOwnership;
if (!identity || !ownership) {
  throw new Error("native identity or element ownership was not decoded");
}
const identityIds = new Set(identity.identities.map((entry) => entry.elementId));
const linkedIfcTags = [...ifc.numericTags].filter((id) => identityIds.has(id));

const ownershipPairs = new Set(
  ownership.relations.map((relation) =>
    `${relation.elementId}:${relation.ownerId}`),
);
const hostPairs = new Set(
  (conversion.nativeHostRelations ?? []).map((relation) =>
    `${relation.elementId}:${relation.hostId}`),
);
const levelPairs = new Set(
  (conversion.nativeAssociatedLevelRelations ?? []).map((relation) =>
    `${relation.elementId}:${relation.levelId}`),
);
const typePairs = new Set(
  conversion.elementBounds
    .filter((record) => record.typeId != null)
    .map((record) => `${record.elementId}:${record.typeId}`),
);
const familyInstanceIds = new Set(
  conversion.elementBounds
    .filter((record) => record.familySymbolId != null)
    .map((record) => record.elementId),
);
const familyBoundInstanceIds = new Set(
  conversion.elementBounds
    .filter((record) => record.familyId != null)
    .map((record) => record.elementId),
);
const levelByElement = new Map(
  (conversion.nativeAssociatedLevelRelations ?? []).map((relation) => [
    relation.elementId,
    relation.levelId,
  ]),
);
const storeysByNativeLevel = new Map<number, Set<number>>();
for (const [elementId, storeyLine] of ifc.containmentStoreyByTag) {
  const levelId = levelByElement.get(elementId);
  if (levelId == null) continue;
  const storeys = storeysByNativeLevel.get(levelId) ?? new Set<number>();
  storeys.add(storeyLine);
  storeysByNativeLevel.set(levelId, storeys);
}
let exactIfcStoreyGroups = 0;
let mismatchedIfcStoreyGroups = 0;
let missingIfcAssociatedLevels = 0;
for (const [elementId, storeyLine] of ifc.containmentStoreyByTag) {
  const levelId = levelByElement.get(elementId);
  if (levelId == null) {
    missingIfcAssociatedLevels += 1;
    continue;
  }
  const storeys = storeysByNativeLevel.get(levelId);
  if (storeys?.size === 1 && storeys.has(storeyLine)) {
    exactIfcStoreyGroups += 1;
  } else {
    mismatchedIfcStoreyGroups += 1;
  }
}

function pairIntersection(
  nativePairs: ReadonlySet<string>,
  oraclePairs: ReadonlySet<string>,
): number {
  let count = 0;
  for (const pair of oraclePairs) if (nativePairs.has(pair)) count += 1;
  return count;
}

const assignmentRows = [
  ...(conversion.nativeElementMaterialAssignments ?? []),
  ...(conversion.nativeCompoundLayerMaterialAssignments ?? []),
];
const assignedElementIds = new Set(
  assignmentRows.map((assignment) => assignment.elementId),
);
const assignmentEvidence = new Map<string, number>();
let assignmentRowsWithIfc = 0;
let assignmentRowsWithExactIfcName = 0;
for (const assignment of assignmentRows) {
  increment(assignmentEvidence, assignment.evidence);
  const names = ifc.materialNamesByTag.get(assignment.elementId);
  if (!names) continue;
  assignmentRowsWithIfc += 1;
  const nativeName = materialDefinitions.get(assignment.materialId)?.name;
  if (nativeName && names.has(nativeName)) assignmentRowsWithExactIfcName += 1;
}
let directFacesWithResolvedMaterial = 0;
let directFacesWithIfcMaterial = 0;
let directFacesWithExactIfcName = 0;
const directFaceOwners = new Set<number>();
const directMaterialIds = new Set<number>();
for (const face of directFaceMaterials) {
  directFaceOwners.add(face.ownerElementId);
  directMaterialIds.add(face.materialElementId);
  const nativeName = materialDefinitions.get(face.materialElementId)?.name;
  if (!nativeName) continue;
  directFacesWithResolvedMaterial += 1;
  const ifcNames = ifc.materialNamesByTag.get(face.ownerElementId);
  if (!ifcNames) continue;
  directFacesWithIfcMaterial += 1;
  if (ifcNames.has(nativeName)) directFacesWithExactIfcName += 1;
}

const uniqueGraphMembers = new Set([
  ...ownership.relations.map((relation) => relation.elementId),
  ...(conversion.nativeHostRelations ?? []).map((relation) =>
    relation.elementId),
  ...(conversion.nativeAssociatedLevelRelations ?? []).map((relation) =>
    relation.elementId),
  ...conversion.elementBounds
    .filter((record) => record.typeId != null)
    .map((record) => record.elementId),
  ...familyInstanceIds,
]);

const report = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-rvt-identity-tree-material-gaps.ts",
  inputs: {
    rvt: {
      name: basename(paths.rvt),
      bytes: rvtBytes.byteLength,
      sha256: sha256(rvtBytes),
    },
    ifc: {
      name: basename(paths.ifc),
      bytes: ifcBytes.byteLength,
      sha256: sha256(ifcBytes),
      role: "post-decode-audit-oracle-only",
    },
  },
  nativeIdentity: {
    format: identity.format,
    decoded: identity.identities.length,
    uniqueElementIds: identityIds.size,
    uniqueUniqueIds: new Set(
      identity.identities.map((entry) => entry.uniqueId),
    ).size,
    ifcElements: ifc.elementCount,
    uniqueNumericIfcTags: ifc.numericTags.size,
    numericIfcTagsLinked: linkedIfcTags.length,
  },
  modelGraph: {
    elementTableRecords: ownership.records.length,
    owningElement: {
      persistedPairs: ownershipPairs.size,
      roots: ownership.rootRecordCount,
      selfOwned: ownership.selfOwnedRecordCount,
      danglingTargets: ownership.danglingOwnerCount,
      comparableIfcAggregateOrNestPairs: ifc.aggregatePairs.size,
      exactIfcPairs: pairIntersection(ownershipPairs, ifc.aggregatePairs),
    },
    host: {
      persistedPairs: hostPairs.size,
      comparableIfcFillVoidPairs: ifc.hostPairs.size,
      exactIfcPairs: pairIntersection(hostPairs, ifc.hostPairs),
    },
    associatedLevel: {
      persistedPairs: levelPairs.size,
      comparableIfcContainedTags: ifc.containmentStoreyByTag.size,
      exactIfcStoreyGroups,
      mismatchedIfcStoreyGroups,
      missingIfcAssociatedLevels,
      distinctNativeLevelTargetsMappedToIfcStoreys:
        [...storeysByNativeLevel.values()].filter((storeys) =>
          storeys.size === 1).length,
    },
    type: {
      persistedPairsOnRecoveredElements: typePairs.size,
      distinctTypeTargets: new Set(
        conversion.elementBounds.flatMap((record) =>
          record.typeId == null ? [] : [record.typeId]),
      ).size,
      comparableIfcTypePairs: ifc.typePairs.size,
      exactIfcPairs: pairIntersection(typePairs, ifc.typePairs),
    },
    family: {
      symbolToFamilyPairs:
        conversion.nativeFamilySymbolRelations?.length ?? 0,
      independentlyNamedFamilies:
        conversion.nativeFamilyDefinitions?.length ?? 0,
      exactInstancesWithPersistedFamilySymbolId:
        conversion.decoderCoverage.nativeFamilySymbols ?? 0,
      recoveredInstancesWithSymbolOrSharedGeometryTarget:
        familyInstanceIds.size,
      recoveredInstancesBoundThroughSymbolToFamily:
        familyBoundInstanceIds.size,
    },
    nestedGeometry: {
      ownersWithPersistedGInstance: nestedOwners.size,
      gInstanceLinks: gInstanceSpans,
      pairedInstanceInfoBodies: instanceInfoSpans,
      semanticSubcomponentMembershipsPublished: 0,
      note:
        "GInstance/InstanceInfo is an exact geometry-composition carrier, not " +
        "yet a published FamilyInstance subcomponent/model-tree edge.",
    },
    ownerView: {
      persistedPairsPublished: 0,
      note:
        "OwnerDBView/owner-view serialization has not been proven for this release.",
    },
    uniqueMembersAcrossPublishedOwnershipHostLevelTypeAndFamilyInstance:
      uniqueGraphMembers.size,
  },
  materials: {
    persistedNamedMaterialElements: materialDefinitions.size,
    elementAssignments: {
      rows: assignmentRows.length,
      uniqueElements: assignedElementIds.size,
      evidence: sortedCounts(assignmentEvidence),
      ifcMaterialBearingTags: ifc.materialNamesByTag.size,
      assignedElementsAlsoMaterialBearingInIfc:
        [...assignedElementIds].filter((id) =>
          ifc.materialNamesByTag.has(id)).length,
      comparableRows: assignmentRowsWithIfc,
      exactNameRows: assignmentRowsWithExactIfcName,
    },
    faceAssignments: {
      geometryOwners,
      decodedFaces,
      directPositiveFaces: directFaceMaterials.length,
      directPositiveOwners: directFaceOwners.size,
      distinctDirectMaterialIds: directMaterialIds.size,
      directFacesResolvedToNamedMaterial: directFacesWithResolvedMaterial,
      directFacesOnIfcMaterialBearingOwner: directFacesWithIfcMaterial,
      directFacesWithNamePresentOnIfcOwner: directFacesWithExactIfcName,
      fallbackFaces: fallbackFaces.length,
      facesWithoutGeometryParent,
      fallbackStatuses: sortedCounts(fallbackStatuses),
      fallbackReasons: sortedCounts(fallbackReasons),
      fallbackSources: sortedCounts(fallbackSources),
      newlyExactFallbackFaces,
    },
    nextExactCarriers: [
      "element/type/family geometry-tag assignment projected onto certified face ownership",
      "category/object-style material lookup",
      "view/system material override",
    ],
  },
  scan: {
    partitionChunks: chunks,
    failedPartitionChunks: failedChunks,
    replayFailures: sortedCounts(replayFailures),
  },
  evidenceBoundary:
    "RVT identity and relationships are persisted browser-safe decodes. " +
    "Positive Face material IDs and Face->Geometry->GStyle precedence are " +
    "exact. IFC is opened only afterward and never supplies an RVT value.",
};

mkdirSync(dirname(paths.json), { recursive: true });
writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `Identity ${linkedIfcTags.length}/${ifc.numericTags.size}; graph ` +
  `${ownershipPairs.size} ownership, ${hostPairs.size} host, ` +
  `${levelPairs.size} level, ${typePairs.size} type pairs`,
);
console.log(
  `Materials ${directFacesWithResolvedMaterial}/${directFaceMaterials.length} ` +
  `direct Faces named; ${newlyExactFallbackFaces}/${fallbackFaces.length} ` +
  "new GStyle fallbacks",
);
console.log(`Wrote ${paths.json}`);
