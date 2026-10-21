/** Source-local riser indices only. Original root nominal indices/elevations,
 * parent declarations, served planes and physical bodies remain distinct.
 * Nothing here replaces their independent consumer guards. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Rational, rational } from "./native-rational-overlay.ts";
import { readSchema } from "./schema-reader.ts";
import { readNativeStairTypedFifo } from "./native-stair-typed-fifo.ts";
import { originalNativeStairAssemblyMembershipFacts, readOriginalNativeStairAssemblySemanticSource, inspectOriginalNativeStairAssemblyLandingPorts, type OriginalNativeStairAssemblyMembership } from "./native-source-stair-assembly.ts";
import { inspectOriginalStairRiserLocalPartition, inspectPortableOriginalRiserPartition, type PortableOriginalRiserPartition } from "./native-stair-riser-local-partition.ts";
export { inspectOriginalStairRiserLocalPartition, inspectPortableOriginalRiserPartition, type PortableOriginalRiserPartition } from "./native-stair-riser-local-partition.ts";
const hash = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
const sourceId = (v: unknown) => (v as { m_id?: { m_id64?: unknown } } | undefined)?.m_id?.m_id64;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const positiveId = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) > 0;
const difference = (a: Rational, b: Rational) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const scalar = (v: Rational) => ({ numerator: v.n.toString(), denominator: v.d.toString() });
const sourceOperandSnapshot = (value: unknown): unknown => {
  if (value instanceof Rational) return scalar(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sourceOperandSnapshot);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, operand]) => [key, sourceOperandSnapshot(operand)]));
  return value;
};
const brand: unique symbol = Symbol("OriginalNativeStairRiserPartition");
export type OriginalNativeStairRiserPartition = { readonly [brand]: true; readonly sourceModelSha256: string; readonly sourceSchemaSha256: string; readonly nativeStairId: number; readonly originalPartitionSha256: string };
const stored = new WeakMap<OriginalNativeStairRiserPartition, ReturnType<typeof partitionFromSource>>();
function partitionFromSource(assembly: OriginalNativeStairAssemblyMembership) {
  const membership = originalNativeStairAssemblyMembershipFacts(assembly);
  if (!membership.completeOriginalChildSemanticOccurrenceCensus || !membership.schemaChildUnionClosed || membership.originalBaseOnlyChildOccurrenceCount || membership.originalParentDeclaredIdsAbsentFromLiveChildCensus.length || !membership.originalRunIds.length) throw Error("Incomplete schema-closed original partition membership");
  const parent = membership.originalParentRoot;
  for (const key of ["m_actualRiserHeight", "m_stairsHeight"] as const) if (!finite(parent[key]) || Number(parent[key]) <= 0) throw Error("Invalid original parent declared height/rise");
  if (!positiveId(parent.m_actualNumberOfRisers) || parent.m_moribund !== 0 || parent.m_dummy !== 0 || !positiveId(sourceId(parent.m_baseLevelId)) || !positiveId(sourceId(parent.m_topLevelId)) || !finite(parent.m_baseLevelOffset) || !finite(parent.m_topLevelOffset)) throw Error("Invalid original parent declared count/served-level metadata");
  const ownedRuns: PortableOriginalRiserPartition["ownedRuns"] = [];
  const runs = membership.members.filter(m => m.kind === "run").map(member => {
    const raw = readOriginalNativeStairAssemblySemanticSource(assembly, member.nativeElementId), schema = readSchema(raw.originalSchemaBytes);
    if (!schema.ok || hash(raw.originalSchemaBytes) !== assembly.sourceSchemaSha256 || hash(raw.originalSemanticBytes) !== member.originalChildSemanticFrameSha256) throw Error("Original partition source identity differs");
    const read = readNativeStairTypedFifo(raw.originalSemanticBytes, schema.schema);
    if (!read.ok || read.value.root.m_moribund !== 0 || read.value.root.m_dummy !== 0 || sourceId(read.value.root.m_stairsId) !== membership.nativeStairId) throw Error("Original partition child source/owner unavailable");
    ownedRuns.push({ originalRunFrameSha256: member.originalChildSemanticFrameSha256, run: structuredClone(read.value) });
    return { originalChildSourceFrameSha256: member.originalChildSemanticFrameSha256, ...inspectOriginalStairRiserLocalPartition(read.value) };
  });
  const total = runs.reduce((n, run) => n + run.originalOrderedRiserCount, 0);
  if (total !== parent.m_actualNumberOfRisers) throw Error("Complete original child partition count differs from parent declared count");
  // Each landing's complete named source boundary/history and reciprocal
  // semantic joins remain exact. Finite incidence and cap/body crossing are
  // retained for independent consumers, never upgraded to walking approval.
  const landings = membership.originalLandingIds.map(id => ({ nativeLandingId: id, originalNamedPortFacts: sourceOperandSnapshot(inspectOriginalNativeStairAssemblyLandingPorts(assembly, id)) }));
  const portableOperands: PortableOriginalRiserPartition = { sourceModelSha256: assembly.sourceModelSha256, sourceSchemaSha256: assembly.sourceSchemaSha256, nativeStairId: assembly.nativeStairId, originalParentFrameSha256: membership.originalParentSemanticFrameSha256, originalParentRoot: structuredClone(parent), ownedRuns };
  inspectPortableOriginalRiserPartition(portableOperands, ownedRuns[0]!.run);
  const rise = rational(Number(parent.m_actualRiserHeight)), height = rational(Number(parent.m_stairsHeight)), product = new Rational(rise.n * BigInt(total), rise.d);
  const facts = { sourceModelSha256: assembly.sourceModelSha256, sourceSchemaSha256: assembly.sourceSchemaSha256, nativeStairId: assembly.nativeStairId, originalAssemblyMembershipSha256: assembly.assemblyMembershipSha256, originalParentSourceFrameSha256: membership.originalParentSemanticFrameSha256, completeSchemaClosedOriginalMembership: true as const, originalOwnedRunIds: membership.originalRunIds, originalOwnedLandingIds: membership.originalLandingIds, originalParentDeclaredMemberIds: membership.originalParentDeclaredMemberIds, originalParentActualNumberOfRisers: parent.m_actualNumberOfRisers, originalParentActualRiserHeightFeet: parent.m_actualRiserHeight, originalParentStairsHeightFeet: parent.m_stairsHeight, originalParentBaseNativeLevelId: sourceId(parent.m_baseLevelId), originalParentTopNativeLevelId: sourceId(parent.m_topLevelId), originalParentBaseLevelOffsetFeet: parent.m_baseLevelOffset, originalParentTopLevelOffsetFeet: parent.m_topLevelOffset, originalParentHeightMinusExactRiseTimesCountFeet: scalar(difference(height, product)), originalParentRiseTimesCountExactEquality: difference(height, product).n === 0n, originalCompleteChildOrderedRiserTotal: total, runs, landings, sourceLocalIndexInterpretationApproved: true as const, nominalRootExtentApproved: false as const, parentHeightRiseProductApproved: false as const, nativeLevelElevationsInspected: false as const, servedPhysicalPlanesApproved: false as const, treadFootprintOrOrientationApproved: false as const, physicalBodyOrTerminalApproved: false as const, fullClearanceApproved: false as const, routeApproved: false as const };
  return { facts, portableOperands };
}
/** Only actual opaque original membership can issue this local-index handle.
 * Caller rows, cached reports and pure descriptor mathematics cannot do so. */
export function bindOriginalNativeStairRiserPartition(assembly: OriginalNativeStairAssemblyMembership): OriginalNativeStairRiserPartition {
  const prepared = partitionFromSource(assembly), facts = prepared.facts, handle = Object.freeze({ [brand]: true as const, sourceModelSha256: facts.sourceModelSha256, sourceSchemaSha256: facts.sourceSchemaSha256, nativeStairId: facts.nativeStairId, originalPartitionSha256: hash(new TextEncoder().encode(JSON.stringify(facts))) });
  stored.set(handle, structuredClone(prepared)); return handle;
}
export function originalNativeStairRiserPartitionFacts(handle: OriginalNativeStairRiserPartition) {
  const prepared = stored.get(handle); if (!prepared) throw Error("Untrusted original local riser partition"); return structuredClone(prepared.facts);
}
/** A consumer must bind the exact same original run frame; no other parent,
 * native member, restored JSON or source generation can reuse this handle. */
export function readOriginalNativeStairRiserPartitionRun(handle: OriginalNativeStairRiserPartition, sourceModelSha256: string, nativeRunId: number, originalRunFrameSha256: string) {
  const prepared = stored.get(handle); if (!prepared) throw Error("Untrusted original local riser partition");
  const facts = prepared.facts;
  const run = facts.runs.find(r => r.nativeRunId === nativeRunId);
  if (facts.sourceModelSha256 !== sourceModelSha256 || !run || run.originalChildSourceFrameSha256 !== originalRunFrameSha256) throw Error("Foreign/stale original partition run");
  return structuredClone(run);
}
/** Full exact typed source operands for mathematical replay. These plain
 * copies never recreate opaque original-source ownership authority. */
export function originalNativeStairRiserPartitionPortableOperands(handle: OriginalNativeStairRiserPartition): PortableOriginalRiserPartition {
  const prepared = stored.get(handle); if (!prepared) throw Error("Untrusted original local riser partition");
  return structuredClone(prepared.portableOperands);
}
