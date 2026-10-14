/**
 * Native MEP evidence, without inferred spatial connections.
 *
 * Adapted from Helen Kwok's Apache-2.0 rvt-rs partition_mep_systems.rs,
 * partition_connector_pairs.rs and partition_room_parameters.rs at 1c3d337.
 * See vendor/rvt-rs-mep/NOTICE and LICENSE. This TypeScript implementation
 * adds bounded streaming, high-word checks and explicit coverage diagnostics.
 * System membership means an exact id reference in a checksum-verified own
 * record, not a decoded field name. Connector-list offsets are measured only
 * for Revit 2025; family symbol/instance connector graphs are not read here.
 */
import type { SchemaSummary } from "./schema.ts";
import type { ElementBoundsRecord } from "./types.ts";
import type { OpenedRevitContainer } from "./convert-container.ts";
import { asBytes, gzipOffsets, inflateRevitChunk, revitWindowTail, stripRevitPageChecksums } from "./revit-container.ts";

const SYSTEM_CLASSES = new Set(["RbsHvacSystem", "RbsPipingSystem", "RbsElectricalSystem"]);
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;
const MAX_FINDINGS = 200_000;
const CURVE_CATEGORIES = new Set([-2008000, -2008044]);
const FITTING_CATEGORIES = new Set([-2008010, -2008049]);
const EQUIPMENT_CATEGORIES = new Set([
  -2008013, -2008016, -2008055, -2001160, -2008099, -2001140,
  -2001040, -2001060, -2001120, -2008087, -2008085, -2008083,
]);

export type NativeMepElementKind = "curve" | "fitting" | "equipment";
export type NativeMepLocator = { stream: string; offset: number };
export type NativeMepSystem = {
  elementId: number;
  className: string;
  name?: string;
  candidateMembers: number[];
  evidence: NativeMepLocator[];
  membershipCandidates: Array<NativeMepLocator & { elementId: number }>;
};
export type NativeMepPort = { elementId: number; index: number; source: "measured-curve-end" | "native-connector-list" };
export type NativeMepConnection = {
  a: { elementId: number; index: number };
  b: { elementId: number; index: number };
  evidence: Array<NativeMepLocator & { layout: "curve-later" | "curve-earlier-inverted" | "fitting-list" }>;
};
export type NativeMepDecode = {
  revitVersion: number | null;
  systems: NativeMepSystem[];
  ports: NativeMepPort[];
  connections: NativeMepConnection[];
  coverage: {
    systemLayout: "supported" | "unsupported-release" | "missing-schema";
    connectorLayout: "supported" | "unsupported-release" | "missing-schema";
    familyConnectorGraphs: "not-decoded";
    systemMembership: "candidate-object-id-references";
    invalidSystemObjects: number;
    incompleteObjects: number;
    conflictingSystems: number;
    conflictingPorts: number;
    limitReached: boolean;
    skippedPartitions: string[];
  };
};

/** Only exact decoded BuiltInCategory ids establish port-bearing kinds. */
export function nativeMepElementKinds(records: readonly ElementBoundsRecord[]): Map<number, NativeMepElementKind> {
  const result = new Map<number, NativeMepElementKind>();
  for (const record of records) {
    const id = record.categoryId;
    const kind = id != null && CURVE_CATEGORIES.has(id) ? "curve"
      : id != null && FITTING_CATEGORIES.has(id) ? "fitting"
        : id != null && EQUIPMENT_CATEGORIES.has(id) ? "equipment" : undefined;
    // Consensus and proximity-derived categories do not certify a connector.
    if (kind && record.categorySource != null && record.categorySource !== "record-code-consensus") result.set(record.elementId, kind);
  }
  return result;
}

function u32(data: Uint8Array, p: number): number | undefined {
  return p >= 0 && p + 4 <= data.length ? (data[p]! | (data[p + 1]! << 8) | (data[p + 2]! << 16) | (data[p + 3]! << 24)) >>> 0 : undefined;
}
function idAt(data: Uint8Array, p: number): number | undefined {
  const low = u32(data, p);
  return low != null && low > 0 && u32(data, p + 4) === 0 ? low : undefined;
}

/** Adler-32 over the native class word and payload, excluding the size echo. */
function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (let p = 0; p < data.length; p += 5552) {
    const end = Math.min(data.length, p + 5552);
    for (let q = p; q < end; q += 1) { a += data[q]!; b += a; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function asciiString(data: Uint8Array, p: number): string | undefined {
  const count = u32(data, p);
  if (count == null || count > 256 || p + 4 + 2 * count > data.length) return undefined;
  const units: number[] = [];
  for (let q = p + 4; q < p + 4 + 2 * count; q += 2) {
    if (data[q + 1] !== 0 || data[q]! < 0x20 || data[q]! >= 0x7f) return undefined;
    units.push(data[q]!);
  }
  return String.fromCharCode(...units);
}

function systemName(data: Uint8Array, className: string): string | undefined {
  if (className !== "RbsElectricalSystem") {
    for (let p = 20; p + 4 <= data.length - 4; p += 1) {
      const value = asciiString(data.subarray(0, data.length - 4), p);
      if (value) return value;
    }
    return undefined;
  }
  for (let p = 0; p + 9 <= data.length; p += 1) {
    if (data[p + 8] !== 1 || !data.subarray(p, p + 8).every((b) => b === 255)) continue;
    const list = p + 8 + 20;
    const count = u32(data, list);
    if (count == null || count > Math.floor(data.length / 32)) return undefined;
    const name = asciiString(data, list + 4 + count * 32);
    return name === "" ? "<unnamed>" : name;
  }
  return undefined;
}

export type NativeMepPage = { stream: string; bytes: Uint8Array };
type DataObject = { id: number; className: string; bytes: Uint8Array; locator: NativeMepLocator };

/**
 * Checksum-confirmed objects across page boundaries. Only a plausible incomplete
 * header is retained, capped at 8 MiB. State never crosses partition boundaries.
 */
function walkObjects(
  pages: Iterable<NativeMepPage>, classes: ReadonlyMap<number, string>,
  onObject: (object: DataObject) => void, diagnostics: NativeMepDecode["coverage"],
  selectedIds?: ReadonlyMap<number, unknown>,
): void {
  let stream = "", tail: Uint8Array<ArrayBufferLike> = new Uint8Array(), base = 0, previousEnd = 0;
  for (const page of pages) {
    if (page.stream !== stream) {
      if (tail.length > 19) diagnostics.incompleteObjects += 1;
      stream = page.stream; tail = new Uint8Array(); base = 0; previousEnd = 0;
    }
    const data = new Uint8Array(tail.length + page.bytes.length);
    data.set(tail); data.set(page.bytes, tail.length);
    let pending = data.length;
    for (let p = 0; p + 20 <= data.length; p += 1) {
      const id = idAt(data, p);
      if (id == null || (selectedIds && !selectedIds.has(id))) continue;
      const className = classes.get(u32(data, p + 16)! & 0xffff);
      const size = u32(data, p + 12)!;
      if (!className || size < 4 || size > MAX_OBJECT_BYTES - 20) continue;
      const end = p + 20 + size;
      if (end > data.length) { pending = Math.min(pending, p); continue; }
      if (base + end <= previousEnd) continue;
      if (u32(data, end - 4) !== size) continue;
      const bytes = data.subarray(p, end);
      if (adler32(bytes.subarray(16, bytes.length - 4)) !== u32(bytes, 8)) {
        if (SYSTEM_CLASSES.has(className)) diagnostics.invalidSystemObjects += 1;
        continue;
      }
      onObject({ id, className, bytes, locator: { stream, offset: base + p } });
    }
    // A header itself may straddle the boundary; twenty bytes suffice.
    pending = Math.min(pending, Math.max(0, data.length - 19));
    previousEnd = base + data.length;
    tail = data.slice(pending); base += pending;
  }
  if (tail.length > 19) diagnostics.incompleteObjects += 1;
}

type RawPair = { own: number; index: number; other: number; otherIndex: number; at: number };
function pairAt(data: Uint8Array, p: number): RawPair | undefined {
  if (u32(data, p) !== 2 || u32(data, p + 16) !== 1 || u32(data, p + 32) !== 1) return undefined;
  const own = idAt(data, p + 4), other = idAt(data, p + 20);
  const index = u32(data, p + 12), otherIndex = u32(data, p + 28);
  if (own == null || other == null || own === other || index == null || index >= 8 || otherIndex == null || otherIndex >= 8) return undefined;
  return { own, index, other, otherIndex, at: p };
}

/**
 * Two replayable streaming passes: inventory systems first, then their exact
 * references and the measured 2025 connector packets. No whole partition is held.
 * The caller supplies independently established element categories.
 */
export function scanNativeMep(input: {
  revitVersion: number | null | undefined;
  schema?: SchemaSummary;
  readPartitions: () => Iterable<NativeMepPage>;
  elementKinds: ReadonlyMap<number, NativeMepElementKind>;
}): NativeMepDecode {
  const version = input.revitVersion ?? null;
  const classes = new Map(input.schema?.taggedClasses.map((c) => [c.tag, c.name]) ?? []);
  const systemsSupported = version != null && version >= 2024 && version <= 2027;
  const manager = input.schema?.taggedClasses.find((c) => c.name === "RbsCurveConnectorManager")?.tag;
  const out: NativeMepDecode = {
    revitVersion: version, systems: [], ports: [], connections: [],
    coverage: {
      systemLayout: !systemsSupported ? "unsupported-release" : !classes.size ? "missing-schema" : "supported",
      connectorLayout: version !== 2025 ? "unsupported-release" : manager == null ? "missing-schema" : "supported",
      familyConnectorGraphs: "not-decoded", systemMembership: "candidate-object-id-references", invalidSystemObjects: 0, incompleteObjects: 0,
      conflictingSystems: 0, conflictingPorts: 0, limitReached: false, skippedPartitions: [],
    },
  };
  if (!systemsSupported || !classes.size) return out;
  const systemById = new Map<number, NativeMepSystem>();
  const conflict = new Set<number>();
  let systemEvidenceCount = 0, membershipEvidenceCount = 0;
  if ([...classes.values()].some((name) => SYSTEM_CLASSES.has(name))) {
    const systemClasses = new Map([...classes].filter(([, name]) => SYSTEM_CLASSES.has(name)));
    walkObjects(input.readPartitions(), systemClasses, (object) => {
      if (!SYSTEM_CLASSES.has(object.className)) return;
      const name = systemName(object.bytes, object.className);
      const existing = systemById.get(object.id);
      if (existing && (existing.className !== object.className || existing.name !== name)) conflict.add(object.id);
      if (existing && systemEvidenceCount < MAX_FINDINGS) { existing.evidence.push(object.locator); systemEvidenceCount += 1; }
      else if (existing) out.coverage.limitReached = true;
      else if (systemById.size < MAX_FINDINGS) systemById.set(object.id, {
        elementId: object.id, className: object.className, name, candidateMembers: [], evidence: [object.locator], membershipCandidates: [],
      }); else out.coverage.limitReached = true;
    }, out.coverage);
  }
  for (const id of conflict) systemById.delete(id);
  out.coverage.conflictingSystems = conflict.size;
  const pairs: Array<NativeMepConnection> = [];
  const acceptPair = (pair: RawPair, locator: NativeMepLocator, layout: NativeMepConnection["evidence"][number]["layout"]) => {
    if (!input.elementKinds.has(pair.own) || !input.elementKinds.has(pair.other)) return;
    if ((input.elementKinds.get(pair.own) === "curve" && pair.index >= 2)
      || (input.elementKinds.get(pair.other) === "curve" && pair.otherIndex >= 2)) return;
    if (pairs.length >= MAX_FINDINGS) { out.coverage.limitReached = true; return; }
    pairs.push({ a: { elementId: pair.own, index: pair.index }, b: { elementId: pair.other, index: pair.otherIndex }, evidence: [{ ...locator, layout }] });
  };
  // A small lookbehind gives connector anchors their full 1,636-byte tail.
  function* connectionPages(): Generator<NativeMepPage> {
    let stream = "", tail: Uint8Array<ArrayBufferLike> = new Uint8Array(), base = 0;
    for (const page of input.readPartitions()) {
      if (page.stream !== stream) { stream = page.stream; tail = new Uint8Array(); base = 0; }
      if (out.coverage.connectorLayout === "supported") {
        const data = new Uint8Array(tail.length + page.bytes.length); data.set(tail); data.set(page.bytes, tail.length);
        for (let p = 0; p + 36 <= data.length; p += 1) {
          if (manager != null && u32(data, p + 2) === 0xffff_ffff
            && data[p] === (manager & 255) && data[p + 1] === (manager >>> 8)
            && data[p + 6] === ((manager + 1) & 255) && data[p + 7] === ((manager + 1) >>> 8)) {
            // Wait until all of the measured search interval is present.
            if (p + 1636 > data.length) continue;
            const lists: RawPair[] = [];
            for (let q = p + 900; q < p + 1600; q += 1) {
              const list = pairAt(data, q);
              if (list && list.index < 2 && input.elementKinds.get(list.own) === "curve") lists.push(list);
            }
            const later = new Set(lists.filter((l) => l.at - p >= 1170).map((l) => `${l.own}:${l.other}:${l.otherIndex}`));
            for (const list of lists) {
              const isLater = list.at - p >= 1170;
              if (!isLater && later.has(`${list.own}:${list.other}:${list.otherIndex}`)) continue;
              acceptPair({ ...list, index: isLater ? list.index : 1 - list.index }, { stream, offset: base + list.at }, isLater ? "curve-later" : "curve-earlier-inverted");
            }
          }
          const fitting = pairAt(data, p);
          if (fitting && input.elementKinds.get(fitting.own) === "fitting") acceptPair(fitting, { stream, offset: base + p }, "fitting-list");
        }
        const keep = Math.max(0, data.length - 1635); tail = data.slice(keep); base += keep;
      }
      yield page;
    }
  }
  if (input.elementKinds.size && (systemById.size || out.coverage.connectorLayout === "supported")) {
    const secondPassCoverage = { ...out.coverage, invalidSystemObjects: 0, incompleteObjects: 0 };
    walkObjects(connectionPages(), classes, (object) => {
      if (!input.elementKinds.has(object.id)) return;
      const seen = new Set<number>();
      // Require the complete positive u64 reference, rather than matching a
      // coincidental low u32 in floating-point or negative parameter values.
      for (let p = 20; p + 8 <= object.bytes.length - 4; p += 1) {
        const id = idAt(object.bytes, p);
        if (id == null || id === object.id || seen.has(id)) continue;
        const system = systemById.get(id);
        if (!system) continue;
        seen.add(id);
        if (membershipEvidenceCount >= MAX_FINDINGS) { out.coverage.limitReached = true; continue; }
        system.candidateMembers.push(object.id);
        system.membershipCandidates.push({ ...object.locator, offset: object.locator.offset + p, elementId: object.id });
        membershipEvidenceCount += 1;
      }
    }, secondPassCoverage, input.elementKinds);
    out.coverage.invalidSystemObjects = Math.max(out.coverage.invalidSystemObjects, secondPassCoverage.invalidSystemObjects);
    out.coverage.incompleteObjects = Math.max(out.coverage.incompleteObjects, secondPassCoverage.incompleteObjects);
  }
  out.systems = [...systemById.values()].sort((a, b) => a.elementId - b.elementId).map((s) => ({ ...s, candidateMembers: [...new Set(s.candidateMembers)].sort((a, b) => a - b) }));
  const byPair = new Map<string, NativeMepConnection>();
  const targets = new Map<string, Set<string>>();
  for (const pair of pairs) {
    if (pair.a.elementId > pair.b.elementId || (pair.a.elementId === pair.b.elementId && pair.a.index > pair.b.index)) [pair.a, pair.b] = [pair.b, pair.a];
    const ak = `${pair.a.elementId}:${pair.a.index}`, bk = `${pair.b.elementId}:${pair.b.index}`;
    for (const [key, value] of [[ak, bk], [bk, ak]]) { const set = targets.get(key!) ?? new Set(); set.add(value!); targets.set(key!, set); }
    const key = `${ak}-${bk}`, existing = byPair.get(key);
    if (existing) {
      for (const evidence of pair.evidence) if (!existing.evidence.some((e) => e.stream === evidence.stream && e.offset === evidence.offset && e.layout === evidence.layout)) existing.evidence.push(evidence);
    } else byPair.set(key, pair);
  }
  // These measured joins describe physical ends; contradictory partners for
  // one port remain unresolved instead of producing a fabricated graph.
  out.coverage.conflictingPorts = [...targets.values()].filter((s) => s.size > 1).length;
  out.connections = [...byPair.values()].filter((p) => targets.get(`${p.a.elementId}:${p.a.index}`)!.size === 1 && targets.get(`${p.b.elementId}:${p.b.index}`)!.size === 1)
    .sort((a, b) => a.a.elementId - b.a.elementId || a.a.index - b.a.index || a.b.elementId - b.b.elementId || a.b.index - b.b.index);
  const ports = new Map<string, NativeMepPort>();
  const addPort = (port: NativeMepPort) => {
    const key = `${port.elementId}:${port.index}`;
    if (ports.has(key) || ports.size < MAX_FINDINGS) ports.set(key, port);
    else out.coverage.limitReached = true;
  };
  if (out.coverage.connectorLayout === "supported") for (const [id, kind] of input.elementKinds) {
    if (kind === "curve") for (let index = 0; index < 2; index += 1) addPort({ elementId: id, index, source: "measured-curve-end" });
  }
  for (const pair of out.connections) for (const end of [pair.a, pair.b]) addPort({ ...end, source: "native-connector-list" });
  out.ports = [...ports.values()].sort((a, b) => a.elementId - b.elementId || a.index - b.index);
  return out;
}

/** Pipeline adapter; optional semantics never replace Reviter's geometry. */
export function scanContainerNativeMep(container: OpenedRevitContainer, records: readonly ElementBoundsRecord[]): NativeMepDecode {
  const skipped = new Set<string>();
  const readPartitions = function* (): Generator<NativeMepPage> {
    for (const partition of container.partitions) {
      const bytes = stripRevitPageChecksums(asBytes(partition.entry.content));
      const offsets = gzipOffsets(bytes);
      let window: Uint8Array | undefined;
      for (let i = 0; i < offsets.length; i += 1) {
        const page = inflateRevitChunk(bytes, offsets[i]!, offsets[i + 1], window);
        if (!page) { skipped.add(partition.path); break; }
        window = revitWindowTail(page);
        yield { stream: partition.path, bytes: page };
      }
    }
  };
  const result = scanNativeMep({ revitVersion: container.decoderPlan.revitVersion, schema: container.schema, readPartitions, elementKinds: nativeMepElementKinds(records) });
  result.coverage.skippedPartitions = [...skipped].sort();
  return result;
}
