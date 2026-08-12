#!/usr/bin/env node

/**
 * Rank persisted RVT reference paths from IFC-material-bearing Members,
 * Columns, and Railings to native MaterialElem records.
 *
 * IFC and a prior conversion JSON are audit oracles only. The RVT scan does
 * not consume either source while decoding object frames or references.
 */
import { readFileSync } from "node:fs";
import CFB from "cfb";
import { IfcAPI } from "web-ifc";

import {
  declareUsage,
  ifcScalar,
  increment,
  requirePath,
  splitStepArgs,
  stepReferences,
} from "./lib/rvt-harness.ts";

import { scanFramedElementObjects } from "../lib/reviter/element-objects.ts";
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
  "audit-rvt-remaining-material-carriers.ts --rvt model.rvt --ifc model.ifc --json report.json",
);

const paths = {
  rvt: requirePath("--rvt"),
  ifc: requirePath("--ifc"),
  json: requirePath("--json"),
};

function quoted(source = ""): string | null {
  const match = /^'((?:''|[^'])*)'$/.exec(source.trim());
  return match?.[1]?.replaceAll("''", "'") ?? null;
}

type IfcOracle = {
  materialNamesByTag: Map<number, Set<string>>;
  classesByTag: Map<number, Set<string>>;
};

async function readIfcOracle(bytes: Uint8Array): Promise<IfcOracle> {
  const materialNodes = new Map<
    number,
    { name: string | null; references: number[] }
  >();
  const materialRelations: Array<{ related: number[]; material: number }> = [];
  const typeByElement = new Map<number, number>();
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
  const materialNamesByTag = new Map<number, Set<string>>();
  const classesByTag = new Map<number, Set<string>>();
  for (const typeCode of api.GetIfcEntityList(model)) {
    if (!api.IsIfcElement(typeCode)) continue;
    const className = api.GetNameFromTypeCode(typeCode);
    const ids = api.GetLineIDsWithType(model, typeCode, false);
    for (let index = 0; index < ids.size(); index += 1) {
      const elementId = ids.get(index);
      const names = new Set(directNames.get(elementId) ?? []);
      for (const name of directNames.get(typeByElement.get(elementId) ?? 0) ?? []) {
        names.add(name);
      }
      if (!names.size) continue;
      const tag = ifcScalar(api.GetLine(model, elementId, false)?.Tag);
      if (typeof tag !== "string" || !/^\d+$/u.test(tag)) continue;
      const numericTag = Number(tag);
      const tagNames = materialNamesByTag.get(numericTag) ?? new Set<string>();
      for (const name of names) tagNames.add(name);
      materialNamesByTag.set(numericTag, tagNames);
      const classes = classesByTag.get(numericTag) ?? new Set<string>();
      classes.add(className);
      classesByTag.set(numericTag, classes);
    }
  }
  api.CloseModel(model);
  api.Dispose();
  return { materialNamesByTag, classesByTag };
}

type ConversionElement = {
  elementId: number;
  category?: { name?: string | null } | null;
  type?: { elementId?: number; name?: string | null } | null;
  geometry?: { source?: string | null } | null;
  materialAssignments?: unknown[];
};

type Frame = {
  marker: number;
  typeCode: number;
  objectLength: number;
};

type Edge = {
  targetId: number;
  offset: number;
};

function sortedCounts<Key extends string | number>(
  map: ReadonlyMap<Key, number>,
): Array<{ value: Key; count: number }> {
  return [...map]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) =>
      right.count - left.count ||
      String(left.value).localeCompare(String(right.value)));
}

const conversion = JSON.parse(readFileSync(paths.json, "utf8")) as {
  elementManifest: { elements: ConversionElement[] };
};
const conversionById = new Map(
  conversion.elementManifest.elements.map((element) => [
    element.elementId,
    element,
  ]),
);
const currentlyAssigned = new Set(
  conversion.elementManifest.elements
    .filter((element) => (element.materialAssignments?.length ?? 0) > 0)
    .map((element) => element.elementId),
);
const oracle = await readIfcOracle(readFileSync(paths.ifc));
const targetClasses = new Set(["IfcMember", "IfcColumn", "IfcRailing"]);
const targets = new Set<number>();
for (const [elementId, classes] of oracle.classesByTag) {
  if (
    !currentlyAssigned.has(elementId) &&
    [...classes].some((className) => targetClasses.has(className))
  ) {
    targets.add(elementId);
  }
}

const container = CFB.read(readFileSync(paths.rvt), { type: "buffer" });
const frameById = new Map<number, Frame>();
const materialNamesById = new Map<number, string>();
const MAX_ELEMENT_ID = 1 << 23;
const MAX_OBJECT_MARKER = 0x2000;

function forEachInflatedChunk(
  callback: (bytes: Uint8Array, stream: string, chunkIndex: number) => void,
): void {
  for (let entryIndex = 0; entryIndex < container.FileIndex.length; entryIndex += 1) {
    const stream = container.FullPaths[entryIndex] ?? "";
    if (!/Partitions\/[^/]+$/i.test(stream)) continue;
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
      callback(inflated, stream, chunkIndex);
    }
  }
}

forEachInflatedChunk((bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const definition of scanMaterialElementRecords(bytes, 2027).definitions) {
    materialNamesById.set(definition.elementId, definition.name);
  }
  for (const object of scanFramedElementObjects(bytes)) {
    if (
      object.offset + 34 > bytes.byteLength ||
      view.getUint32(object.offset + 26, true) !== object.elementId ||
      view.getUint32(object.offset + 30, true) !== 0
    ) continue;
    if (
      object.elementId < 8 ||
      object.elementId >= MAX_ELEMENT_ID ||
      object.marker > MAX_OBJECT_MARKER
    ) continue;
    if (!frameById.has(object.elementId)) {
      frameById.set(object.elementId, {
        marker: object.marker,
        typeCode: object.typeCode,
        objectLength: object.objectLength,
      });
    }
  }
});

const knownIds = new Set(frameById.keys());
const edgesBySource = new Map<number, Edge[]>();
const adjacentReferencePairCounts = new Map<string, number>();
const adjacentReferencePairSources = new Map<string, Set<number>>();
forEachInflatedChunk((bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const object of scanFramedElementObjects(bytes)) {
    // Keep this audit bounded. Additional hops are promoted explicitly after
    // their source fields are certified; retaining every coincidental
    // integer-looking edge in 417 MB of opaque records is neither useful nor
    // memory-safe.
    if (!targets.has(object.elementId)) continue;
    if (
      object.offset + 34 > bytes.byteLength ||
      view.getUint32(object.offset + 26, true) !== object.elementId ||
      view.getUint32(object.offset + 30, true) !== 0
    ) continue;
    const end = object.offset + object.objectLength;
    const edges: Edge[] = [];
    const seen = new Set<string>();
    for (let offset = object.offset + 26; offset + 8 <= end; offset += 1) {
      if (view.getUint32(offset + 4, true) !== 0) continue;
      const targetId = view.getUint32(offset, true);
      if (!knownIds.has(targetId) && !materialNamesById.has(targetId)) continue;
      if (targetId === object.elementId) continue;
      const relative = offset - object.offset;
      const key = `${targetId}:${relative}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ targetId, offset: relative });
      if (offset + 16 <= end && view.getUint32(offset + 12, true) === 0) {
        const secondId = view.getUint32(offset + 8, true);
        if (knownIds.has(secondId) || secondId === 0) {
          const firstFrame = frameById.get(targetId);
          const secondFrame = frameById.get(secondId);
          const classes = [
            ...(oracle.classesByTag.get(object.elementId) ?? []),
          ].sort().join("+");
          const pairKey = [
            classes,
            `sourceType=${object.typeCode}`,
            `offset=0x${relative.toString(16)}`,
            `firstType=${firstFrame?.typeCode ?? (targetId === 0 ? "null" : "unframed")}`,
            `secondType=${secondFrame?.typeCode ?? (secondId === 0 ? "null" : "unframed")}`,
          ].join(" ");
          increment(adjacentReferencePairCounts, pairKey);
          const sources = adjacentReferencePairSources.get(pairKey) ??
            new Set<number>();
          sources.add(object.elementId);
          adjacentReferencePairSources.set(pairKey, sources);
        }
      }
    }
    for (let offset = object.offset + 26; offset + 16 <= end; offset += 1) {
      if (
        view.getUint32(offset + 4, true) !== 0 ||
        view.getUint32(offset + 12, true) !== 0
      ) continue;
      const firstId = view.getUint32(offset, true);
      const secondId = view.getUint32(offset + 8, true);
      if (
        (!knownIds.has(firstId) && firstId !== 0) ||
        (!knownIds.has(secondId) && secondId !== 0) ||
        (firstId === 0 && secondId === 0)
      ) continue;
      const firstFrame = frameById.get(firstId);
      const secondFrame = frameById.get(secondId);
      const classes = [
        ...(oracle.classesByTag.get(object.elementId) ?? []),
      ].sort().join("+");
      const pairKey = [
        classes,
        `sourceType=${object.typeCode}`,
        `offset=0x${(offset - object.offset).toString(16)}`,
        `firstType=${firstFrame?.typeCode ?? (firstId === 0 ? "null" : "unframed")}`,
        `secondType=${secondFrame?.typeCode ?? (secondId === 0 ? "null" : "unframed")}`,
      ].join(" ");
      increment(adjacentReferencePairCounts, pairKey);
      const sources = adjacentReferencePairSources.get(pairKey) ??
        new Set<number>();
      sources.add(object.elementId);
      adjacentReferencePairSources.set(pairKey, sources);
    }
    if (edges.length) edgesBySource.set(object.elementId, edges);
  }
});

const classCounts = new Map<string, number>();
const markerCounts = new Map<string, number>();
const frameTypeCounts = new Map<string, number>();
const geometryCounts = new Map<string, number>();
const directReferenceCounts = new Map<string, number>();

for (const elementId of targets) {
  const classes = [...(oracle.classesByTag.get(elementId) ?? [])].sort();
  for (const className of classes) increment(classCounts, className);
  const frame = frameById.get(elementId);
  increment(
    markerCounts,
    frame
      ? `0x${frame.marker.toString(16).padStart(4, "0")}`
      : "unframed",
  );
  for (const className of classes) {
    increment(
      frameTypeCounts,
      `${className} ${frame ? `type=${frame.typeCode}` : "unframed"}`,
    );
  }
  const conversionElement = conversionById.get(elementId);
  increment(geometryCounts, conversionElement?.geometry?.source ?? "missing");
  for (const edge of edgesBySource.get(elementId) ?? []) {
    const targetFrame = frameById.get(edge.targetId);
    const key = [
      classes.join("+"),
      `0x${edge.offset.toString(16)}`,
      targetFrame
        ? `type=${targetFrame.typeCode}`
        : materialNamesById.has(edge.targetId)
        ? "material"
        : "unknown",
    ].join(" ");
    increment(directReferenceCounts, key);
  }

}

console.log(JSON.stringify({
  paths,
  scope: {
    ifcUse: "audit-only target population and material-name oracle",
    rvtEvidence:
      "length/echo frame + repeated element id + release-specific outer type code",
    candidateReferenceWarning:
      "raw aligned-looking ids are ranked only; none is promoted without a field cursor from the embedded schema",
  },
  counts: {
    targetElements: targets.size,
    framedElements: frameById.size,
    materialDefinitions: materialNamesById.size,
    sourcesWithReferenceCandidates: edgesBySource.size,
  },
  classCounts: sortedCounts(classCounts),
  markerCounts: sortedCounts(markerCounts),
  frameTypeCounts: sortedCounts(frameTypeCounts),
  geometryCounts: sortedCounts(geometryCounts),
  directReferenceCounts: sortedCounts(directReferenceCounts).slice(0, 100),
  adjacentReferencePairCounts:
    sortedCounts(adjacentReferencePairCounts).slice(0, 100),
  blocker:
    "StairsSupport.m_typeId and m_hostCompId follow polymorphic/dynamic geometry fields; without their scoped object/array reader, no schema-certified cursor reaches the instance-to-support-type relation.",
}, null, 2));
