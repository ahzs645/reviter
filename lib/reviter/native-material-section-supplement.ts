/** Derived supplement to the prepared original material sections: production-cutter sections of
 * native barrier owners (walls, curtain panels/mullions, columns) whose retained native-brep mesh
 * crosses a prepared cut but which have NO section row at that level/cut (a census or section
 * omission of the historical extraction). The prepared `nativeMaterialSections` stay byte-identical
 * (their checksum and every binding to it are unchanged); this descriptor is bound to that checksum,
 * carries its own checksum and per-section provenance, and is merged only where material is read
 * (routing/selection material query, envelope supplement barrier). It is never authored: the
 * compiler re-derives it from the model with the unchanged production mesh cutter. */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { NativeMaterialSections } from "./native-material-sections.ts";

type Point = [number, number];
export const NATIVE_MATERIAL_SECTION_SUPPLEMENT_METHOD =
  "production-native-mesh-barrier-cuts-v1" as const;
export type NativeMaterialSectionSupplement = {
  version: 1;
  method: typeof NATIVE_MATERIAL_SECTION_SUPPLEMENT_METHOD;
  sourceModelSha256: string;
  sourceMaterialGeometrySha256: string;
  levels: {
    levelId: number;
    elevationFeet: number;
    cutElevationFeet: number;
    sections: {
      nativeElementId: number;
      categoryId: number;
      kind: "wall" | "column";
      /** Vertical extent of the owner's retained native mesh. */
      baseElevationFeet: number;
      topElevationFeet: number;
      partsFeet: Point[][][];
      provenance: {
        kind: "production-native-mesh-cutter";
        /** census-omission: owner absent from the row's sourceElementIds as well. */
        reason: "census-omission" | "section-omission";
      };
    }[];
  }[];
  geometrySha256: string;
};
export const nativeMaterialSectionSupplementHash = (
  value: Omit<NativeMaterialSectionSupplement, "geometrySha256"> | NativeMaterialSectionSupplement,
) =>
  bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([value.version, value.method, value.sourceModelSha256, value.sourceMaterialGeometrySha256, value.levels]),
      ),
    ),
  );
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const point = (p: unknown) =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7);
export function validateNativeMaterialSectionSupplement(
  value: NativeMaterialSectionSupplement | undefined,
  material: Pick<NativeMaterialSections, "geometrySha256" | "sourceModelSha256" | "levels"> | undefined,
  model?: string,
) {
  if (value === undefined) return;
  if (
    !value ||
    value.version !== 1 ||
    value.method !== NATIVE_MATERIAL_SECTION_SUPPLEMENT_METHOD ||
    !digest(value.sourceModelSha256) ||
    (model !== undefined && value.sourceModelSha256 !== model) ||
    !material ||
    material.sourceModelSha256 !== value.sourceModelSha256 ||
    value.sourceMaterialGeometrySha256 !== material.geometrySha256 ||
    !Array.isArray(value.levels) ||
    value.levels.length > 1000 ||
    value.geometrySha256 !== nativeMaterialSectionSupplementHash(value)
  )
    throw new Error("Native material section supplement is missing, stale or not bound to these original sections.");
  for (const level of value.levels) {
    const row = material.levels.find(
      (l) => l.levelId === level.levelId && l.elevationFeet === level.elevationFeet && l.cutElevationFeet === level.cutElevationFeet,
    );
    const present = new Set(row?.sections.map((s) => s.nativeElementId));
    const ids = level.sections?.map((s) => s.nativeElementId) ?? [];
    if (
      !row ||
      !Array.isArray(level.sections) ||
      !level.sections.length ||
      new Set(ids).size !== ids.length ||
      level.sections.some(
        (s) =>
          !Number.isSafeInteger(s.nativeElementId) ||
          s.nativeElementId <= 0 ||
          present.has(s.nativeElementId) ||
          !Number.isSafeInteger(s.categoryId) ||
          !["wall", "column"].includes(s.kind) ||
          !Number.isFinite(s.baseElevationFeet) ||
          !Number.isFinite(s.topElevationFeet) ||
          !(s.baseElevationFeet < level.cutElevationFeet && level.cutElevationFeet < s.topElevationFeet) ||
          s.provenance?.kind !== "production-native-mesh-cutter" ||
          !["census-omission", "section-omission"].includes(s.provenance.reason) ||
          (s.provenance.reason === "census-omission") !== !row.sourceElementIds?.includes(s.nativeElementId) ||
          !Array.isArray(s.partsFeet) ||
          !s.partsFeet.length ||
          s.partsFeet.some(
            (part) =>
              !Array.isArray(part) || !part.length || part.some((ring) => !Array.isArray(ring) || ring.length < 3 || !ring.every(point)),
          ),
      )
    )
      throw new Error("Invalid native material section supplement row; prepared original sections are never replaced.");
  }
}
/** Supplement sections at one prepared material row (empty when none). */
export function nativeMaterialSectionSupplementAt(
  value: NativeMaterialSectionSupplement | undefined,
  row: { levelId: number; elevationFeet: number; cutElevationFeet: number },
) {
  return (
    value?.levels.find(
      (l) => l.levelId === row.levelId && l.elevationFeet === row.elevationFeet && l.cutElevationFeet === row.cutElevationFeet,
    )?.sections ?? []
  );
}
/** Read-only merged view for material consumers that never verify the original checksum
 * (envelope barrier). Original rows stay first and unchanged; supplement rows are appended. */
export function nativeMaterialSectionsWithSupplement<T extends Pick<NativeMaterialSections, "levels">>(
  material: T,
  value: NativeMaterialSectionSupplement | undefined,
): T {
  if (!value?.levels.length) return material;
  return {
    ...material,
    levels: material.levels.map((row) => {
      const add = nativeMaterialSectionSupplementAt(value, row);
      return add.length ? { ...row, sections: [...row.sections, ...add] } : row;
    }),
  };
}
