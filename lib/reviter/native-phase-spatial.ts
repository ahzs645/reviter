/** Source phase and spatial semantics adapted from rvt-rs 1c3d337,
 * partition_phases.rs (2024), partition_level_parameters.rs (RE-172/174),
 * partition_room_parameters.rs (RE-153). Copyright 2026 Griffin Long,
 * Apache-2.0: docs/third-party/rvt-rs/{LICENSE,NOTICE}.
 * Element phase fields use Reviter's existing framed Element field walk and
 * the file's declared field order. No phase order or lifecycle is guessed.
 */
import { associatedLevelFieldOffset } from "./level-relations.ts";
import { frameHeaderBytes, narrowElementIds } from "./element-id-width.ts";
import { indexPageFrames, type PageFrameIndex } from "./page-frame-index.ts";
import { canonicalClassTag, fileClassFieldNames, readsElementRecordLayout } from "./revit-class-tags.ts";
import { REVIT_2027_CLASS_NAMES, REVIT_2027_FIRST_CLASS_INDEX } from "./revit-2027-class-names.data.ts";
import type { SchemaSummary } from "./schema.ts";
import type { ElementHeader } from "./element-headers.ts";
import type { NativeRoomPageSource, NativeRoomEvidenceSource } from "./native-source-rooms.ts";

export const NATIVE_PHASE_NAME_RELEASES = [2024] as const;
export const NATIVE_LEVEL_PARAMETER_RELEASES = [2024] as const;
export const NATIVE_ROOM_FLOOR_FINISH_RELEASES = [2024, 2025] as const;
const MAX_CANDIDATES = 250_000, MAX_REFERENCES = 1024;
const MAX_CHECKSUM_WORK = 32 * 1024 * 1024;
const OST_PHASES = -2_000_112;
const FLOOR_FINISH = -1_006_903;
const FLOOR_FINISH_BYTES = (() => { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigInt64(0, BigInt(FLOOR_FINISH), true); return [...bytes]; })();
const LEVEL_MARKER = [0xd3, 0x02, 1, 0, 0, 0];
const ELEMENT_PHASE_FIELDS = [
  "m_pParamValueSetDouble", "m_pParamValueSetInt", "m_pParamValueSetAString", "m_pParamValueSetElementId",
  "m_geomSteps", "m_pGeomTable", "m_constrInfo", "m_cellList", "m_docAccess", "m_id",
  "m_assocLevelId", "m_famId", "m_unplacedOwnerId", "m_ownerDBViewId", "m_createdPhaseId", "m_demolishedPhaseId", "m_designOptionId",
];
const ordinal = (name: string) => REVIT_2027_FIRST_CLASS_INDEX + REVIT_2027_CLASS_NAMES.indexOf(name);
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function matches(bytes: Uint8Array, p: number, tag: readonly number[]) { return p >= 0 && p + tag.length <= bytes.length && tag.every((byte, i) => bytes[p + i] === byte); }
function u32(view: DataView, p: number): number | undefined { return p >= 0 && p + 4 <= view.byteLength ? view.getUint32(p, true) : undefined; }
function id(view: DataView, p: number, width = 8): number | null | undefined {
  if (p < 0 || p + width > view.byteLength) return undefined;
  const value = width === 8 ? view.getBigInt64(p, true) : BigInt(view.getInt32(p, true));
  if (value === -1n) return null;
  return value > 0n && value <= 0x7fff_ffffn ? Number(value) : undefined;
}
function textAt(bytes: Uint8Array, p: number, limit = 256) {
  const count = u32(viewOf(bytes), p);
  if (count == null || count < 1 || count > limit || p + 4 + count * 2 > bytes.length) return undefined;
  try {
    const text = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(p + 4, p + 4 + count * 2));
    return text.trim() && !/[\u0000-\u001f\u007f-\u009f\ufffd-\uffff]/u.test(text) ? text : undefined;
  } catch { return undefined; }
}
export type NativePhaseDefinition = { phaseId: number; name: string; sources: NativeRoomEvidenceSource[] };
export type NativeElementPhases = {
  elementId: number;
  createdPhaseId: number | null;
  demolishedPhaseId: number | null;
  source: "Element.phase-fields" | "partition-reference-single-phase";
  /** Reference-list decoding cannot prove absence of a demolition field. */
  demolitionKnown: boolean;
  evidence: NativeRoomEvidenceSource;
};
export type NativeLevelParameters = {
  elementId: number; levelId?: number; topLevelId?: number; stairBaseLevelId?: number; stairTopLevelId?: number;
  evidence: NativeRoomEvidenceSource;
};
export type NativePhaseSpatialEvidence = {
  revitVersion: number | null;
  phases: NativePhaseDefinition[];
  elementPhases: NativeElementPhases[];
  levelParameters: NativeLevelParameters[];
  roomFloorFinishes: { elementId: number; value: string; evidence: NativeRoomEvidenceSource }[];
  limitations: string[];
};
export type NativePhaseSpatialResolve = {
  elementHeaders: ReadonlyMap<number, ElementHeader>;
  levelIds: ReadonlySet<number>;
};
type LevelCandidate = { elementId: number; levelId: number | null | undefined; tops: number[]; stairPairs: [number, number][]; evidence: NativeRoomEvidenceSource };
type RefCandidate = { elementId: number; references: number[]; evidence: NativeRoomEvidenceSource };

/** Bounded source collector. Schema/declared identities are captured for one file. */
export function createNativePhaseSpatialCollector(options: {
  revitVersion: number | null | undefined;
  schema?: SchemaSummary;
  declaredElementIds: ReadonlySet<number>;
}) {
  const { revitVersion, schema, declaredElementIds } = options;
  const names: { phaseId: number; name: string; tagged: boolean; evidence: NativeRoomEvidenceSource }[] = [];
  const phaseFields: NativeElementPhases[] = [], levels: LevelCandidate[] = [], references: RefCandidate[] = [];
  const finishes: { elementId: number; value: string; evidence: NativeRoomEvidenceSource }[] = [];
  const floorObjectConflicts = new Set<number>();
  const classes = new Map(schema?.taggedClasses.map((entry) => [entry.name, entry]));
  const elementTags = new Set<number>();
  for (const entry of classes.values()) {
    let current: string | undefined = entry.name;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === "Element") { elementTags.add(canonicalClassTag(entry.tag)); break; }
      seen.add(current); current = classes.get(current)?.parent;
    }
  }
  const phaseTag = classes.get("ProjectPhase")?.tag;
  const fieldOrder = fileClassFieldNames(ordinal("Element"));
  const fieldGate = readsElementRecordLayout(revitVersion) && ELEMENT_PHASE_FIELDS.every((name, i) => fieldOrder?.[i] === name);
  const narrow = narrowElementIds(), width = narrow ? 4 : 8;
  const sourceKey = (source: NativeRoomEvidenceSource) => `${source.stream}:${source.chunkIndex}:${source.offset}`;
  const seen = new Set<string>();
  let capped = false, checksumCapped = false;
  let previous: { data: Uint8Array; source: NativeRoomPageSource; offset: number } | undefined;
  const add = <T extends { evidence: NativeRoomEvidenceSource }>(kind: string, list: T[], value: T) => {
    const key = `${kind}:${sourceKey(value.evidence)}`;
    if (seen.has(key)) return;
    if (seen.size >= MAX_CANDIDATES) { capped = true; return; }
    seen.add(key); list.push(value);
  };
  return {
    pushPage(page: Uint8Array, location: NativeRoomPageSource, suppliedFrames?: PageFrameIndex) {
      const prior = location.complete !== false && previous?.source.complete !== false && previous?.source.stream === location.stream && previous.source.chunkIndex + 1 === location.chunkIndex ? previous : undefined;
      const prefix = prior?.data.length ?? 0;
      const bytes = prefix ? new Uint8Array(prefix + page.length) : page;
      if (prior) { bytes.set(prior.data); bytes.set(page, prefix); }
      previous = location.complete === false ? undefined : { data: page.slice(Math.max(0, page.length - 65_536)), source: location, offset: Math.max(0, page.length - 65_536) };
      const view = viewOf(bytes);
      const source = (at: number): NativeRoomEvidenceSource => prior && at < prefix
        ? { stream: prior.source.stream, chunkIndex: prior.source.chunkIndex, rawOffset: prior.source.rawOffset, offset: prior.offset + at }
        : { stream: location.stream, chunkIndex: location.chunkIndex, rawOffset: location.rawOffset, offset: at - prefix };
      if (fieldGate) {
        // Shared page frames are safe to reuse only without an overlap prefix.
        const frames = prefix ? indexPageFrames(bytes) : suppliedFrames ?? indexPageFrames(bytes);
        for (const frame of frames.frames) {
          if (!elementTags.has(frame.marker) || !declaredElementIds.has(frame.elementId)) continue;
          const limit = frame.offset + frame.objectLength + frameHeaderBytes();
          const offset = associatedLevelFieldOffset(view, frame.offset, limit, narrow);
          if (offset == null || frame.offset + offset + 6 * width > limit) continue;
          if (id(view, frame.offset + offset - width, width) !== frame.elementId) continue;
          const createdPhaseId = id(view, frame.offset + offset + 4 * width, width), demolishedPhaseId = id(view, frame.offset + offset + 5 * width, width);
          if (createdPhaseId === undefined || demolishedPhaseId === undefined) continue;
          add("phase-fields", phaseFields, { elementId: frame.elementId, createdPhaseId, demolishedPhaseId, source: "Element.phase-fields", demolitionKnown: true, evidence: source(frame.offset) });
        }
      }
      if (revitVersion === 2024) {
        for (let at = bytes.indexOf(1); at >= 0; at = bytes.indexOf(1, at + 1)) {
          if (!matches(bytes, at, [1, 0, 0, 0])) continue;
          const phaseId = id(view, at + 4);
          if (phaseId == null || !declaredElementIds.has(phaseId) || !matches(bytes, at + 12, Array(56).fill(255)) || !matches(bytes, at + 68, [0, 0, 0])) continue;
          const name = textAt(bytes, at + 71, 200);
          if (!name) continue;
          const tagged = phaseTag != null && at >= 34 && view.getUint16(at - 34, true) === phaseTag && bytes.subarray(at - 32, at).every((byte) => byte === 0);
          const own = matches(bytes, at - 6, [255, 255, 255, 255, 0xd3, 2]);
          if (tagged || own) add("phase-name", names, { phaseId, name, tagged, evidence: source(at) });
        }
        const starts: number[] = [];
        for (let at = bytes.indexOf(LEVEL_MARKER[0]!); at >= 0; at = bytes.indexOf(LEVEL_MARKER[0]!, at + 1)) if (matches(bytes, at, LEVEL_MARKER)) starts.push(at);
        for (let i = 0; i < starts.length; i++) {
          const at = starts[i]!, ownAt = at + 6, elementId = id(view, ownAt);
          if (elementId == null || !declaredElementIds.has(elementId) || u32(view, ownAt + 4) !== 0 || u32(view, ownAt + 12) !== 0 || !matches(bytes, ownAt + 16, Array(24).fill(255))) continue;
          // Wait for the bounded window or its next association delimiter before
          // remembering this source location; later pages may carry its top slot.
          const end = Math.min(starts[i + 1] ?? Infinity, ownAt + 352);
          if (end > bytes.length) continue;
          const tops: number[] = [], stairPairs: [number, number][] = [];
          for (let displacement = 100; displacement < 320; displacement++) {
            const p = ownAt + displacement;
            if (p + 12 > end) break;
            const top = u32(view, p);
            if (u32(view, p - 4) === 0 && u32(view, p + 4) === 0 && (u32(view, p + 8) ?? 0) >= 0xffff_fff0 && top != null) tops.push(top);
          }
          for (const displacement of [115, 121, 129, 137]) {
            const base = u32(view, ownAt + displacement), top = u32(view, ownAt + displacement + 32);
            if (ownAt + displacement + 36 <= end && base != null && top != null && base !== top) stairPairs.push([base, top]);
          }
          add("levels", levels, { elementId, levelId: id(view, ownAt + 8), tops, stairPairs, evidence: source(at) });
        }
        // PhaseCreated's reference rule is measured on 2024 record headers.
        const headerTag = classes.get("ElementHeader")?.tag;
        if (headerTag != null) for (let at = bytes.indexOf(headerTag & 255, 12); at >= 12 && at + 6 <= bytes.length; at = bytes.indexOf(headerTag & 255, at + 1)) {
          if (bytes[at + 1] !== headerTag >> 8) continue;
          const elementId = id(view, at - 12), count = u32(view, at + 2);
          if (elementId == null || !declaredElementIds.has(elementId) || count == null || count > 4096) continue;
          const categoryAt = at + 6 + count * 22, markerAt = categoryAt + 62;
          if (!matches(bytes, markerAt, [0x46, 1, 255, 255, 255, 255, 0xab, 5])) continue;
          const n = u32(view, markerAt + 56);
          if (n == null || n < 1 || n > MAX_REFERENCES || markerAt + 60 + n * 8 > bytes.length) continue;
          const values: number[] = [];
          for (let j = 0; j < n; j++) { const value = id(view, markerAt + 60 + 8 * j); if (value != null) values.push(value); }
          add("references", references, { elementId, references: values, evidence: source(at - 12) });
        }
      }
      if (NATIVE_ROOM_FLOOR_FINISH_RELEASES.some((version) => version === revitVersion)) {
        let budget = MAX_CHECKSUM_WORK;
        for (let at = 0; at + 24 <= bytes.length; at++) {
          const elementId = u32(view, at), size = u32(view, at + 12);
          if (elementId == null || !declaredElementIds.has(elementId) || u32(view, at + 4) !== 0 || size == null || size < 4) continue;
          const end = at + 20 + size;
          if (end > bytes.length || u32(view, end - 4) !== size) continue;
          const values = new Set<string>();
          for (let p = bytes.indexOf(FLOOR_FINISH_BYTES[0]!, at + 20); p >= at + 20 && p + 12 < end - 4; p = bytes.indexOf(FLOOR_FINISH_BYTES[0]!, p + 1)) {
            if (view.getBigInt64(p, true) !== BigInt(FLOOR_FINISH)) continue;
            const candidate = textAt(bytes.subarray(0, end - 4), p + 8);
            if (candidate && values.size < 2) values.add(candidate);
          }
          if (!values.size) continue;
          if (end - at > budget) { checksumCapped = true; continue; }
          budget -= end - at;
          let a = 1, b = 0;
          for (let p = at + 16; p < end - 4; p++) { a = (a + bytes[p]!) % 65521; b = (b + a) % 65521; }
          if (((b * 65536 + a) >>> 0) !== u32(view, at + 8)) continue;
          if (values.size > 1) { if (floorObjectConflicts.size < MAX_CANDIDATES) floorObjectConflicts.add(elementId); else capped = true; }
          else add("floor-finish", finishes, { elementId, value: [...values][0]!, evidence: source(at) });
          at = end - 1;
        }
      }
    },
    resolve(input: NativePhaseSpatialResolve): NativePhaseSpatialEvidence {
      const phaseMap = new Map<number, NativePhaseDefinition>(), phaseConflicts = new Set<number>();
      for (const candidate of names) {
        if (!candidate.tagged && input.elementHeaders.get(candidate.phaseId)?.categoryId !== OST_PHASES) continue;
        const held = phaseMap.get(candidate.phaseId);
        if (held && held.name !== candidate.name) phaseConflicts.add(candidate.phaseId);
        if (held) held.sources.push(candidate.evidence); else phaseMap.set(candidate.phaseId, { phaseId: candidate.phaseId, name: candidate.name, sources: [candidate.evidence] });
      }
      for (const phaseId of phaseConflicts) phaseMap.delete(phaseId);
      const phaseByElement = new Map<number, NativeElementPhases>(), phaseElementConflicts = new Set<number>();
      for (const value of phaseFields) {
        const held = phaseByElement.get(value.elementId);
        if (held && (held.createdPhaseId !== value.createdPhaseId || held.demolishedPhaseId !== value.demolishedPhaseId)) phaseElementConflicts.add(value.elementId);
        else if (!held) phaseByElement.set(value.elementId, value);
      }
      const referenceTargets = new Map<number, { ids: Set<number>; evidence: NativeRoomEvidenceSource; ambiguous: boolean }>();
      for (const reference of references) {
        if (phaseByElement.has(reference.elementId) || phaseElementConflicts.has(reference.elementId)) continue;
        const ids = [...new Set(reference.references.filter((phaseId) => phaseMap.has(phaseId)))];
        const held = referenceTargets.get(reference.elementId) ?? { ids: new Set<number>(), evidence: reference.evidence, ambiguous: false };
        for (const phaseId of ids) held.ids.add(phaseId);
        held.ambiguous ||= ids.length > 1;
        referenceTargets.set(reference.elementId, held);
      }
      for (const [elementId, target] of referenceTargets) if (!target.ambiguous && target.ids.size === 1) phaseByElement.set(elementId, { elementId, createdPhaseId: [...target.ids][0]!, demolishedPhaseId: null, source: "partition-reference-single-phase", demolitionKnown: false, evidence: target.evidence });
      for (const elementId of phaseElementConflicts) phaseByElement.delete(elementId);
      const levelByElement = new Map<number, NativeLevelParameters>(), levelConflicts = new Set<number>();
      for (const value of levels) {
        const levelId = value.levelId != null && input.levelIds.has(value.levelId) ? value.levelId : undefined;
        const tops = [...new Set(value.tops.filter((level) => input.levelIds.has(level)))];
        const stairPairs = value.stairPairs.filter(([base, top]) => input.levelIds.has(base) && input.levelIds.has(top));
        const stair = input.elementHeaders.get(value.elementId)?.categoryId === -2000120 && stairPairs.length === 1 ? stairPairs[0] : undefined;
        if (levelId == null && !stair) continue;
        const result: NativeLevelParameters = { elementId: value.elementId, levelId: levelId ?? stair?.[0], evidence: value.evidence,
          ...(input.elementHeaders.get(value.elementId)?.categoryId === -2000011 && tops.length === 1 ? { topLevelId: tops[0]! } : {}),
          ...(stair ? { stairBaseLevelId: stair[0], stairTopLevelId: stair[1] } : {}),
        };
        const held = levelByElement.get(value.elementId);
        if (held && (held.levelId !== result.levelId || held.topLevelId !== result.topLevelId || held.stairTopLevelId !== result.stairTopLevelId)) levelConflicts.add(value.elementId);
        else if (!held) levelByElement.set(value.elementId, result);
      }
      for (const elementId of levelConflicts) levelByElement.delete(elementId);
      const floorByElement = new Map<number, typeof finishes[number]>(), floorConflicts = new Set<number>(floorObjectConflicts);
      for (const value of finishes) {
        if (input.elementHeaders.get(value.elementId)?.categoryId !== -2000160) continue;
        const held = floorByElement.get(value.elementId);
        if (held && held.value !== value.value) floorConflicts.add(value.elementId);
        else if (!held) floorByElement.set(value.elementId, value);
      }
      for (const elementId of floorConflicts) floorByElement.delete(elementId);
      const limitations = ["Native phase order and export target phase are not decoded; lifecycle remains unresolved without independently proven order and target evidence."];
      limitations.push("Reference lists naming several phases are ambiguous and are not treated as Phase Created or Phase Demolished fields.");
      if (revitVersion !== 2024) limitations.push("Phase names, unique record-reference creation joins, and level/top/stair parameter layouts are measured on 2024 only.");
      if (!NATIVE_ROOM_FLOOR_FINISH_RELEASES.some((version) => version === revitVersion)) limitations.push("Room Floor Finish owner decoding is admitted on 2024–2025 only.");
      if (!fieldGate) limitations.push("Element phase fields require an admitted record layout and exact file-declared Element field order.");
      if (capped || checksumCapped) limitations.push("Semantic collector work limit reached; evidence is partial.");
      if (phaseElementConflicts.size || levelConflicts.size || floorConflicts.size || phaseConflicts.size) limitations.push("Conflicting source copies were omitted.");
      return { revitVersion: revitVersion ?? null, phases: [...phaseMap.values()].sort((a, b) => a.phaseId - b.phaseId), elementPhases: [...phaseByElement.values()].sort((a, b) => a.elementId - b.elementId), levelParameters: [...levelByElement.values()].sort((a, b) => a.elementId - b.elementId), roomFloorFinishes: [...floorByElement.values()].sort((a, b) => a.elementId - b.elementId), limitations };
    },
  };
}

export type NativeExportPhaseEvidence = {
  orderedPhaseIds: readonly number[];
  targetPhaseId: number;
  /** This must come from a separately verified, ordered native phase list. */
  source: "native-AllProjectPhases";
  evidence: NativeRoomEvidenceSource;
};
export type NativePhaseLifecycle = "new" | "existing" | "demolished" | "temporary" | "not-yet-created" | "already-demolished" | "unresolved";
export function nativePhaseLifecycle(element: NativeElementPhases, phases: readonly NativePhaseDefinition[], target?: NativeExportPhaseEvidence): NativePhaseLifecycle {
  if (!target || target.source !== "native-AllProjectPhases" || !target.evidence.stream.startsWith("Partitions/") || !Number.isInteger(target.evidence.offset) || target.evidence.offset < 0 || !element.demolitionKnown) return "unresolved";
  const order = target.orderedPhaseIds, known = new Set(phases.map((phase) => phase.phaseId));
  if (order.length !== known.size || new Set(order).size !== order.length || !order.every((phaseId) => known.has(phaseId))) return "unresolved";
  const created = element.createdPhaseId == null ? -1 : order.indexOf(element.createdPhaseId), demolished = element.demolishedPhaseId == null ? null : order.indexOf(element.demolishedPhaseId), selected = order.indexOf(target.targetPhaseId);
  if (created < 0 || selected < 0 || (demolished != null && (demolished < created || demolished < 0))) return "unresolved";
  if (created > selected) return "not-yet-created";
  if (demolished != null && demolished < selected) return "already-demolished";
  if (created === selected && demolished === selected) return "temporary";
  if (demolished === selected) return "demolished";
  return created === selected ? "new" : "existing";
}
