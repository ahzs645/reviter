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
  nativeSelectionOriginalSimpleTerminalCapMask,
} from "./native-selection-contact-repairs.ts";

export type ContactPhysicalEvidence = {
  contactMode?:
    | "finite-cap-overlap"
    | "original-free-cap"
    | "original-simple-terminal-cap";
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

/** An applied drawing-backed row that closes the same joint as a contact repair. */
export type NativeSelectionContactDuplicateClosure = {
  repairId: string;
  rowId: string;
  /** The closure of record for the joint: the repair's exact original-edge gap
   * mask. The row is a duplicate closure there, never foreign material. */
  closure: "contact-repair";
};
type ClosureRow = {
  id: string;
  levelId: number;
  state: string;
  baseElevationFeet: number;
  topElevationFeet: number;
  drawingBacked?: { nativeOwnerIds: number[] };
};
/** Plan cut of the exact material the contact guard reads at a level. */
const contactCutOffsetFeet = 4;
/** Joint identity of a drawing-backed closure and a contact repair: the row is
 * material at the repair level's plan cut (its height band covers the cut,
 * whichever level authored it) and both repair owners are among the row's
 * owners. Position is the third test, decided by the caller: the row body
 * meets the repair's gap mask. */
export function nativeSelectionContactSameJoint(
  repair: Pick<
    ContactPhysicalEvidence,
    "levelId" | "elevationFeet" | "source" | "target"
  >,
  row: ClosureRow | undefined,
  cutElevationFeet = repair.elevationFeet + contactCutOffsetFeet,
): boolean {
  return (
    !!row &&
    row.state === "applied" &&
    !!row.drawingBacked &&
    row.baseElevationFeet <= cutElevationFeet &&
    row.topElevationFeet > cutElevationFeet &&
    repair.source.nativeElementId !== repair.target.nativeElementId &&
    row.drawingBacked.nativeOwnerIds.includes(repair.source.nativeElementId) &&
    row.drawingBacked.nativeOwnerIds.includes(repair.target.nativeElementId)
  );
}

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
  const cut = elevation + contactCutOffsetFeet;
  const exactWalls = nativeMaterialPlanExactWalls(
    data,
    levelId,
    createNativeRoutingMaterialQuery(data),
    cut,
  );
  const originalByOwner = new Map<number, NativeRationalParts>();
  const simpleOriginalByOwner = new Map<number, NativeRationalParts>();
  for (const wall of exactWalls) {
    freezeNativeRationalParts(wall.exactParts);
    if (
      wall.kind === "wall" &&
      !wall.approximate &&
      !wall.reviewPatchId &&
      (wall as typeof wall & { geometrySource?: string }).geometrySource ===
        "original-native-material-section"
    )
      simpleOriginalByOwner.set(wall.nativeElementId, [
        ...(simpleOriginalByOwner.get(wall.nativeElementId) ?? []),
        ...wall.exactParts,
      ]);
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
  let floorWithoutSourceOpenings: NativeRationalParts | undefined;
  const closureRows = new Map<string, ClosureRow>(
    (data.nativeProvisionalCornerSeals?.rows ?? []).map((r) => [r.id, r]),
  );
  /** Returns the ids of applied drawing-backed rows that close this same joint. */
  return (
    repair: ContactPhysicalEvidence,
    mask: NativeRationalParts,
  ): string[] => {
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
    if (
      repair.contactMode === "original-free-cap" ||
      repair.contactMode === "original-simple-terminal-cap"
    ) {
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
      if (repair.contactMode === "original-simple-terminal-cap") {
        floorWithoutSourceOpenings ??= freezeNativeRationalParts(
          nativeRationalOverlay("difference", floorWithoutOpenings, openings),
        );
        if (
          !nativeRationalPathSupported(
            repair.source.capFeet,
            floorWithoutSourceOpenings,
          )
        )
          fail(
            "entire original simple terminal cap crosses a source floor or stair opening",
          );
      }
      if (!repair.target.faceFeet)
        fail("original free cap lacks the original named target edge");
      const authoritative = (
        repair.contactMode === "original-simple-terminal-cap"
          ? nativeSelectionOriginalSimpleTerminalCapMask
          : nativeSelectionOriginalFreeCapMask
      )(
        repair.contactMode === "original-simple-terminal-cap"
          ? (simpleOriginalByOwner.get(repair.source.nativeElementId) ?? [])
          : sourceParts,
        repair.contactMode === "original-simple-terminal-cap"
          ? (simpleOriginalByOwner.get(repair.target.nativeElementId) ?? [])
          : targetParts,
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
    const duplicates = new Set<string>();
    for (const wall of exactWalls) {
      if (
        !wall.reviewPatchId &&
        (wall.nativeElementId === repair.source.nativeElementId ||
          wall.nativeElementId === repair.target.nativeElementId)
      )
        continue;
      if (!intersects(wall.exactParts)) continue;
      // An applied drawing-backed row that closes this same joint (same
      // owners, body inside the gap) is a second closure of the gap, not
      // foreign material in it. Every other body is still foreign.
      if (
        (wall as typeof wall & { geometrySource?: string }).geometrySource ===
          "provisional-native-corner-seal" &&
        nativeSelectionContactSameJoint(
          repair,
          closureRows.get(wall.reviewPatchId ?? ""),
          cut,
        )
      ) {
        duplicates.add(wall.reviewPatchId!);
        continue;
      }
      fail("positive gap intersects a foreign wall or column");
    }
    if (intersects(doors)) fail("positive gap intersects a physical doorway");
    if (intersects(fixtures))
      fail("positive gap intersects a physical fixture");
    if (intersects(exclusions))
      fail("positive gap intersects a reviewed excluded footprint");
    if (intersects(openings))
      fail("positive gap intersects a source floor or stair opening");
    return [...duplicates].sort();
  };
}

/** Exact physical vetoes for one separately derived, positive gap-only mask.
 * No buffering, area epsilon, raw coordinate edit, route or access approval. */
export function assertNativeSelectionContactPhysicalGuards(
  data: IndoorDataset,
  repair: ContactPhysicalEvidence & { id?: string },
  mask: NativeRationalParts,
): NativeSelectionContactDuplicateClosure[] {
  return createNativeSelectionContactPhysicalGuard(data, repair.levelId)(
    repair,
    mask,
  ).map((rowId) => ({
    repairId: repair.id ?? "",
    rowId,
    closure: "contact-repair",
  }));
}
/** Batched checks share only a fresh calculation's original physical snapshot.
 * All masks must pass before application; no persistent identity trust/cache.
 * Returns every joint closed by both a repair and an applied drawing-backed row,
 * with the closure of record for it. */
export function assertNativeSelectionContactRepairsPhysicalGuards(
  data: IndoorDataset,
  repairs: readonly (ContactPhysicalEvidence & { id?: string })[],
  masks: readonly NativeRationalParts[],
): NativeSelectionContactDuplicateClosure[] {
  if (repairs.length !== masks.length)
    throw new Error(
      "Native selection contact repair: mismatched physical check inventory.",
    );
  const guards = new Map<
    number,
    ReturnType<typeof createNativeSelectionContactPhysicalGuard>
  >();
  const duplicates: NativeSelectionContactDuplicateClosure[] = [];
  for (const [i, repair] of repairs.entries()) {
    let guard = guards.get(repair.levelId);
    if (!guard) {
      guard = createNativeSelectionContactPhysicalGuard(data, repair.levelId);
      guards.set(repair.levelId, guard);
    }
    for (const rowId of guard(repair, masks[i]))
      duplicates.push({
        repairId: repair.id ?? "",
        rowId,
        closure: "contact-repair",
      });
  }
  return duplicates;
}
