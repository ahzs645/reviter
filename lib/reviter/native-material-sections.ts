import {
  validateNativePositiveMaterialBand,
  type NativePositiveMaterialBand,
} from "./native-positive-material-bands";
import {
  validateNativeDoorClearOpeningProfile,
  type NativeDoorClearOpeningProfile,
} from "./native-door-clear-opening";
import {
  validateNativeOriginalMemberSection,
  type NativeOriginalMemberSection,
} from "./native-derived-frame-returns.ts";
/** Independently recovered original native material at a stated horizontal cut.
 * Plan sections and ankle-height sections are distinct; neither is an envelope. */
export type NativeMaterialSections = {
  version: 1;
  sourceModelSha256: string;
  geometrySha256: string;
  levels: {
    levelId: number;
    elevationFeet: number;
    cutElevationFeet: number;
    evidenceSha256: string;
    /** Original owners whose presence/absence was independently checked here. */
    sourceElementIds: number[];
    /** Additive bounded positive subsets; never a complete owner census. */
    originalPositiveMaterialBands?: NativePositiveMaterialBand[];
    originalDoorClearOpeningProfiles?: NativeDoorClearOpeningProfile[];
    originalNativeMemberSections?: NativeOriginalMemberSection[];
    originalNativeHostRelations?: {
      hostNativeElementId: number;
      memberNativeElementIds: number[];
      physicalDoorNativeElementIds: number[];
      evidenceSha256: string;
    }[];
    originalFiniteMaterialSections?: {
      nativeElementId: number;
      baseElevationFeet: number;
      topElevationFeet: number;
      partsFeet: [number, number][][][];
      evidenceSha256: string;
    }[];
    sections: {
      nativeElementId: number;
      categoryId: number;
      /** Original persisted host relations; parent parts are the union of these physical children, excluding door leaves. */
      sourceAssemblyChildIds?: number[];
      originalPhysicalDoorChildIds?: number[];
      sourceNativeHostRelationsVerified?: true;
      kind: "wall" | "window" | "column";
      baseElevationFeet: number;
      topElevationFeet: number;
      partsFeet: [number, number][][][];
    }[];
  }[];
};
const digest = (v: unknown) =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function validateNativeMaterialSections(
  value: NativeMaterialSections | undefined,
  model?: string,
) {
  if (value === undefined) return;
  if (
    !value ||
    value.version !== 1 ||
    !digest(value.sourceModelSha256) ||
    !digest(value.geometrySha256) ||
    (model && model !== value.sourceModelSha256) ||
    !Array.isArray(value.levels) ||
    !value.levels.length ||
    value.levels.length > 1000
  )
    throw new Error("Invalid original native material source binding.");
  const seen = new Set<string>();
  for (const row of value.levels) {
    const id = `${row?.levelId}:${row?.elevationFeet}:${row?.cutElevationFeet}`;
    if (
      !row ||
      !Number.isSafeInteger(row.levelId) ||
      !Number.isFinite(row.elevationFeet) ||
      !Number.isFinite(row.cutElevationFeet) ||
      row.cutElevationFeet <= row.elevationFeet ||
      row.cutElevationFeet > row.elevationFeet + 20 ||
      seen.has(id) ||
      !digest(row.evidenceSha256) ||
      !Array.isArray(row.sourceElementIds) ||
      !row.sourceElementIds.length ||
      row.sourceElementIds.length > 100000 ||
      row.sourceElementIds.some((n) => !Number.isSafeInteger(n) || n <= 0) ||
      new Set(row.sourceElementIds).size !== row.sourceElementIds.length ||
      !Array.isArray(row.sections) ||
      row.sections.length > 100000
    )
      throw new Error("Invalid original native material cut evidence.");
    seen.add(id);
    if (row.originalPositiveMaterialBands !== undefined) {
      if (
        !Array.isArray(row.originalPositiveMaterialBands) ||
        row.originalPositiveMaterialBands.length > 10000
      )
        throw new Error("Invalid additive native material bands.");
      const bands = new Set<string>();
      for (const band of row.originalPositiveMaterialBands) {
        validateNativePositiveMaterialBand(band);
        const key = `${band.nativeElementId}:${band.baseElevationFeet}:${band.topElevationFeet}`;
        if (bands.has(key))
          throw new Error("Duplicate positive native material band.");
        bands.add(key);
      }
    }
    if (row.originalDoorClearOpeningProfiles !== undefined) {
      const profiles = row.originalDoorClearOpeningProfiles;
      if (
        !Array.isArray(profiles) ||
        profiles.length > 100000 ||
        new Set(profiles.map((p) => p.nativeDoorElementId)).size !==
          profiles.length
      )
        throw new Error("Invalid original doorway clear-profile census.");
      for (const p of profiles) {
        validateNativeDoorClearOpeningProfile(p);
        if (
          row.cutElevationFeet < p.sourceBodyBaseFeet ||
          row.cutElevationFeet >= p.sourceBodyTopFeet ||
          !row.originalNativeHostRelations?.some(
            (h) =>
              h.hostNativeElementId === p.hostWallNativeElementId &&
              h.physicalDoorNativeElementIds.includes(p.nativeDoorElementId),
          )
        )
          throw new Error(
            "Original doorway profile has no matching finite source host evidence.",
          );
      }
    }
    if (row.originalNativeMemberSections !== undefined) {
      if (
        !Array.isArray(row.originalNativeMemberSections) ||
        row.originalNativeMemberSections.length > 100000 ||
        new Set(row.originalNativeMemberSections.map((p) => p.nativeElementId))
          .size !== row.originalNativeMemberSections.length
      )
        throw new Error(
          "Invalid independently recovered original member census.",
        );
      for (const p of row.originalNativeMemberSections) {
        validateNativeOriginalMemberSection(p);
        if (!row.sourceElementIds.includes(p.nativeElementId))
          throw new Error(
            "Original member is absent from the source owner census.",
          );
      }
    }
    if (row.originalNativeHostRelations !== undefined) {
      if (
        !Array.isArray(row.originalNativeHostRelations) ||
        row.originalNativeHostRelations.length > 100000 ||
        new Set(
          row.originalNativeHostRelations.map((r) => r.hostNativeElementId),
        ).size !== row.originalNativeHostRelations.length
      )
        throw new Error("Invalid original native host relation census.");
      for (const r of row.originalNativeHostRelations) {
        const ids = (v: number[]) =>
          Array.isArray(v) &&
          v.length < 100000 &&
          v.every(
            (n) =>
              Number.isSafeInteger(n) && n > 0 && n !== r.hostNativeElementId,
          ) &&
          new Set(v).size === v.length;
        if (
          !Number.isSafeInteger(r.hostNativeElementId) ||
          r.hostNativeElementId <= 0 ||
          !ids(r.memberNativeElementIds) ||
          !ids(r.physicalDoorNativeElementIds) ||
          r.memberNativeElementIds.some(
            (n) =>
              !row.sourceElementIds.includes(n) ||
              r.physicalDoorNativeElementIds.includes(n),
          ) ||
          !digest(r.evidenceSha256)
        )
          throw new Error(
            "Invalid persisted original native material/door host relation.",
          );
      }
    }
    if (row.originalFiniteMaterialSections !== undefined) {
      if (
        !Array.isArray(row.originalFiniteMaterialSections) ||
        row.originalFiniteMaterialSections.length > 100000
      )
        throw new Error("Invalid original finite-band material census.");
      for (const q of row.originalFiniteMaterialSections) {
        if (
          !row.sourceElementIds.includes(q.nativeElementId) ||
          !Number.isFinite(q.baseElevationFeet) ||
          !Number.isFinite(q.topElevationFeet) ||
          q.topElevationFeet <= q.baseElevationFeet ||
          !digest(q.evidenceSha256) ||
          !Array.isArray(q.partsFeet) ||
          !q.partsFeet.length ||
          q.partsFeet.some(
            (p) =>
              !Array.isArray(p) ||
              !p.length ||
              p.some(
                (r) =>
                  !Array.isArray(r) ||
                  r.length < 3 ||
                  r.some(
                    (x) =>
                      !Array.isArray(x) ||
                      x.length !== 2 ||
                      x.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e7),
                  ),
              ),
          )
        )
          throw new Error(
            "Invalid independently replayed original finite material band.",
          );
      }
    }
    const owners = new Set(row.sourceElementIds),
      parts = new Set<number>();
    for (const section of row.sections) {
      if (
        !section ||
        !owners.has(section.nativeElementId) ||
        parts.has(section.nativeElementId) ||
        !Number.isSafeInteger(section.categoryId) ||
        !["wall", "window", "column"].includes(section.kind) ||
        !Number.isFinite(section.baseElevationFeet) ||
        !Number.isFinite(section.topElevationFeet) ||
        section.baseElevationFeet > row.cutElevationFeet + 1e-7 ||
        section.topElevationFeet < row.cutElevationFeet - 1e-7 ||
        !Array.isArray(section.partsFeet) ||
        !section.partsFeet.length ||
        section.partsFeet.length > 10000 ||
        section.partsFeet.some(
          (part) =>
            !Array.isArray(part) ||
            !part.length ||
            part.some(
              (ring) =>
                !Array.isArray(ring) ||
                ring.length < 3 ||
                ring.length > 100000 ||
                ring.some(
                  (point) =>
                    !Array.isArray(point) ||
                    point.length !== 2 ||
                    point.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e7),
                ),
            ),
        )
      )
        throw new Error(
          "Invalid original native material footprint or finite body height.",
        );
      const assembly = section.sourceAssemblyChildIds;
      if (
        assembly !== undefined ||
        section.originalPhysicalDoorChildIds !== undefined ||
        section.sourceNativeHostRelationsVerified !== undefined
      ) {
        const ids = (v: unknown): v is number[] =>
          Array.isArray(v) &&
          v.length <= 10000 &&
          v.every(
            (n) =>
              Number.isSafeInteger(n) && n > 0 && n !== section.nativeElementId,
          ) &&
          new Set(v).size === v.length;
        if (
          section.kind !== "wall" ||
          section.sourceNativeHostRelationsVerified !== true ||
          !ids(assembly) ||
          !assembly.length ||
          !ids(section.originalPhysicalDoorChildIds) ||
          assembly.some((n) => !owners.has(n)) ||
          section.originalPhysicalDoorChildIds.some((n) => assembly.includes(n))
        )
          throw new Error("Invalid original native host assembly evidence.");
      }
      parts.add(section.nativeElementId);
    }
  }
}
export async function nativeMaterialSectionsHash(
  value:
    | Omit<NativeMaterialSections, "geometrySha256">
    | NativeMaterialSections,
) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([value.version, value.sourceModelSha256, value.levels]),
  );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyNativeMaterialSections(
  value: NativeMaterialSections | undefined,
  model?: string,
) {
  validateNativeMaterialSections(value, model);
  if (
    value &&
    value.geometrySha256 !== (await nativeMaterialSectionsHash(value))
  )
    throw new Error(
      "Original native material checksum changed; regenerate its source evidence.",
    );
}
/** Call once for each verified immutable calculation, never globally on mutable authoring. */
export function createNativeMaterialSectionIndex(
  value: NativeMaterialSections | undefined,
  model: string,
) {
  validateNativeMaterialSections(value, model);
  return {
    positiveAt: (elevation: number, cut: number, levelId?: number) => [
      ...new Map(
        (
          value?.levels.filter(
            (row) =>
              Math.abs(row.elevationFeet - elevation) < 0.05 &&
              (levelId === undefined || row.levelId === levelId),
          ) ?? []
        )
          .flatMap((row) => row.originalPositiveMaterialBands ?? [])
          .filter((b) => cut >= b.baseElevationFeet && cut < b.topElevationFeet)
          .map((b) => [JSON.stringify(b), b] as const),
      ).values(),
    ],
    at: (elevation: number, cut: number, levelId?: number) =>
      value?.levels.filter(
        (row) =>
          Math.abs(row.elevationFeet - elevation) < 0.05 &&
          Math.abs(row.cutElevationFeet - cut) < 1e-6 &&
          (levelId === undefined || row.levelId === levelId),
      ) ?? [],
  };
}
export type NativeMaterialSectionIndex = ReturnType<
  typeof createNativeMaterialSectionIndex
>;
