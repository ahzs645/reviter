/**
 * Native primary design options, adapted from rvt-rs's RE-40 reader
 * Copyright 2026 Griffin Long; licensed under Apache-2.0.
 * See docs/rvt-rs-design-options-attribution.md. The partition chain and counted
 * option/name entry must agree. Alternatives stay visible unless a caller
 * explicitly requests `primary`; missing or conflicting evidence never hides
 * an element. Geometry and reviewed indoor sources are not modified here.
 */
import type { ElementHeader } from "./element-headers.ts";
import type { SchemaSummary } from "./schema.ts";

const SET_CATEGORY = -2_006_112n;
const MAX_OPTIONS = 64;
const MAX_NAME_UNITS = 256;
const PREFIX_BYTES = 0x5a + (MAX_OPTIONS + 1) * 8;
const NAME_ENTRY_BYTES = 4 + MAX_OPTIONS * 8 + 8 + MAX_NAME_UNITS * 2 + 8;
const MAX_SETS = 4096;
const MAX_ENTRIES = 16384;
const EXPECTED_TAGS: Record<number, [number, number, number]> = {
  2024: [1439, 326, 1451],
  2025: [1479, 345, 1491],
  2026: [1509, 353, 1521],
};

export type NativeDesignOptionSet = {
  setId: number;
  name: string;
  optionIds: number[];
  primaryOptionId: number;
};
export type DesignOptionsDecode = {
  source: "native-partition-design-options";
  status: "supported" | "unsupported";
  revitVersion: number | null;
  sets: NativeDesignOptionSet[];
  unresolvedSets: { setId: number; optionIds: number[]; reasons: string[] }[];
  /** Only elements with a native option id; absent ids remain unresolved. */
  elementOptions: { elementId: number; optionId: number }[];
  warnings: string[];
};
export type DesignOptionSelectionMode = "all" | "primary";
export type DesignOptionDecision = {
  include: boolean;
  state: "main-model" | "primary" | "non-primary" | "unresolved";
  optionId: number | null;
  setId?: number;
};

type Entry = { name: string; primary: number };
type Membership = { options: number[]; reasons: Set<string> };
const key = (ids: readonly number[]) => ids.join(",");
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const idAt = (view: DataView, at: number) => {
  if (at < 0 || at + 8 > view.byteLength) return null;
  const id = view.getBigUint64(at, true);
  return id > 0n && id <= 0x7fff_ffffn ? Number(id) : null;
};

/** Require the measured wide-id release and its own schema; never guess tags. */
function schemaGate(revitVersion: number | null | undefined, schema?: SchemaSummary): number | null {
  const tags = EXPECTED_TAGS[revitVersion ?? 0];
  if (!tags || !schema) return null;
  const names = ["ElementHeader", "Outline", "ElementParents"];
  if (!names.every((name, i) => schema.taggedClasses.some(c => c.name === name && c.tag === tags[i]))) return null;
  const header = schema.taggedClasses.find(c => c.name === "ElementHeader");
  return header?.declaredFieldCount === 12 && header.version === (revitVersion === 2024 ? 24 : revitVersion === 2025 ? 25 : 26) ? tags[0] : null;
}

/**
 * Streaming collector: push contiguous inflated pages, then finishPartition.
 * A missing/salvaged page invalidates chain evidence: call invalidatePartition
 * before processing any subsequent pages of that partition. Only bytes on the leading project chain can
 * introduce a set; loaded families after the chain cannot supply project sets.
 * Names can precede or follow their sets and can cross page boundaries.
 */
export class DesignOptionsCollector {
  private readonly headerTag: number | null;
  private readonly version: number | null;
  private readonly members = new Map<number, Membership>();
  private readonly entries = new Map<string, Entry[]>();
  private entryCount = 0;
  private budgetExceeded = false;
  private nameTail = new Uint8Array();
  private chainAlive = true;
  private prefix = new Uint8Array(PREFIX_BYTES);
  private prefixLength = 0;
  private recordLength: number | null = null;
  private recordPosition = 0;
  private trailer = new Uint8Array(16);

  constructor(options: { revitVersion: number | null | undefined; schema?: SchemaSummary }) {
    this.version = options.revitVersion ?? null;
    this.headerTag = schemaGate(options.revitVersion, options.schema);
  }

  pushPage(page: Uint8Array): void {
    if (this.headerTag == null || this.budgetExceeded) return;
    this.scanNames(page);
    let at = 0;
    while (at < page.length && this.chainAlive) {
      if (this.recordLength == null) {
        const count = Math.min(16 - this.prefixLength, page.length - at);
        this.prefix.set(page.subarray(at, at + count), this.prefixLength);
        this.prefixLength += count;
        this.recordPosition += count;
        at += count;
        if (this.prefixLength < 16) break;
        const view = viewOf(this.prefix);
        const length = view.getUint32(8, true);
        if (!idAt(view, 0) || length < 16 || view.getUint16(12, true) !== this.headerTag) {
          this.chainAlive = false;
          break;
        }
        this.recordLength = length;
      }
      const length = this.recordLength;
      if (this.recordPosition < length) {
        const count = Math.min(length - this.recordPosition, page.length - at);
        const retained = Math.max(0, Math.min(count, PREFIX_BYTES - this.recordPosition));
        this.prefix.set(page.subarray(at, at + retained), this.recordPosition < PREFIX_BYTES ? this.recordPosition : PREFIX_BYTES);
        this.prefixLength += retained;
        at += count;
        this.recordPosition += count;
      }
      if (this.recordPosition < length) break;
      const trailerPosition = this.recordPosition - length;
      const count = Math.min(16 - trailerPosition, page.length - at);
      this.trailer.set(page.subarray(at, at + count), trailerPosition);
      at += count;
      this.recordPosition += count;
      if (this.recordPosition < length + 16) break;
      const trailer = viewOf(this.trailer);
      const flags = trailer.getUint32(8, true);
      if ((flags !== 0 && flags !== 0x0100_0000) || trailer.getUint32(12, true) !== length) {
        this.chainAlive = false;
        break;
      }
      this.readMembers(length);
      this.prefixLength = 0;
      this.recordLength = null;
      this.recordPosition = 0;
    }
  }

  private readMembers(length: number): void {
    const view = viewOf(this.prefix.subarray(0, this.prefixLength));
    if (length < 0x5a || view.byteLength < 0x5a || view.getBigInt64(0x12, true) !== SET_CATEGORY) return;
    // +0x12 follows an empty m_regenHistory, not an arbitrary header offset.
    if (view.getUint32(0x0e, true) !== 0) return;
    const setId = idAt(view, 0)!;
    const count = view.getUint32(0x56, true);
    if (count < 2 || count > MAX_OPTIONS + 1 || 0x5a + count * 8 > Math.min(length, view.byteLength)) return;
    if (idAt(view, 0x5a) !== setId) return;
    const options: number[] = [];
    for (let i = 1; i < count; i++) {
      const id = idAt(view, 0x5a + i * 8);
      if (id == null || id === setId || options.includes(id)) return;
      options.push(id);
    }
    const held = this.members.get(setId);
    if (held) {
      if (key(held.options) !== key(options)) {
        held.reasons.add("conflicting-member-lists");
        held.options = [...new Set([...held.options, ...options])];
      }
    } else if (this.members.size < MAX_SETS) {
      this.members.set(setId, { options, reasons: new Set() });
    } else this.budgetExceeded = true;
  }

  private scanNames(page: Uint8Array): void {
    const bytes = new Uint8Array(this.nameTail.length + page.length);
    bytes.set(this.nameTail);
    bytes.set(page, this.nameTail.length);
    const view = viewOf(bytes);
    for (let at = 0; at + 4 <= bytes.length; at++) {
      const count = view.getUint32(at, true);
      if (count < 1 || count > MAX_OPTIONS) continue;
      const separator = at + 4 + count * 8;
      if (separator + 8 > bytes.length || view.getUint32(separator, true) !== 1) continue;
      const units = view.getUint32(separator + 4, true);
      const end = separator + 8 + units * 2 + 8;
      if (units < 1 || units > MAX_NAME_UNITS || end > bytes.length || end <= this.nameTail.length) continue;
      const options: number[] = [];
      for (let i = 0; i < count; i++) {
        const id = idAt(view, at + 4 + i * 8);
        if (id == null || options.includes(id)) break;
        options.push(id);
      }
      if (options.length !== count) continue;
      const primary = idAt(view, end - 8);
      if (primary == null || !options.includes(primary)) continue;
      let name: string;
      try { name = new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(separator + 8, end - 8)); }
      catch { continue; }
      if (!name.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) continue;
      const listKey = key(options);
      const entries = this.entries.get(listKey) ?? [];
      if (entries.some(entry => entry.primary === primary && entry.name === name)) continue;
      if (this.entryCount >= MAX_ENTRIES) { this.budgetExceeded = true; return; }
      entries.push({ name, primary });
      this.entries.set(listKey, entries);
      this.entryCount++;
    }
    this.nameTail = bytes.slice(Math.max(0, bytes.length - NAME_ENTRY_BYTES));
  }

  /** A missing/salvaged chunk breaks framing until the next partition. */
  invalidatePartition(): void {
    this.chainAlive = false;
    this.nameTail = new Uint8Array();
  }

  finishPartition(): void {
    this.nameTail = new Uint8Array();
    this.chainAlive = true;
    this.prefixLength = 0;
    this.recordLength = null;
    this.recordPosition = 0;
  }

  finish(headers: Iterable<ElementHeader> = []): DesignOptionsDecode {
    const result: DesignOptionsDecode = {
      source: "native-partition-design-options", status: this.headerTag == null ? "unsupported" : "supported",
      revitVersion: this.version, sets: [], unresolvedSets: [], elementOptions: [], warnings: [],
    };
    if (this.headerTag == null) result.warnings.push("Primary design-option decoding requires a measured 2024–2026 release and matching ElementHeader/Outline/ElementParents schema.");
    if (this.budgetExceeded) result.warnings.push("Design-option evidence budget exceeded; primary selection retains every option.");
    const owners = new Map<number, number[]>();
    for (const [setId, member] of this.members) for (const id of member.options) {
      const list = owners.get(id) ?? []; list.push(setId); owners.set(id, list);
    }
    for (const [setId, member] of [...this.members].sort((a, b) => a[0] - b[0])) {
      const reasons = new Set(member.reasons);
      const entries = this.entries.get(key(member.options)) ?? [];
      if (!entries.length) reasons.add("missing-name-entry");
      if (new Set(entries.map(entry => entry.primary)).size > 1) reasons.add("conflicting-primary-options");
      if (new Set(entries.map(entry => entry.name)).size > 1) reasons.add("conflicting-set-names");
      if (member.options.some(id => owners.get(id)!.length > 1)) reasons.add("option-in-multiple-sets");
      if (this.budgetExceeded) reasons.add("evidence-budget-exceeded");
      if (reasons.size) result.unresolvedSets.push({ setId, optionIds: [...member.options], reasons: [...reasons].sort() });
      else result.sets.push({ setId, name: entries[0]!.name, optionIds: [...member.options], primaryOptionId: entries[0]!.primary });
    }
    for (const header of headers) if (header.designOptionId != null) result.elementOptions.push({ elementId: header.elementId, optionId: header.designOptionId });
    result.elementOptions.sort((a, b) => a.elementId - b.elementId);
    return result;
  }
}

/** Build once per export. `all` preserves existing scene/export behaviour. */
export function createDesignOptionSelector(
  evidence: DesignOptionsDecode | undefined,
  mode: DesignOptionSelectionMode = "all",
): (optionId: number | null | undefined) => DesignOptionDecision {
  const resolved = new Map<number, NativeDesignOptionSet[]>();
  const unresolved = new Set(evidence?.unresolvedSets.flatMap(set => set.optionIds) ?? []);
  if (evidence?.status === "supported") for (const set of evidence.sets) for (const id of set.optionIds) {
    const list = resolved.get(id) ?? []; list.push(set); resolved.set(id, list);
  }
  return optionId => {
    if (optionId === null) return { include: true, state: "main-model", optionId };
    if (optionId === undefined) return { include: true, state: "unresolved", optionId: null };
    const sets = resolved.get(optionId);
    if (unresolved.has(optionId) || sets?.length !== 1) return { include: true, state: "unresolved", optionId };
    const set = sets[0]!;
    const primary = set.primaryOptionId === optionId;
    return { include: mode === "all" || primary, state: primary ? "primary" : "non-primary", optionId, setId: set.setId };
  };
}

/** Missing element/header evidence is retained even under primary selection. */
export function createDesignOptionElementSelector(evidence: DesignOptionsDecode | undefined, mode: DesignOptionSelectionMode = "all") {
  const byId = new Map<number, number[]>();
  for (const member of evidence?.elementOptions ?? []) {
    const held = byId.get(member.elementId) ?? [];
    if (!held.includes(member.optionId)) held.push(member.optionId);
    byId.set(member.elementId, held);
  }
  const select = createDesignOptionSelector(evidence, mode);
  return (elementId: number): DesignOptionDecision => {
    const ids = byId.get(elementId);
    return select(ids?.length === 1 ? ids[0] : undefined);
  };
}
