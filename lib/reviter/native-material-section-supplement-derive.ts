/** Compiler-only derivation of the material section supplement (see native-material-section-supplement.ts).
 * Audit: for every prepared material row (level, cut), the native-provenance owners in the production
 * cutter categories whose retained native-brep triangles cross the cut but which have no section row.
 * Supplement: the UNCHANGED production nativeMeshBarrierCuts sections of exactly those owners (only
 * closed, unbranched cuts survive the cutter); owners it cannot cut stay listed as uncuttable. */
import type { ConvertResult } from "./types.ts";
import type { NativeMaterialSections } from "./native-material-sections.ts";
import { nativeMeshBarrierCuts } from "./native-mesh-barrier-cuts.ts";
import {
  NATIVE_MATERIAL_SECTION_SUPPLEMENT_METHOD,
  nativeMaterialSectionSupplementHash,
  type NativeMaterialSectionSupplement,
} from "./native-material-section-supplement.ts";

/** Same categories as the production cutter: walls, curtain mullions/panels, columns. */
export const NATIVE_MATERIAL_SECTION_AUDIT_CATEGORIES = new Set([-2000011, -2000170, -2000171, -2000100, -2000133]);
const size = (a: ArrayLike<number>) => a.length ?? Object.keys(a).length;
export type NativeMaterialSectionAuditRow = {
  levelId: number;
  elevationFeet: number;
  cutElevationFeet: number;
  missing: { nativeElementId: number; categoryId: number; censusOmission: boolean; meshBaseFeet: number; meshTopFeet: number }[];
};
export function auditNativeMaterialSectionCensus(model: Pick<ConvertResult, "elementBounds" | "meshes" | "origin">, material: Pick<NativeMaterialSections, "levels">): NativeMaterialSectionAuditRow[] {
  const owners = new Map(
    model.elementBounds
      .filter((r) => NATIVE_MATERIAL_SECTION_AUDIT_CATEGORIES.has(r.categoryId!) && r.renderGeometryProvenance === "native")
      .map((r) => [r.elementId, r]),
  );
  const span = new Map<number, [number, number]>();
  for (const mesh of model.meshes ?? []) {
    if (mesh.source !== "native-brep" || !mesh.elementIds) continue;
    const count = Math.min(size(mesh.elementIds), Math.floor(size(mesh.indices) / 3));
    for (let t = 0; t < count; t++) {
      const id = mesh.elementIds[t]!;
      if (!owners.has(id)) continue;
      const s = span.get(id) ?? [Infinity, -Infinity];
      for (let k = 0; k < 3; k++) {
        const z = mesh.positions[mesh.indices[t * 3 + k]! * 3 + 2]! + model.origin.z;
        if (Number.isFinite(z)) { if (z < s[0]) s[0] = z; if (z > s[1]) s[1] = z; }
      }
      span.set(id, s);
    }
  }
  return material.levels.map((row) => {
    const present = new Set(row.sections.map((s) => s.nativeElementId));
    const census = new Set(row.sourceElementIds ?? []);
    const missing = [...span]
      .filter(([id, [lo, hi]]) => lo < row.cutElevationFeet && row.cutElevationFeet < hi && !present.has(id))
      .map(([id, [lo, hi]]) => ({ nativeElementId: id, categoryId: owners.get(id)!.categoryId!, censusOmission: !census.has(id), meshBaseFeet: lo, meshTopFeet: hi }))
      .sort((a, b) => a.nativeElementId - b.nativeElementId);
    return { levelId: row.levelId, elevationFeet: row.elevationFeet, cutElevationFeet: row.cutElevationFeet, missing };
  });
}
/** Restrict meshes to the given owners' triangles (positions copied unchanged) so the unchanged cutter
 * does the same work for those owners without re-walking the whole model at every cut. */
function ownerMeshes(model: Pick<ConvertResult, "meshes">, ids: Set<number>): ConvertResult["meshes"] {
  const out: ConvertResult["meshes"] = [];
  for (const mesh of model.meshes ?? []) {
    if (mesh.source !== "native-brep" || !mesh.elementIds) continue;
    const count = Math.min(size(mesh.elementIds), Math.floor(size(mesh.indices) / 3));
    const positions: number[] = [], indices: number[] = [], elementIds: number[] = [], remap = new Map<number, number>();
    for (let t = 0; t < count; t++) {
      const id = mesh.elementIds[t]!;
      if (!ids.has(id)) continue;
      for (let k = 0; k < 3; k++) {
        const v = mesh.indices[t * 3 + k]!;
        let at = remap.get(v);
        if (at === undefined) { at = positions.length / 3; remap.set(v, at); positions.push(mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!); }
        indices.push(at);
      }
      elementIds.push(id);
    }
    if (elementIds.length) out.push({ ...mesh, positions, indices, elementIds } as never);
  }
  return out;
}
export function deriveNativeMaterialSectionSupplement(
  model: Pick<ConvertResult, "elementBounds" | "meshes" | "origin">,
  material: NativeMaterialSections,
): { supplement?: NativeMaterialSectionSupplement; audit: (NativeMaterialSectionAuditRow & { supplementedOwnerIds: number[]; uncuttableOwnerIds: number[] })[] } {
  const audit = auditNativeMaterialSectionCensus(model, material);
  const ids = new Set(audit.flatMap((a) => a.missing.map((m) => m.nativeElementId)));
  const reduced = ids.size
    ? ({ ...model, elementBounds: model.elementBounds.filter((r) => ids.has(r.elementId)), meshes: ownerMeshes(model, ids) } as ConvertResult)
    : undefined;
  const levels: NativeMaterialSectionSupplement["levels"] = [];
  const out = audit.map((row) => {
    if (!row.missing.length || !reduced) return { ...row, supplementedOwnerIds: [], uncuttableOwnerIds: [] };
    const want = new Map(row.missing.map((m) => [m.nativeElementId, m]));
    const cut = nativeMeshBarrierCuts(reduced, row.levelId, row.cutElevationFeet).filter((w) => want.has(w.nativeElementId!));
    const byOwner = new Map<number, typeof cut>();
    for (const w of cut) byOwner.set(w.nativeElementId!, [...(byOwner.get(w.nativeElementId!) ?? []), w]);
    const sections = [...byOwner].sort((a, b) => a[0] - b[0]).map(([id, walls]) => {
      const m = want.get(id)!;
      return {
        nativeElementId: id,
        categoryId: m.categoryId,
        kind: walls[0]!.kind === "column" ? ("column" as const) : ("wall" as const),
        baseElevationFeet: m.meshBaseFeet,
        topElevationFeet: m.meshTopFeet,
        partsFeet: walls.map((w) => w.ringsFeet as [number, number][][]),
        provenance: { kind: "production-native-mesh-cutter" as const, reason: m.censusOmission ? ("census-omission" as const) : ("section-omission" as const) },
      };
    });
    if (sections.length) levels.push({ levelId: row.levelId, elevationFeet: row.elevationFeet, cutElevationFeet: row.cutElevationFeet, sections });
    return { ...row, supplementedOwnerIds: sections.map((s) => s.nativeElementId), uncuttableOwnerIds: row.missing.map((m) => m.nativeElementId).filter((id) => !byOwner.has(id)) };
  });
  if (!levels.length) return { audit: out };
  const body = { version: 1 as const, method: NATIVE_MATERIAL_SECTION_SUPPLEMENT_METHOD, sourceModelSha256: material.sourceModelSha256, sourceMaterialGeometrySha256: material.geometrySha256, levels };
  return { supplement: { ...body, geometrySha256: nativeMaterialSectionSupplementHash(body) }, audit: out };
}
