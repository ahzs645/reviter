#!/usr/bin/env node
/** Read-only paired audit. Does not load reference geometry into RVT conversion. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { IfcAPI } from "web-ifc";
import { openRevitContainer } from "../lib/reviter/convert-container.ts";
import { collectElementParameters } from "../lib/reviter/element-parameters.ts";
import { asBytes, gzipOffsets, inflateRevitChunk, revitWindowTail, stripRevitPageChecksums } from "../lib/reviter/revit-container.ts";
import { IfcExportParameterCollector, revitIfcGlobalId } from "../lib/reviter/revit-ifc-semantics.ts";
import { setActiveClassTagTranslation } from "../lib/reviter/revit-class-tags.ts";
import { setActiveElementIdBytes } from "../lib/reviter/element-id-width.ts";

const args = process.argv.slice(2);
const rvtPath = args[0];
const ifcPath = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
if (!rvtPath) throw new Error("Usage: audit-ifc-native-semantics.ts model.rvt [reference.ifc] [--json report.json]");
const rvtBytes = readFileSync(rvtPath);
const ifcBytes = ifcPath ? readFileSync(ifcPath) : null;
const container = openRevitContainer(rvtBytes, {});
const native = container.nativeIdentity;
if (!native) throw new Error("No supported native Revit identity decode");
const identityByElement = new Map(native.identities.map((identity) => [identity.elementId, identity]));
const collector = new IfcExportParameterCollector();
let pages = 0;
const savedIfcGuids = new Map<number, Set<string>>();
for (const partition of container.partitions) {
  const data = stripRevitPageChecksums(asBytes(partition.entry.content));
  const offsets = gzipOffsets(data);
  let window: Uint8Array | undefined;
  for (let index = 0; index < offsets.length; index += 1) {
    const inflated = inflateRevitChunk(data, offsets[index]!, offsets[index + 1], window);
    if (!inflated) continue;
    window = revitWindowTail(inflated);
    pages += 1;
    for (const table of collectElementParameters(inflated)) {
      collector.add(table.elementId, table.parameters);
      for (const parameter of table.parameters) {
        if (parameter.parameterId !== -1019000 || typeof parameter.value !== "string" || !parameter.value.trim()) continue;
        const values = savedIfcGuids.get(table.elementId) ?? new Set<string>();
        values.add(parameter.value);
        savedIfcGuids.set(table.elementId, values);
      }
    }
  }
}
setActiveClassTagTranslation(null);
setActiveElementIdBytes(null);
const api = new IfcAPI();
await api.Init();
const model = ifcBytes ? api.OpenModel(ifcBytes, { COORDINATE_TO_ORIGIN: false }) : null;
if (model !== null && model < 0) throw new Error("Reference IFC reader failed");
const referenceSchema = model === null ? null : api.GetModelSchema(model);
const referenceIdentifiers = ifcBytes ? /RevitIdentifiers \[ContentGUID: ([0-9a-f-]+), VersionGUID: ([0-9a-f-]+), NumberOfSaves: (\d+)\]/i.exec(ifcBytes.subarray(0, 8192).toString("utf8")) : null;
let referenceElements = 0;
let nativeTaggedProducts = 0;
let matchingGlobalIds = 0;
let unsupportedOriginalHandles = 0;
const matchedByEntity = new Map<string, number>();
const mismatchesByEntity = new Map<string, number>();
const nativeElementsWithMatchingGlobalId = new Set<number>();
const mismatches: { elementId: number; entity: string; expected: string; actual: string }[] = [];
const refs = new Map<number, { entity: string; globalId: string }[]>();
try {
  for (const type of model === null ? [] : api.GetAllTypesOfModel(model)) {
    if (model === null) break;
    if (!api.IsIfcElement(type.typeID)) continue;
    const ids = api.GetLineIDsWithType(model, type.typeID, false);
    for (let index = 0; index < ids.size(); index += 1) {
      const line = api.GetLine(model, ids.get(index), false);
      referenceElements += 1;
      const tag = line?.Tag?.value;
      if (typeof tag !== "string" || !/^\d+$/.test(tag)) continue;
      const elementId = Number(tag);
      const actual = line?.GlobalId?.value;
      if (typeof actual !== "string") continue;
      const values = refs.get(elementId) ?? [];
      values.push({ entity: type.typeName, globalId: actual });
      refs.set(elementId, values);
      const identity = identityByElement.get(elementId);
      if (!identity) continue;
      nativeTaggedProducts += 1;
      const expected = revitIfcGlobalId(identity.episodeGuid, identity.originalElementId);
      if (!expected) { unsupportedOriginalHandles += 1; continue; }
      if (expected === actual) {
        matchingGlobalIds += 1;
        matchedByEntity.set(type.typeName, (matchedByEntity.get(type.typeName) ?? 0) + 1);
        nativeElementsWithMatchingGlobalId.add(elementId);
      } else {
        mismatchesByEntity.set(type.typeName, (mismatchesByEntity.get(type.typeName) ?? 0) + 1);
        mismatches.push({ elementId, entity: type.typeName, expected, actual });
      }
    }
  }
} finally {
  if (model !== null) api.CloseModel(model);
  api.Dispose();
}
const report = {
  audit: "revit-ifc-native-semantics-v1",
  rvt: { name: basename(rvtPath), sha256: createHash("sha256").update(rvtBytes).digest("hex"), release: container.decoderPlan.revitVersion },
  ifc: ifcPath && ifcBytes ? { name: basename(ifcPath), sha256: createHash("sha256").update(ifcBytes).digest("hex") } : null,
  referenceSchema,
  referenceRevitIdentifiers: referenceIdentifiers ? { contentGuid: referenceIdentifiers[1], versionGuid: referenceIdentifiers[2], numberOfSaves: Number(referenceIdentifiers[3]) } : null,
  sourceRevisionAgreement: "unverified: creation identity is stable across revisions; the IFC export revision has not been joined to the RVT save revision",
  inflatedPages: pages,
  nativeIdentities: native.identities.length,
  referenceElements,
  nativeTaggedProducts,
  matchingGlobalIds,
  nativeElementsWithMatchingGlobalId: nativeElementsWithMatchingGlobalId.size,
  matchedByEntity: Object.fromEntries(matchedByEntity),
  mismatchesByEntity: Object.fromEntries(mismatchesByEntity),
  unsupportedOriginalHandles,
  mismatchCount: mismatches.length,
  mismatchSamples: mismatches.slice(0, 30),
  uniqueNativeTags: [...refs.keys()].filter((id) => identityByElement.has(id)).length,
  nonuniqueNativeTags: [...refs].filter(([id, values]) => identityByElement.has(id) && values.length > 1).length,
  nonuniqueNativeTagSamples: [...refs].filter(([id, values]) => identityByElement.has(id) && values.length > 1).slice(0, 10).map(([elementId, referenceProducts]) => ({ elementId, referenceProducts })),
  savedIfcGuidParameterCount: savedIfcGuids.size,
  savedIfcGuidParameterSamples: [...savedIfcGuids].slice(0, 20).map(([elementId, guids]) => ({ elementId, guids: [...guids], referenceProducts: refs.get(elementId) ?? [] })),
  exportParameters: collector.entries().map((entry) => ({ ...entry, referenceProducts: refs.get(entry.elementId) ?? [] })),
  limitations: ["Reference exporters may synthesize subelements, override saved IFC GUIDs, or split one native element into multiple products. Those are reported as disagreements, not silently remapped.", "Parameter recovery requires Reviter's measured owned element parameter-table framing; no proximity scan is used."],
};
const text = `${JSON.stringify(report, null, 2)}\n`;
const outputIndex = args.indexOf("--json");
if (outputIndex >= 0) {
  if (!args[outputIndex + 1]) throw new Error("--json requires a path");
  writeFileSync(args[outputIndex + 1]!, text);
}
process.stdout.write(text);
