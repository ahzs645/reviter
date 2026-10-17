import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { ElementHeader } from "./element-headers.ts";
import type { ElementOwnershipDecode } from "./element-relations.ts";
import { nonModelReason } from "./model-elements.ts";
import { collectRevit2027GInstanceBindings, collectRevit2027NestedInstances } from "./revit-2027-nested-instance.ts";
import type { Revit2027GRepReplay } from "./revit-2027-grep-replay.ts";
import type { ConvertResult } from "./types.ts";
import { indexPageFrames } from "./page-frame-index.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
import type { Bounds3 } from "./types.ts";
import { originalNativePlanarComponentEnvelope, type NativePlanarComponentEnvelope } from "./native-planar-component-envelopes.ts";

/** Complete original local GRep containing only external, identity-placed
 * child instances. This is a statement about the original source graph, not
 * renderer admission or the completeness of a child's independent body. */
export type NativeInstanceOnlyContainer = {
  version: 1;
  nativeElementId: number;
  sourceFrameSha256: string;
  childElementIds: number[];
};

export type NativeMaterialSource = {
  version: 1;
  sourceModelSha256: string;
  geometrySha256: string;
  ownershipSha256: string;
  /** All accepted original occurrences, retaining contradictory declarations.
   * Missing/unsupported headers are absent; absence never means category null.
   * Positive custom categories are not given nonphysical semantics. */
  elementHeaders: ElementHeader[];
  instanceOnlyContainers: NativeInstanceOnlyContainer[];
  /** Foreign obstacle bounds only. Null-loop faces remain inside the complete
   * original source envelope; this does not certify finite physical bodies. */
  foreignInstanceEnvelopes?: NativeForeignInstanceEnvelope[];
  /** Complete original planar source components. These conservative boxes
   * retain source parametrization discrepancies; they certify no walking body. */
  planarComponentEnvelopes?: NativePlanarComponentEnvelope[];
};

export type NativeForeignInstanceEnvelope = {
  version: 1;
  use: "foreign-material-envelope-only";
  carrierElementId: number;
  definitionElementId: number;
  carrierFrameSha256: string;
  definitionFrameSha256: string;
  carrierFrameHex: string;
  definitionFrameHex: string;
  boundsFeet: Bounds3;
  originalFaceCount: number;
  nullLoopFaceTokens: number[];
};

const digest = (value: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
const validSha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function nativeMaterialOwnershipHash(value: ElementOwnershipDecode | undefined): string {
  return digest(value ?? null);
}

export function nativeMaterialSourceHash(value: Omit<NativeMaterialSource, "geometrySha256"> | NativeMaterialSource): string {
  const raw: Partial<NativeMaterialSource> = { ...value };
  delete raw.geometrySha256;
  return digest(raw);
}

export function prepareNativeMaterialSource(
  sourceModelSha256: string,
  elementHeaders: readonly ElementHeader[],
  instanceOnlyContainers: readonly NativeInstanceOnlyContainer[],
  ownership: ElementOwnershipDecode | undefined,
  foreignInstanceEnvelopes: readonly NativeForeignInstanceEnvelope[] = [],
  planarComponentEnvelopes: readonly NativePlanarComponentEnvelope[] = [],
): NativeMaterialSource {
  const raw: Omit<NativeMaterialSource, "geometrySha256"> = {
    version: 1, sourceModelSha256,
    ownershipSha256: nativeMaterialOwnershipHash(ownership),
    elementHeaders: structuredClone([...elementHeaders]),
    instanceOnlyContainers: structuredClone([...instanceOnlyContainers]),
    ...(foreignInstanceEnvelopes.length ? { foreignInstanceEnvelopes: structuredClone([...foreignInstanceEnvelopes]) } : {}),
    ...(planarComponentEnvelopes.length ? { planarComponentEnvelopes: structuredClone([...planarComponentEnvelopes]) } : {}),
  };
  return { ...raw, geometrySha256: nativeMaterialSourceHash(raw) };
}

/** Decode BOTH actual original frames. This trusts the original persisted
 * GRep m_bBox contract already used for conservative foreign obstacles, never
 * rendered mesh completeness. The immutable source producer must obtain these
 * bytes from the independently checked original model, not supplied metadata.
 * The complete leaf has no nested/embedded instance or unsupported primitive;
 * both of its original extent copies must equal both identity carrier copies.
 * Unknown/null face loops are retained inside the WHOLE source obstacle box. */
export function originalForeignInstanceEnvelope(
  carrierOriginalBytes: Uint8Array,
  definitionOriginalBytes: Uint8Array,
): NativeForeignInstanceEnvelope | undefined {
  try {
    const decode = (input: Uint8Array) => {
      const bytes = Uint8Array.from(input);
      if (bytes.length < 20 || bytes.length > 1024 * 1024) return;
      const frames = indexPageFrames(bytes).frames.filter((f) => f.offset === 0 && f.objectLength + 20 === bytes.length && f.marker === 2246);
      if (frames.length !== 1) return;
      const root = decodeRevit2027FramedGRepRoot(bytes, frames[0]!, 2027);
      if (!root.ok || !root.value.localExtents.valid || !root.value.worldExtents.valid || root.value.objectType !== 3) return;
      const replay = replayRevit2027GRepFifo(bytes, root.value);
      if (!replay.ok) return;
      return { bytes, root: root.value, replay: replay.value };
    };
    const carrier = decode(carrierOriginalBytes), leaf = decode(definitionOriginalBytes);
    if (!carrier || !leaf || carrier.root.flags !== 0 || leaf.root.flags !== 2) return;
    const proof = originalInstanceOnlyContainer(carrier.replay, carrier.bytes);
    const id = Number(leaf.root.ownerElementId);
    if (!proof || !validId(id) || proof.childElementIds.length !== 1 || proof.childElementIds[0] !== id) return;
    const extents = [carrier.root.localExtents, carrier.root.worldExtents, leaf.root.localExtents, leaf.root.worldExtents];
    if (extents.some((e) => JSON.stringify([e.minimum, e.maximum]) !== JSON.stringify([extents[0]!.minimum, extents[0]!.maximum]))) return;
    const allowed = new Set(["Revit2027GLine", "Revit2027GGroup", "Revit2027Geometry", "Revit2027Face", "Revit2027GEdge", "Revit2027EdgeLoop", "Revit2027AnalyticSurface:634"]);
    if (!leaf.replay.spans.length || leaf.replay.spans.some((s) => s.ownerElementId !== leaf.root.ownerElementId || !allowed.has(s.readerId))) return;
    const faces = leaf.replay.spans.filter((s) => s.readerId === "Revit2027Face");
    if (!faces.length || !leaf.replay.spans.some((s) => s.readerId === "Revit2027Geometry")) return;
    const nullLoopFaceTokens = faces.filter((s) => {
      const value = s.value as { firstLoop?: { token: number }; faceRegions?: { count: number } };
      return value.firstLoop?.token === 0 && value.faceRegions?.count === 0;
    }).map((s) => s.propertyToken).sort((a, b) => a - b);
    const e = carrier.root.localExtents;
    return { version: 1, use: "foreign-material-envelope-only", carrierElementId: proof.nativeElementId, definitionElementId: id,
      carrierFrameSha256: proof.sourceFrameSha256, definitionFrameSha256: bytesToHex(sha256(leaf.bytes)),
      carrierFrameHex: bytesToHex(carrier.bytes), definitionFrameHex: bytesToHex(leaf.bytes),
      boundsFeet: { min: { x: e.minimum[0], y: e.minimum[1], z: e.minimum[2] }, max: { x: e.maximum[0], y: e.maximum[1], z: e.maximum[2] } },
      originalFaceCount: faces.length, nullLoopFaceTokens };
  } catch { return undefined; }
}

/** Called only after a complete exact FIFO replay. There can be no local
 * faces, wire stand-ins, embedded bodies, selectors, placements or unread
 * siblings hidden by this container certificate. */
export function originalInstanceOnlyContainer(
  replay: Revit2027GRepReplay,
  originalFrameBytes: Uint8Array,
): NativeInstanceOnlyContainer | undefined {
  const owner = Number(replay.ownerElementId);
  if (!validId(owner) || !replay.spans.length || replay.spans.some((span) =>
    span.ownerElementId !== replay.ownerElementId ||
    (span.readerId !== "Revit2027GInstance" && span.readerId !== "Revit2027InstanceInfo"),
  )) return undefined;
  const bindings = collectRevit2027GInstanceBindings(replay);
  const nested = collectRevit2027NestedInstances(replay);
  if (!bindings.ok || !nested.ok || !nested.value.length ||
    bindings.value.some((binding) => binding.kind !== "external") ||
    replay.spans.length !== nested.value.length * 2) return undefined;
  const children: number[] = [];
  for (const instance of nested.value) {
    const child = Number(instance.symbolElementId);
    if (!validId(child) || child === owner || children.includes(child) ||
      instance.gRepId !== 0 || instance.cda !== 1 || instance.hasScale ||
      instance.resolveSymbolInView || instance.forbiddenTarget !== 0 ||
      instance.transform.matrix.some((value, i) => value !== identity[i])) return undefined;
    children.push(child);
  }
  return {
    version: 1, nativeElementId: owner,
    sourceFrameSha256: bytesToHex(sha256(originalFrameBytes)),
    childElementIds: children.sort((a, b) => a - b),
  };
}

function source(model: ConvertResult, expected: string): NativeMaterialSource | undefined {
  try {
    const value = model.nativeMaterialSource;
    if (!value || value.version !== 1 || !validSha(expected) || value.sourceModelSha256 !== expected ||
      !validSha(value.geometrySha256) || value.geometrySha256 !== nativeMaterialSourceHash(value) ||
      value.ownershipSha256 !== nativeMaterialOwnershipHash(model.elementOwnership) ||
      !Array.isArray(value.elementHeaders) || !Array.isArray(value.instanceOnlyContainers) ||
      (value.foreignInstanceEnvelopes !== undefined && !Array.isArray(value.foreignInstanceEnvelopes)) ||
      (value.planarComponentEnvelopes !== undefined && (!Array.isArray(value.planarComponentEnvelopes) || value.planarComponentEnvelopes.length > 1000))) return undefined;
    return value;
  } catch { return undefined; }
}

function originalHeaders(value: NativeMaterialSource): Map<number, ElementHeader> {
  const headers = new Map<number, ElementHeader>(), conflicts = new Set<number>();
  for (const header of value.elementHeaders) {
    if (!validId(header.elementId)) continue;
    const existing = headers.get(header.elementId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(header)) conflicts.add(header.elementId);
    else headers.set(header.elementId, header);
  }
  for (const id of conflicts) headers.delete(id);
  return headers;
}

/** Source model, original source headers, whole original frame and unchanged
 * native world bounds must all match. Duplicate or conflicting records keep
 * their ordinary full-box material fallback. This never narrows a carrier:
 * its additional original branches remain separate material records. */
export function nativeSourcePlanarComponentEnvelopes(model: ConvertResult, expectedSourceModelSha256: string): Map<number, Bounds3[]> {
  const result = new Map<number, Bounds3[]>(), evidence = source(model, expectedSourceModelSha256);
  if (!evidence) return result;
  const headers = originalHeaders(evidence);
  const occurrences = new Map<number, number>();
  for (const fact of evidence.planarComponentEnvelopes ?? []) occurrences.set(fact.nativeElementId, (occurrences.get(fact.nativeElementId) ?? 0) + 1);
  for (const fact of evidence.planarComponentEnvelopes ?? []) {
    try {
      if (occurrences.get(fact.nativeElementId) !== 1 || typeof fact.originalFrameHex !== "string" || fact.originalFrameHex.length > 16 * 1024 * 1024) continue;
      const records = model.elementBounds.filter((r) => r.elementId === fact.nativeElementId), record = records[0];
      if (records.length !== 1 || !record || record.categoryId === undefined || record.categoryId >= 0 ||
        headers.get(fact.nativeElementId)?.categoryId !== record.categoryId || JSON.stringify(record.boundsFeet) !== JSON.stringify(fact.boundsFeet)) continue;
      const replayed = originalNativePlanarComponentEnvelope(hexToBytes(fact.originalFrameHex));
      if (!replayed || JSON.stringify(replayed) !== JSON.stringify(fact)) continue;
      result.set(fact.nativeElementId, structuredClone(fact.components.map((c) => c.boundsFeet)));
    } catch { /* Unsupported evidence preserves the ordinary material box. */ }
  }
  return result;
}

export function nativeSourceInstantiatedElementIds(model: ConvertResult, expectedSourceModelSha256: string): Set<number> {
  const evidence = source(model, expectedSourceModelSha256);
  return new Set(evidence?.instanceOnlyContainers.flatMap((p) => p.childElementIds) ?? []);
}

export function nativeSourceNonPhysicalElementIds(model: ConvertResult, expectedSourceModelSha256: string): Set<number> {
  const evidence = source(model, expectedSourceModelSha256);
  if (!evidence) return new Set();
  const result = new Set<number>();
  // A definition can supply real material through an original instance even
  // when it is not independently scene-visible. Do not erase that target.
  const instantiated = new Set(evidence.instanceOnlyContainers.flatMap((p) => p.childElementIds));
  for (const [id, header] of originalHeaders(evidence)) {
    if (instantiated.has(id)) continue;
    // Never turn an omitted/unsupported category into an original null header.
    if (!Object.hasOwn(header, "categoryId") ||
      (header.categoryId !== null && !Number.isSafeInteger(header.categoryId)) ||
      [header.familyId, header.ownerViewId, header.designOptionId].some((value) => value !== null && !validId(value)) ||
      (header.unplacedOwnerId !== undefined && header.unplacedOwnerId !== null && !validId(header.unplacedOwnerId))) continue;
    if (nonModelReason(header, undefined)) result.add(id);
  }
  return result;
}

/** A source-proven stair wrapper may be represented by all of its physical
 * children. Missing physical bodies and unknown metadata retain its bbox.
 * The caller must keep every returned physical child in its spatial census. */
export type NativeStairMaterialContainerCoverage = {
  childElementIds: number[];
  requiredCarrierBounds: { carrierElementId: number; definitionElementId: number; boundsFeet: Bounds3; sourceFrameSha256: string }[];
};

function materialContainerCoverage(
  model: ConvertResult,
  parentId: number,
  expectedSourceModelSha256: string,
  allowInstanceEnvelopes: boolean,
): NativeStairMaterialContainerCoverage | undefined {
  const evidence = source(model, expectedSourceModelSha256), ownership = model.elementOwnership;
  if (!evidence || !ownership || ownership.declaredRecordCount !== ownership.decodedRecordCount + 1 ||
    ownership.decodedRecordCount !== ownership.records.length || ownership.danglingOwnerCount !== 0) return undefined;
  const headers = originalHeaders(evidence);
  if (headers.get(parentId)?.categoryId !== -2000120) return undefined;
  const proofs = evidence.instanceOnlyContainers.filter((p) => p.nativeElementId === parentId);
  const assemblies = model.nativeStairAssemblies?.filter((a) => a.stairElementId === parentId) ?? [];
  if (proofs.length !== 1 || assemblies.length !== 1 || assemblies[0]!.evidence === "runs") return undefined;
  const proof = proofs[0]!;
  if (proof.version !== 1 || !validSha(proof.sourceFrameSha256) || !proof.childElementIds.length ||
    new Set(proof.childElementIds).size !== proof.childElementIds.length ||
    proof.childElementIds.some((id) => !validId(id) || id === parentId)) return undefined;
  // Two wrappers must not each delegate their only bodies back to the other.
  const graphs = new Map<number, number[]>(), ambiguous = new Set<number>();
  for (const item of evidence.instanceOnlyContainers) {
    if (graphs.has(item.nativeElementId)) ambiguous.add(item.nativeElementId);
    graphs.set(item.nativeElementId, item.childElementIds);
  }
  const graphActive = new Set<number>(), graphDone = new Set<number>();
  const acyclic = (id: number, depth: number): boolean => {
    if (depth > 64 || ambiguous.has(id) || graphActive.has(id)) return false;
    if (graphDone.has(id)) return true;
    graphActive.add(id);
    for (const child of graphs.get(id) ?? []) if (!acyclic(child, depth + 1)) return false;
    graphActive.delete(id); graphDone.add(id); return true;
  };
  if (!acyclic(parentId, 0)) return undefined;
  const byId = new Map<number, number | null>(), byOwner = new Map<number, number[]>();
  for (const record of ownership.records) {
    if (byId.has(record.elementId)) return undefined;
    byId.set(record.elementId, record.owningElementId);
    if (record.owningElementId !== null && record.owningElementId !== record.elementId) {
      const children = byOwner.get(record.owningElementId) ?? [];
      children.push(record.elementId); byOwner.set(record.owningElementId, children);
    }
  }
  if (!byId.has(parentId)) return undefined;
  const assembly = assemblies[0]!, children = new Set<number>([
    ...proof.childElementIds, ...assembly.runAndLandingIds,
    ...assembly.stringerIds, ...assembly.railingIds, ...assembly.supportIds,
  ]);
  const visited = new Set<number>(), active = new Set<number>();
  const visit = (owner: number): boolean => {
    if (active.has(owner)) return false;
    if (visited.has(owner)) return true;
    active.add(owner);
    for (const child of byOwner.get(owner) ?? []) { children.add(child); if (!visit(child)) return false; }
    active.delete(owner); visited.add(owner); return true;
  };
  for (const seed of [parentId, ...children]) if (!visit(seed)) return undefined;
  if (children.has(parentId)) return undefined;
  const nonphysical = nativeSourceNonPhysicalElementIds(model, expectedSourceModelSha256);
  const elements = new Map(model.elementBounds.map((record) => [record.elementId, record]));
  const requiredCarrierBounds: NativeStairMaterialContainerCoverage["requiredCarrierBounds"] = [];
  const coveredDefinitions = new Set<number>();
  for (const child of children) {
    if (!validId(child) || !byId.has(child)) return undefined;
    if (nonphysical.has(child)) continue;
    const element = elements.get(child);
    if (!element && allowInstanceEnvelopes) {
      const facts = evidence.foreignInstanceEnvelopes?.filter((p) => p.definitionElementId === child) ?? [];
      if (facts.length !== 1) return undefined;
      const fact = facts[0]!;
      const replayed = originalForeignInstanceEnvelope(hexToBytes(fact.carrierFrameHex), hexToBytes(fact.definitionFrameHex));
      if (!replayed || JSON.stringify(fact) !== JSON.stringify(replayed)) return undefined;
      const carriers = model.elementBounds.filter((r) => r.elementId === fact.carrierElementId);
      const carrier = carriers[0], carrierProofs = evidence.instanceOnlyContainers.filter((p) => p.nativeElementId === fact.carrierElementId);
      // The template remains physical. Its complete original world envelope is
      // carried by this independently retained physical model instance. It is
      // NOT a nonphysical header exclusion or a finite-body mesh certificate.
      if (carriers.length !== 1 || !carrier || !byId.has(fact.carrierElementId) || fact.carrierElementId === parentId ||
        !carrier.categoryId || carrier.categoryId >= 0 || nonphysical.has(fact.carrierElementId) ||
        headers.get(fact.carrierElementId)?.categoryId !== carrier.categoryId ||
        headers.get(child)?.categoryId !== null ||
        carrier.familySymbolId !== child || carrierProofs.length !== 1 ||
        carrierProofs[0]!.sourceFrameSha256 !== fact.carrierFrameSha256 ||
        JSON.stringify(carrierProofs[0]!.childElementIds) !== JSON.stringify([child]) ||
        JSON.stringify(carrier.boundsFeet) !== JSON.stringify(fact.boundsFeet) ||
        (carrier.boundsFeet.max.x - carrier.boundsFeet.min.x) * (carrier.boundsFeet.max.y - carrier.boundsFeet.min.y) >= 1e7 ||
        !acyclic(fact.carrierElementId, 0)) return undefined;
      requiredCarrierBounds.push({ carrierElementId: fact.carrierElementId, definitionElementId: child,
        boundsFeet: structuredClone(fact.boundsFeet), sourceFrameSha256: fact.carrierFrameSha256 });
      coveredDefinitions.add(child);
      continue;
    }
    if (!element || element.categoryId === undefined ||
      !(element.categoryId < 0) ||
      !(["x", "y", "z"] as const).every((axis) =>
        Number.isFinite(element.boundsFeet.min[axis]) && Number.isFinite(element.boundsFeet.max[axis]) &&
        element.boundsFeet.min[axis] <= element.boundsFeet.max[axis],
      ) ||
      (element.boundsFeet.max.x - element.boundsFeet.min.x) * (element.boundsFeet.max.y - element.boundsFeet.min.y) >= 1e7) return undefined;
  }
  return { childElementIds: [...new Set([...children].filter((id) => !coveredDefinitions.has(id)).concat(requiredCarrierBounds.map((p) => p.carrierElementId)))].sort((a, b) => a - b), requiredCarrierBounds };
}

/** Legacy strict API: never delegates a missing definition, because its caller
 * has no contract requiring the carrier's WHOLE original obstacle box. */
export function nativeStairMaterialContainerChildren(model: ConvertResult, parentId: number, expectedSourceModelSha256: string): number[] | undefined {
  return materialContainerCoverage(model, parentId, expectedSourceModelSha256, false)?.childElementIds;
}

/** The caller MUST retain every physical child and use every required carrier
 * WHOLE box even when its saved-view mesh is sparse. Unconsumed requirements
 * cannot grant delegation. This is foreign material only, never walking body. */
export function nativeStairMaterialContainerCoverage(model: ConvertResult, parentId: number, expectedSourceModelSha256: string): NativeStairMaterialContainerCoverage | undefined {
  try { return materialContainerCoverage(model, parentId, expectedSourceModelSha256, true); } catch { return undefined; }
}
