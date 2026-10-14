/** Read-only native lifecycle audit, optionally joined to Autodesk SVF properties. */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync, gunzipSync, strFromU8 } from "fflate";
import { openRvt, iterateInflatedChunks, optionValue } from "./lib/rvt-harness.ts";
import { readSchema } from "../lib/reviter/schema-reader.ts";
import { buildClassTagTranslation, setActiveClassTagTranslation } from "../lib/reviter/revit-class-tags.ts";
import { setActiveElementIdBytes, elementIdBytesFromSchema } from "../lib/reviter/element-id-width.ts";
import { decodeRevitDocumentHistory, decodeRevitNativeIdentities } from "../lib/reviter/native-identity.ts";
import { scanElementHeaders } from "../lib/reviter/element-headers.ts";
import { nativePhaseLayout, collectNativePhaseEvidence, resolveNativePhaseEvidence } from "../lib/reviter/native-phases.ts";
import type { NativePhaseEvidence } from "../lib/reviter/native-phases.ts";

const path = process.argv[2];
if (!path || path.startsWith("--")) throw Error("usage: audit-native-phases.ts model.rvt [--svf capture-svf.zip] [--json report.json]");
const model = openRvt(path);
const version = model.release();
if (!version) throw Error("Missing BasicFileInfo release");
const inflate = (pattern: RegExp) => {
  const chunks = [...iterateInflatedChunks(model, { pattern, salvage: false, onFailure() { throw Error(`Incomplete ${pattern} inflation`); } })];
  if (!chunks.length) throw Error(`Missing ${pattern}`);
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.data.length, 0));
  let at = 0;
  for (const chunk of chunks) { result.set(chunk.data, at); at += chunk.data.length; }
  return result;
};
const schema = readSchema(inflate(/\/Formats\/Latest$/i));
if (!schema.ok) throw Error(schema.error);
setActiveElementIdBytes(elementIdBytesFromSchema(schema.schema.classes));
setActiveClassTagTranslation(buildClassTagTranslation(schema.schema.classes.map((entry) => ({
  name: entry.name, tag: entry.index, declaredFieldCount: entry.propertyCount, fieldNames: entry.properties.map((field) => field.name),
}))));
const history = decodeRevitDocumentHistory(inflate(/\/Global\/History$/i), version);
if (history.format === "unsupported") throw Error(history.reason);
const identity = decodeRevitNativeIdentities(inflate(/\/Global\/ElemTable$/i), history, version);
if (identity.format === "unsupported") throw Error(identity.reason);
const declaredIds = new Set(identity.identities.map((entry) => entry.elementId));
const phaseCategoryIds = new Set<number>();
const evidence: NativePhaseEvidence[] = [];
const layout = nativePhaseLayout(version, schema.schema.classes);
let pages = 0, failures = 0, salvaged = 0;
for (const chunk of iterateInflatedChunks(model, { onFailure() { failures++; } })) {
  pages++;
  if (chunk.salvaged) { salvaged++; continue; }
  for (const header of scanElementHeaders(chunk.data)) if (header.categoryId === -2_000_112) phaseCategoryIds.add(header.elementId);
  evidence.push(collectNativePhaseEvidence(chunk.data, layout, declaredIds, { stream: chunk.path, chunkIndex: chunk.chunkIndex }));
}
const native = resolveNativePhaseEvidence(evidence, phaseCategoryIds);
const names = new Map(native.phases.map((phase) => [phase.elementId, phase.name]));
const phaseByElement = new Map(native.relations.map((relation) => [relation.elementId, relation]));
const svf = optionValue("--svf");
let comparison: object | null = null;
if (svf) {
  const archive = unzipSync(readFileSync(svf));
  const table = (name: string): unknown[] => {
    const key = Object.keys(archive).find((key) => key.endsWith(`objects_${name}.json.gz`));
    if (!key) throw Error(`SVF lacks ${name}`);
    return JSON.parse(strFromU8(gunzipSync(archive[key]!)));
  };
  const ids = table("ids"), attrs = table("attrs"), values = table("vals");
  const offsets = table("offs") as number[], avs = table("avs") as number[];
  const byUniqueId = new Map(identity.identities.map((entry) => [entry.uniqueId.toLowerCase(), entry.elementId]));
  let matched = 0, different = 0, unavailable = 0, referenceCreated = 0, referenceDemolished = 0;
  const mismatchExamples: object[] = [];
  for (let dbId = 0; dbId < ids.length; dbId++) {
    const uniqueId = ids[dbId];
    if (typeof uniqueId !== "string") continue;
    const elementId = byUniqueId.get(uniqueId.toLowerCase());
    if (elementId === undefined) continue;
    for (let pair = offsets[dbId]!; pair < (offsets[dbId + 1] ?? avs.length / 2); pair++) {
      const attr = attrs[avs[pair * 2]!] as unknown[] | undefined;
      if (!Array.isArray(attr) || attr[1] !== "Phasing" || !["Phase Created", "Phase Demolished"].includes(String(attr[0]))) continue;
      const expected = values[avs[pair * 2 + 1]!];
      if (typeof expected !== "string" || !expected.trim() || expected === "None") continue;
      const created = attr[0] === "Phase Created";
      if (created) referenceCreated++; else referenceDemolished++;
      const relation = phaseByElement.get(elementId);
      const phaseId = created ? relation?.createdPhaseId : relation?.demolishedPhaseId;
      const actual = phaseId == null ? undefined : names.get(phaseId);
      if (actual === undefined) unavailable++;
      else if (actual === expected) matched++;
      else { different++; if (mismatchExamples.length < 10) mismatchExamples.push({ elementId, property: attr[0], expected, actual }); }
    }
  }
  comparison = { source: basename(svf), sha256: createHash("sha256").update(readFileSync(svf)).digest("hex"), join: "Native Global/ElemTable + Global/History UniqueId to SVF objects_ids", referenceCreated, referenceDemolished, matched, different, unavailable, mismatchExamples };
}
const report = {
  model: basename(path), sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), version,
  schemaAdmitted: layout !== null, pages, failures, salvaged, declaredIds: declaredIds.size,
  phaseCategoryIds: [...phaseCategoryIds], phases: native.phases,
  lifecycleRelations: native.relations.length,
  resolvedCreated: native.relations.filter((relation) => relation.createdPhaseId !== null && names.has(relation.createdPhaseId)).length,
  resolvedDemolished: native.relations.filter((relation) => relation.demolishedPhaseId !== null && names.has(relation.demolishedPhaseId)).length,
  comparison,
  limitations: ["Complete in-page frames only; broad frame ceiling 65535 bytes.", "No phase order, active view phase, lifecycle status or phase filtering inferred.", "Only 2024/2025/2027 schemas measured by this collector.", "Salvaged pages excluded from evidence."],
};
const output = optionValue("--json");
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
setActiveClassTagTranslation(null);
setActiveElementIdBytes(null);
