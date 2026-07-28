#!/usr/bin/env node

/**
 * Exact, read-only native Revit identity audit.
 *
 * Usage:
 *   node --experimental-strip-types scripts/audit-native-identity.ts \
 *     --rvt model.rvt --ifc reference.ifc --json report.json
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import CFB from "cfb";
import { IfcAPI } from "web-ifc";

import {
  decodeRevitDocumentHistory,
  decodeRevitNativeIdentities,
} from "../lib/reviter/native-identity.ts";
import {
  asBytes,
  gzipOffsets,
  inflateRevitChunk,
  stripRevitPageChecksums,
} from "../lib/reviter/revit-container.ts";

const argv = process.argv.slice(2);

function option(name: string): string {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]!);
  throw new Error(`Missing ${name}. Run with --rvt, --ifc, and --json.`);
}

const paths = {
  rvt: option("--rvt"),
  ifc: option("--ifc"),
  json: option("--json"),
};

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function scalar(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "object" && "value" in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

function inflateNamedStream(
  cfb: ReturnType<typeof CFB.read>,
  pattern: RegExp,
): { path: string; rawBytes: number; inflated: Uint8Array } {
  const entry = cfb.FileIndex
    .map((candidate, index) => ({
      entry: candidate,
      path: cfb.FullPaths[index] ?? "",
    }))
    .find(({ entry: candidate, path }) => candidate.size > 0 && pattern.test(path));
  if (!entry) throw new Error(`Missing stream ${pattern}`);
  const raw = stripRevitPageChecksums(asBytes(entry.entry.content));
  const gzipOffset = gzipOffsets(raw, 1)[0];
  const inflated = gzipOffset == null ? null : inflateRevitChunk(raw, gzipOffset);
  if (!inflated) throw new Error(`Could not inflate ${entry.path}`);
  return {
    path: entry.path.replace(/^Root Entry\//, ""),
    rawBytes: entry.entry.size,
    inflated,
  };
}

const rvtBytes = readFileSync(paths.rvt);
const ifcBytes = readFileSync(paths.ifc);
const cfb = CFB.read(rvtBytes, { type: "buffer" });
const historyStream = inflateNamedStream(cfb, /\/Global\/History$/i);
const elemTableStream = inflateNamedStream(cfb, /\/Global\/ElemTable$/i);
const history = decodeRevitDocumentHistory(historyStream.inflated, 2027);
if (history.format === "unsupported") throw new Error(history.reason);
const identity = decodeRevitNativeIdentities(elemTableStream.inflated, history, 2027);
if (identity.format === "unsupported") throw new Error(identity.reason);

const identityByElement = new Map(
  identity.identities.map((entry) => [entry.elementId, entry]),
);
const uniqueIdSet = new Set(identity.identities.map((entry) => entry.uniqueId));
const uniqueIdDigest = sha256(
  `${identity.identities.map((entry) => entry.uniqueId).join("\n")}\n`,
);
const originalIdDifferenceCount = identity.identities.filter(
  (entry) => entry.originalElementId !== entry.elementId,
).length;
const missingLastUserModification = identity.identities.filter(
  (entry) => entry.lastUserModificationEpisodeId == null,
).length;

const creationEpisodeIds = identity.identities.map((entry) => entry.creationEpisodeId);
const modificationEpisodeIds =
  identity.identities.map((entry) => entry.lastModificationEpisodeId);
const samples = [
  identity.identities[0],
  identityByElement.get(23),
  identityByElement.get(414),
  identityByElement.get(1_272_040),
  identityByElement.get(1_280_585),
  identity.identities.at(-1),
].filter((entry, index, values) =>
  entry != null && values.findIndex((candidate) => candidate?.elementId === entry.elementId) === index
);

const ifcText = ifcBytes.toString("latin1");
const revitIdentifiers = /RevitIdentifiers \[ContentGUID: ([0-9a-f-]+), VersionGUID: ([0-9a-f-]+), NumberOfSaves: (\d+)\]/i
  .exec(ifcText);
const api = new IfcAPI();
await api.Init();
const model = api.OpenModel(ifcBytes, { COORDINATE_TO_ORIGIN: false });
if (model < 0) throw new Error("web-ifc could not open the reference IFC");

let ifcElements = 0;
let ifcGlobalIds = 0;
const numericTags = new Set<number>();
const linkedNumericTags = new Set<number>();
let directGlobalIdToNativeUniqueIdMatches = 0;
for (const typeCode of api.GetIfcEntityList(model)) {
  if (!api.IsIfcElement(typeCode)) continue;
  const ids = api.GetLineIDsWithType(model, typeCode, false);
  for (let index = 0; index < ids.size(); index += 1) {
    const line = api.GetLine(model, ids.get(index), false);
    ifcElements += 1;
    const globalId = scalar(line.GlobalId);
    if (typeof globalId === "string" && globalId) {
      ifcGlobalIds += 1;
      if (uniqueIdSet.has(globalId)) directGlobalIdToNativeUniqueIdMatches += 1;
    }
    const tag = scalar(line.Tag);
    if (typeof tag !== "string" || !/^\d+$/u.test(tag)) continue;
    const numericTag = Number(tag);
    numericTags.add(numericTag);
    if (identityByElement.has(numericTag)) linkedNumericTags.add(numericTag);
  }
}
api.CloseModel(model);

const contentGuid = revitIdentifiers?.[1]?.toLowerCase() ?? null;
const matchingDocumentGuidSlots = contentGuid
  ? history.documentGuidSlots
      .map((guid, index) => ({ index, guid }))
      .filter(({ guid }) => guid === contentGuid)
      .map(({ index }) => index)
  : [];
const strengthHistogram: Record<string, number> = {};
for (const entry of history.episodes) {
  const key = `0x${entry.strength.toString(16)}`;
  strengthHistogram[key] = (strengthHistogram[key] ?? 0) + 1;
}

const report = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-native-identity.ts",
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
  },
  documentHistory: {
    stream: historyStream.path,
    storedBytes: historyStream.rawBytes,
    inflatedBytes: historyStream.inflated.byteLength,
    format: history.format,
    nextLocalSequenceNumber: history.nextLocalSequenceNumber,
    subsequenceNumberDeficit: history.subsequenceNumberDeficit,
    documentGuidSlots: history.documentGuidSlots,
    historyIndexValueCount: history.historyIndexValues.length,
    historyIndexValueRange: [
      Math.min(...history.historyIndexValues),
      Math.max(...history.historyIndexValues),
    ],
    historyIndexValuesSha256: sha256(
      `${history.historyIndexValues.join(",")}\n`,
    ),
    episodes: history.episodes.length,
    uniqueEpisodeGuids: new Set(history.episodes.map((entry) => entry.guid)).size,
    strengthHistogram,
    episodeSamples: [
      ...history.episodes.slice(0, 3),
      ...history.episodes.slice(-3),
    ],
  },
  nativeIdentity: {
    stream: elemTableStream.path,
    storedBytes: elemTableStream.rawBytes,
    inflatedBytes: elemTableStream.inflated.byteLength,
    format: identity.format,
    declaredRecordCount: identity.declaredRecordCount,
    decodedIdentityCount: identity.decodedIdentityCount,
    uniqueIdentityCount: uniqueIdSet.size,
    originalIdDifferenceCount,
    missingLastUserModification,
    creationEpisodeRange: [
      Math.min(...creationEpisodeIds),
      Math.max(...creationEpisodeIds),
    ],
    lastModificationEpisodeRange: [
      Math.min(...modificationEpisodeIds),
      Math.max(...modificationEpisodeIds),
    ],
    uniqueIdsSha256: uniqueIdDigest,
    samples,
  },
  ifcReference: {
    contentGuid,
    versionGuid: revitIdentifiers?.[2]?.toLowerCase() ?? null,
    numberOfSaves: revitIdentifiers ? Number(revitIdentifiers[3]) : null,
    contentGuidMatchingDocumentSlots: matchingDocumentGuidSlots,
    elements: ifcElements,
    elementsWithGlobalId: ifcGlobalIds,
    uniqueNumericRevitTags: numericTags.size,
    numericTagsLinkedToNativeIdentity: linkedNumericTags.size,
    directGlobalIdToNativeUniqueIdMatches,
    note:
      "IFC GlobalId and native Revit UniqueId are different identifier domains. " +
      "The numeric IFC Tag is the exact element-table join key.",
  },
};

mkdirSync(dirname(paths.json), { recursive: true });
writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `History: ${history.episodes.length} unique episodes; ` +
  `${history.documentGuidSlots.length} document GUID slots`,
);
console.log(
  `Native identity: ${identity.decodedIdentityCount} decoded; ` +
  `${uniqueIdSet.size} unique`,
);
console.log(
  `IFC: ${linkedNumericTags.size}/${numericTags.size} unique numeric tags linked; ` +
  `${matchingDocumentGuidSlots.length} content-GUID slot matches`,
);
console.log(`Wrote ${paths.json}`);
