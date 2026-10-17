import type { NativeElementIdentity } from "./native-identity.ts";
import { Rational, rational } from "./native-rational-overlay.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ConvertResult } from "./types.ts";

const ifcDigits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** Decode the standard 22-character buildingSMART GlobalId without lossy
 * number arithmetic. This establishes an identifier only, never body geometry. */
export function expandedIfcGlobalId(value: string): string | undefined {
  if (typeof value !== "string" || value.length !== 22 || !"0123".includes(value[0]!)) return;
  let number = 0n;
  for (const character of value) {
    const digit = ifcDigits.indexOf(character);
    if (digit < 0) return;
    number = number * 64n + BigInt(digit);
  }
  const hex = number.toString(16).padStart(32, "0");
  if (hex.length !== 32) return;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Autodesk's base occurrence identifier derives from the persisted native
 * creation UUID with the original element id XORed into its low32 bits.
 * Current/remapped element ids, labels and proximity cannot substitute for it.
 * Derived IFC occurrences can have other identifiers and remain separately
 * required by the complete body/decomposition census. This is not permission
 * to discard a nonmatching occurrence or approve any physical body. */
export function pairedIfcGlobalIdMatchesNativeIdentity(
  globalId: string,
  identity: NativeElementIdentity,
): boolean {
  const original = identity?.originalElementId;
  if (!Number.isSafeInteger(identity?.elementId) || identity.elementId < 1 ||
    !Number.isSafeInteger(original) || original < 1 || original > 0xffff_ffff ||
    identity.provenance !== "Global/ElemTable.ElementHistory+Global/History.Episode" ||
    typeof identity.episodeGuid !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(identity.episodeGuid) ||
    identity.uniqueId !== `${identity.episodeGuid}-${original.toString(16).padStart(8, "0")}`) return false;
  const expanded = expandedIfcGlobalId(globalId);
  if (!expanded) return false;
  const expected = BigInt(`0x${identity.episodeGuid.replaceAll("-", "")}`) ^ BigInt(original);
  return expanded.replaceAll("-", "") === expected.toString(16).padStart(32, "0");
}

export type PairedSourceBodyMesh = { positionsFeet: number[]; indices: number[] };
export function pairedSourceBodyMeshHash(mesh: PairedSourceBodyMesh): string {
  const prefix = new TextEncoder().encode("ifc-world-feet-mesh-v1\0"), p = mesh.positionsFeet, ix = mesh.indices;
  if (!Array.isArray(p) || !Array.isArray(ix) || p.length > 3_000_000 || ix.length > 3_000_000 ||
    p.some((n) => !Number.isFinite(n)) || ix.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 0xffff_ffff)) throw Error("Unsupported source body mesh");
  const bytes = new Uint8Array(prefix.length + 8 + p.length * 8 + ix.length * 4), view = new DataView(bytes.buffer);
  bytes.set(prefix); view.setUint32(prefix.length, p.length, true); view.setUint32(prefix.length + 4, ix.length, true);
  let at = prefix.length + 8;
  for (const n of p) { view.setFloat64(at, n, true); at += 8; }
  for (const n of ix) { view.setUint32(at, n, true); at += 4; }
  return bytesToHex(sha256(bytes));
}

export type PairedSourceRawRecord = { expressId: number; byteOffset: number; byteLength: number; sha256: string; text: string };
/** Source raw records are checked against the actual independently checksummed
 * full IFC bytes. Hashing a record supplied by a candidate is insufficient. */
export function pairedSourceRecordsBoundToIfc(
  ifcBytes: Uint8Array,
  expectedOriginalIfcSha256: string,
  records: readonly PairedSourceRawRecord[],
): boolean {
  try {
    const originalIfcBytes = Uint8Array.from(ifcBytes);
    if (!/^[a-f0-9]{64}$/.test(expectedOriginalIfcSha256) || bytesToHex(sha256(originalIfcBytes)) !== expectedOriginalIfcSha256 ||
      !Array.isArray(records) || !records.length || records.length > 100_000) return false;
    const seen = new Map<number, string>(), decoder = new TextDecoder("utf-8", { fatal: true });
    for (const r of records) {
      if (!Number.isSafeInteger(r.expressId) || r.expressId < 1 || !Number.isSafeInteger(r.byteOffset) || r.byteOffset < 0 ||
        !Number.isSafeInteger(r.byteLength) || r.byteLength < 1 || r.byteLength > 10_000_000 || r.byteOffset + r.byteLength > originalIfcBytes.length ||
        !/^[a-f0-9]{64}$/.test(r.sha256) || typeof r.text !== "string" || !r.text.startsWith(`#${r.expressId}=`) || !r.text.endsWith(";")) return false;
      const original = originalIfcBytes.subarray(r.byteOffset, r.byteOffset + r.byteLength);
      if (bytesToHex(sha256(original)) !== r.sha256 || decoder.decode(original) !== r.text || (seen.has(r.expressId) && seen.get(r.expressId) !== r.text)) return false;
      seen.set(r.expressId, r.text);
    }
    return true;
  } catch { return false; }
}

export function pairedSourceGraphHash(records: readonly PairedSourceRawRecord[]): string {
  return bytesToHex(sha256(new TextEncoder().encode([...records].sort((a, b) => a.expressId - b.expressId)
    .map((r) => `${r.expressId},${r.byteOffset},${r.byteLength},${r.sha256}\n`).join(""))));
}

/** Original Float64 triangle coordinates are compared without rounding,
 * snapping or expansion. Cyclic vertex starts do not change orientation. */
export function pairedSourceBodyItemCoverage(
  whole: PairedSourceBodyMesh,
  triangleSourceItemExpressIds: readonly number[],
  items: readonly { expressId: number; mesh: PairedSourceBodyMesh }[],
): { exact: boolean; missingTriangles: number; extraTriangles: number } | undefined {
  try {
    if (!Array.isArray(items) || !items.length || items.length > 10_000 ||
      new Set(items.map((item) => item.expressId)).size !== items.length ||
      whole.indices.length % 3 || triangleSourceItemExpressIds.length !== whole.indices.length / 3) return;
    const allowed = new Set(items.map((item) => item.expressId));
    if (items.some((item) => !Number.isSafeInteger(item.expressId) || item.expressId < 1) || triangleSourceItemExpressIds.some((id) => !allowed.has(id))) return;
    const addMesh = (counts: Map<string, number>, mesh: PairedSourceBodyMesh, owners: readonly number[]) => {
      const p = mesh.positionsFeet, ix = mesh.indices;
      if (!Array.isArray(p) || p.length % 3 || !Array.isArray(ix) || ix.length % 3 || owners.length !== ix.length / 3 ||
        p.some((n) => !Number.isFinite(n)) || ix.some((n) => !Number.isSafeInteger(n) || n < 0 || n >= p.length / 3)) throw Error("Incomplete original item mesh");
      for (let i = 0; i < ix.length; i += 3) {
        const triangle = ix.slice(i, i + 3).map((n) => JSON.stringify(p.slice(n * 3, n * 3 + 3)));
        const key = `${owners[i / 3]}:${[0, 1, 2].map((j) => [...triangle.slice(j), ...triangle.slice(0, j)].join("|")).sort()[0]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    };
    const wholeCounts = new Map<string, number>(), itemCounts = new Map<string, number>();
    addMesh(wholeCounts, whole, triangleSourceItemExpressIds);
    for (const item of items) addMesh(itemCounts, item.mesh, Array(item.mesh.indices.length / 3).fill(item.expressId));
    let missingTriangles = 0, extraTriangles = 0;
    for (const key of new Set([...wholeCounts.keys(), ...itemCounts.keys()])) {
      const difference = (wholeCounts.get(key) ?? 0) - (itemCounts.get(key) ?? 0);
      if (difference > 0) missingTriangles += difference; else extraTriangles -= difference;
    }
    return { exact: !missingTriangles && !extraTriangles, missingTriangles, extraTriangles };
  } catch { return; }
}
export type PairedSourceItemTopology = {
  vertexCount: number;
  triangleCount: number;
  components: { triangleCount: number; sixTimesSignedVolume: [string, string] }[];
};
const add = (a: Rational, b: Rational) => new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) => new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);

/** Inspect ONE original physical Body item. The exact source item mesh must
 * already be independently bound to its raw representation, placement and
 * source bytes. Closed positive topology alone never establishes that binding.
 * Whole products may retain overlapping independent item shells, so callers
 * must not impose this single-solid condition on their concatenated product. */
export function pairedSourceItemMeshTopology(mesh: PairedSourceBodyMesh): PairedSourceItemTopology | undefined {
  try {
    const p = mesh?.positionsFeet, indices = mesh?.indices;
    if (!Array.isArray(p) || !Array.isArray(indices) || p.length < 12 || p.length % 3 || p.length > 3_000_000 ||
      indices.length < 12 || indices.length % 3 || indices.length > 3_000_000 ||
      p.some((n) => !Number.isFinite(n)) || indices.some((n) => !Number.isSafeInteger(n) || n < 0 || n >= p.length / 3)) return;
    const sourcePoints: [number, number, number][] = [];
    const pointIds = new Map<string, number>(), normalized: number[] = [];
    for (let i = 0; i < p.length; i += 3) {
      const point: [number, number, number] = [p[i]!, p[i + 1]!, p[i + 2]!], key = JSON.stringify(point);
      if (!pointIds.has(key)) { pointIds.set(key, sourcePoints.length); sourcePoints.push(point); }
      normalized.push(pointIds.get(key)!);
    }
    const exact = sourcePoints.map((point) => point.map(rational));
    const origin = exact[0]!, vectors = exact.map((point) => point.map((n, i) => sub(n, origin[i]!)));
    const edges = new Map<string, { from: number; to: number; triangles: number[]; balance: number }>();
    const used = new Set<number>(), volumes: Rational[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      const ids = indices.slice(i, i + 3).map((n) => normalized[n]!);
      if (new Set(ids).size !== 3) return;
      ids.forEach((id) => used.add(id));
      const [a, b, c] = ids.map((id) => exact[id]!);
      const u = b!.map((n, j) => sub(n, a![j]!)), v = c!.map((n, j) => sub(n, a![j]!));
      const cross = [sub(mul(u[1]!, v[2]!), mul(u[2]!, v[1]!)), sub(mul(u[2]!, v[0]!), mul(u[0]!, v[2]!)), sub(mul(u[0]!, v[1]!), mul(u[1]!, v[0]!))];
      if (cross.every((n) => n.n === 0n)) return;
      const [x, y, z] = ids.map((id) => vectors[id]!);
      volumes.push(add(add(
        mul(x![0]!, sub(mul(y![1]!, z![2]!), mul(y![2]!, z![1]!))),
        mul(x![1]!, sub(mul(y![2]!, z![0]!), mul(y![0]!, z![2]!))),
      ), mul(x![2]!, sub(mul(y![0]!, z![1]!), mul(y![1]!, z![0]!)))));
      for (let j = 0; j < 3; j++) {
        const from = ids[j]!, to = ids[(j + 1) % 3]!, key = `${Math.min(from, to)}:${Math.max(from, to)}`;
        const edge = edges.get(key) ?? { from, to, triangles: [], balance: 0 };
        edge.triangles.push(i / 3); edge.balance += from < to ? 1 : -1;
        if (edge.triangles.length > 2) return;
        edges.set(key, edge);
      }
    }
    if (used.size !== sourcePoints.length || [...edges.values()].some((edge) => edge.triangles.length !== 2 || edge.balance !== 0)) return;
    const adjacent = volumes.map((): number[] => []);
    for (const edge of edges.values()) {
      const [first, second] = edge.triangles;
      adjacent[first!]!.push(second!); adjacent[second!]!.push(first!);
    }
    const seen = new Set<number>(), components: PairedSourceItemTopology["components"] = [];
    for (let i = 0; i < volumes.length; i++) {
      if (seen.has(i)) continue;
      const pending = [i]; let volume = new Rational(0n), triangleCount = 0;
      while (pending.length) {
        const triangle = pending.pop()!;
        if (seen.has(triangle)) continue;
        seen.add(triangle); triangleCount++; volume = add(volume, volumes[triangle]!);
        for (const neighbour of adjacent[triangle]!) if (!seen.has(neighbour)) pending.push(neighbour);
      }
      if (volume.n <= 0n) return;
      components.push({ triangleCount, sixTimesSignedVolume: [volume.n.toString(), volume.d.toString()] });
    }
    return { vertexCount: sourcePoints.length, triangleCount: indices.length / 3, components };
  } catch { return; }
}

type Step = { id: number; type: string; args: string[] };
function step(text: string): Step | undefined {
  const match = /^#(\d+)=([A-Z0-9_]+)\(([\s\S]*)\);$/.exec(text.trim());
  if (!match) return;
  const body = match[3]!, args: string[] = []; let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'") { if (quoted && body[i + 1] === "'") { i++; continue; } quoted = !quoted; }
    else if (!quoted) {
      if (c === "(") depth++; else if (c === ")") { if (--depth < 0) return; }
      else if (c === "," && depth === 0) { args.push(body.slice(start, i).trim()); start = i + 1; }
    }
  }
  if (quoted || depth) return;
  args.push(body.slice(start).trim());
  return { id: Number(match[1]), type: match[2]!, args };
}
const ref = (value: string | undefined) => value && /^#\d+$/.test(value) ? Number(value.slice(1)) : undefined;
function sourceReferences(text: string): number[] {
  const result: number[] = []; let quoted = false;
  for (let i = text.indexOf("=") + 1; i < text.length; i++) {
    if (text[i] === "'") { if (quoted && text[i + 1] === "'") i++; else quoted = !quoted; }
    else if (!quoted && text[i] === "#") { const match = /^#(\d+)/.exec(text.slice(i)); if (!match) throw Error("Unsupported source reference"); result.push(Number(match[1])); i += match[0].length - 1; }
  }
  if (quoted) throw Error("Incomplete source string");
  return result;
}
function refs(value: string | undefined): number[] | undefined {
  if (!value || !/^\((?:#\d+(?:,#\d+)*)?\)$/.test(value.replaceAll(" ", ""))) return;
  return [...value.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}
type SourceContext = Readonly<{ sourceIfcSha256: string; byteLength: number }>;
const contexts = new WeakMap<SourceContext, { bytes: Uint8Array; text: string; externalOperations: Map<number, number[]> }>();

/** Snapshot the actual original export once. The opaque context cannot be
 * forged by copying a source checksum into a candidate metadata object. */
export function createPairedSourceStairBodyContext(bytes: Uint8Array, expectedOriginalIfcSha256: string): SourceContext | undefined {
  try {
    if (bytes.length > 900 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(expectedOriginalIfcSha256)) return;
    const original = Uint8Array.from(bytes);
    if (bytesToHex(sha256(original)) !== expectedOriginalIfcSha256) return;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(original);
    if (!text.startsWith("ISO-10303-21;") || !text.trimEnd().endsWith("END-ISO-10303-21;")) return;
    const operations = new Map<number, number[]>(); let count = 0;
    for (const match of text.matchAll(/^#\d+=IFCREL(?:VOIDSELEMENT|PROJECTSELEMENT)\([^\r\n]*\);\r?$/gm)) {
      const record = step(match[0]); if (!record) return;
      const owner = ref(record.args[4]); if (!owner) return;
      operations.set(owner, [...(operations.get(owner) ?? []), record.id]); count++;
    }
    // Unsupported whitespace/case/comment layouts must retain an unknown cut,
    // never disappear from BOTH the implemented reader and its census guard.
    if (count !== [...text.matchAll(/\bIFCREL(?:VOIDSELEMENT|PROJECTSELEMENT)\b/gi)].length) return;
    const context = Object.freeze({ sourceIfcSha256: expectedOriginalIfcSha256, byteLength: original.length });
    contexts.set(context, { bytes: original, text, externalOperations: operations }); return context;
  } catch { return; }
}

type RawGraph = { rootExpressId: number; records: PairedSourceRawRecord[]; sha256: string };
type CandidateV3 = {
  version: number; provenance: string; sourceModelSha256: string; ifcSha256: string; ifcBytes: number;
  producerValidationErrors: string[]; bodyRepresentationSemantics: string;
  nativeElementId: number; nativeIdentity: NativeElementIdentity;
  sourceHeader: Omit<PairedSourceRawRecord, "expressId">;
  ifcSchema: string;
  sourceDocument: { ifcContentGuid: string; ifcVersionGuid: string; ifcNumberOfSaves: number; nativeUniqueDocumentGuid: string; nativeUniqueDocumentIncrements: number; versionGuidMatchesNativeEpisode: boolean };
  ifcProduct: { expressId: number; globalId: string; ifcType: string; tag: string; sourceRecord: PairedSourceRawRecord };
  allNativeTagOccurrences: { expressId: number; globalId: string; sourceProductRecord: PairedSourceRawRecord }[];
  representations: { expressId: number; identifier: string; type: string; items: { expressId: number; ifcType: string }[] }[];
  representationSourceGraph: RawGraph; placementSourceGraph: RawGraph;
  aggregateRelations: PairedSourceRawRecord[];
  productExternalOperations: { voidRelations: PairedSourceRawRecord[]; projectionRelations: PairedSourceRawRecord[]; unsupportedRelations: PairedSourceRawRecord[] };
  mesh: PairedSourceBodyMesh; meshSha256: string; triangleSourceItemExpressIds: number[];
  physicalItems: { expressId: number; ifcType: string; sourceEntity: PairedSourceRawRecord; sourceGraph: RawGraph; mesh: PairedSourceBodyMesh; meshSha256: string }[];
  independentProductControl: { mesh: PairedSourceBodyMesh; meshSha256: string; triangleSourceItemExpressIds: number[] };
};
type OriginalBodyModel = Pick<ConvertResult, "nativeIdentity" | "nativeStairAssemblies" | "elementOwnership" | "elementBounds">;
export type PairedSourceStairBodyCertificate = {
  version: 1; provenance: "reference-ifc"; sourceModelSha256: string; sourceIfcSha256: string; originalExtractionSha256: string;
  nativeStairId: number; nativeElementId: number; nativeUniqueId: string; ifcProductExpressId: number;
  completeOriginalIfcBodyItemCount: number; bodyMeshSha256: string; physicalItemMeshSha256s: { expressId: number; meshSha256: string }[];
  retainedOccurrenceExpressIds: number[]; versionGuidMismatchRetained: boolean;
  independentProductControlRawDifference: { missingTriangles: number; extraTriangles: number };
  numericalStepGeometryIndependentlyReevaluated: false;
  originalNativeWalkingCorrespondenceApproved: false; routeApproved: false;
};
export type PairedSourceOriginalDocumentIdentity = {
  sourceModelSha256: string; documentGuidSlots: string[]; uniqueDocumentGuid: string; uniqueDocumentIncrements: number;
};

/** Verify complete paired IFC Body SOURCE operands. Actual original IFC bytes,
 * a separately reviewed original-source producer manifest SHA and independently
 * decoded RVT ownership/document identities are REQUIRED TRUSTED INPUTS. Never
 * derive expectedOriginalExtractionSha256 from the same incoming candidate;
 * producer/dependency provenance must have been checked independently. This
 * verifies binding and internal closed operand coverage. It does NOT repeat
 * the producer's numerical STEP profile/placement geometry evaluation.
 * This never creates a route/body receipt
 * or approves native walking correspondence, material, caps, access or floors. */
export function validatePairedSourceStairBodyV3(
  context: SourceContext,
  originalExtractionBytes: Uint8Array,
  expectedOriginalExtractionSha256: string,
  originalModel: OriginalBodyModel,
  expectedSourceModelSha256: string,
  nativeStairId: number,
  originalDocument: PairedSourceOriginalDocumentIdentity,
): { ok: true; certificate: PairedSourceStairBodyCertificate } | { ok: false; reason: string } {
  const reject = (reason: string) => ({ ok: false as const, reason });
  try {
    const source = contexts.get(context);
    if (!source) return reject("Missing actual original IFC byte context");
    if (!/^[a-f0-9]{64}$/.test(expectedOriginalExtractionSha256) || originalExtractionBytes.length > 32 * 1024 * 1024) return reject("Original extraction SHA does not match the independent frozen source manifest");
    const extraction = Uint8Array.from(originalExtractionBytes);
    if (bytesToHex(sha256(extraction)) !== expectedOriginalExtractionSha256) return reject("Original extraction SHA does not match the independent frozen source manifest");
    const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(extraction)) as CandidateV3;
    if (data.version !== 3 || data.provenance !== "reference-ifc" || data.sourceModelSha256 !== expectedSourceModelSha256 ||
      !/^[a-f0-9]{64}$/.test(expectedSourceModelSha256) || data.ifcSha256 !== context.sourceIfcSha256 || data.ifcBytes !== context.byteLength ||
      data.bodyRepresentationSemantics !== "additive-original-swept-solid-operands" || !Array.isArray(data.producerValidationErrors) || data.producerValidationErrors.length) return reject("Unsupported or source-mismatched paired Body producer");
    const native = originalModel.nativeIdentity?.identities.filter((r) => r.elementId === data.nativeElementId) ?? [];
    const stair = originalModel.nativeIdentity?.identities.filter((r) => r.elementId === nativeStairId) ?? [];
    const nativeKeys: (keyof NativeElementIdentity)[] = ["elementId", "originalElementId", "creationEpisodeId", "lastModificationEpisodeId", "lastUserModificationEpisodeId", "episodeGuid", "uniqueId", "byteOffset", "provenance"];
    if (native.length !== 1 || stair.length !== 1 || nativeKeys.some((key) => native[0]![key] !== data.nativeIdentity[key]) ||
      !pairedIfcGlobalIdMatchesNativeIdentity(data.ifcProduct.globalId, native[0]!)) return reject("Original native UniqueId and base IFC GlobalId binding failed");
    const element = originalModel.elementBounds.find((r) => r.elementId === data.nativeElementId);
    if (!element || ![-2000919, -2000920].includes(element.categoryId ?? 0)) return reject("Original native element is not a run or landing");
    const owners = new Map<number, Set<number | null>>();
    for (const r of originalModel.elementOwnership?.records ?? []) { const set = owners.get(r.elementId) ?? new Set<number | null>(); set.add(r.owningElementId); owners.set(r.elementId, set); }
    let at: number | null = data.nativeElementId; const seen = new Set<number>();
    while (at !== null && at !== nativeStairId && !seen.has(at)) { seen.add(at); const set = owners.get(at); if (set && set.size !== 1) return reject("Ambiguous original native ownership"); at = set ? [...set][0]! : null; }
    const assemblies = originalModel.nativeStairAssemblies?.filter((a) => a.runAndLandingIds.includes(data.nativeElementId)) ?? [];
    if (assemblies.length > 1 || assemblies.some((a) => a.stairElementId !== nativeStairId)) return reject("Conflicting original native assembly ownership");
    const selfOwnedRoot = at === data.nativeElementId && owners.get(at)?.size === 1 && owners.get(at)!.has(at);
    if (at !== nativeStairId && !((at === null || selfOwnedRoot) && seen.size === 1 && assemblies.length === 1 && assemblies[0]!.stairElementId === nativeStairId && assemblies[0]!.evidence === "runs-and-element-frame")) return reject("Original native stair ownership is not bound");
    const recordMap = new Map<number, PairedSourceRawRecord>(), decoder = new TextDecoder("utf-8", { fatal: true });
    const bindRecord = (r: Omit<PairedSourceRawRecord, "expressId"> & { expressId?: number }) => {
      if (!Number.isSafeInteger(r.byteOffset) || !Number.isSafeInteger(r.byteLength) || r.byteOffset < 0 || r.byteLength < 1 || r.byteOffset + r.byteLength > source.bytes.length) throw Error("Invalid original raw source span");
      const bytes = source.bytes.subarray(r.byteOffset, r.byteOffset + r.byteLength);
      if (bytesToHex(sha256(bytes)) !== r.sha256 || decoder.decode(bytes) !== r.text) throw Error("Raw source record does not match actual original IFC bytes");
      if (r.expressId !== undefined) { const parsed = step(r.text); if (!parsed || parsed.id !== r.expressId) throw Error("Original source entity identity mismatch"); const old = recordMap.get(r.expressId); if (old && old.sha256 !== r.sha256) throw Error("Contradictory source entity"); recordMap.set(r.expressId, r as PairedSourceRawRecord); }
    };
    bindRecord(data.sourceHeader);
    const guid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    const header = /RevitIdentifiers \[ContentGUID:\s*([a-f0-9-]+),\s*VersionGUID:\s*([a-f0-9-]+),\s*NumberOfSaves:\s*(\d+)\]/.exec(data.sourceHeader.text);
    if (!originalDocument || originalDocument.sourceModelSha256 !== expectedSourceModelSha256 || !guid.test(originalDocument.uniqueDocumentGuid) ||
      !Array.isArray(originalDocument.documentGuidSlots) || !originalDocument.documentGuidSlots.length || originalDocument.documentGuidSlots.some((v) => !guid.test(v)) ||
      !Number.isSafeInteger(originalDocument.uniqueDocumentIncrements) || originalDocument.uniqueDocumentIncrements < 0 ||
      !guid.test(data.sourceDocument.ifcContentGuid) || !guid.test(data.sourceDocument.ifcVersionGuid) ||
      !header || header[1] !== data.sourceDocument.ifcContentGuid || header[2] !== data.sourceDocument.ifcVersionGuid || Number(header[3]) !== data.sourceDocument.ifcNumberOfSaves ||
      !originalDocument.documentGuidSlots.includes(data.sourceDocument.ifcContentGuid) || data.sourceDocument.nativeUniqueDocumentGuid !== originalDocument.uniqueDocumentGuid ||
      data.sourceDocument.nativeUniqueDocumentIncrements !== originalDocument.uniqueDocumentIncrements || data.sourceDocument.ifcNumberOfSaves !== originalDocument.uniqueDocumentIncrements ||
      data.ifcSchema !== "IFC2X3" || !data.sourceHeader.text.includes("FILE_SCHEMA(('IFC2X3'));")) return reject("Source document identity does not match independently decoded original RVT/header bytes");
    const bindGraph = (g: RawGraph) => {
      if (!g || !Array.isArray(g.records) || !g.records.length || g.records.length > 100_000 || new Set(g.records.map((r) => r.expressId)).size !== g.records.length || !g.records.some((r) => r.expressId === g.rootExpressId) || pairedSourceGraphHash(g.records) !== g.sha256) throw Error("Incomplete or changed original source graph");
      const records = new Map(g.records.map((r) => [r.expressId, r])); for (const r of g.records) bindRecord(r);
      const seen = new Set<number>(), active = new Set<number>();
      const visit = (id: number, depth: number) => {
        if (depth > 256 || active.has(id) || !records.has(id)) throw Error("Missing or cyclic original source graph operand");
        if (seen.has(id)) return; active.add(id);
        for (const child of sourceReferences(records.get(id)!.text)) visit(child, depth + 1);
        active.delete(id); seen.add(id);
      };
      visit(g.rootExpressId, 0); if (seen.size !== records.size) throw Error("Unreferenced source graph material cannot grant completeness");
    };
    bindRecord(data.ifcProduct.sourceRecord); bindGraph(data.representationSourceGraph); bindGraph(data.placementSourceGraph);
    const product = step(data.ifcProduct.sourceRecord.text)!;
    if (product.id !== data.ifcProduct.expressId || data.ifcProduct.sourceRecord.expressId !== product.id || data.ifcProduct.tag !== String(data.nativeElementId) ||
      data.ifcProduct.ifcType !== (product.type === "IFCSTAIRFLIGHT" ? "IfcStairFlight" : "IfcSlab") || !['IFCSTAIRFLIGHT', 'IFCSLAB'].includes(product.type) || product.args[0] !== `'${data.ifcProduct.globalId}'` ||
      product.args[7] !== `'${data.nativeElementId}'` || ref(product.args[5]) !== data.placementSourceGraph.rootExpressId || ref(product.args[6]) !== data.representationSourceGraph.rootExpressId) return reject("Original product declaration or placement/representation root differs");
    const occurrences: number[] = [];
    for (const match of source.text.matchAll(/^#\d+=IFC(?:STAIRFLIGHT|SLAB)\([^\r\n]*\);\r?$/gm)) { const p = step(match[0]); if (p?.args[7] === `'${data.nativeElementId}'`) occurrences.push(p.id); }
    if (!Array.isArray(data.allNativeTagOccurrences) || JSON.stringify(occurrences.sort((a, b) => a - b)) !== JSON.stringify(data.allNativeTagOccurrences.map((o) => o.expressId).sort((a, b) => a - b))) return reject("Original source product occurrence census is incomplete");
    for (const occurrence of data.allNativeTagOccurrences) {
      bindRecord(occurrence.sourceProductRecord); const declared = step(occurrence.sourceProductRecord.text)!;
      if (occurrence.expressId !== occurrence.sourceProductRecord.expressId || declared.id !== occurrence.expressId ||
        declared.args[0] !== `'${occurrence.globalId}'` || declared.args[7] !== `'${data.nativeElementId}'`) return reject("Contradictory original source occurrence identity");
    }
    let parentBound = false;
    for (const relation of data.aggregateRelations) {
      bindRecord(relation); const r = step(relation.text)!;
      if (r.type !== "IFCRELAGGREGATES" || !refs(r.args[5])?.includes(product.id)) continue;
      const parent = ref(r.args[4]); if (!parent) continue;
      const line = new RegExp(`^#${parent}=[^\\r\\n]*;\\r?$`, "m").exec(source.text)?.[0], p = line && step(line);
      if (p && p.args[7] === `'${nativeStairId}'` && pairedIfcGlobalIdMatchesNativeIdentity(p.args[0]!.slice(1, -1), stair[0]!)) parentBound = true;
    }
    if (!parentBound) return reject("Original IFC aggregate parent does not match the original native stair");
    const operations = data.productExternalOperations;
    if (!operations || !Array.isArray(operations.voidRelations) || !Array.isArray(operations.projectionRelations) || !Array.isArray(operations.unsupportedRelations) || operations.voidRelations.length || operations.projectionRelations.length || operations.unsupportedRelations.length || source.externalOperations.has(product.id)) return reject("Original source product has unsupported cuts or projections");
    const definition = step(recordMap.get(data.representationSourceGraph.rootExpressId)!.text)!;
    if (definition.type !== "IFCPRODUCTDEFINITIONSHAPE" || JSON.stringify(refs(definition.args[2])) !== JSON.stringify(data.representations.map((r) => r.expressId))) return reject("Original representation census differs");
    const declaredItems: number[] = [];
    for (const representation of data.representations) {
      const r = recordMap.get(representation.expressId), declaration = r && step(r.text);
      if (!declaration || declaration.type !== "IFCSHAPEREPRESENTATION" || declaration.args[1] !== "'Body'" || declaration.args[2] !== "'SweptSolid'" ||
        representation.identifier !== "Body" || representation.type !== "SweptSolid" || JSON.stringify(refs(declaration.args[3])) !== JSON.stringify(representation.items.map((i) => i.expressId)) || representation.items.some((i) => i.ifcType !== "IfcExtrudedAreaSolid")) return reject("Unsupported or incomplete original Body representation");
      declaredItems.push(...representation.items.map((i) => i.expressId));
    }
    if (!declaredItems.length || new Set(declaredItems).size !== declaredItems.length || !Array.isArray(data.physicalItems) || JSON.stringify(declaredItems) !== JSON.stringify(data.physicalItems.map((i) => i.expressId))) return reject("Original Body item inventory is incomplete");
    for (const item of data.physicalItems) {
      bindRecord(item.sourceEntity); bindGraph(item.sourceGraph);
      const root = item.sourceGraph.records.find((r) => r.expressId === item.expressId);
      if (item.ifcType !== "IfcExtrudedAreaSolid" || item.sourceEntity.expressId !== item.expressId || !root || root.sha256 !== item.sourceEntity.sha256 || root.text !== item.sourceEntity.text ||
        step(root.text)?.id !== item.expressId || step(root.text)?.type !== "IFCEXTRUDEDAREASOLID" || item.sourceGraph.rootExpressId !== item.expressId ||
        item.sourceGraph.records.some((r) => /=(?:IFCBOOLEAN|IFCMAPPED)/.test(r.text)) || pairedSourceBodyMeshHash(item.mesh) !== item.meshSha256 || !pairedSourceItemMeshTopology(item.mesh)) return reject(`Original physical Body item ${item.expressId} is unsupported, changed or not exactly closed/positive`);
    }
    if (pairedSourceBodyMeshHash(data.mesh) !== data.meshSha256 || !pairedSourceBodyItemCoverage(data.mesh, data.triangleSourceItemExpressIds, data.physicalItems)?.exact) return reject("Original primary Body is not the exact complete source-item operands");
    const control = data.independentProductControl;
    if (!control || pairedSourceBodyMeshHash(control.mesh) !== control.meshSha256) return reject("Independent original product control is missing or changed");
    const comparison = pairedSourceBodyItemCoverage(control.mesh, control.triangleSourceItemExpressIds, data.physicalItems);
    if (!comparison) return reject("Independent product control has an unclassified source-item mapping");
    return { ok: true, certificate: {
      version: 1, provenance: "reference-ifc", sourceModelSha256: expectedSourceModelSha256, sourceIfcSha256: context.sourceIfcSha256,
      originalExtractionSha256: expectedOriginalExtractionSha256, nativeStairId, nativeElementId: data.nativeElementId, nativeUniqueId: native[0]!.uniqueId, ifcProductExpressId: product.id,
      completeOriginalIfcBodyItemCount: data.physicalItems.length, bodyMeshSha256: data.meshSha256, physicalItemMeshSha256s: data.physicalItems.map((i) => ({ expressId: i.expressId, meshSha256: i.meshSha256 })),
      retainedOccurrenceExpressIds: occurrences, versionGuidMismatchRetained: data.sourceDocument.ifcVersionGuid !== originalDocument.uniqueDocumentGuid,
      independentProductControlRawDifference: { missingTriangles: comparison.missingTriangles, extraTriangles: comparison.extraTriangles }, numericalStepGeometryIndependentlyReevaluated: false, originalNativeWalkingCorrespondenceApproved: false, routeApproved: false,
    } };
  } catch (error) { return reject(`Invalid paired source Body evidence: ${String(error)}`); }
}
