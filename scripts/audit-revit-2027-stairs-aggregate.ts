#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import CFB from "cfb";
import { IfcAPI } from "web-ifc";

import {
  decodeRevit2027StairsElementAggregate,
  decodeRevit2027StairsRunAndLandingAggregate,
  REVIT_2027_STAIRS_ELEMENT_MARKER,
  REVIT_2027_STAIRS_LANDING_MARKER,
  REVIT_2027_STAIRS_RUN_MARKER,
  type Revit2027StairsRunAndLandingAggregate,
} from "../lib/reviter/revit-2027-stairs-aggregate.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  revitWindowTail,
  salvageRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const arguments_ = process.argv.slice(2);

function option(name: string, required = true): string | null {
  const index = arguments_.indexOf(name);
  if (index >= 0 && arguments_[index + 1]) {
    return resolve(arguments_[index + 1]!);
  }
  if (!required) return null;
  throw new Error(`Missing ${name}.`);
}

const paths = {
  rvt: option("--rvt")!,
  ifc: option("--ifc")!,
  semantic: option("--semantic")!,
  json: option("--json", false),
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const byteLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

type Frame = {
  objectOffset: number;
  objectLength: number;
  elementId: number;
  marker: number;
};

const targetMarkers = new Set([
  REVIT_2027_STAIRS_ELEMENT_MARKER,
  REVIT_2027_STAIRS_LANDING_MARKER,
  REVIT_2027_STAIRS_RUN_MARKER,
]);

function targetFrames(data: Uint8Array): Frame[] {
  const frames: Frame[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let objectOffset = 0; objectOffset + 40 <= data.byteLength; objectOffset += 1) {
    const marker = view.getUint16(objectOffset + 16, true);
    if (!targetMarkers.has(marker)) continue;
    if (
      view.getUint32(objectOffset + 4, true) !== 0 ||
      view.getUint32(objectOffset + 22, true) !== 0
    ) {
      continue;
    }
    const elementId = view.getUint32(objectOffset, true);
    const objectLength = view.getUint32(objectOffset + 12, true);
    const echoOffset = objectOffset + objectLength + 16;
    if (
      elementId === 0 ||
      objectLength < 127 ||
      echoOffset + 4 > data.byteLength ||
      view.getUint32(echoOffset, true) !== objectLength
    ) {
      continue;
    }
    frames.push({ objectOffset, objectLength, elementId, marker });
  }
  return frames;
}

function splitStepArguments(source: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'") {
      if (quoted && source[index + 1] === "'") index += 1;
      else quoted = !quoted;
    } else if (!quoted) {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (character === "," && depth === 0) {
        result.push(source.slice(start, index).trim());
        start = index + 1;
      }
    }
  }
  result.push(source.slice(start).trim());
  return result;
}

function references(source = ""): number[] {
  return [...source.matchAll(/#(\d+)/gu)].map((match) => Number(match[1]));
}

type IfcRelation = {
  kind: "aggregation" | "containment";
  parent: number;
  related: number[];
};

function parseTreeRelations(text: string): IfcRelation[] {
  const relations: IfcRelation[] = [];
  const entity =
    /#(\d+) *= *(IFCRELAGGREGATES|IFCRELCONTAINEDINSPATIALSTRUCTURE)\(([\s\S]*?)\);\s*$/gmu;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    const fields = splitStepArguments(match[3]!);
    relations.push({
      kind:
        match[2] === "IFCRELAGGREGATES" ? "aggregation" : "containment",
      parent:
        match[2] === "IFCRELAGGREGATES"
          ? (references(fields[4])[0] ?? 0)
          : (references(fields[5])[0] ?? 0),
      related:
        match[2] === "IFCRELAGGREGATES"
          ? references(fields[5])
          : references(fields[4]),
    });
  }
  return relations;
}

function scalar(value: unknown): unknown {
  return value != null && typeof value === "object" && "value" in value
    ? (value as { value: unknown }).value
    : value;
}

type IfcElement = {
  expressId: number;
  ifcClass: string;
  tag: number | null;
};

const rvtBytes = readFileSync(paths.rvt);
const ifcBytes = readFileSync(paths.ifc);
const semanticBytes = readFileSync(paths.semantic);
const semantic = JSON.parse(semanticBytes.toString("utf8")) as {
  modelTree?: {
    elements?: {
      elementId: number;
      owningElementId?: number | null;
    }[];
    hostRelations?: { elementId: number }[];
    associatedLevelRelations?: { elementId: number }[];
  };
};

const api = new IfcAPI();
await api.Init();
const model = api.OpenModel(ifcBytes, { COORDINATE_TO_ORIGIN: false });
if (model < 0) throw new Error("web-ifc could not open the IFC.");
const ifcElements = new Map<number, IfcElement>();
for (const typeCode of api.GetIfcEntityList(model)) {
  if (!api.IsIfcElement(typeCode)) continue;
  const ifcClass = api.GetNameFromTypeCode(typeCode);
  const ids = api.GetLineIDsWithType(model, typeCode, false);
  for (let index = 0; index < ids.size(); index += 1) {
    const expressId = ids.get(index);
    const line = api.GetLine(model, expressId, false) as {
      Tag?: unknown;
    };
    const rawTag = scalar(line.Tag);
    const tag =
      typeof rawTag === "string" && /^\d+$/u.test(rawTag)
        ? Number(rawTag)
        : null;
    ifcElements.set(expressId, { expressId, ifcClass, tag });
  }
}
const ifcRelations = parseTreeRelations(ifcBytes.toString("latin1"));

const existingMembers = new Set<number>();
for (const element of semantic.modelTree?.elements ?? []) {
  if (
    element.owningElementId != null &&
    element.owningElementId !== element.elementId
  ) {
    existingMembers.add(element.elementId);
  }
}
for (const relation of semantic.modelTree?.hostRelations ?? []) {
  existingMembers.add(relation.elementId);
}
for (const relation of semantic.modelTree?.associatedLevelRelations ?? []) {
  existingMembers.add(relation.elementId);
}

const comparableTags = new Set<number>();
const expectedStairsPairs = new Map<
  string,
  { childTag: number; parentTag: number; ifcClass: string }
>();
for (const relation of ifcRelations) {
  const parent = ifcElements.get(relation.parent);
  for (const childExpressId of relation.related) {
    const child = ifcElements.get(childExpressId);
    if (child?.tag != null) comparableTags.add(child.tag);
    if (
      relation.kind !== "aggregation" ||
      parent?.ifcClass !== "IfcStair" ||
      parent.tag == null ||
      child?.tag == null ||
      child.tag === parent.tag
    ) {
      continue;
    }
    expectedStairsPairs.set(`${parent.tag}:${child.tag}`, {
      childTag: child.tag,
      parentTag: parent.tag,
      ifcClass: child.ifcClass,
    });
  }
}

const cfb = CFB.read(rvtBytes, { type: "buffer" });
const stairsDirectPairs = new Map<
  string,
  { parentTag: number; childTag: number; source: string }
>();
const reciprocalPairs = new Map<
  string,
  { parentTag: number; childTag: number; source: string }
>();
const runById = new Map<number, Revit2027StairsRunAndLandingAggregate>();
const knownStairsElementIds = new Set<number>();
const pendingRunAndLandingFrames: { data: Uint8Array; frame: Frame }[] = [];
let partitions = 0;
let inflatedChunks = 0;
let stairsFrames = 0;
let runFrames = 0;
let landingFrames = 0;
let registeredRailingIds = 0;
let declaredRunAndLandingIds = 0;
let declaredSupportIds = 0;
let maximumObjectLength = 0;
const failures: { elementId: number; marker: number; error: string }[] = [];

for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const stream = cfb.FullPaths[entryIndex] ?? "";
  if (!/\/Partitions\/[^/]+$/iu.test(stream)) continue;
  partitions += 1;
  const stored = stripRevitPageChecksums(
    asBytes(cfb.FileIndex[entryIndex].content),
  );
  const offsets = gzipOffsets(stored);
  const chunks: Uint8Array[] = [];
  let window: Uint8Array | null = null;
  for (let chunkIndex = 0; chunkIndex < offsets.length; chunkIndex += 1) {
    const read = inflateRevitChunk(
      stored,
      offsets[chunkIndex]!,
      offsets[chunkIndex + 1],
      window,
    );
    const inflated =
      read ??
      salvageRevitChunk(
        stored,
        offsets[chunkIndex]!,
        offsets[chunkIndex + 1],
        window,
      );
    if (!inflated) continue;
    if (read) window = revitWindowTail(read);
    chunks.push(inflated);
    inflatedChunks += 1;
  }
  const inflated = concatenate(chunks);
  for (const frame of targetFrames(inflated)) {
    maximumObjectLength = Math.max(maximumObjectLength, frame.objectLength);
    if (frame.marker === REVIT_2027_STAIRS_ELEMENT_MARKER) {
      stairsFrames += 1;
      const decoded = decodeRevit2027StairsElementAggregate(
        inflated,
        frame.objectOffset,
        frame.objectLength,
        2027,
      );
      if (!decoded.ok) {
        failures.push({ ...frame, error: decoded.error });
        continue;
      }
      knownStairsElementIds.add(decoded.value.elementId);
      registeredRailingIds += decoded.value.registeredRailingIds.length;
      declaredRunAndLandingIds += decoded.value.runAndLandingIds.length;
      declaredSupportIds += decoded.value.supportIds.length;
      for (const childTag of decoded.value.registeredRailingIds) {
        stairsDirectPairs.set(`${decoded.value.elementId}:${childTag}`, {
          parentTag: decoded.value.elementId,
          childTag,
          source: "StairsElement.m_registeredRailings",
        });
      }
      for (const childTag of decoded.value.runAndLandingIds) {
        stairsDirectPairs.set(`${decoded.value.elementId}:${childTag}`, {
          parentTag: decoded.value.elementId,
          childTag,
          source: "StairsElement.m_runsAndLandings",
        });
      }
      for (const childTag of decoded.value.supportIds) {
        stairsDirectPairs.set(`${decoded.value.elementId}:${childTag}`, {
          parentTag: decoded.value.elementId,
          childTag,
          source: "StairsElement.m_supports",
        });
      }
      continue;
    }

    if (frame.marker === REVIT_2027_STAIRS_RUN_MARKER) runFrames += 1;
    else landingFrames += 1;
    pendingRunAndLandingFrames.push({ data: inflated, frame });
  }
}

for (const { data, frame } of pendingRunAndLandingFrames) {
    const decoded = decodeRevit2027StairsRunAndLandingAggregate(
      data,
      frame.objectOffset,
      frame.objectLength,
      2027,
      { knownStairsElementIds },
    );
    if (!decoded.ok) {
      failures.push({ ...frame, error: decoded.error });
      continue;
    }
    runById.set(decoded.value.elementId, decoded.value);
    reciprocalPairs.set(
      `${decoded.value.stairsId}:${decoded.value.elementId}`,
      {
        parentTag: decoded.value.stairsId,
        childTag: decoded.value.elementId,
        source: "StairsRunAndLanding.m_stairsId",
      },
    );
    for (const childTag of decoded.value.stringerIds) {
      reciprocalPairs.set(`${decoded.value.stairsId}:${childTag}`, {
        parentTag: decoded.value.stairsId,
        childTag,
        source: "StairsRunAndLanding.m_stringerArr via m_stairsId",
      });
    }
}

api.CloseModel(model);
api.Dispose();

const decodedPairs = new Map([...stairsDirectPairs, ...reciprocalPairs]);
const exactIfcPairs = [...decodedPairs]
  .filter(([key]) => expectedStairsPairs.has(key))
  .map(([, pair]) => ({
    ...pair,
    ifcClass: expectedStairsPairs.get(
      `${pair.parentTag}:${pair.childTag}`,
    )!.ifcClass,
  }));
const exactIfcTags = new Set(exactIfcPairs.map((pair) => pair.childTag));
const addedTags = new Set(
  [...exactIfcTags].filter((tag) => !existingMembers.has(tag)),
);
const baselineMatches = [...comparableTags].filter((tag) =>
  existingMembers.has(tag),
).length;
const addedByClass = new Map<string, number>();
const addedBySource = new Map<string, number>();
for (const pair of exactIfcPairs) {
  if (!addedTags.has(pair.childTag)) continue;
  addedByClass.set(pair.ifcClass, (addedByClass.get(pair.ifcClass) ?? 0) + 1);
  addedBySource.set(pair.source, (addedBySource.get(pair.source) ?? 0) + 1);
}
const ranked = (values: Map<string, number>) =>
  [...values]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({ value, count }));

const report = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-revit-2027-stairs-aggregate.ts",
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
    },
    semantic: {
      name: basename(paths.semantic),
      bytes: semanticBytes.byteLength,
      sha256: sha256(semanticBytes),
    },
  },
  corpus: {
    partitions,
    inflatedChunks,
    stairsElementFrames: stairsFrames,
    stairsRunFrames: runFrames,
    stairsLandingFrames: landingFrames,
    maximumObjectLength,
    registeredRailingIds,
    declaredRunAndLandingIds,
    declaredSupportIds,
    reciprocalRunAndLandingIds: runById.size,
    failures,
  },
  ifcOracle: {
    expectedStairsAggregationPairs: expectedStairsPairs.size,
    exactDecodedPairs: exactIfcPairs.length,
    unresolvedPairs: [...expectedStairsPairs]
      .filter(([key]) => !decodedPairs.has(key))
      .map(([, pair]) => pair)
      .sort((left, right) => left.childTag - right.childTag),
    decodedNonIfcPairs: [...decodedPairs]
      .filter(([key]) => !expectedStairsPairs.has(key))
      .length,
  },
  modelTreeParityImpact: {
    baseline: {
      matches: baselineMatches,
      comparableNumericTags: comparableTags.size,
      ratio: baselineMatches / comparableTags.size,
    },
    addedExactTags: addedTags.size,
    addedByClass: ranked(addedByClass),
    addedBySource: ranked(addedBySource),
    afterStairsAggregateReader: {
      matches: baselineMatches + addedTags.size,
      comparableNumericTags: comparableTags.size,
      ratio: (baselineMatches + addedTags.size) / comparableTags.size,
    },
  },
  evidenceBoundary: {
    schema:
      "Formats/Latest names and orders the StairsElement ObjectId collections and the StairsRunAndLanding reciprocal suffix.",
    native: [
      "OdBmStairsElement::getRunsAndLandings",
      "OdBmStairsElement::getSupports",
      "OdBmStairsElement::getRegisteredRailings",
      "OdBmStairsRunAndLanding::getStairsId",
    ],
    rule:
      "Only typed collection members and the uniquely decoded reciprocal suffix create relations; raw nearby ObjectId values do not.",
  },
};

console.log(JSON.stringify(report, null, 2));
if (paths.json) {
  writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);
}
