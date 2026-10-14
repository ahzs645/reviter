/**
 * Native phase identities/names and explicit Element lifecycle fields.
 * Name framing reviewed against rvt-rs partition_phases.rs at 1c3d337
 * (Apache-2.0); implemented independently with frame/schema/identity joins.
 * The lifecycle fields come from the file's Element schema, not from the
 * ambiguous reference-list heuristic. No phase order/status is inferred.
 */
import { scanFramedElementObjects } from "./element-objects.ts";
import { associatedLevelFieldOffset } from "./level-relations.ts";
import type { SchemaStreamClass } from "./schema-reader.ts";

export type NativePhaseLocation = { stream: string; chunkIndex: number; recordOffset: number };
export type NativePhaseNameCandidate = NativePhaseLocation & {
  elementId: number; name: string; evidence: "framed-ProjectPhase" | "phase-category-element-data" | "element-data-phase-candidate";
};
export type NativePhaseRelationCandidate = NativePhaseLocation & {
  elementId: number; createdPhaseId: number | null; demolishedPhaseId: number | null;
};
export type NativePhaseEvidence = {
  phases: NativePhaseNameCandidate[];
  relations: NativePhaseRelationCandidate[];
};
export type NativePhaseLayout = {
  phaseTag: number; cellListTag: number; elementTags: ReadonlySet<number>;
};
const SUPPORTED_RELEASES = new Set([2024, 2025, 2027]);
const ELEMENT_FIELDS = [
  "m_pParamValueSetDouble", "m_pParamValueSetInt", "m_pParamValueSetAString", "m_pParamValueSetElementId",
  "m_geomSteps", "m_pGeomTable", "m_constrInfo", "m_cellList", "m_docAccess", "m_id",
  "m_assocLevelId", "m_famId", "m_unplacedOwnerId", "m_ownerDBViewId", "m_createdPhaseId",
  "m_demolishedPhaseId", "m_designOptionId", "m_locked", "m_moribund", "m_dummy",
];

/** Positive schema admission before reading any native byte fields. */
export function nativePhaseLayout(release: number, classes: readonly SchemaStreamClass[]): NativePhaseLayout | null {
  if (!SUPPORTED_RELEASES.has(release)) return null;
  const element = classes.find((entry) => entry.name === "Element");
  const phase = classes.find((entry) => entry.name === "ProjectPhase");
  const cell = classes.find((entry) => entry.name === "CellList");
  if (!element || !phase || !cell || element.properties.length !== ELEMENT_FIELDS.length) return null;
  if (!element.properties.every((field, index) => field.name === ELEMENT_FIELDS[index])) return null;
  if (phase.parent.kind === "none" || phase.parent.index !== element.index || phase.version !== 1 ||
      phase.properties.length !== 2 || !phase.properties.every((field, index) =>
        field.name === ["m_name", "m_description"][index] && field.variant?.kind === "string" && field.loadingMode === 0)) return null;
  if (cell.properties.length !== 1 || cell.properties[0]!.name !== "m_cells" || cell.properties[0]!.loadingMode !== 1 || cell.properties[0]!.itemMode !== 5) return null;
  for (const index of [9, 10, 11, 12, 13, 14, 15, 16]) {
    const field = element.properties[index]!;
    if (field.variant?.kind !== "object" || field.loadingMode !== 0 ||
        (field.staticType?.kind !== "reference" && field.staticType?.kind !== "inline") || field.staticType.name !== "ElementId") return null;
  }
  for (const index of [0, 1, 2, 3, 4, 5, 7]) {
    const field = element.properties[index]!;
    if (field.variant?.kind !== "object" || field.loadingMode !== 1 || field.itemMode !== 0) return null;
  }
  const constraints = element.properties[6]!;
  if (constraints.variant?.kind !== "object" || constraints.loadingMode !== 1 || constraints.itemMode !== 5) return null;
  if (!element.properties.slice(17).every((field) => field.variant?.kind === "bool")) return null;
  const byIndex = new Map(classes.map((entry) => [entry.index, entry]));
  const elementTags = new Set<number>();
  for (const entry of classes) {
    let current: SchemaStreamClass | undefined = entry;
    const seen = new Set<number>();
    while (current && !seen.has(current.index)) {
      if (current.index === element.index) { elementTags.add(entry.index); break; }
      seen.add(current.index);
      current = current.parent.kind === "none" ? undefined : byIndex.get(current.parent.index);
    }
  }
  return { phaseTag: phase.index, cellListTag: cell.index, elementTags };
}

function readOptionalId(view: DataView, at: number, limit: number): number | null | undefined {
  if (at < 0 || at + 8 > limit) return undefined;
  const low = view.getUint32(at, true), high = view.getUint32(at + 4, true);
  if (low === 0xffff_ffff && high === 0xffff_ffff) return null;
  return low > 0 && high === 0 ? low : undefined;
}

function nameAt(view: DataView, at: number, limit: number): string | null {
  if (at < 0 || at + 4 > limit) return null;
  const units = view.getUint32(at, true);
  if (!units || units > 256 || at + 4 + units * 2 > limit) return null;
  let result = "";
  for (let index = 0; index < units; index++) {
    const unit = view.getUint16(at + 4 + index * 2, true);
    if (unit < 32 || (unit >= 0x7f && unit <= 0x9f) || unit >= 0xfffd) return null;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (++index >= units) return null;
      const low = view.getUint16(at + 4 + index * 2, true);
      if (low < 0xdc00 || low > 0xdfff) return null;
      result += String.fromCharCode(unit, low);
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return null;
    else result += String.fromCharCode(unit);
  }
  return result.trim() ? result : null;
}

/** Full-page collector; declared ids are independent Global/ElemTable evidence. */
export function collectNativePhaseEvidence(
  data: Uint8Array,
  layout: NativePhaseLayout | null,
  declaredIds: ReadonlySet<number>,
  location: Omit<NativePhaseLocation, "recordOffset">,
): NativePhaseEvidence {
  const phases: NativePhaseNameCandidate[] = [], relations: NativePhaseRelationCandidate[] = [];
  if (!layout || !declaredIds.size) return { phases, relations };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (const frame of scanFramedElementObjects(data)) {
    if (!declaredIds.has(frame.elementId)) continue;
    const tag = view.getUint16(frame.offset + 16, true);
    if (!layout.elementTags.has(tag)) continue;
    const limit = frame.offset + frame.objectLength + 16;
    const relative = associatedLevelFieldOffset(view, frame.offset, limit);
    if (relative === null) continue;
    const assocAt = frame.offset + relative;
    if (readOptionalId(view, assocAt - 8, limit) !== frame.elementId) continue;
    const createdPhaseId = readOptionalId(view, assocAt + 4 * 8, limit);
    const demolishedPhaseId = readOptionalId(view, assocAt + 5 * 8, limit);
    // Validate the preceding identity fields and the two lifecycle fields.
    // m_designOptionId has additional native sentinels (including -4); it
    // is outside this decoder and must not suppress valid lifecycle evidence.
    if (Array.from({ length: 6 }, (_, index) => readOptionalId(view, assocAt + index * 8, limit)).some((id) => id === undefined)) continue;
    if (createdPhaseId === undefined || demolishedPhaseId === undefined) continue;
    relations.push({ ...location, recordOffset: frame.offset, elementId: frame.elementId, createdPhaseId, demolishedPhaseId });
    if (tag === layout.phaseTag) {
      const flags = assocAt + 7 * 8;
      if (flags + 3 > limit || data[flags] !== 0 || data[flags + 1] !== 0 || data[flags + 2] !== 0) continue;
      const name = nameAt(view, flags + 3, limit);
      if (name) phases.push({ ...location, recordOffset: frame.offset, elementId: frame.elementId, name, evidence: "framed-ProjectPhase" });
    }
  }
  // Some phase elements persist their Element data without a full ProjectPhase
  // envelope. Admit only independently categorized OST_Phases ids, the file's
  // CellList pointer, repeated native id and the exact seven-null-id frame.
  for (let at = data.indexOf(0xff); at >= 0 && at + 81 <= data.length; at = data.indexOf(0xff, at + 1)) {
    if (view.getUint32(at, true) !== 0xffff_ffff || view.getUint16(at + 4, true) !== layout.cellListTag || view.getUint32(at + 6, true) !== 1) continue;
    const id = readOptionalId(view, at + 10, data.length);
    if (id == null || !declaredIds.has(id)) continue;
    if (!data.subarray(at + 18, at + 74).every((byte) => byte === 0xff)) continue;
    if (data[at + 74] || data[at + 75] || data[at + 76]) continue;
    const name = nameAt(view, at + 77, data.length);
    if (name) phases.push({ ...location, recordOffset: at, elementId: id, name, evidence: "element-data-phase-candidate" });
  }
  return { phases, relations };
}

/** Drop conflicting native names/relationships rather than selecting a winner. */
export function resolveNativePhaseEvidence(
  evidence: readonly NativePhaseEvidence[],
  phaseCategoryIds: ReadonlySet<number> = new Set(),
): NativePhaseEvidence {
  const phases = new Map<number, NativePhaseNameCandidate | null>();
  const relations = new Map<number, NativePhaseRelationCandidate | null>();
  for (const page of evidence) {
    for (const candidate of page.phases) {
      if (candidate.evidence === "element-data-phase-candidate" && !phaseCategoryIds.has(candidate.elementId)) continue;
      const phase = candidate.evidence === "element-data-phase-candidate" ? { ...candidate, evidence: "phase-category-element-data" as const } : candidate;
      const previous = phases.get(phase.elementId);
      phases.set(phase.elementId, previous === undefined ? phase : previous?.name === phase.name ? previous : null);
    }
    for (const relation of page.relations) {
      const previous = relations.get(relation.elementId);
      relations.set(relation.elementId, previous === undefined ? relation :
        previous?.createdPhaseId === relation.createdPhaseId && previous?.demolishedPhaseId === relation.demolishedPhaseId ? previous : null);
    }
  }
  return {
    phases: [...phases.values()].filter((phase): phase is NativePhaseNameCandidate => phase !== null),
    relations: [...relations.values()].filter((relation): relation is NativePhaseRelationCandidate => relation !== null && (relation.createdPhaseId !== null || relation.demolishedPhaseId !== null)),
  };
}
