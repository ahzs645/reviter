/**
 * Original family symbols and exporter type identities (upstream RE-167/B72).
 * Adapted formulas/layout from helenkwok/rvt-rs at 1c3d337, Apache-2.0:
 * partition_schema_mvp.rs::attach_original_symbols and
 * ifc/export_content.rs::door_symbol_flipped. See docs/third-party/rvt-rs.
 * Complete, checksum-verified objects are required. Split/damaged objects do
 * not become identity evidence; unknown host/facing never means unflipped.
 */
import type { ElementObject } from "./element-objects.ts";
import type { InstancePlacement } from "./instanced-geometry.ts";
import type { NativeHostRelation } from "./host-relations.ts";
import type { ElementBoundsRecord } from "./types.ts";
import { nativeIfcGlobalIds, revitDoorWindowTypeGlobalId, revitIfcSubElementGlobalId } from "./ifc-global-id.ts";
import type { NativeElementIdentity } from "./native-identity.ts";
import { hypot } from "./deterministic-math.ts";
import { canonicalClassTag } from "./revit-class-tags.ts";
import { decodeRevit2027FramedGRepRoot } from "./revit-2027-framed-grep-root.ts";
import { replayRevit2027GRepFifo } from "./revit-2027-grep-replay.ts";
import type { Revit2027GInstance, Revit2027InstanceInfo } from "./revit-2027-ginstance.ts";

export type NativeOriginalSymbolReference = {
  elementId: number;
  /** null is Revit's explicitly stored invalid-id/instance-geometry sentinel. */
  originalSymbolId: number | null;
  source: "checksum-verified-GElement.original-symbol";
  revitVersion: number;
  stream: string;
  chunkIndex: number;
  rawOffset: number;
  objectOffset: number;
  /** Exact field position obtained by following the owning graphics FIFO. */
  symbolFieldOffset?: number;
  /** Embedded instance geometry needs a separately proven exporter recipe. */
  embeddedSymbolGeometry?: boolean;
};
export type NativeIfcTypeIdentityEvidence = NativeOriginalSymbolReference & {
  flipped?: boolean;
  flipSource?: "native-instance-facing+native-host-wall-axis";
};
type Location = { stream: string; chunkIndex: number; rawOffset: number; complete: boolean };

/** The end−20 recipe only reads the symbol when InstanceInfo is the last
 * deferred object. Follow the existing certified FIFO for larger records.
 * Only the first direct GInstance of the owner is eligible; nested graphics
 * and reused pointers cannot borrow another instance's symbol. */
export function nativeOriginalSymbolFromFifo(data: Uint8Array, frame: ElementObject, revitVersion: number): {
  originalSymbolId: number | null; symbolFieldOffset: number; embeddedSymbolGeometry: boolean;
} | null {
  const verified = verifiedOriginalSymbolObject(data, frame.offset);
  if (!verified || verified.elementId !== frame.elementId || canonicalClassTag(verified.classTag) !== 2246) return null;
  const root = decodeRevit2027FramedGRepRoot(data, { ...frame, marker: 2246 }, revitVersion);
  if (!root.ok || root.value.children.length > 64 || root.value.children[0]?.sourceClassSlot !== 2215) return null;
  const replay = replayRevit2027GRepFifo(data, root.value, undefined, { maxReplayEntries: 512, maxDescriptors: 2048 });
  if (!replay.ok) return null;
  const instanceSpan = replay.value.spans.find(span => span.path.length === 1 && span.path[0] === 0 && span.readerId === "Revit2027GInstance");
  const infoSpan = replay.value.spans.find(span => span.parentReplayIndex === instanceSpan?.replayIndex && span.path.length === 2 && span.path[1] === 0 && span.readerId === "Revit2027InstanceInfo");
  if (!instanceSpan || !infoSpan) return null;
  const instance = instanceSpan.value as Revit2027GInstance;
  const info = infoSpan.value as Revit2027InstanceInfo;
  const symbol = info.symbolElementId;
  if (symbol !== -1n && (symbol < 1n || symbol > 0xffff_fffen)) return null;
  return {
    originalSymbolId: symbol === -1n ? null : Number(symbol),
    symbolFieldOffset: info.byteOffset + 96,
    embeddedSymbolGeometry: instance.embeddedSymbolGRep.token !== 0,
  };
}

/** Original symbols can survive outside the current ElemTable inventory.
 * Admit their validated creation histories for this identity reader only;
 * actual symbols still require named, checksum-verified source objects. This
 * does not admit historical records into scene or other semantic decoders. */
export function nativeOriginalSymbolElementIds(declared: ReadonlySet<number>, identities: readonly NativeElementIdentity[]): ReadonlySet<number> {
  return new Set([...declared, ...nativeIfcGlobalIds(identities).keys()]);
}

/** Reads the same verified data-object envelope as upstream RE-153. */
export function verifiedOriginalSymbolObject(data: Uint8Array, offset: number): { elementId: number; classTag: number; end: number } | null {
  if (!Number.isInteger(offset) || offset < 0 || offset + 24 > data.length) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(offset + 4, true) !== 0) return null;
  const size = view.getUint32(offset + 12, true);
  const end = offset + 20 + size;
  if (size < 4 || size > 0xffff || end > data.length || view.getUint32(end - 4, true) !== size) return null;
  let a = 1, b = 0;
  for (let cursor = offset + 16; cursor < end - 4; cursor += 1) {
    a = (a + data[cursor]!) % 65521;
    b = (b + a) % 65521;
  }
  if (((b * 65536 + a) >>> 0) !== view.getUint32(offset + 8, true)) return null;
  const elementId = view.getUint32(offset, true);
  return elementId > 0 ? { elementId, classTag: view.getUint16(offset + 16, true), end } : null;
}

export function createNativeOriginalSymbolCollector(options: {
  revitVersion: number | null;
  classes: readonly { tag: number; name: string }[];
  elementIds: ReadonlySet<number>;
  /** Validated native table/history ids; named source witnesses are required. */
  historyElementIds?: ReadonlySet<number>;
}) {
  const classes = new Map(options.classes.map(entry => [entry.tag, entry.name]));
  const admitted = options.revitVersion != null && Number.isInteger(options.revitVersion) && options.revitVersion >= 2024 && options.revitVersion <= 2027;
  const symbols = new Set<number>();
  const instances = new Set<number>();
  const held = new Map<number, { partition: number; references: Map<number, NativeOriginalSymbolReference> }>();
  let checksumWork = 0;
  let fifoWork = 0;
  let capped = false;
  const MAX_CHECKSUM_BYTES = 128 * 1024 * 1024;
  const MAX_ELEMENTS = 200_000;
  const MAX_FIFO_BYTES = 16 * 1024 * 1024;
  return {
    consumeObjects(data: Uint8Array, location: Location, objects: readonly ElementObject[]): void {
      if (!admitted || !location.complete || capped) return;
      const partitionText = /^Partitions\/(\d+)$/.exec(location.stream)?.[1];
      if (partitionText == null) return;
      const partition = Number(partitionText);
      if (!Number.isSafeInteger(partition)) return;
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (const frame of objects) {
        if (frame.offset + 20 > data.length) continue;
        const className = classes.get(view.getUint16(frame.offset + 16, true));
        const isSymbol = className === "FamilySymbol" || className === "SysMullionFamSym" || className === "SysPanelFamSym";
        const isInstance = className === "FamilyInstance" || className === "CurtainWallMullion" || className === "CurtainWallPanel";
        // The generic inventory can be narrower than validated native history.
        // Do not checksum unrelated GElement geometry from the wider domain;
        // an extra instance needs its own verified named instance object first.
        if (!options.elementIds.has(frame.elementId) &&
          !(options.historyElementIds?.has(frame.elementId) &&
            (isSymbol || isInstance || (className === "GElement" && instances.has(frame.elementId))))) continue;
        if (isInstance) {
          if (!options.elementIds.has(frame.elementId)) {
            const size = view.getUint32(frame.offset + 12, true);
            if (size > 0xffff) continue;
            checksumWork += size;
            if (checksumWork > MAX_CHECKSUM_BYTES) { capped = true; break; }
            const verified = verifiedOriginalSymbolObject(data, frame.offset);
            if (!verified || verified.elementId !== frame.elementId) continue;
          }
          if (instances.size >= MAX_ELEMENTS) { capped = true; break; }
          instances.add(frame.elementId);
          continue;
        }
        if (!isSymbol && className !== "GElement") continue;
        const size = view.getUint32(frame.offset + 12, true);
        if (size > 0xffff) continue;
        checksumWork += size;
        if (checksumWork > MAX_CHECKSUM_BYTES || held.size >= MAX_ELEMENTS || symbols.size >= MAX_ELEMENTS) { capped = true; break; }
        const verified = verifiedOriginalSymbolObject(data, frame.offset);
        if (!verified || verified.elementId !== frame.elementId) continue;
        if (isSymbol) { symbols.add(frame.elementId); continue; }
        const at = verified.end - 20;
        if (at < frame.offset + 20) continue;
        const tailSymbolId = view.getUint32(at, true);
        // Preserve the measured fixed-instance path. Larger complete records
        // can append geometry after InstanceInfo and need structural replay.
        let fifo: ReturnType<typeof nativeOriginalSymbolFromFifo> = null;
        if (size > 300 && instances.has(frame.elementId) && fifoWork + size <= MAX_FIFO_BYTES && checksumWork + size <= MAX_CHECKSUM_BYTES) {
          fifoWork += size;
          checksumWork += size; // The standalone structural helper re-verifies.
          fifo = nativeOriginalSymbolFromFifo(data, frame, options.revitVersion!);
        }
        const originalSymbolId = fifo ? fifo.originalSymbolId ?? 0xffff_ffff : tailSymbolId;
        const previous = held.get(frame.elementId);
        if (previous && previous.partition > partition) continue;
        const current = previous?.partition === partition ? previous : { partition, references: new Map<number, NativeOriginalSymbolReference>() };
        const previousReference = current.references.get(originalSymbolId);
        current.references.set(originalSymbolId, {
          elementId: frame.elementId, originalSymbolId: originalSymbolId === 0xffff_ffff ? null : originalSymbolId,
          source: "checksum-verified-GElement.original-symbol", revitVersion: options.revitVersion!,
          stream: location.stream, chunkIndex: location.chunkIndex, rawOffset: location.rawOffset, objectOffset: frame.offset,
          ...(fifo ? { symbolFieldOffset: fifo.symbolFieldOffset, embeddedSymbolGeometry: fifo.embeddedSymbolGeometry } : {}),
          ...(previousReference?.embeddedSymbolGeometry ? { embeddedSymbolGeometry: true } : {}),
        });
        held.set(frame.elementId, current);
      }
    },
    finish(): NativeOriginalSymbolReference[] {
      if (!admitted || capped) return [];
      return [...held.values()].flatMap(({ references }) => {
        if (references.size !== 1) return [];
        const reference = [...references.values()][0]!;
        return instances.has(reference.elementId) &&
          (reference.originalSymbolId == null || symbols.has(reference.originalSymbolId)) ? [reference] : [];
      }).sort((a, b) => a.elementId - b.elementId);
    },
    get capped(): boolean { return capped; },
  };
}

/** Explicit native facing and straight host axis; no AABB direction inference. */
export function doorWindowSymbolFlipped(opening: [number, number], wall: [number, number], direction: [number, number], facing: [number, number]): boolean | null {
  if (![...opening, ...wall, ...direction, ...facing].every(Number.isFinite)) return null;
  const length = hypot(...direction), facingLength = hypot(...facing);
  if (length < 1e-9 || facingLength < 1e-9) return null;
  const normal = [-direction[1] / length, direction[0] / length];
  const offset = (opening[0] - wall[0]) * normal[0]! + (opening[1] - wall[1]) * normal[1]!;
  const facingSide = normal[0]! * facing[0] + normal[1]! * facing[1];
  return (offset > -1e-9) !== (facingSide > -1e-9);
}

export function resolveNativeIfcTypeIdentityEvidence(options: {
  references: readonly NativeOriginalSymbolReference[];
  placements: Iterable<InstancePlacement>;
  elementBounds: readonly ElementBoundsRecord[];
  hostRelations: readonly NativeHostRelation[];
  /** Owners of certified native triangles may have no duplicated bounds. */
  certifiedMeshElementIds?: ReadonlySet<number>;
  revitVersion: number;
}): NativeIfcTypeIdentityEvidence[] {
  const records = new Map(options.elementBounds.map(record => [record.elementId, record]));
  const placements = new Map<number, InstancePlacement | null>();
  for (const placement of options.placements) {
    const previous = placements.get(placement.elementId);
    if (previous === undefined) placements.set(placement.elementId, placement);
    else if (previous && JSON.stringify([previous.basis, previous.origin]) !== JSON.stringify([placement.basis, placement.origin])) placements.set(placement.elementId, null);
  }
  const hostIds = new Map<number, number | null>();
  for (const relation of options.hostRelations) {
    if (relation.source !== "Partitions/InsertableInst.m_hostId" || relation.evidence !== "persisted") continue;
    const previous = hostIds.get(relation.elementId);
    hostIds.set(relation.elementId, previous === undefined || previous === relation.hostId ? relation.hostId : null);
  }
  return options.references.filter(reference => reference.revitVersion === options.revitVersion &&
    (records.has(reference.elementId) || options.certifiedMeshElementIds?.has(reference.elementId))).map(reference => {
    const own = records.get(reference.elementId);
    if (own?.categoryId !== -2_000_023 && own?.categoryId !== -2_000_014) return { ...reference };
    const placement = placements.get(reference.elementId);
    const hostId = hostIds.get(reference.elementId);
    const host = hostId == null ? undefined : records.get(hostId);
    const solid = host?.solid ?? (host?.solids?.length === 1 ? host.solids[0] : undefined);
    if (!placement || placement.basis.length !== 9 || !solid || host?.categoryId !== -2_000_011) return { ...reference };
    if (!placement.basis.every(Number.isFinite) ||
      Math.abs(hypot(placement.basis[1]!, placement.basis[4]!, placement.basis[7]!) - 1) > 1e-6) return { ...reference };
    const { min, max } = own.boundsFeet;
    const flipped = doorWindowSymbolFlipped(
      [(min.x + max.x) / 2, (min.y + max.y) / 2],
      [solid.start.x, solid.start.y], [solid.end.x - solid.start.x, solid.end.y - solid.start.y],
      [placement.basis[1]!, placement.basis[4]!],
    );
    return flipped == null ? { ...reference } : { ...reference, flipped, flipSource: "native-instance-facing+native-host-wall-axis" };
  });
}

export function nativeFamilyTypeGlobalId(options: {
  evidence: NativeIfcTypeIdentityEvidence | undefined;
  nativeGuids: ReadonlyMap<number, string>;
  instanceEntity: string;
  exporterVersion: number;
  inAssembly?: boolean;
}): string | null {
  const evidence = options.evidence;
  if (!evidence || evidence.source !== "checksum-verified-GElement.original-symbol" ||
    evidence.embeddedSymbolGeometry === true ||
    !Number.isInteger(evidence.revitVersion) || evidence.revitVersion < 2024 || evidence.revitVersion > 2027 ||
    !Number.isSafeInteger(evidence.elementId) || evidence.elementId < 1 ||
    (evidence.originalSymbolId !== null && (!Number.isSafeInteger(evidence.originalSymbolId) || evidence.originalSymbolId < 1 || evidence.originalSymbolId > 0xffff_fffe))) return null;
  if (evidence.originalSymbolId == null) {
    const own = options.nativeGuids.get(evidence.elementId);
    return own ? revitIfcSubElementGlobalId(own, 2048) : null;
  }
  const original = options.nativeGuids.get(evidence.originalSymbolId);
  if (!original) return null;
  if (options.instanceEntity === "IFCDOOR" || options.instanceEntity === "IFCWINDOW") {
    if (typeof evidence.flipped !== "boolean" || evidence.flipSource !== "native-instance-facing+native-host-wall-axis") return null;
    return revitDoorWindowTypeGlobalId(original, evidence.flipped, options.inAssembly ?? false, options.exporterVersion);
  }
  return original;
}
