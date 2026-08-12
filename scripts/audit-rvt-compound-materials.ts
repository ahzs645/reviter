#!/usr/bin/env node

/**
 * Audit the browser-safe BasicWallType -> CompoundStructure -> layer material
 * carrier against an IFC export. IFC is an oracle here and is never consulted
 * by the decoder.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-rvt-compound-materials.ts \
 *     --rvt model.rvt --ifc reference.ifc [--json report.json]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import CFB from "cfb";
import { IfcAPI } from "web-ifc";

import {
  declareUsage,
  ifcScalar,
  optionalPath,
  requirePath,
  sha256,
  splitStepArgs,
  stepReferences,
} from "./lib/rvt-harness.ts";

import {
  resolveCompoundLayerMaterialAssignments,
  resolveCompoundStructureDefinitions,
  scanCompoundStructureCandidates,
  type CompoundStructureCandidate,
} from "../lib/reviter/compound-structure-materials.ts";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { collectTypeLinks, type TypeReference } from "../lib/reviter/element-types.ts";
import { scanMaterialElementRecords } from "../lib/reviter/material-records.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

declareUsage(
  "audit-rvt-compound-materials.ts --rvt model.rvt --ifc model.ifc [--json report.json]",
);

const paths = {
  rvt: requirePath("--rvt"),
  ifc: requirePath("--ifc"),
  json: optionalPath("--json"),
};

type IfcMaterialCoverage = {
  assignedRevitElementIds: Set<number>;
  classNamesByAssignedRevitElementId: Map<number, Set<string>>;
  materialAssignedIfcElements: number;
  materialAssignedTaggedIfcElements: number;
  numericRevitTags: number;
  materialRelations: number;
  typeRelations: number;
  taggedObjects: number;
};

async function readIfcMaterialCoverage(
  bytes: Uint8Array,
): Promise<IfcMaterialCoverage> {
  const text = Buffer.from(bytes).toString("latin1");
  const typeByElement = new Map<number, number>();
  const materialRelatedObjects = new Set<number>();
  let typeRelations = 0;
  let materialRelations = 0;
  const entity = /^#(\d+) *= *([A-Z0-9_]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    const type = match[2]!;
    const fields = splitStepArgs(match[3]!);
    if (type === "IFCRELDEFINESBYTYPE") {
      typeRelations += 1;
      const typeObject = stepReferences(fields[5])[0] ?? 0;
      for (const member of stepReferences(fields[4])) {
        typeByElement.set(member, typeObject);
      }
    } else if (type === "IFCRELASSOCIATESMATERIAL") {
      materialRelations += 1;
      for (const related of stepReferences(fields[4])) {
        materialRelatedObjects.add(related);
      }
    }
  }

  // STEP subtypes append attributes after IfcElement.Tag, so the last quoted
  // field is not a safe generic Tag reader. web-ifc supplies the exact schema
  // field here; this code is audit-only and never enters the browser decoder.
  const api = new IfcAPI();
  await api.Init();
  const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
  if (model < 0) throw new Error("web-ifc could not open the reference IFC.");
  const assignedRevitElementIds = new Set<number>();
  const classNamesByAssignedRevitElementId =
    new Map<number, Set<string>>();
  const numericRevitTags = new Set<number>();
  let materialAssignedIfcElements = 0;
  let materialAssignedTaggedIfcElements = 0;
  let taggedObjects = 0;
  for (const typeCode of api.GetIfcEntityList(model)) {
    if (!api.IsIfcElement(typeCode)) continue;
    const className = api.GetNameFromTypeCode(typeCode);
    const ids = api.GetLineIDsWithType(model, typeCode, false);
    for (let index = 0; index < ids.size(); index += 1) {
      const elementId = ids.get(index);
      const tag = ifcScalar(api.GetLine(model, elementId, false)?.Tag);
      const typeObject = typeByElement.get(elementId);
      const materialAssigned =
        materialRelatedObjects.has(elementId) ||
        (typeObject != null && materialRelatedObjects.has(typeObject));
      if (materialAssigned) materialAssignedIfcElements += 1;
      if (typeof tag !== "string" || !/^\d+$/u.test(tag)) continue;
      const numericTag = Number(tag);
      taggedObjects += 1;
      numericRevitTags.add(numericTag);
      if (!materialAssigned) continue;
      materialAssignedTaggedIfcElements += 1;
      assignedRevitElementIds.add(numericTag);
      const classNames =
        classNamesByAssignedRevitElementId.get(numericTag) ?? new Set<string>();
      classNames.add(className);
      classNamesByAssignedRevitElementId.set(numericTag, classNames);
    }
  }
  api.CloseModel(model);
  api.Dispose();
  return {
    assignedRevitElementIds,
    classNamesByAssignedRevitElementId,
    materialAssignedIfcElements,
    materialAssignedTaggedIfcElements,
    numericRevitTags: numericRevitTags.size,
    materialRelations,
    typeRelations,
    taggedObjects,
  };
}

function intersectionSize(
  left: ReadonlySet<number>,
  right: ReadonlySet<number>,
): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function differenceSize(
  left: ReadonlySet<number>,
  right: ReadonlySet<number>,
): number {
  let count = 0;
  for (const value of left) if (!right.has(value)) count += 1;
  return count;
}

const rvtBytes = readFileSync(paths.rvt);
const ifcBytes = readFileSync(paths.ifc);
const cfb = CFB.read(rvtBytes, { type: "buffer" });
const materialNames = new Map<number, string>();
const typeNames = new Map<number, string>();
const compoundCandidates: CompoundStructureCandidate[] = [];
const typeReferences: TypeReference[] = [];
let partitionStreams = 0;
let gzipChunks = 0;
let inflatedBytes = 0;

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

    for (const definition of scanMaterialElementRecords(inflated, 2027).definitions) {
      if (!materialNames.has(definition.elementId)) {
        materialNames.set(definition.elementId, definition.name);
      }
    }
    compoundCandidates.push(...scanCompoundStructureCandidates(inflated, 2027));
    const links = collectTypeLinks(inflated);
    typeReferences.push(...links.references);
    for (const entry of links.names) {
      if (!typeNames.has(entry.typeId)) typeNames.set(entry.typeId, entry.name);
    }
  }
}

const compoundDefinitions = resolveCompoundStructureDefinitions(
  compoundCandidates,
  new Set(materialNames.keys()),
);
const compoundAssignments = resolveCompoundLayerMaterialAssignments(
  typeReferences,
  compoundDefinitions,
);
const compoundAssignedElements = new Set(
  compoundAssignments.map((assignment) => assignment.elementId),
);

const conversion = convertRvtBytes(
  new Uint8Array(rvtBytes.buffer, rvtBytes.byteOffset, rvtBytes.byteLength),
  basename(paths.rvt),
  { revitVersion: 2027, maxSegments: 1 },
);
if (!conversion.ok) {
  throw new Error(`Existing material conversion failed: ${conversion.error}`);
}
const existingAssignments = conversion.nativeElementMaterialAssignments ?? [];
const existingAssignedElements = new Set(
  existingAssignments.map((assignment) => assignment.elementId),
);
const projectedAssignedElements = new Set(existingAssignedElements);
for (const elementId of compoundAssignedElements) {
  projectedAssignedElements.add(elementId);
}

const ifc = await readIfcMaterialCoverage(
  new Uint8Array(ifcBytes.buffer, ifcBytes.byteOffset, ifcBytes.byteLength),
);
const ifcAssignedElements = ifc.assignedRevitElementIds;
const remainingIfcOnlyByClass = new Map<string, Set<number>>();
for (const elementId of ifcAssignedElements) {
  if (projectedAssignedElements.has(elementId)) continue;
  for (const className of ifc.classNamesByAssignedRevitElementId.get(elementId) ?? []) {
    const ids = remainingIfcOnlyByClass.get(className) ?? new Set<number>();
    ids.add(elementId);
    remainingIfcOnlyByClass.set(className, ids);
  }
}
const typeRows = compoundDefinitions.map((definition) => {
  const assigned = compoundAssignments.filter(
    (assignment) => assignment.typeId === definition.typeId,
  );
  const assignedElements = new Set(assigned.map((entry) => entry.elementId));
  return {
    typeId: definition.typeId,
    name: typeNames.get(definition.typeId) ?? null,
    layerCount: definition.layers.length,
    totalWidthFeet: definition.layers.reduce(
      (sum, layer) => sum + layer.widthFeet,
      0,
    ),
    layers: definition.layers.map((layer) => ({
      layerIndex: layer.layerIndex,
      widthFeet: layer.widthFeet,
      materialId: layer.materialId,
      materialName: layer.materialId == null
        ? null
        : materialNames.get(layer.materialId) ?? null,
      function: layer.function,
      priority: layer.priority,
      capFlag: layer.capFlag,
    })),
    placedElements: assignedElements.size,
    placedElementsWithIfcMaterial: intersectionSize(
      assignedElements,
      ifcAssignedElements,
    ),
  };
});

const result = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-rvt-compound-materials.ts",
  inputs: {
    rvt: {
      name: basename(paths.rvt),
      bytes: rvtBytes.length,
      sha256: sha256(rvtBytes),
    },
    ifc: {
      name: basename(paths.ifc),
      bytes: ifcBytes.length,
      sha256: sha256(ifcBytes),
      role: "audit-oracle-only",
    },
  },
  scan: {
    revitVersion: 2027,
    partitionStreams,
    gzipChunks,
    inflatedBytes,
    basicWallTypeMarker: "0x0270",
    layersFieldSelector: "ff ff ff ff ab 11",
    layerStrideBytes: 41,
    rawCompoundCandidates: compoundCandidates.length,
    resolvedCompoundDefinitions: compoundDefinitions.length,
    resolvedMaterialDefinitions: materialNames.size,
    decodedTypeReferences: typeReferences.length,
    types: typeRows,
  },
  elementCoverage: {
    existingNativeAssignedElements: existingAssignedElements.size,
    existingNativeRelations: existingAssignments.length,
    compoundLayerAssignedElements: compoundAssignedElements.size,
    compoundLayerRelations: compoundAssignments.length,
    newElementsBeyondExisting:
      differenceSize(compoundAssignedElements, existingAssignedElements),
    projectedNativeAssignedElements: projectedAssignedElements.size,
    ifcAssignedNumericRevitTags: ifcAssignedElements.size,
    existingNativeIfcIntersection:
      intersectionSize(existingAssignedElements, ifcAssignedElements),
    compoundIfcIntersection:
      intersectionSize(compoundAssignedElements, ifcAssignedElements),
    newIfcElementsBeyondExisting: [...compoundAssignedElements].filter(
      (elementId) =>
        !existingAssignedElements.has(elementId) &&
        ifcAssignedElements.has(elementId),
    ).length,
    projectedIfcIntersection:
      intersectionSize(projectedAssignedElements, ifcAssignedElements),
    projectedIfcCoverage: ifcAssignedElements.size
      ? intersectionSize(projectedAssignedElements, ifcAssignedElements) /
        ifcAssignedElements.size
      : null,
    projectedNonIfcAssignments:
      differenceSize(projectedAssignedElements, ifcAssignedElements),
    remainingIfcOnly:
      differenceSize(ifcAssignedElements, projectedAssignedElements),
    remainingIfcOnlyByClass: Object.fromEntries(
      [...remainingIfcOnlyByClass]
        .map(([className, ids]) => [className, ids.size] as const)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
    ),
  },
  ifcAudit: {
    materialRelations: ifc.materialRelations,
    typeRelations: ifc.typeRelations,
    materialAssignedIfcElements: ifc.materialAssignedIfcElements,
    materialAssignedTaggedIfcElements: ifc.materialAssignedTaggedIfcElements,
    assignedUniqueNumericRevitTags: ifcAssignedElements.size,
    numericRevitTags: ifc.numericRevitTags,
    taggedObjects: ifc.taggedObjects,
    note:
      "Element coverage only. This does not claim native face, side, cap, " +
      "or triangle material selection.",
  },
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (paths.json) {
  mkdirSync(dirname(paths.json), { recursive: true });
  writeFileSync(paths.json, json);
}
console.log(json);
