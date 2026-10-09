import { nativePositiveMaterialBandPartsAt } from "./native-positive-material-bands.ts";
import {
  createNativeProvisionalCornerSealIndex,
  type NativeProvisionalCornerSeals,
} from "./native-provisional-corner-seals.ts";
import {
  createNativeDerivedFrameReturnIndex,
  type NativeDerivedFrameReturns,
} from "./native-derived-frame-returns.ts";
import {
  createNativeMaterialSectionIndex,
  type NativeMaterialSections,
} from "./native-material-sections.ts";
import {
  nativeMaterialSectionSupplementAt,
  validateNativeMaterialSectionSupplement,
  type NativeMaterialSectionSupplement,
} from "./native-material-section-supplement.ts";
import pc from "polygon-clipping";
type Point = [number, number];
type Data = {
  source: { modelSha256: string };
  nativeDerivedFrameReturns?: NativeDerivedFrameReturns;
  nativeProvisionalCornerSeals?: NativeProvisionalCornerSeals;
  nativeIndoorEnvelopes?: Parameters<
    typeof createNativeProvisionalCornerSealIndex
  >[0]["nativeIndoorEnvelopes"];
  doors?: Parameters<typeof createNativeProvisionalCornerSealIndex>[0]["doors"];
  edges?: Parameters<typeof createNativeProvisionalCornerSealIndex>[0]["edges"];
  walkingSupport?: Parameters<
    typeof createNativeDerivedFrameReturnIndex
  >[0]["walkingSupport"];
  nativeMaterialSections?: NativeMaterialSections;
  nativeMaterialSectionSupplement?: NativeMaterialSectionSupplement;
  nativeWallPositionRepairs?: {
    sourceModelSha256: string;
    walls: {
      nativeElementId: number;
      originalRingsFeet: Point[][];
      ringsFeet: Point[][];
    }[];
  };
};
/** Original cuts plus already validated rigid placement repairs. Source material
 * IDs with no ankle section are known absent; unknown IDs retain old vetoes. */
export function createNativeRoutingMaterialQuery(data: Data) {
  const provisional = createNativeProvisionalCornerSealIndex(
    data as Parameters<typeof createNativeProvisionalCornerSealIndex>[0],
  );
  const derived = data.nativeDerivedFrameReturns
    ? createNativeDerivedFrameReturnIndex(
        data as Parameters<typeof createNativeDerivedFrameReturnIndex>[0],
      )
    : undefined;
  const index = createNativeMaterialSectionIndex(
      data.nativeMaterialSections,
      data.source.modelSha256,
    ),
    supplement = data.nativeMaterialSectionSupplement,
    cache = new Map<
      string,
      {
        known: Set<number>;
        present: Set<number>;
        parts: {
          nativeElementId: number;
          column: boolean;
          rings: Point[][];
          positiveSubsetOnly?: true;
        }[];
        assemblies: Map<number, { childIds: number[]; doorIds: number[] }>;
        derivedParts?: Point[][][];
      }
    >();
  // Derived production-cutter sections of owners the prepared rows omitted; bound to the
  // original checksum, appended after original rows, never replacing an original owner.
  validateNativeMaterialSectionSupplement(supplement, data.nativeMaterialSections, data.source.modelSha256);
  const repairs = new Map(
    data.nativeWallPositionRepairs?.sourceModelSha256 ===
    data.source.modelSha256
      ? data.nativeWallPositionRepairs.walls.map((r) => [r.nativeElementId, r])
      : [],
  );
  return (z: number, cut = z + 0.1) => {
    const key = JSON.stringify([z, cut]);
    const previous = cache.get(key);
    if (previous) return previous;
    const rows = index.at(z, cut),
      sections = [
        ...(() => {
          const byOwner = new Map(
            rows
              .flatMap((row) => row.sections)
              .map((section) => [section.nativeElementId, section] as const),
          );
          for (const row of rows)
            for (const added of nativeMaterialSectionSupplementAt(supplement, row))
              if (!byOwner.has(added.nativeElementId))
                byOwner.set(added.nativeElementId, added as unknown as (typeof row.sections)[number]);
          return byOwner;
        })().values(),
      ];
    const parts: {
      nativeElementId: number;
      column: boolean;
      rings: Point[][];
      positiveSubsetOnly?: true;
    }[] = sections.flatMap((section) => {
      const repair = repairs.get(section.nativeElementId),
        original = repair?.originalRingsFeet[0]?.[0],
        target = repair?.ringsFeet[0]?.[0];
      const dx = original && target ? target[0] - original[0] : 0,
        dy = original && target ? target[1] - original[1] : 0;
      return section.partsFeet.map((part) => ({
        nativeElementId: section.nativeElementId,
        column: section.kind === "column",
        rings:
          dx || dy
            ? part.map((ring) =>
                ring.map((p) => [p[0] + dx, p[1] + dy] as Point),
              )
            : part,
      }));
    });
    // Additive positive evidence cannot evaluate an owner as absent or replace
    // its complete conservative mask. Apply the same validated rigid placement.
    const positiveParts = index.positiveAt(z, cut).flatMap((band) => {
      const repair = repairs.get(band.nativeElementId),
        original = repair?.originalRingsFeet[0]?.[0],
        target = repair?.ringsFeet[0]?.[0];
      const dx = original && target ? target[0] - original[0] : 0,
        dy = original && target ? target[1] - original[1] : 0;
      return nativePositiveMaterialBandPartsAt(band, cut).map((part) => ({
        nativeElementId: band.nativeElementId,
        column: band.kind === "column",
        positiveSubsetOnly: true as const,
        rings:
          dx || dy
            ? part.map((r) => r.map((p) => [p[0] + dx, p[1] + dy] as Point))
            : part,
      }));
    });
    const value = {
      known: new Set([
        ...rows.flatMap((row) => row.sourceElementIds),
        ...rows.flatMap((row) => nativeMaterialSectionSupplementAt(supplement, row).map((s) => s.nativeElementId)),
      ]),
      present: new Set(sections.map((s) => s.nativeElementId)),
      parts: [...parts, ...positiveParts],
      ...(derived || provisional.rows.length
        ? {
            derivedParts: [
              ...(derived?.partsAt(cut) ?? []),
              ...provisional.partsAt(cut),
            ].map((p) => [p.outer, ...p.holes]),
          }
        : {}),
      assemblies: new Map(
        sections.flatMap((section) =>
          section.sourceNativeHostRelationsVerified &&
          section.sourceAssemblyChildIds &&
          section.originalPhysicalDoorChildIds
            ? [
                [
                  section.nativeElementId,
                  {
                    childIds: section.sourceAssemblyChildIds,
                    doorIds: section.originalPhysicalDoorChildIds,
                  },
                ] as const,
              ]
            : [],
        ),
      ),
    };
    // Current source levels use only a few cuts; keep arbitrary queried heights
    // bounded as well, within this one immutable calculation.
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, value);
    return value;
  };
}

export type NativeRoutingMaterial = ReturnType<
  ReturnType<typeof createNativeRoutingMaterialQuery>
>;
/** An exact door aperture belongs to its original host. A recovered physical
 * child additionally needs persisted host/door membership and current material
 * entirely inside that source host union. No foreign wall or column is exempt. */
export function createNativeHostApertureQuery(material: NativeRoutingMaterial) {
  const parts = new Map<number, Point[][][]>();
  for (const part of material.parts)
    if (!part.column) {
      const rows = parts.get(part.nativeElementId) ?? [];
      rows.push(part.rings);
      parts.set(part.nativeElementId, rows);
    }
  const checked = new Map<string, boolean>();
  return (
    hostId: number | undefined,
    doorId: number | undefined,
    ownerId: number,
  ) => {
    if (!hostId || !doorId) return false;
    if (ownerId === hostId) return true;
    const assembly = material.assemblies.get(hostId);
    if (
      !assembly?.doorIds.includes(doorId) ||
      !assembly.childIds.includes(ownerId)
    )
      return false;
    const key = `${hostId}:${ownerId}`;
    if (checked.has(key)) return checked.get(key)!;
    let supported = false;
    const parent = parts.get(hostId),
      child = parts.get(ownerId);
    try {
      if (parent?.length && child?.length) {
        const outside = pc.difference(child, parent);
        const area = outside.reduce(
          (s, rs) =>
            s +
            rs.reduce(
              (v, r, i) =>
                v +
                ((i ? -1 : 1) *
                  Math.abs(
                    r.reduce((a, p, j) => {
                      const q = r[(j + 1) % r.length]!;
                      return a + p[0] * q[1] - q[0] * p[1];
                    }, 0),
                  )) /
                  2,
              0,
            ),
          0,
        );
        // Source union contacts differ only at machine overlay precision. This
        // does not enlarge the parent, child, or exact door aperture.
        supported = area <= 1e-10;
      }
    } catch {
      /* Unclassifiable material cannot gain an aperture exemption. */
    }
    checked.set(key, supported);
    return supported;
  };
}
