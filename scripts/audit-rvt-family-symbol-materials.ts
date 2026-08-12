#!/usr/bin/env node

/**
 * Audit FamilySymbol.m_geomTag2MaterialId against an IFC export.
 *
 * The decoder reads only RVT data. IFC is loaded separately as an audit oracle
 * for element population and exact material-name comparison.
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

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
import {
  resolveFamilySymbolMaterialAssignments,
  resolveFamilySymbolMaterialMaps,
  scanFamilySymbolMaterialReferenceSets,
  type FamilySymbolMaterialReferenceSet,
} from "../lib/reviter/family-symbol-materials.ts";
import {
  readInstancePlacement,
  type InstancePlacement,
} from "../lib/reviter/instanced-geometry.ts";
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
  "audit-rvt-family-symbol-materials.ts --rvt model.rvt --ifc model.ifc [--json report.json]",
);

const paths = {
  rvt: requirePath("--rvt"),
  ifc: requirePath("--ifc"),
  json: optionalPath("--json"),
};

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

type IfcOracle = {
  materialNamesByRevitTag: Map<number, Set<string>>;
  classNamesByRevitTag: Map<number, Set<string>>;
  materialAssignedIfcElements: number;
  materialAssignedTaggedRows: number;
  materialRelations: number;
  typeRelations: number;
};

async function readIfcOracle(bytes: Uint8Array): Promise<IfcOracle> {
  const materialNodes = new Map<
    number,
    { name: string | null; references: number[] }
  >();
  const materialRelations: Array<{ related: number[]; material: number }> = [];
  const typeByElement = new Map<number, number>();
  let typeRelations = 0;
  const text = Buffer.from(bytes).toString("latin1");
  const entity = /^#(\d+) *= *([A-Z0-9_]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    const id = Number(match[1]);
    const type = match[2]!;
    const fields = splitStepArgs(match[3]!);
    if (type.startsWith("IFCMATERIAL")) {
      materialNodes.set(id, {
        name: type === "IFCMATERIAL" ? quoted(fields[0]) : null,
        references: stepReferences(match[3]!),
      });
    } else if (type === "IFCRELASSOCIATESMATERIAL") {
      materialRelations.push({
        related: stepReferences(fields[4]),
        material: stepReferences(fields[5])[0] ?? 0,
      });
    } else if (type === "IFCRELDEFINESBYTYPE") {
      typeRelations += 1;
      const typeObject = stepReferences(fields[5])[0] ?? 0;
      for (const elementId of stepReferences(fields[4])) {
        typeByElement.set(elementId, typeObject);
      }
    }
  }

  const materialMemo = new Map<number, Set<string>>();
  const materialNames = (
    id: number,
    visiting = new Set<number>(),
  ): Set<string> => {
    const memo = materialMemo.get(id);
    if (memo) return memo;
    const node = materialNodes.get(id);
    if (!node || visiting.has(id)) return new Set<string>();
    visiting.add(id);
    const result = new Set<string>();
    if (node.name) result.add(node.name);
    for (const reference of node.references) {
      for (const name of materialNames(reference, visiting)) result.add(name);
    }
    visiting.delete(id);
    materialMemo.set(id, result);
    return result;
  };

  const directNames = new Map<number, Set<string>>();
  for (const relation of materialRelations) {
    const names = materialNames(relation.material);
    for (const related of relation.related) {
      const values = directNames.get(related) ?? new Set<string>();
      for (const name of names) values.add(name);
      directNames.set(related, values);
    }
  }

  const api = new IfcAPI();
  await api.Init();
  const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
  if (model < 0) throw new Error("web-ifc could not open the reference IFC.");
  const materialNamesByRevitTag = new Map<number, Set<string>>();
  const classNamesByRevitTag = new Map<number, Set<string>>();
  let materialAssignedIfcElements = 0;
  let materialAssignedTaggedRows = 0;
  for (const typeCode of api.GetIfcEntityList(model)) {
    if (!api.IsIfcElement(typeCode)) continue;
    const className = api.GetNameFromTypeCode(typeCode);
    const ids = api.GetLineIDsWithType(model, typeCode, false);
    for (let index = 0; index < ids.size(); index += 1) {
      const elementId = ids.get(index);
      const names = new Set(directNames.get(elementId) ?? []);
      const typeObject = typeByElement.get(elementId);
      for (const name of directNames.get(typeObject ?? 0) ?? []) names.add(name);
      if (!names.size) continue;
      materialAssignedIfcElements += 1;
      const tag = ifcScalar(api.GetLine(model, elementId, false)?.Tag);
      if (typeof tag !== "string" || !/^\d+$/u.test(tag)) continue;
      materialAssignedTaggedRows += 1;
      const numericTag = Number(tag);
      const tagNames = materialNamesByRevitTag.get(numericTag) ?? new Set<string>();
      for (const name of names) tagNames.add(name);
      materialNamesByRevitTag.set(numericTag, tagNames);
      const classes = classNamesByRevitTag.get(numericTag) ?? new Set<string>();
      classes.add(className);
      classNamesByRevitTag.set(numericTag, classes);
    }
  }
  api.CloseModel(model);
  api.Dispose();
  return {
    materialNamesByRevitTag,
    classNamesByRevitTag,
    materialAssignedIfcElements,
    materialAssignedTaggedRows,
    materialRelations: materialRelations.length,
    typeRelations,
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

function groupedClassCounts(
  ids: Iterable<number>,
  classesById: ReadonlyMap<number, Set<string>>,
): Record<string, number> {
  const grouped = new Map<string, Set<number>>();
  for (const id of ids) {
    for (const className of classesById.get(id) ?? []) {
      const values = grouped.get(className) ?? new Set<number>();
      values.add(id);
      grouped.set(className, values);
    }
  }
  return Object.fromEntries(
    [...grouped]
      .map(([className, values]) => [className, values.size] as const)
      .sort((left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0])),
  );
}

const rvtBytes = readFileSync(paths.rvt);
const ifcBytes = readFileSync(paths.ifc);
const container = CFB.read(rvtBytes, { type: "buffer" });
const materialNamesById = new Map<number, string>();
const referenceSets: FamilySymbolMaterialReferenceSet[] = [];
const placements: InstancePlacement[] = [];
let partitionStreams = 0;
let gzipChunks = 0;
let inflatedBytes = 0;

for (
  let entryIndex = 0;
  entryIndex < container.FileIndex.length;
  entryIndex += 1
) {
  const path = container.FullPaths[entryIndex] ?? "";
  if (!/Partitions\/[^/]+$/i.test(path)) continue;
  partitionStreams += 1;
  const stored = stripRevitPageChecksums(
    asBytes(container.FileIndex[entryIndex]!.content),
  );
  const offsets = gzipOffsets(stored);
  let window: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      window,
    );
    const inflated = read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        window,
      );
    if (!inflated) continue;
    if (read) window = revitWindowTail(read);
    gzipChunks += 1;
    inflatedBytes += inflated.byteLength;
    for (const definition of scanMaterialElementRecords(inflated, 2027).definitions) {
      if (!materialNamesById.has(definition.elementId)) {
        materialNamesById.set(definition.elementId, definition.name);
      }
    }
    referenceSets.push(
      ...scanFamilySymbolMaterialReferenceSets(inflated, 2027),
    );
    for (const object of scanFramedElementObjects(inflated)) {
      const placement = readInstancePlacement(inflated, object);
      if (placement) placements.push(placement);
    }
  }
}

const maps = resolveFamilySymbolMaterialMaps(
  referenceSets,
  new Set(materialNamesById.keys()),
);
const assignments = resolveFamilySymbolMaterialAssignments(placements, maps);
const familyAssignedElements = new Set(
  assignments.map((assignment) => assignment.elementId),
);

const conversion = convertRvtBytes(
  new Uint8Array(rvtBytes.buffer, rvtBytes.byteOffset, rvtBytes.byteLength),
  basename(paths.rvt),
  { revitVersion: 2027, maxSegments: 1 },
);
if (!conversion.ok) throw new Error(`Current conversion failed: ${conversion.error}`);
const currentAssignedElements = new Set(
  [
    ...(conversion.nativeElementMaterialAssignments ?? []).filter(
      (assignment) =>
        assignment.evidence !==
        "persisted-instance-family-symbol-geometry-tag-material",
    ),
    ...(conversion.nativeCompoundLayerMaterialAssignments ?? []),
  ].map((assignment) => assignment.elementId),
);
const newlyAssignedElements = new Set(
  [...familyAssignedElements].filter(
    (elementId) => !currentAssignedElements.has(elementId),
  ),
);
const projectedAssignedElements = new Set(currentAssignedElements);
for (const elementId of familyAssignedElements) {
  projectedAssignedElements.add(elementId);
}

const oracle = await readIfcOracle(
  new Uint8Array(ifcBytes.buffer, ifcBytes.byteOffset, ifcBytes.byteLength),
);
const ifcAssignedTags = new Set(oracle.materialNamesByRevitTag.keys());
let comparableRelations = 0;
let exactNameRelations = 0;
const elementsWithComparableRelations = new Set<number>();
const elementsWithAllNamesExact = new Set<number>();
const assignmentsByElement = new Map<number, typeof assignments>();
for (const assignment of assignments) {
  const rows = assignmentsByElement.get(assignment.elementId);
  if (rows) rows.push(assignment);
  else assignmentsByElement.set(assignment.elementId, [assignment]);
  const ifcNames = oracle.materialNamesByRevitTag.get(assignment.elementId);
  if (!ifcNames) continue;
  comparableRelations += 1;
  elementsWithComparableRelations.add(assignment.elementId);
  const name = materialNamesById.get(assignment.materialId);
  if (name && ifcNames.has(name)) exactNameRelations += 1;
}
for (const [elementId, rows] of assignmentsByElement) {
  const ifcNames = oracle.materialNamesByRevitTag.get(elementId);
  if (
    ifcNames &&
    rows.every((row) => {
      const name = materialNamesById.get(row.materialId);
      return name != null && ifcNames.has(name);
    })
  ) {
    elementsWithAllNamesExact.add(elementId);
  }
}

const projectedIfcIntersection = intersectionSize(
  projectedAssignedElements,
  ifcAssignedTags,
);
const remainingIfcOnly = new Set(
  [...ifcAssignedTags].filter(
    (elementId) => !projectedAssignedElements.has(elementId),
  ),
);
const newlyAssignedIfc = new Set(
  [...newlyAssignedElements].filter((elementId) => ifcAssignedTags.has(elementId)),
);
const result = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-rvt-family-symbol-materials.ts",
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
    familySymbolMarker: "0x0810",
    mapGrammar: "u32 count; count * (i32 geometryTag, u64 MaterialElemId)",
    framedFamilySymbolReferenceSets: referenceSets.length,
    resolvedFamilySymbolMaterialMaps: maps.length,
    resolvedMaterialDefinitions: materialNamesById.size,
    placementRecords: placements.length,
    distinctMappedMaterialIds: new Set(
      maps.flatMap((map) => map.entries.map((entry) => entry.materialId)),
    ).size,
    mapEntryRelations: maps.reduce((sum, map) => sum + map.entries.length, 0),
  },
  assignments: {
    familySymbolAssignedElements: familyAssignedElements.size,
    familySymbolElementMaterialRelations: assignments.length,
    newElementsBeyondCurrent: newlyAssignedElements.size,
    newIfcAssignedTags: newlyAssignedIfc.size,
    newIfcAssignedTagsByClass: groupedClassCounts(
      newlyAssignedIfc,
      oracle.classNamesByRevitTag,
    ),
    comparableElementMaterialRelations: comparableRelations,
    exactMaterialNameRelations: exactNameRelations,
    exactMaterialNamePrecision: comparableRelations
      ? exactNameRelations / comparableRelations
      : null,
    elementsWithComparableRelations: elementsWithComparableRelations.size,
    elementsWithAllDecodedNamesExact: elementsWithAllNamesExact.size,
  },
  projectedCoverage: {
    currentNativeAssignedElements: currentAssignedElements.size,
    projectedNativeAssignedElements: projectedAssignedElements.size,
    ifcMaterialAssignedElements: oracle.materialAssignedIfcElements,
    ifcMaterialAssignedTaggedRows: oracle.materialAssignedTaggedRows,
    ifcAssignedUniqueNumericTags: ifcAssignedTags.size,
    currentIfcIntersection: intersectionSize(
      currentAssignedElements,
      ifcAssignedTags,
    ),
    projectedIfcIntersection,
    projectedIfcCoverage: ifcAssignedTags.size
      ? projectedIfcIntersection / ifcAssignedTags.size
      : null,
    projectedNonIfcAssignments:
      projectedAssignedElements.size - projectedIfcIntersection,
    remainingIfcOnly: remainingIfcOnly.size,
    remainingIfcOnlyByClass: groupedClassCounts(
      remainingIfcOnly,
      oracle.classNamesByRevitTag,
    ),
  },
  ifcAudit: {
    materialRelations: oracle.materialRelations,
    typeRelations: oracle.typeRelations,
    note:
      "IFC verifies element population and exact material names only; it is " +
      "not consulted by the RVT decoder.",
  },
};

const json = `${JSON.stringify(result, null, 2)}\n`;
if (paths.json) {
  mkdirSync(dirname(paths.json), { recursive: true });
  writeFileSync(paths.json, json);
}
console.log(json);
