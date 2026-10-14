/**
 * Primary design options, adapted from helenkwok/rvt-rs RE-40 at
 * 1c3d337dbd2a6810e9dfad68fe99857843d67387, src/partition_design_options.rs
 * and partition_element_records.rs. Upstream is licensed Apache-2.0; see
 * lib/rvt-wasm/LICENSE. This TypeScript adaptation adds explicit uncertainty.
 *
 * Positive primary-option evidence: Snowdon Towers Architectural 2024,
 * reports/element-framing/RE-40-design-option-primary.md. Upstream also reads
 * this shape in 2025, but has no positive 2025 design-option fixture. No
 * inference is made for older narrow-id records or 2026/2027 records.
 * Input must be COMPLETE inflated partition streams, in original byte order;
 * the record chain can cross the compressed page boundary.
 */
import type { ElementHeader } from "./element-headers.ts";

export const OST_DESIGN_OPTION_SETS = -2_006_112;
export const DESIGN_OPTION_SOURCE = "rvt-rs/RE-40@1c3d337";
const MAX_OPTIONS = 64;
const MAX_NAME_UNITS = 256;
const MARKERS: Record<number, readonly number[]> = {
  2024: [0x46, 0x01, 0xff, 0xff, 0xff, 0xff, 0xab, 0x05],
  2025: [0x59, 0x01, 0xff, 0xff, 0xff, 0xff, 0xd3, 0x05],
};

export type DesignOptionPartition = { stream: string; bytes: Uint8Array };
export type DesignOptionLocation = { stream: string; offset: number };
export type NativeDesignOptionSet = {
  setId: number;
  name: string;
  optionIds: number[];
  primaryOptionId: number;
  recordSources: DesignOptionLocation[];
  nameSources: DesignOptionLocation[];
};
export type UnresolvedDesignOptionSet = {
  setId: number;
  optionIds: number[];
  reason: "invalid-members" | "conflicting-members" | "missing-name-entry" |
    "conflicting-name-entries" | "option-in-multiple-sets";
  recordSources: DesignOptionLocation[];
};
export type NativeDesignOptions = {
  source: typeof DESIGN_OPTION_SOURCE;
  revitVersion: number | null;
  status: "decoded" | "unsupported-release" | "schema-marker-mismatch" | "incomplete-partitions";
  /** 2025 is implemented upstream but lacks a measured positive fixture. */
  positiveEvidence: "measured-2024" | "unvalidated-positive-2025" | "none";
  sets: NativeDesignOptionSet[];
  unresolvedSets: UnresolvedDesignOptionSet[];
  incompleteReason?: string;
};

function u32(view: DataView, at: number): number | undefined {
  return at >= 0 && at + 4 <= view.byteLength ? view.getUint32(at, true) : undefined;
}
function id(view: DataView, at: number): number | undefined {
  if (at < 0 || at + 8 > view.byteLength) return undefined;
  const value = view.getBigUint64(at, true);
  return value > 0n && value <= 0xffff_ffffn ? Number(value) : undefined;
}

/** The leading project record chain; trailer echoes prevent embedded matches. */
function* recordChain(bytes: Uint8Array, marker: readonly number[]) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const prologue = (marker[6]! | marker[7]! << 8) - 12;
  let at = 0;
  while (at + 16 <= bytes.byteLength) {
    const size = u32(view, at + 8)!;
    if (size < 16 || view.getUint16(at + 12, true) !== prologue) break;
    const end = at + size;
    const flag = u32(view, end + 8);
    if ((flag !== 0 && flag !== 0x0100_0000) || u32(view, end + 12) !== size) break;
    yield { view, start: at, end, setId: id(view, at) };
    at = end + 16;
  }
}

function optionMembers(view: DataView, start: number, end: number, setId: number): number[] | undefined {
  const count = u32(view, start + 0x56);
  if (count === undefined || count < 2 || count > MAX_OPTIONS + 1) return undefined;
  const idsAt = start + 0x5a;
  if (idsAt + count * 8 > end || id(view, idsAt) !== setId) return undefined;
  const options: number[] = [];
  for (let index = 1; index < count; index++) {
    const option = id(view, idsAt + index * 8);
    if (option === undefined || option === setId || options.includes(option)) return undefined;
    options.push(option);
  }
  return options;
}

function findNameEntries(partition: DesignOptionPartition, options: number[]) {
  const needle = new Uint8Array(8 + options.length * 8);
  const writer = new DataView(needle.buffer);
  writer.setUint32(0, options.length, true);
  options.forEach((option, index) => writer.setBigUint64(4 + index * 8, BigInt(option), true));
  writer.setUint32(needle.length - 4, 1, true);
  const bytes = partition.bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: { name: string; primaryOptionId: number; location: DesignOptionLocation }[] = [];
  for (let at = bytes.indexOf(needle[0]!); at >= 0; at = bytes.indexOf(needle[0]!, at + 1)) {
    if (at + needle.length > bytes.length) break;
    if (!needle.every((value, index) => value === bytes[at + index])) continue;
    const lengthAt = at + needle.length;
    const units = u32(view, lengthAt);
    if (units === undefined || units < 1 || units > MAX_NAME_UNITS) continue;
    const nameAt = lengthAt + 4;
    const primaryOptionId = id(view, nameAt + units * 2);
    if (primaryOptionId === undefined || !options.includes(primaryOptionId)) continue;
    let name: string;
    try {
      name = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(nameAt, nameAt + units * 2));
    } catch { continue; }
    if (!name.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) continue;
    entries.push({ name, primaryOptionId, location: { stream: partition.stream, offset: at } });
  }
  return entries;
}

/** Resolve set names and primary ids; missing/conflicting evidence stays visible. */
export function decodeNativeDesignOptions(
  partitions: readonly DesignOptionPartition[],
  revitVersion: number | null | undefined,
  schemaMarker?: readonly number[],
): NativeDesignOptions {
  const marker = revitVersion == null ? undefined : MARKERS[revitVersion];
  const result: NativeDesignOptions = {
    source: DESIGN_OPTION_SOURCE, revitVersion: revitVersion ?? null,
    status: marker ? "decoded" : "unsupported-release",
    positiveEvidence: revitVersion === 2024 ? "measured-2024" : revitVersion === 2025 ? "unvalidated-positive-2025" : "none",
    sets: [], unresolvedSets: [],
  };
  if (!marker) return result;
  if (schemaMarker && (schemaMarker.length !== marker.length || marker.some((value, index) => value !== schemaMarker[index]))) {
    result.status = "schema-marker-mismatch";
    return result;
  }
  const members = new Map<number, { options: number[]; sources: DesignOptionLocation[]; reason?: UnresolvedDesignOptionSet["reason"] }>();
  for (const partition of partitions) {
    for (const span of recordChain(partition.bytes, marker)) {
      if (span.setId === undefined || span.start + 0x1a > span.end || span.view.getBigInt64(span.start + 0x12, true) !== BigInt(OST_DESIGN_OPTION_SETS)) continue;
      const options = optionMembers(span.view, span.start, span.end, span.setId);
      const held = members.get(span.setId);
      const location = { stream: partition.stream, offset: span.start };
      if (!held) members.set(span.setId, { options: options ?? [], sources: [location], ...(options ? {} : { reason: "invalid-members" as const }) });
      else {
        held.sources.push(location);
        if (!options) held.reason = "invalid-members";
        else if (JSON.stringify(held.options) !== JSON.stringify(options)) {
          held.options = [...new Set([...held.options, ...options])];
          held.reason = "conflicting-members";
        }
      }
    }
  }
  return resolveSets(members, options => partitions.flatMap(partition => findNameEntries(partition, options)), result);
}

type Members = Map<number, { options: number[]; sources: DesignOptionLocation[]; reason?: UnresolvedDesignOptionSet["reason"] }>;
type NameEntry = { name: string; primaryOptionId: number; location: DesignOptionLocation };
function resolveSets(members: Members, lookup: (options: number[]) => NameEntry[], result: NativeDesignOptions) {
  const ownership = new Map<number, number>();
  const overlapping = new Set<number>();
  for (const [setId, held] of members) for (const option of held.options) {
    const previous = ownership.get(option);
    if (previous !== undefined && previous !== setId) { overlapping.add(previous); overlapping.add(setId); }
    ownership.set(option, setId);
  }
  for (const [setId, held] of [...members].sort(([a], [b]) => a - b)) {
    let reason = overlapping.has(setId) ? "option-in-multiple-sets" as const : held.reason;
    const entries = reason ? [] : lookup(held.options);
    if (!reason && !entries.length) reason = "missing-name-entry";
    if (!reason && entries.some(entry => entry.name !== entries[0]!.name || entry.primaryOptionId !== entries[0]!.primaryOptionId)) reason = "conflicting-name-entries";
    if (reason) result.unresolvedSets.push({ setId, optionIds: held.options, reason, recordSources: held.sources });
    else result.sets.push({ setId, optionIds: held.options, name: entries[0]!.name, primaryOptionId: entries[0]!.primaryOptionId, recordSources: held.sources, nameSources: entries.map(entry => entry.location) });
  }
  return result;
}

/**
 * Streaming evidence collector: only the first 610 bytes and 16-byte trailer
 * of each leading record, plus a 1044-byte overlap for names, are retained.
 * Validated name entries and set records have a combined 4096-evidence cap.
 * Missing pages/cap overflow retain ALL alternatives with explicit status.
 */
export function createDesignOptionCollector(
  revitVersion: number | null | undefined,
  schemaMarker?: readonly number[],
  maxEvidence = 4096,
) {
  const base = decodeNativeDesignOptions([], revitVersion, schemaMarker);
  const marker = revitVersion == null ? undefined : MARKERS[revitVersion];
  const evidenceLimit = Number.isFinite(maxEvidence) ? Math.max(0, Math.min(4096, maxEvidence)) : 4096;
  const members: Members = new Map();
  const names = new Map<string, NameEntry[]>();
  const seenNames = new Set<string>();
  type State = { offset: number; recordStart: number; prefix: Uint8Array; prefixBytes: number; size?: number; trailer: Uint8Array; trailerBytes: number; stopped: boolean; overlap: Uint8Array };
  const streams = new Map<string, State>();
  let incompleteReason: string | undefined;
  let evidenceCount = 0;
  let finished: NativeDesignOptions | undefined;
  const invalidate = (reason = "missing-or-corrupt-partition-page") => {
    incompleteReason ??= reason;
    streams.clear(); members.clear(); names.clear(); seenNames.clear();
  };
  function addEvidence() {
    if (++evidenceCount > evidenceLimit) { invalidate("design-option-evidence-limit"); return false; }
    return true;
  }
  function finishRecord(stream: string, state: State) {
    const view = new DataView(state.prefix.buffer, 0, state.prefixBytes);
    const trailer = new DataView(state.trailer.buffer);
    const flags = trailer.getUint32(8, true);
    if ((flags !== 0 && flags !== 0x0100_0000) || trailer.getUint32(12, true) !== state.size) { state.stopped = true; return; }
    const setId = id(view, 0);
    if (setId !== undefined && view.byteLength >= 0x1a && view.getBigInt64(0x12, true) === BigInt(OST_DESIGN_OPTION_SETS)) {
      if (!addEvidence()) return;
      const options = optionMembers(view, 0, state.size!, setId);
      const held = members.get(setId);
      const location = { stream, offset: state.recordStart };
      if (!held) members.set(setId, { options: options ?? [], sources: [location], ...(options ? {} : { reason: "invalid-members" as const }) });
      else {
        held.sources.push(location);
        if (!options) held.reason = "invalid-members";
        else if (JSON.stringify(held.options) !== JSON.stringify(options)) {
          held.options = [...new Set([...held.options, ...options])]; held.reason = "conflicting-members";
        }
      }
    }
    state.recordStart += state.size! + 16;
    state.prefixBytes = 0; state.size = undefined; state.trailerBytes = 0;
  }
  function scanNames(stream: string, state: State, bytes: Uint8Array) {
    // At most a page plus a constant overlap; process unusually large pages in
    // 128KiB slices so temporary allocations remain bounded as well.
    for (let pageAt = 0; pageAt < bytes.length && !incompleteReason; pageAt += 128 * 1024) {
      const slice = bytes.subarray(pageAt, pageAt + 128 * 1024);
      const combined = new Uint8Array(state.overlap.length + slice.length);
      combined.set(state.overlap); combined.set(slice, state.overlap.length);
      const absoluteStart = state.offset + pageAt - state.overlap.length;
      const view = new DataView(combined.buffer);
      for (let at = 0; at + 12 <= combined.length; at++) {
        const count = combined[at]!;
        if (count < 1 || count > MAX_OPTIONS || combined[at + 1] || combined[at + 2] || combined[at + 3]) continue;
        const flagAt = at + 4 + count * 8;
        if (u32(view, flagAt) !== 1) continue;
        const units = u32(view, flagAt + 4);
        if (units === undefined || units < 1 || units > MAX_NAME_UNITS || flagAt + 8 + units * 2 + 8 > combined.length) continue;
        const options: number[] = [];
        for (let index = 0; index < count; index++) {
          const option = id(view, at + 4 + index * 8);
          if (option === undefined || options.includes(option)) break;
          options.push(option);
        }
        if (options.length !== count) continue;
        const key = options.join(",");
        const sourceKey = `${stream}:${absoluteStart + at}`;
        if (seenNames.has(sourceKey)) continue;
        const entry = findNameEntries({ stream, bytes: combined.subarray(at, flagAt + 8 + units * 2 + 8) }, options)[0];
        if (!entry) continue;
        if (!addEvidence()) return;
        seenNames.add(sourceKey);
        entry.location.offset = absoluteStart + at;
        const held = names.get(key) ?? []; held.push(entry); names.set(key, held);
      }
      state.overlap = combined.slice(Math.max(0, combined.length - 1044));
    }
  }
  return {
    /** Caller must invalidate on skipped/salvaged incomplete partition pages. */
    invalidate,
    pushPage(stream: string, bytes: Uint8Array) {
      if (finished || base.status !== "decoded" || !marker || incompleteReason) return;
      if (!streams.has(stream) && streams.size >= 4096) { invalidate("partition-stream-count-limit"); return; }
      const state = streams.get(stream) ?? { offset: 0, recordStart: 0, prefix: new Uint8Array(610), prefixBytes: 0, trailer: new Uint8Array(16), trailerBytes: 0, stopped: false, overlap: new Uint8Array() };
      streams.set(stream, state);
      scanNames(stream, state, bytes);
      let at = 0;
      while (at < bytes.length && !state.stopped && !incompleteReason) {
        if (state.size === undefined) {
          const n = Math.min(16 - state.prefixBytes, bytes.length - at);
          state.prefix.set(bytes.subarray(at, at + n), state.prefixBytes); state.prefixBytes += n; at += n;
          if (state.prefixBytes < 16) break;
          const view = new DataView(state.prefix.buffer);
          const prologue = (marker[6]! | marker[7]! << 8) - 12;
          const size = view.getUint32(8, true);
          if (size < 16 || view.getUint16(12, true) !== prologue) { state.stopped = true; break; }
          state.size = size;
        }
        const bodyLeft = state.recordStart + state.size - (state.offset + at);
        if (bodyLeft > 0) {
          const n = Math.min(bodyLeft, bytes.length - at);
          const capture = Math.min(n, state.prefix.length - state.prefixBytes);
          if (capture > 0) { state.prefix.set(bytes.subarray(at, at + capture), state.prefixBytes); state.prefixBytes += capture; }
          at += n;
          if (at === bytes.length) break;
        }
        const n = Math.min(16 - state.trailerBytes, bytes.length - at);
        state.trailer.set(bytes.subarray(at, at + n), state.trailerBytes); state.trailerBytes += n; at += n;
        if (state.trailerBytes === 16) finishRecord(stream, state);
      }
      state.offset += bytes.length;
    },
    finish(): NativeDesignOptions {
      if (finished) return finished;
      if (!incompleteReason && [...streams.values()].some(state => !state.stopped && state.size !== undefined)) invalidate("truncated-leading-record");
      finished = incompleteReason ? { ...base, status: "incomplete-partitions", incompleteReason } : resolveSets(members, options => names.get(options.join(",")) ?? [], base);
      streams.clear(); members.clear(); names.clear(); seenNames.clear();
      return finished;
    },
  };
}

export type DesignOptionSelectionMode = "all" | "main-and-primary";
export type DesignOptionExportDecision = {
  include: boolean;
  reason: "all-options" | "main-model" | "primary-option" | "non-primary-option" | "unresolved-option" | "missing-header";
  optionId?: number;
  setId?: number;
};

/** Explicit export-only selection. Viewers retain all geometry by default. */
export function designOptionExportDecision(
  header: Pick<ElementHeader, "designOptionId"> | undefined,
  options: NativeDesignOptions | undefined,
  mode: DesignOptionSelectionMode = "all",
): DesignOptionExportDecision {
  if (mode === "all") return { include: true, reason: "all-options" };
  if (!header) return { include: true, reason: "missing-header" };
  const optionId = header.designOptionId;
  if (optionId == null) return { include: true, reason: "main-model" };
  if (options?.status !== "decoded" || options.unresolvedSets.some(set => set.optionIds.includes(optionId))) return { include: true, reason: "unresolved-option", optionId };
  const owningSets = options.sets.filter(set => set.optionIds.includes(optionId));
  if (owningSets.length !== 1) return { include: true, reason: "unresolved-option", optionId };
  const set = owningSets[0]!;
  const include = set.primaryOptionId === optionId;
  return { include, reason: include ? "primary-option" : "non-primary-option", optionId, setId: set.setId };
}

/** Return selected elements and explain every omission/uncertain membership. */
export function selectDesignOptionExportElements<T extends { elementId: number }>(
  elements: readonly T[],
  headers: ReadonlyMap<number, Pick<ElementHeader, "designOptionId">> | undefined,
  options: NativeDesignOptions | undefined,
  mode: DesignOptionSelectionMode = "all",
) {
  const included: T[] = [];
  const excluded: { elementId: number; decision: DesignOptionExportDecision }[] = [];
  const unresolved: { elementId: number; decision: DesignOptionExportDecision }[] = [];
  for (const element of elements) {
    const decision = designOptionExportDecision(headers?.get(element.elementId), options, mode);
    if (decision.include) included.push(element);
    else excluded.push({ elementId: element.elementId, decision });
    if (decision.reason === "missing-header" || decision.reason === "unresolved-option") unresolved.push({ elementId: element.elementId, decision });
  }
  return { elements: included, excluded, unresolved };
}
