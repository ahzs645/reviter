/**
 * Measured MEP evidence adapted from rvt-rs (Apache-2.0), commit 1c3d337:
 * partition_mep_systems.rs (RE-162), partition_connector_pairs.rs (RE-138/141).
 * Systems are data objects, not geometry. Joins are native counted references,
 * never inferred from spatial proximity. See docs/rvt-semantic-attribution.md.
 */
import { createNativeMepDimensionCollector, type MepBoundsEvidence } from "./native-mep-dimensions.ts";
export const MEP_SYSTEM_RELEASES = [2024, 2025, 2026, 2027] as const;
export const MEP_CONNECTION_RELEASES = [2025] as const;
const SYSTEM_CLASSES = new Set(["RbsHvacSystem", "RbsPipingSystem", "RbsElectricalSystem"]);
const MAX_REFERENCES = 1_000_000;
const MAX_CHECKSUM_BYTES_PER_PAGE = 32 * 1024 * 1024;

export type MepPartitionSource = { stream: string; chunkIndex: number; byteOffset: number; revitVersion: number; decoder: "RE-162" | "RE-138" | "RE-141" | "RE-134" | "RE-157" | "RE-165" | "RE-131" };
/** A model projection has no exposed binary locator. Nulls prevent a fabricated
 * byte offset from masquerading as a partition measurement. */
export type MepModelSource = { stream: null; chunkIndex: null; byteOffset: null; revitVersion: number; decoder: "rvt-rs-connectors" | "rvt-rs-symbol-ports"; readerCommit: string; readerMode: string; entityIndex: number; sourceKind: "reader-model" };
export type MepSource = MepPartitionSource | MepModelSource;
export type NativeMepSystem = { elementId: number; className: string; name?: string; members: number[]; memberSources: { elementId: number; source: MepSource }[]; sources: MepSource[] };
export type NativeMepConnection = { elementId: number; connectorIndex: number; otherElementId: number; otherConnectorIndex: number; sources: MepSource[] };
export type NativeMepPort = { elementId: number; connectorIndex: number; sources: MepSource[] };
export type NativeMepDimensions = { elementId: number; typeId?: number; widthFeet?: number; heightFeet?: number; lengthFeet?: number; pipeInnerDiameterFeet?: number; pipeOuterDiameterFeet?: number; nominalDiameterFeet?: number; pipeAxis?: { startFeet: [number, number, number]; endFeet: [number, number, number]; radiusFeet: number }; sources: MepPartitionSource[] };
export type NativeMepEvidence = {
  revitVersion: number;
  systems: NativeMepSystem[];
  connections: NativeMepConnection[];
  ports?: NativeMepPort[];
  dimensions?: NativeMepDimensions[];
  /** Prevent a legacy fallback from reintroducing explicitly ambiguous joins. */
  suppressedConnectorKeys?: string[];
  limitations: string[];
};
export type MepCollectorOptions = {
  revitVersion: number;
  /** File-local schema indices, not the upstream reader's inferred tags. */
  classes: readonly { name: string; tag: number }[];
  /** Declared native identities; prevents attaching findings to invented ids. */
  elementIds: ReadonlySet<number>;
  /** Duct/pipe and fitting identities established by category/class evidence. */
  curveIds?: ReadonlySet<number>;
  fittingIds?: ReadonlySet<number>;
};

function viewOf(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function u32(view: DataView, p: number): number | undefined { return p >= 0 && p + 4 <= view.byteLength ? view.getUint32(p, true) : undefined; }
function id64(view: DataView, p: number): number | undefined {
  if (p < 0 || p + 8 > view.byteLength) return undefined;
  const id = view.getBigUint64(p, true);
  return id > 0n && id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : undefined;
}
function asciiString(view: DataView, p: number): string | undefined {
  const n = u32(view, p);
  if (n == null || n > 256 || p + 4 + n * 2 > view.byteLength) return undefined;
  let text = "";
  for (let i = 0; i < n; i++) {
    const c = view.getUint16(p + 4 + i * 2, true);
    if (c < 0x20 || c >= 0x7f) return undefined;
    text += String.fromCharCode(c);
  }
  return text;
}
function systemName(bytes: Uint8Array, className: string): string | undefined {
  const view = viewOf(bytes);
  if (className === "RbsElectricalSystem") {
    for (let p = 0; p + 9 <= bytes.length; p++) {
      if (bytes[p + 8] !== 1 || !bytes.subarray(p, p + 8).every((b) => b === 255)) continue;
      const list = p + 8 + 20;
      const count = u32(view, list);
      if (count == null) return undefined;
      const name = asciiString(view, list + 4 + count * 32);
      return name === "" ? "<unnamed>" : name;
    }
    return undefined;
  }
  // The original decoder's first printable counted string is measured on RE1.
  const payload = viewOf(bytes.subarray(20, bytes.length - 4));
  for (let p = 0; p + 4 <= payload.byteLength; p++) {
    const text = asciiString(payload, p);
    if (text) return text;
  }
  return undefined;
}

/** Native data-object checksum covers class word and payload, excluding size echo. */
function verifiedObject(bytes: Uint8Array, view: DataView, p: number, budget: { remaining: number; exhausted: boolean }): { id: number; tag: number; end: number } | undefined {
  if (u32(view, p + 4) !== 0) return undefined;
  const size = u32(view, p + 12);
  if (size == null || size < 4) return undefined;
  const end = p + 20 + size;
  if (end > bytes.length || u32(view, end - 4) !== size) return undefined;
  const work = end - 4 - (p + 16);
  if (work > budget.remaining) { budget.exhausted = true; return undefined; }
  budget.remaining -= work;
  let a = 1, b = 0;
  for (let q = p + 16; q < end - 4; q++) { a = (a + bytes[q]!) % 65521; b = (b + a) % 65521; }
  if (((b * 65536 + a) >>> 0) !== u32(view, p + 8)) return undefined;
  return { id: u32(view, p)!, tag: u32(view, p + 16)! & 0xffff, end };
}

/** A page collector. A bounded prior-page tail joins explicitly complete,
 * consecutive inflated chunks; incomplete records fail closed. */
export function createNativeMepCollector(options: MepCollectorOptions) {
  const { revitVersion, elementIds } = options;
  const admitted = MEP_SYSTEM_RELEASES.some((v) => v === revitVersion);
  const joinsAdmitted = revitVersion === 2025;
  const systemTags = new Map(options.classes.filter((c) => SYSTEM_CLASSES.has(c.name)).map((c) => [c.tag, c.name]));
  const knownTags = new Set(options.classes.map((c) => c.tag));
  const manager = options.classes.find((c) => c.name === "RbsCurveConnectorManager")?.tag;
  const curveTags = new Set(options.classes.filter((c) => c.name === "RbsDuctCurve" || c.name === "RbsPipeCurve").map((c) => c.tag));
  const curveIds = new Set(options.curveIds);
  const dimensionCollector = createNativeMepDimensionCollector(options);
  const classNames = new Map(options.classes.map((c) => [c.tag, c.name]));
  const fittingIds = new Set(options.fittingIds);
  const systems = new Map<number, NativeMepSystem>();
  const disagreements = new Set<number>();
  const references = new Map<number, Map<number, MepSource>>();
  const connections = new Map<string, NativeMepConnection>();
  const fittingCandidates = new Map<string, { own: number; other: number; index: number; otherIndex: number; source: MepSource }>();
  let referenceCount = 0, capped = false, checksumCapped = false;
  let previous: { bytes: Uint8Array; stream: string; chunkIndex: number; byteOffset: number } | undefined;

  function addJoin(own: number, index: number, other: number, otherIndex: number, source: MepSource) {
    if (!elementIds.has(own) || !elementIds.has(other) || own === other) return;
    // Canonical endpoint order collapses reciprocal lists without losing provenance.
    if (own > other || (own === other && index > otherIndex)) [own, index, other, otherIndex] = [other, otherIndex, own, index];
    const key = `${own}:${index}:${other}:${otherIndex}`;
    const current = connections.get(key);
    if (current) {
      if (!current.sources.some((s) => s.stream === source.stream && s.chunkIndex === source.chunkIndex && s.byteOffset === source.byteOffset && s.decoder === source.decoder)) current.sources.push(source);
    }
    else if (connections.size < MAX_REFERENCES) connections.set(key, { elementId: own, connectorIndex: index, otherElementId: other, otherConnectorIndex: otherIndex, sources: [source] });
    else capped = true;
  }
  function rawJoin(view: DataView, p: number) {
    if (u32(view, p) !== 2 || u32(view, p + 16) !== 1 || u32(view, p + 32) !== 1) return undefined;
    const own = id64(view, p + 4), other = id64(view, p + 20), index = u32(view, p + 12), otherIndex = u32(view, p + 28);
    return own != null && other != null && index != null && otherIndex != null ? { own, other, index, otherIndex } : undefined;
  }
  return {
    /** Headers may appear after connector lists; decide fitting ownership only
     * once the caller has gathered the complete native category evidence. */
    observeElementHeaders(headers: Iterable<{ elementId: number; categoryId: number | null }>) {
      const collected = [...headers];
      dimensionCollector.observeElementHeaders(collected);
      for (const header of collected) if (elementIds.has(header.elementId) && (header.categoryId === -2008010 || header.categoryId === -2008049)) fittingIds.add(header.elementId);
    },
    observeElementBounds(records: Iterable<MepBoundsEvidence>) { dimensionCollector.observeElementBounds(records); },
    pushPage(page: Uint8Array, location: { stream: string; chunkIndex: number; complete?: boolean }) {
      if (!admitted) return;
      const prior = location.complete && previous?.stream === location.stream && previous.chunkIndex + 1 === location.chunkIndex ? previous : undefined;
      const prefix = prior?.bytes.length ?? 0;
      const bytes = prefix ? new Uint8Array(prefix + page.length) : page;
      if (prior) { bytes.set(prior.bytes); bytes.set(page, prefix); }
      const kept = Math.min(65_536, page.length);
      previous = location.complete ? { bytes: page.slice(page.length - kept), stream: location.stream, chunkIndex: location.chunkIndex, byteOffset: page.length - kept } : undefined;
      const view = viewOf(bytes);
      const budget = { remaining: Math.min(MAX_CHECKSUM_BYTES_PER_PAGE, Math.max(1_048_576, bytes.length * 4)), exhausted: false };
      const source = (at: number, decoder: MepPartitionSource["decoder"]): MepPartitionSource => prior && at < prefix
        ? { stream: prior.stream, chunkIndex: prior.chunkIndex, byteOffset: prior.byteOffset + at, revitVersion, decoder }
        : { stream: location.stream, chunkIndex: location.chunkIndex, byteOffset: at - prefix, revitVersion, decoder };
      for (let p = 0; p + 20 <= bytes.length; p++) {
        // Identity/schema checks are cheap; reject noise before size/checksum work.
        if (!elementIds.has(view.getUint32(p, true)) || !knownTags.has(view.getUint32(p + 16, true) & 0xffff)) continue;
        if (p + 20 + view.getUint32(p + 12, true) <= prefix) continue;
        const object = verifiedObject(bytes, view, p, budget);
        if (!object || !elementIds.has(object.id)) continue;
        dimensionCollector.observeVerifiedObject(bytes.subarray(p, object.end), object.id, classNames.get(object.tag) ?? "", source(p, "RE-162"));
        if (curveTags.has(object.tag)) curveIds.add(object.id);
        const className = systemTags.get(object.tag);
        if (className) {
          const name = systemName(bytes.subarray(p, object.end), className);
          const existing = systems.get(object.id);
          if (existing) {
            if (existing.name !== name || existing.className !== className) disagreements.add(object.id);
            existing.sources.push(source(p, "RE-162"));
          } else systems.set(object.id, { elementId: object.id, className, name, members: [], memberSources: [], sources: [source(p, "RE-162")] });
        }
        if (!capped && systemTags.size) {
          const held = references.get(object.id) ?? new Map<number, MepSource>();
          for (let q = p + 20; q + 4 <= object.end - 4; q++) {
            const id = view.getUint32(q, true);
            if (id === object.id || !elementIds.has(id) || held.has(id)) continue;
            if (referenceCount >= MAX_REFERENCES) { capped = true; break; }
            held.set(id, source(q, "RE-162")); referenceCount++;
          }
          references.set(object.id, held);
        }
        p = object.end - 1;
      }
      checksumCapped ||= budget.exhausted;
      if (!joinsAdmitted) return;
      for (let p = 0; p + 36 <= bytes.length; p++) {
        const fitting = rawJoin(view, p);
        if (fitting && fitting.own !== fitting.other && elementIds.has(fitting.own) && elementIds.has(fitting.other) && fitting.index < 8 && fitting.otherIndex < 8) {
          const provenance = source(p, "RE-141");
          const key = `${fitting.own}:${fitting.index}:${fitting.other}:${fitting.otherIndex}:${provenance.stream}:${provenance.chunkIndex}:${provenance.byteOffset}`;
          if (fittingCandidates.size < MAX_REFERENCES) fittingCandidates.set(key, { ...fitting, source: provenance });
          else capped = true;
        }
        if (manager == null || view.getUint16(p, true) !== manager || u32(view, p + 2) !== 0xffff_ffff || view.getUint16(p + 6, true) !== ((manager + 1) & 0xffff)) continue;
        dimensionCollector.observeCurveAnchor(bytes, p, source(p, "RE-134"));
        const lists: { own: number; other: number; index: number; otherIndex: number; at: number }[] = [];
        for (let q = p + 900; q < Math.min(p + 1600, bytes.length - 35); q++) {
          const join = rawJoin(view, q);
          if (!join || join.index >= 2 || !curveIds.has(join.own)) continue;
          lists.push({ ...join, at: q - p }); q += 35;
        }
        const later = new Set(lists.filter((l) => l.at >= 1170).map((l) => `${l.own}:${l.other}:${l.otherIndex}`));
        for (const join of lists) {
          if (join.at < 1170 && later.has(`${join.own}:${join.other}:${join.otherIndex}`)) continue;
          addJoin(join.own, join.at >= 1170 ? join.index : 1 - join.index, join.other, join.otherIndex, source(p + join.at, "RE-138"));
        }
      }
    },
    finish(): NativeMepEvidence {
      for (const join of fittingCandidates.values()) if (fittingIds.has(join.own)) addJoin(join.own, join.index, join.other, join.otherIndex, join.source);
      const membership = new Map<number, { elementId: number; source: MepSource }[]>();
      for (const [elementId, refs] of references) for (const [systemId, source] of refs) {
        if (systemId === elementId || !systems.has(systemId)) continue;
        const members = membership.get(systemId) ?? [];
        members.push({ elementId, source }); membership.set(systemId, members);
      }
      const out = [...systems.values()].sort((a, b) => a.elementId - b.elementId).map((system) => {
        const memberSources = (membership.get(system.elementId) ?? []).sort((a, b) => a.elementId - b.elementId);
        return { ...system, name: disagreements.has(system.elementId) ? undefined : system.name, members: memberSources.map((m) => m.elementId), memberSources };
      });
      const limitations = ["System membership is an ElementId reference in a checksum-verified data object (RE-162), not a decoded system field.", "Unfiltered memberships can include warning records or additional family instances; IFC membership is restricted to emitted products.", "Incomplete objects/connector lists spanning more than the bounded prior-page tail or across a damaged chunk are omitted.", "Only joined ports are recovered; unconnected family-symbol ports and flow direction require native graph decoding."];
      if (!admitted) limitations.push(`System decoder is not admitted for Revit ${revitVersion}.`);
      if (!joinsAdmitted) limitations.push(`Connector layout is measured only for Revit 2025; no connections decoded for ${revitVersion}.`);
      if (capped) limitations.push("MEP reference limit reached; evidence is partial.");
      if (checksumCapped) limitations.push("MEP checksum work limit reached; evidence is partial.");
      if (disagreements.size) limitations.push(`${disagreements.size} conflicting system names/class records suppressed.`);
      const dimensional = dimensionCollector.finish();
      return { revitVersion, systems: out, connections: [...connections.values()].sort((a, b) => a.elementId - b.elementId || a.connectorIndex - b.connectorIndex || a.otherElementId - b.otherElementId || a.otherConnectorIndex - b.otherConnectorIndex), dimensions: dimensional.dimensions, limitations: [...limitations, ...dimensional.limitations] };
    },
  };
}
