import type { IndoorDataset } from "./indoor-contract.ts";
import { indoorExclusionParts } from "./indoor-exclusions.ts";
import {
  freezeNativeRationalParts,
  nativeRationalArea,
  nativeRationalPathSupported,
  nativeRationalPoint,
} from "./native-exact-planar-topology.ts";
import { nativeMaterialPlanExactWalls } from "./native-material-plan.ts";
import { validateNativeMaterialSections } from "./native-material-sections.ts";
import { nativeRationalIntersectionOperand } from "./native-rational-intersection-broadphase.ts";
import {
  Rational,
  nativeRationalOverlay,
  type NativeRationalParts,
  type NativeRationalPoint,
  type NativeRationalOverlayInput,
} from "./native-rational-overlay.ts";
import { createNativeRoutingMaterialQuery } from "./native-routing-material.ts";

import {
  nativeSelectionContactInterval,
  nativeSelectionOriginalFreeCapMask,
} from "./native-selection-contact-repairs.ts";

export type ContactPhysicalEvidence = {
  contactMode?: "finite-cap-overlap" | "original-free-cap";
  sourceModelSha256: string;
  sourceMaterialGeometrySha256: string;
  levelId: number;
  elevationFeet: number;
  source: { nativeElementId: number; capFeet: [number, number][] };
  target: { nativeElementId: number; faceFeet?: [number, number][] };
};
const sub = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => new Rational(a.n * b.n, a.d * b.d);
const add = (a: Rational, b: Rational) =>
  new Rational(a.n * b.d + b.n * a.d, a.d * b.d);
const dot = (a: NativeRationalPoint, b: NativeRationalPoint) =>
  add(mul(a[0], b[0]), mul(a[1], b[1]));
const delta = (
  a: NativeRationalPoint,
  b: NativeRationalPoint,
): NativeRationalPoint => [sub(a[0], b[0]), sub(a[1], b[1])];
const sameAbsolute = (a: Rational, b: Rational) =>
  (a.n < 0n ? -a.n : a.n) * b.d === (b.n < 0n ? -b.n : b.n) * a.d;

/** Fresh operation-local physical snapshot, shared across one immutable repair set.
 * Never retain this factory across import/edit/application or use object identity
 * as a lasting approval. Caller independently verifies material checksums first. */
export function createNativeSelectionContactPhysicalGuard(
  data: IndoorDataset,
  levelId: number,
) {
  const fail = (reason: string): never => {
    throw new Error(`Native selection contact repair: ${reason}.`);
  };
  validateNativeMaterialSections(
    data.nativeMaterialSections,
    data.source.modelSha256,
  );
  const level = data.nativeLevels.find((row) => row.id === levelId);
  if (
    !level ||
    !data.nativeMaterialSections ||
    data.walkingSupport?.sourceModelSha256 !== data.source.modelSha256
  )
    fail("stale model, material, level or original floor binding");
  const model = data.source.modelSha256,
    materialSha = data.nativeMaterialSections!.geometrySha256,
    elevation = level!.elevationFeet;
  const exact = (parts: NativeRationalOverlayInput): NativeRationalParts =>
    freezeNativeRationalParts(
      parts.map((part) => part.map((ring) => ring.map(nativeRationalPoint))),
    );
  const floors = exact(
    data
      .walkingSupport!.floors.filter((f) => f.elevationFeet === elevation)
      .flatMap((f) => f.partsFeet ?? [f.ringsFeet]),
  );
  const holes = freezeNativeRationalParts(
    floors.flatMap((part) => part.slice(1).map((ring) => [ring])),
  );
  const exactWalls = nativeMaterialPlanExactWalls(
    data,
    levelId,
    createNativeRoutingMaterialQuery(data),
  );
  const originalByOwner = new Map<number, NativeRationalParts>();
  for (const wall of exactWalls) {
    freezeNativeRationalParts(wall.exactParts);
    if (wall.kind === "wall" && !wall.approximate && !wall.reviewPatchId)
      originalByOwner.set(wall.nativeElementId, [
        ...(originalByOwner.get(wall.nativeElementId) ?? []),
        ...wall.exactParts,
      ]);
  }
  for (const parts of originalByOwner.values())
    freezeNativeRationalParts(parts);
  const sameHeightLevelIds = new Set(
    data.nativeLevels
      .filter((row) => row.elevationFeet === elevation)
      .map((row) => row.id),
  );
  const doors = exact(
    (data.doors ?? [])
      .filter((d) => sameHeightLevelIds.has(d.levelId) && d.footprintFeet)
      .map((d) => [d.footprintFeet!]),
  );
  if (
    data.circulationGeometry?.fixtures?.length &&
    data.circulationGeometry.sourceModelSha256 !== model
  )
    fail("stale original fixture binding");
  const fixtures = exact(
    (data.circulationGeometry?.fixtures ?? [])
      .filter(
        (f) =>
          f.levelIds.some((id) => sameHeightLevelIds.has(id)) ||
          f.elevationFeet === elevation,
      )
      .map((f) => f.ringsFeet),
  );
  const exclusions = exact(indoorExclusionParts(data, elevation));
  const openings = exact(
    data.records
      .filter((row) => sameHeightLevelIds.has(row.levelId))
      .flatMap((row) =>
        ((row.properties.floorOpeningsFeet ?? []) as [number, number][][]).map(
          (ring) => [ring],
        ),
      ),
  );
  let floorWithoutOpenings: NativeRationalParts | undefined;
  return (repair: ContactPhysicalEvidence, mask: NativeRationalParts): void => {
    if (
      repair.sourceModelSha256 !== model ||
      data.source.modelSha256 !== model ||
      repair.sourceMaterialGeometrySha256 !== materialSha ||
      data.nativeMaterialSections?.geometrySha256 !== materialSha ||
      repair.levelId !== levelId ||
      repair.elevationFeet !== elevation ||
      data.nativeLevels.find((row) => row.id === levelId)?.elevationFeet !==
        elevation
    )
      fail("stale model, material, level or original floor binding");
    if (mask.length === 0 || nativeRationalArea(mask).n <= 0n)
      fail("no positive exact gap mask");
    const intersects = (operand: NativeRationalOverlayInput) => {
      const local = nativeRationalIntersectionOperand(mask, operand);
      return (
        local.length > 0 &&
        nativeRationalOverlay("intersection", mask, local).length > 0
      );
    };
    const localFloors = nativeRationalIntersectionOperand(mask, floors);
    if (
      localFloors.length === 0 ||
      nativeRationalOverlay("difference", mask, localFloors).length > 0
    )
      fail("positive gap crosses unsupported original same-height floor");
    // Any original aperture remains protected even when another slab overlaps it.
    if (intersects(holes))
      fail("positive gap intersects an original floor opening");
    const sourceParts =
        originalByOwner.get(repair.source.nativeElementId) ?? [],
      targetParts = originalByOwner.get(repair.target.nativeElementId) ?? [];
    if (
      sourceParts.length === 0 ||
      targetParts.length === 0 ||
      repair.source.nativeElementId === repair.target.nativeElementId ||
      repair.source.capFeet.length !== 2 ||
      !nativeRationalPathSupported(repair.source.capFeet, sourceParts)
    )
      fail(
        "full source cap no longer contacts current retained original material",
      );
    if (intersects(sourceParts) || intersects(targetParts))
      fail("gap mask adds overlap inside an original support");
    if (repair.contactMode === "original-free-cap") {
      floorWithoutOpenings ??= freezeNativeRationalParts(
        nativeRationalOverlay("difference", floors, holes),
      );
      if (
        !nativeRationalPathSupported(
          repair.source.capFeet,
          floorWithoutOpenings,
        )
      )
        fail(
          "entire original free cap lacks original floor or crosses an opening",
        );
      if (!repair.target.faceFeet)
        fail("original free cap lacks the original named target edge");
      const authoritative = nativeSelectionOriginalFreeCapMask(
        sourceParts,
        targetParts,
        repair.source.capFeet,
        repair.target.faceFeet!,
      );
      if (
        nativeRationalOverlay("difference", mask, authoritative).length > 0 ||
        nativeRationalOverlay("difference", authoritative, mask).length > 0
      )
        fail(
          "free cap mask differs from exact original first-material intervals",
        );
    } else {
      const interval = nativeSelectionContactInterval(repair);
      if (repair.contactMode === "finite-cap-overlap") {
        const fullCap = repair.source.capFeet.map(nativeRationalPoint);
        floorWithoutOpenings ??= freezeNativeRationalParts(
          nativeRationalOverlay("difference", floors, holes),
        );
        if (!nativeRationalPathSupported(fullCap, floorWithoutOpenings))
          fail(
            "entire original source cap lacks original floor or crosses an opening",
          );
        if (
          !nativeRationalPathSupported(interval.sourceContact, sourceParts) ||
          !nativeRationalPathSupported(
            repair.target.faceFeet!.map(nativeRationalPoint),
            targetParts,
          )
        )
          fail(
            "finite contact evidence no longer reaches retained original material",
          );
        const equal = (a: NativeRationalPoint, b: NativeRationalPoint) =>
          a[0].n * b[0].d === b[0].n * a[0].d &&
          a[1].n * b[1].d === b[1].n * a[1].d;
        if (
          !mask.some((part) =>
            part[0].some((p, i) => {
              const q = part[0][(i + 1) % part[0].length],
                [a, b] = interval.sourceContact;
              return (
                (equal(p, a) && equal(q, b)) || (equal(p, b) && equal(q, a))
              );
            }),
          )
        )
          fail("complete finite source interval is not a mask contact");
      }
      const cap = repair.source.capFeet.map(nativeRationalPoint),
        capDirection = delta(cap[1], cap[0]),
        capWidthSquared = dot(capDirection, capDirection);
      if (!capWidthSquared.n) fail("degenerate source cap");
      const fullTargetContact = mask.some((part) =>
        part[0].some((point, index) => {
          const next = part[0][(index + 1) % part[0].length];
          return (
            sameAbsolute(
              dot(delta(next, point), capDirection),
              interval.projectedSpan,
            ) && nativeRationalPathSupported([point, next], targetParts)
          );
        }),
      );
      if (!fullTargetContact)
        fail(
          "complete target contact no longer reaches current retained original material",
        );
    }
    for (const wall of exactWalls) {
      if (
        !wall.reviewPatchId &&
        (wall.nativeElementId === repair.source.nativeElementId ||
          wall.nativeElementId === repair.target.nativeElementId)
      )
        continue;
      if (intersects(wall.exactParts))
        fail("positive gap intersects a foreign wall or column");
    }
    if (intersects(doors)) fail("positive gap intersects a physical doorway");
    if (intersects(fixtures))
      fail("positive gap intersects a physical fixture");
    if (intersects(exclusions))
      fail("positive gap intersects a reviewed excluded footprint");
    if (intersects(openings))
      fail("positive gap intersects a source floor or stair opening");
  };
}

/** Exact physical vetoes for one separately derived, positive gap-only mask.
 * No buffering, area epsilon, raw coordinate edit, route or access approval. */
export function assertNativeSelectionContactPhysicalGuards(
  data: IndoorDataset,
  repair: ContactPhysicalEvidence,
  mask: NativeRationalParts,
): void {
  createNativeSelectionContactPhysicalGuard(data, repair.levelId)(repair, mask);
}
/** Batched checks share only a fresh calculation's original physical snapshot.
 * All masks must pass before application; no persistent identity trust/cache. */
export function assertNativeSelectionContactRepairsPhysicalGuards(
  data: IndoorDataset,
  repairs: readonly ContactPhysicalEvidence[],
  masks: readonly NativeRationalParts[],
): void {
  if (repairs.length !== masks.length)
    throw new Error(
      "Native selection contact repair: mismatched physical check inventory.",
    );
  const guards = new Map<
    number,
    ReturnType<typeof createNativeSelectionContactPhysicalGuard>
  >();
  for (const [i, repair] of repairs.entries()) {
    let guard = guards.get(repair.levelId);
    if (!guard) {
      guard = createNativeSelectionContactPhysicalGuard(data, repair.levelId);
      guards.set(repair.levelId, guard);
    }
    guard(repair, masks[i]);
  }
}
