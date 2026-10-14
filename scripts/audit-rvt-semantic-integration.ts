#!/usr/bin/env node
/**
 * Reproduce semantic integration evidence without changing the measured release.
 * node --experimental-strip-types scripts/audit-rvt-semantic-integration.ts model.rvt
 *   --reference-ifc revit.ifc --reference-glb reference.glb
 *   --baseline baseline.json --json audit.json --out recovered.ifc
 *   --native-rooms --design-options main-and-primary --evidence rooms.json
 *
 * A reference may represent another view/schema/exporter configuration. Exact
 * Tag identity comparisons are observations, not an all-elements-match gate.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { IfcAPI } from "web-ifc";
import { convertRvtBytes } from "../lib/reviter/convert.ts";
import type { ConvertResult } from "../lib/reviter/types.ts";
import { analyzeGlbDocument, readGlbDocument } from "./glb-statistics.ts";
import { declareUsage, hasFlag, isEntryPoint, optionValue, positionals, splitStepArgs, writeJsonReport } from "./lib/rvt-harness.ts";

type TaggedRoot = { entity: string; tag: string; globalId: string; kind: "product" | "type" };

/** Only IfcElement/IfcElementType Tag fields; spatial LongName is not a Tag. */
export function taggedIfcRoots(source: string): TaggedRoot[] {
  const roots: TaggedRoot[] = [];
  const expressions = /#\d+\s*=\s*(IFC[A-Z0-9]+)\s*\(\s*'([0-3][0-9A-Za-z_$]{21})'((?:'(?:[^']|'')*'|[^';])*)\);/g;
  for (const match of source.matchAll(expressions)) {
    const entity = match[1]!;
    if (/^IFC(?:REL|PROPERTY|PROJECT|SITE|BUILDING$|BUILDINGSTOREY|SPACE$|GROUP|SYSTEM|ZONE)/.test(entity)) continue;
    const args = splitStepArgs(`'${match[2]}'${match[3]}`);
    const tag = /^'([0-9]+)'$/.exec(args[7] ?? "")?.[1];
    if (tag == null) continue;
    roots.push({ entity, tag, globalId: match[2]!, kind: /(?:TYPE|STYLE)$|^IFCTYPE(?:PRODUCT|OBJECT)$/.test(entity) ? "type" : "product" });
  }
  return roots;
}

export function compareIfcGlobalIds(exported: string, reference: string) {
  const index = (roots: TaggedRoot[]) => {
    const byTag = new Map<string, TaggedRoot[]>();
    for (const root of roots) {
      const key = `${root.kind}:${root.tag}`;
      byTag.set(key, [...(byTag.get(key) ?? []), root]);
    }
    return byTag;
  };
  const output = index(taggedIfcRoots(exported));
  const truth = index(taggedIfcRoots(reference));
  const byEntity: Record<string, { compared: number; matched: number; mismatched: number }> = {};
  const mismatchExamples: Array<{ tag: string; referenceEntity: string; exportedEntity: string; referenceGlobalId: string; exportedGlobalId: string }> = [];
  let matched = 0, mismatched = 0, ambiguousTags = 0, outputOnly = 0, referenceOnly = 0;
  for (const [key, values] of output) {
    const referenceValues = truth.get(key);
    if (!referenceValues) { outputOnly += 1; continue; }
    if (values.length !== 1 || referenceValues.length !== 1) { ambiguousTags += 1; continue; }
    const own = values[0]!, ref = referenceValues[0]!;
    const counts = byEntity[`${ref.entity} -> ${own.entity}`] ??= { compared: 0, matched: 0, mismatched: 0 };
    counts.compared += 1;
    if (own.globalId === ref.globalId) { matched += 1; counts.matched += 1; }
    else {
      mismatched += 1; counts.mismatched += 1;
      if (mismatchExamples.length < 30) mismatchExamples.push({ tag: own.tag, referenceEntity: ref.entity, exportedEntity: own.entity, referenceGlobalId: ref.globalId, exportedGlobalId: own.globalId });
    }
  }
  for (const key of truth.keys()) if (!output.has(key)) referenceOnly += 1;
  return {
    join: "exact numeric IFC Tag text, separated into product/type; duplicate tags excluded",
    exportedTaggedRoots: [...output.values()].reduce((n, values) => n + values.length, 0),
    referenceTaggedRoots: [...truth.values()].reduce((n, values) => n + values.length, 0),
    compared: matched + mismatched, matched, mismatched, ambiguousTags, outputOnly, referenceOnly,
    byEntity, mismatchExamples,
    scope: "Reference export coverage, schema and generated sub-elements can differ; mismatches are reported without assuming equivalence.",
  };
}

/** Matches the pre-integration mesh-byte hashing used for baseline snapshots. */
export function semanticAuditGeometryHash(result: ConvertResult): string {
  const hash = createHash("sha256");
  for (const mesh of result.meshes) for (const key of ["positions", "indices", "colors", "elementIds"] as const) {
    const data = mesh[key];
    if (data) hash.update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  return hash.digest("hex");
}

export function compareGeometryBaseline(actual: Record<string, unknown>, baseline: Record<string, unknown>) {
  return Object.fromEntries(["geometryHash", "triangles", "meshes", "bounds", "origin", "bbox"].map((key) => {
    const expected = baseline[key];
    return [key, { expected: expected ?? null, actual: actual[key], matches: expected === undefined ? null : JSON.stringify(expected) === JSON.stringify(actual[key]) }];
  }));
}

async function reopenIfc(source: string) {
  const api = new IfcAPI();
  await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(source));
  if (model < 0) { api.Dispose(); throw new Error("web-ifc could not reopen the exported IFC"); }
  try {
    const entities = Object.fromEntries(api.GetAllTypesOfModel(model).map((type) => [
      type.typeName.toUpperCase(), api.GetLineIDsWithType(model, type.typeID).size(),
    ]));
    return { reader: "web-ifc", schema: api.GetModelSchema(model), entities, scope: "Schema/entity population reopen only; meshes are not tessellated by this check." };
  } finally { api.CloseModel(model); api.Dispose(); }
}

function referenceGlb(path: string) {
  const document = readGlbDocument(readFileSync(path));
  const payload = document as unknown as { asset?: unknown; extras?: unknown; nodes?: Array<{ name?: string; extras?: unknown }>; meshes?: Array<{ name?: string; extras?: unknown }> };
  const nodeMetadata = (payload.nodes ?? []).filter((node) => node.name || node.extras);
  const meshMetadata = (payload.meshes ?? []).filter((mesh) => mesh.name || mesh.extras);
  const metadataKeys: Record<string, number> = {};
  const autodeskDbIds = new Set<number>();
  for (const item of [...nodeMetadata, ...meshMetadata]) {
    if (!item.extras || typeof item.extras !== "object") continue;
    for (const [key, value] of Object.entries(item.extras)) {
      metadataKeys[key] = (metadataKeys[key] ?? 0) + 1;
      if (key === "autodeskDbId" && typeof value === "number") autodeskDbIds.add(value);
    }
  }
  return {
    path, statistics: analyzeGlbDocument(document), asset: payload.asset, extras: payload.extras,
    namedOrAnnotatedNodes: nodeMetadata.length, namedOrAnnotatedMeshes: meshMetadata.length,
    metadataKeys, distinctAutodeskDbIds: autodeskDbIds.size,
    nodeMetadataExamples: nodeMetadata.slice(0, 12).map(({ name, extras }) => ({ name, extras })),
    meshMetadataExamples: meshMetadata.slice(0, 12).map(({ name, extras }) => ({ name, extras })),
    scope: "Reference payload metadata, instancing and world bounds only. Autodesk dbId is not treated as a Revit ElementId. A scoped visual export is not assumed to have full-model coverage, shared coordinates, units or element tags.",
  };
}

function evidenceSummary(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value ?? null;
  if (Array.isArray(value)) return { count: value.length };
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key, Array.isArray(entry)
      ? entry.length && entry.every(item => typeof item === "string") ? entry : { count: entry.length }
      : entry,
  ]));
}

async function run() {
  const usage = "audit-rvt-semantic-integration.ts model.rvt [--reference-ifc revit.ifc] [--reference-glb reference.glb] [--baseline baseline.json] [--json audit.json] [--out recovered.ifc] [--native-rooms] [--mep] [--design-options all|main-and-primary] [--evidence evidence.json]";
  declareUsage(usage);
  const [input] = positionals("--reference-ifc", "--reference-glb", "--baseline", "--json", "--out", "--design-options", "--evidence");
  if (!input) throw new Error(`usage: ${usage}`);
  const designOptions = optionValue("--design-options") ?? "all";
  if (designOptions !== "all" && designOptions !== "main-and-primary") throw new Error("--design-options must be all or main-and-primary");
  const exportOptions = { nativeRooms: hasFlag("--native-rooms"), mep: hasFlag("--mep"), designOptions } as const;
  const started = Date.now();
  const inputBytes = new Uint8Array(readFileSync(input));
  const sourceSha256 = createHash("sha256").update(inputBytes).digest("hex");
  // Release detection is intentionally automatic, including narrow-id models.
  const result = convertRvtBytes(inputBytes, basename(input), {});
  if (!result.ok) throw new Error(result.error);
  const geometryHash = semanticAuditGeometryHash(result);
  const triangles = result.meshes.reduce((n, mesh) => n + mesh.indices.length / 3, 0);
  const { makeIfc } = await import("../lib/reviter/export-ifc.ts");
  const ifc = makeIfc(result, exportOptions);
  const propertySetNames: Record<string, number> = {};
  for (const match of ifc.matchAll(/=IFCPROPERTYSET\('[^']*',#[0-9]+,'((?:[^']|'')*)'/g)) {
    const name = match[1]!.replaceAll("''", "'");
    propertySetNames[name] = (propertySetNames[name] ?? 0) + 1;
  }
  const outPath = optionValue("--out");
  if (outPath) writeFileSync(outPath, ifc);
  const baselinePath = optionValue("--baseline");
  const baseline = baselinePath ? JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, unknown> : null;
  const referencePath = optionValue("--reference-ifc");
  const glbPath = optionValue("--reference-glb");
  const evidence = result as unknown as Record<string, unknown>;
  const sourceSummary = { file: input, sourceSha256, byteLength: result.byteLength, version: result.decoderCoverage.revitVersion, method: result.method, geometryHash, meshes: result.meshes.length, triangles, bounds: result.elementBounds.length, origin: result.origin, bbox: result.bbox, identities: result.nativeIdentity?.identities.length ?? 0 };
  const roomStatus: Record<string, number> = {};
  const rooms = result.nativeSourceRooms ?? [];
  for (const room of rooms) roomStatus[room.outlineStatus] = (roomStatus[room.outlineStatus] ?? 0) + 1;
  const roomSummary = {
    count: rooms.length, withName: rooms.filter(room => room.name).length,
    withNumber: rooms.filter(room => room.number).length,
    withOutline: rooms.filter(room => room.outline).length,
    withLevel: rooms.filter(room => room.levelId != null).length,
    withBounds: rooms.filter(room => room.boundsFeet).length,
    outlineStatus: roomStatus,
  };
  const overrideIds = new Set([-1_019_014, -1_019_015, -1_019_016, -1_019_017]);
  const overrideCounts: Record<string, { own: number; type: number }> = {};
  for (const id of overrideIds) overrideCounts[String(id)] = { own: 0, type: 0 };
  for (const element of result.elementBounds) {
    for (const parameter of element.parameters ?? []) if (overrideIds.has(parameter.parameterId)) overrideCounts[String(parameter.parameterId)]!.own += 1;
    for (const parameter of element.typeParameters ?? []) if (overrideIds.has(parameter.parameterId)) overrideCounts[String(parameter.parameterId)]!.type += 1;
  }
  const parameters = {
    elementsWithOwnParameters: result.elementBounds.filter(element => element.parameters?.length).length,
    ownParameterValues: result.elementBounds.reduce((n, element) => n + (element.parameters?.length ?? 0), 0),
    elementsWithTypeParameters: result.elementBounds.filter(element => element.typeParameters?.length).length,
    typeParameterValuesPerElement: result.elementBounds.reduce((n, element) => n + (element.typeParameters?.length ?? 0), 0),
    exportOverrideCountsPerElement: overrideCounts,
    scope: "Type values are counted as attached to each instance, so shared type parameters may repeat.",
  };
  const evidencePath = optionValue("--evidence");
  const roomIds = new Set(rooms.map(room => room.elementId));
  if (evidencePath) writeJsonReport(evidencePath, {
    schemaVersion: 1, source: sourceSummary, nativeSourceRooms: rooms,
    nativeRoomIdentities: result.nativeIdentity?.identities.filter(identity => roomIds.has(identity.elementId)) ?? [],
    levels: result.levels, nativeDesignOptions: result.nativeDesignOptions,
    nativeDesignOptionMembership: result.nativeDesignOptionMembership,
  });
  const baselineChecks = baseline ? compareGeometryBaseline(sourceSummary, baseline) : null;
  const report = {
    schemaVersion: 1, generatedBy: "scripts/audit-rvt-semantic-integration.ts", source: sourceSummary,
    baseline: baselinePath ? { path: baselinePath, checks: baselineChecks } : null,
    semantics: { rooms: roomSummary, parameters, designOptions: evidenceSummary(evidence.nativeDesignOptions), mep: evidenceSummary(evidence.nativeMepEvidence), coverage: result.decoderCoverage },
    output: { path: outPath, bytes: Buffer.byteLength(ifc), exportOptions, evidencePath, propertySetNames, standardPropertySets: Object.fromEntries(Object.entries(propertySetNames).filter(([name]) => name.startsWith("Pset_"))), readerValidation: await reopenIfc(ifc) },
    referenceIfc: referencePath ? { path: referencePath, ...compareIfcGlobalIds(ifc, readFileSync(referencePath, "utf8")) } : null,
    referenceGlb: glbPath ? referenceGlb(glbPath) : null,
    elapsedMs: Date.now() - started,
  };
  const jsonPath = optionValue("--json");
  if (jsonPath) writeJsonReport(jsonPath, report);
  console.log(JSON.stringify(report, null, 2));
  if (baselineChecks && Object.values(baselineChecks).some((check) => check.matches === false)) process.exitCode = 1;
}

if (isEntryPoint(import.meta.url)) await run();
