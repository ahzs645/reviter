#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import CFB from "cfb";
import { IfcAPI } from "web-ifc";

import {
  decodeRevit2027BaseRailingStairsRelation,
  REVIT_2027_BASE_RAILING_MARKER,
} from "../lib/reviter/revit-2027-base-railing-stairs.ts";
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

type Frame = {
  objectOffset: number;
  objectLength: number;
  elementId: number;
  marker: number;
  streamOffset: number;
};

const targetMarkers = new Set([
  REVIT_2027_STAIRS_ELEMENT_MARKER,
  REVIT_2027_STAIRS_LANDING_MARKER,
  REVIT_2027_STAIRS_RUN_MARKER,
  REVIT_2027_BASE_RAILING_MARKER,
]);

const MAX_REASSEMBLED_FRAME_BYTES = 1024 * 1024;

type ReassembledFrame = {
  data: Uint8Array;
  frame: Frame;
};

/**
 * Retain only incomplete target frames plus the 17-byte split-header tail.
 * A completed frame is copied into its own bounded byte array for the exact
 * release reader. The whole inflated partition is never held contiguously.
 */
class BoundedFrameReassembler {
  #buffer = new Uint8Array();
  #bufferStreamOffset = 0;
  #nextScanOffset = 0;
  #pending = new Map<
    number,
    { elementId: number; marker: number; objectLength: number }
  >();
  maxBufferedBytes = 0;
  oversizedTargetFrames = 0;

  push(chunk: Uint8Array): ReassembledFrame[] {
    const combined = new Uint8Array(this.#buffer.byteLength + chunk.byteLength);
    combined.set(this.#buffer);
    combined.set(chunk, this.#buffer.byteLength);
    const combinedStart = this.#bufferStreamOffset;
    const combinedEnd = combinedStart + combined.byteLength;
    this.maxBufferedBytes = Math.max(
      this.maxBufferedBytes,
      combined.byteLength,
    );
    const view = new DataView(
      combined.buffer,
      combined.byteOffset,
      combined.byteLength,
    );
    const scanStart = Math.max(this.#nextScanOffset, combinedStart);
    const scanEnd = combinedEnd - 18;
    for (
      let streamOffset = scanStart;
      streamOffset <= scanEnd;
      streamOffset += 1
    ) {
      const offset = streamOffset - combinedStart;
      const marker = view.getUint16(offset + 16, true);
      if (!targetMarkers.has(marker)) continue;
      if (view.getUint32(offset + 4, true) !== 0) continue;
      const typeCode = view.getUint32(offset + 18, true);
      if (
        (marker === REVIT_2027_BASE_RAILING_MARKER &&
          typeCode !== 0xffff_ffff) ||
        (marker !== REVIT_2027_BASE_RAILING_MARKER && typeCode !== 0)
      ) {
        continue;
      }
      const elementId = view.getUint32(offset, true);
      const objectLength = view.getUint32(offset + 12, true);
      if (elementId === 0 || objectLength < 127) continue;
      if (objectLength + 20 > MAX_REASSEMBLED_FRAME_BYTES) {
        this.oversizedTargetFrames += 1;
        continue;
      }
      this.#pending.set(streamOffset, {
        elementId,
        marker,
        objectLength,
      });
    }
    this.#nextScanOffset = Math.max(this.#nextScanOffset, scanEnd + 1);

    const frames: ReassembledFrame[] = [];
    for (const [streamOffset, pending] of this.#pending) {
      const frameEnd = streamOffset + pending.objectLength + 20;
      if (frameEnd > combinedEnd) continue;
      const offset = streamOffset - combinedStart;
      if (
        offset < 0 ||
        view.getUint32(offset + pending.objectLength + 16, true) !==
          pending.objectLength
      ) {
        this.#pending.delete(streamOffset);
        continue;
      }
      const data = combined.slice(offset, offset + pending.objectLength + 20);
      frames.push({
        data,
        frame: {
          objectOffset: 0,
          objectLength: pending.objectLength,
          elementId: pending.elementId,
          marker: pending.marker,
          streamOffset,
        },
      });
      this.#pending.delete(streamOffset);
    }

    let retainFrom = this.#nextScanOffset;
    for (const streamOffset of this.#pending.keys()) {
      retainFrom = Math.min(retainFrom, streamOffset);
    }
    retainFrom = Math.max(combinedStart, retainFrom);
    this.#buffer = combined.slice(retainFrom - combinedStart);
    this.#bufferStreamOffset = retainFrom;
    return frames;
  }

  finish(): { incompleteTargetFrames: number } {
    return { incompleteTargetFrames: this.#pending.size };
  }
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
const baseRailingPairs = new Map<
  string,
  { parentTag: number; childTag: number; source: string }
>();
const runById = new Map<number, Revit2027StairsRunAndLandingAggregate>();
const knownStairsElementIds = new Set<number>();
const pendingRunAndLandingFrames: { data: Uint8Array; frame: Frame }[] = [];
const pendingBaseRailingFrames: { data: Uint8Array; frame: Frame }[] = [];
let partitions = 0;
let inflatedChunks = 0;
let stairsFrames = 0;
let runFrames = 0;
let landingFrames = 0;
let baseRailingFrames = 0;
let baseRailingsWithStairsId = 0;
let baseRailingsWithoutStairsId = 0;
let baseRailingTargetsOutsideDecodedStairsFrames = 0;
let registeredRailingIds = 0;
let declaredRunAndLandingIds = 0;
let declaredSupportIds = 0;
let maximumObjectLength = 0;
let maximumReassemblyBufferBytes = 0;
let oversizedTargetFrames = 0;
let incompleteTargetFrames = 0;
const failures: { elementId: number; marker: number; error: string }[] = [];

function collectFrame({ data, frame }: ReassembledFrame): void {
  maximumObjectLength = Math.max(maximumObjectLength, frame.objectLength);
  if (frame.marker === REVIT_2027_STAIRS_ELEMENT_MARKER) {
    stairsFrames += 1;
    const decoded = decodeRevit2027StairsElementAggregate(
      data,
      frame.objectOffset,
      frame.objectLength,
      2027,
    );
    if (!decoded.ok) {
      failures.push({ ...frame, error: decoded.error });
      return;
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
    return;
  }

  if (frame.marker === REVIT_2027_BASE_RAILING_MARKER) {
    baseRailingFrames += 1;
    pendingBaseRailingFrames.push({ data, frame });
    return;
  }

  if (frame.marker === REVIT_2027_STAIRS_RUN_MARKER) runFrames += 1;
  else landingFrames += 1;
  pendingRunAndLandingFrames.push({ data, frame });
}

for (let entryIndex = 0; entryIndex < cfb.FileIndex.length; entryIndex += 1) {
  const stream = cfb.FullPaths[entryIndex] ?? "";
  if (!/\/Partitions\/[^/]+$/iu.test(stream)) continue;
  partitions += 1;
  const stored = stripRevitPageChecksums(
    asBytes(cfb.FileIndex[entryIndex].content),
  );
  const offsets = gzipOffsets(stored);
  const reassembler = new BoundedFrameReassembler();
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
    inflatedChunks += 1;
    for (const frame of reassembler.push(inflated)) collectFrame(frame);
  }
  maximumReassemblyBufferBytes = Math.max(
    maximumReassemblyBufferBytes,
    reassembler.maxBufferedBytes,
  );
  oversizedTargetFrames += reassembler.oversizedTargetFrames;
  incompleteTargetFrames += reassembler.finish().incompleteTargetFrames;
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

for (const { data, frame } of pendingBaseRailingFrames) {
  const decoded = decodeRevit2027BaseRailingStairsRelation(
    data,
    frame.objectOffset,
    frame.objectLength,
    2027,
  );
  if (!decoded.ok) {
    failures.push({ ...frame, error: decoded.error });
    continue;
  }
  if (!decoded.value.relation) {
    baseRailingsWithoutStairsId += 1;
    continue;
  }
  baseRailingsWithStairsId += 1;
  if (!knownStairsElementIds.has(decoded.value.relation.parentId)) {
    baseRailingTargetsOutsideDecodedStairsFrames += 1;
  }
  baseRailingPairs.set(
    `${decoded.value.relation.parentId}:${decoded.value.relation.childId}`,
    {
      parentTag: decoded.value.relation.parentId,
      childTag: decoded.value.relation.childId,
      source: decoded.value.relation.source,
    },
  );
}

api.CloseModel(model);
api.Dispose();

const decodedPairs = new Map([
  ...stairsDirectPairs,
  ...reciprocalPairs,
  ...baseRailingPairs,
]);
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
    baseRailingFrames,
    maximumObjectLength,
    maximumReassemblyBufferBytes,
    reassemblyFrameByteLimit: MAX_REASSEMBLED_FRAME_BYTES,
    oversizedTargetFrames,
    incompleteTargetFrames,
    registeredRailingIds,
    declaredRunAndLandingIds,
    declaredSupportIds,
    reciprocalRunAndLandingIds: runById.size,
    baseRailingsWithStairsId,
    baseRailingsWithoutStairsId,
    baseRailingTargetsOutsideDecodedStairsFrames,
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
      "OdBmBaseRailing::getStairsId",
    ],
    rule:
      "Only typed collection members and the uniquely decoded reciprocal suffix create relations; raw nearby ObjectId values do not.",
  },
};

console.log(JSON.stringify(report, null, 2));
if (paths.json) {
  writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);
}
