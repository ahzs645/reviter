import {nativeRationalOverlay} from './native-rational-overlay.ts';
import { nativeAuthoredStairTreads, type NativeAuthoredStairTreadRoles } from "./native-authored-stair-treads.ts";
import {
  nativeWallPositionMaterialBinding,
  type NativeWallPositionRepairs,
} from "./native-wall-position-repairs.ts";
import pc from "polygon-clipping";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  nativeSourceStairBodyHash,
  type NativeSourceStairBody,
} from "./native-source-stair-body.ts";
type P3 = [number, number, number];
type Rings = [number, number][][];
export type NativeSourceStairMaterial = {
  version: 1;
  sourceModelSha256: string;
  geometrySha256: string;
  evidenceSha256: string;
  sourceWallPositionRepairsSha256: string;
  nativeStairId: number;
  widthFeet: 2;
  pointsFeet: P3[];
  sourceElementIds: number[];
  bands: {
    segmentIndex: number;
    minimumElevationFeet: number;
    maximumElevationFeet: number;
    unclassifiedSourceElementIds: number[];
    sections: { nativeElementId: number; partsFeet: Rings[] }[];
  }[];
};
export type NativeSourceStairMaterials = {
  version: 1;
  sourceModelSha256: string;
  flights: NativeSourceStairMaterial[];
  walkingBodies?: NativeSourceStairBody[];
  authoredTreadRoles?: NativeAuthoredStairTreadRoles;
};
/** Portable source facts may contain unresolved overlaps. Validation checks
 * provenance/shape; actual acceptance still needs both full body and clearance. */
export function validateNativeSourceStairMaterials(
  value: NativeSourceStairMaterials | undefined,
  model?: string,
): void {
  if (value === undefined) return;
  const fail = () => {
    throw new Error("Invalid original native stair source material evidence.");
  };
  if (
    !value ||
    value.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(value.sourceModelSha256) ||
    (model && value.sourceModelSha256 !== model) ||
    !Array.isArray(value.flights) ||
    value.flights.length > 1000 ||
    new Set(value.flights.map((f) => f.nativeStairId)).size !==
      value.flights.length
  )
    fail();
  nativeAuthoredStairTreads(value.authoredTreadRoles, value.sourceModelSha256);
  for (const flight of value.flights) {
    const copy = structuredClone(flight);
    if (
      copy.geometrySha256 !== nativeSourceStairMaterialHash(copy) ||
      copy.sourceModelSha256 !== value.sourceModelSha256 ||
      !Array.isArray(copy.bands)
    )
      fail();
    for (const band of copy.bands) {
      if (
        !Array.isArray(band.unclassifiedSourceElementIds) ||
        band.unclassifiedSourceElementIds.some(
          (id) =>
            !Number.isSafeInteger(id) || !copy.sourceElementIds.includes(id),
        ) ||
        !Array.isArray(band.sections) ||
        band.sections.some(
          (s) =>
            !copy.sourceElementIds.includes(s.nativeElementId) ||
            !Array.isArray(s.partsFeet) ||
            !s.partsFeet.length ||
            s.partsFeet.some(
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
                        x.some((v) => !Number.isFinite(v)),
                    ),
                ),
            ),
        )
      )
        fail();
      band.sections = [];
      band.unclassifiedSourceElementIds = [];
    }
    copy.sourceWallPositionRepairsSha256 =
      nativeSourceStairPlacementHash(undefined);
    copy.geometrySha256 = nativeSourceStairMaterialHash(copy);
    if (
      !validNativeSourceStairMaterial(
        copy,
        value.sourceModelSha256,
        copy.nativeStairId,
        copy.pointsFeet,
      )
    )
      fail();
  }
  if (
    value.walkingBodies !== undefined &&
    (!Array.isArray(value.walkingBodies) ||
      value.walkingBodies.length > 1000 ||
      new Set(value.walkingBodies.map((b) => b.nativeStairId)).size !==
        value.walkingBodies.length)
  )
    fail();
  const ring = (value: unknown): boolean =>
    Array.isArray(value) &&
    value.length >= 3 &&
    value.length <= 100000 &&
    value.every(
      (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
    );
  for (const body of value.walkingBodies ?? []) {
    if (
      body.version !== 1 ||
      !Number.isSafeInteger(body.nativeStairId) ||
      body.nativeStairId <= 0 ||
      !/^[a-f0-9]{64}$/.test(body.evidenceSha256) ||
      body.sourceModelSha256 !== value.sourceModelSha256 ||
      body.geometrySha256 !== nativeSourceStairBodyHash(body) ||
      body.completeOriginalBody !== true ||
      !Array.isArray(body.nativeRunIds) ||
      !body.nativeRunIds.length ||
      new Set(body.nativeRunIds).size !== body.nativeRunIds.length ||
      body.nativeRunIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      !Array.isArray(body.unclassifiedSourceElementIds) ||
      body.unclassifiedSourceElementIds.length ||
      !Array.isArray(body.treads) ||
      !body.treads.length ||
      body.treads.length > 100000 ||
      body.treads.some(
        (t) =>
          !body.nativeRunIds.includes(t.runElementId) ||
          !Number.isFinite(t.elevationFeet) ||
          !ring(t.ringFeet),
      ) ||
      !Array.isArray(body.landings) ||
      body.landings.length > 100000 ||
      body.landings.some(
        (l) =>
          !Number.isSafeInteger(l.nativeElementId) ||
          l.nativeElementId <= 0 ||
          !Number.isFinite(l.elevationFeet) ||
          !Array.isArray(l.ringsFeet) ||
          !l.ringsFeet.length ||
          l.ringsFeet.some((r) => !ring(r)),
      )
    )
      fail();
  }
}
export function nativeSourceStairPlacementHash(value: unknown, derivedFrameReturns?: unknown, provisionalCornerSeals?: unknown): string {
  const oldBinding=derivedFrameReturns===undefined ? (nativeWallPositionMaterialBinding(value as NativeWallPositionRepairs | undefined)??null) : ["native-derived-frame-returns-v1",nativeWallPositionMaterialBinding(value as NativeWallPositionRepairs | undefined)??null,derivedFrameReturns];
  if(provisionalCornerSeals!==undefined)return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(["native-provisional-corner-seals-v1",oldBinding,provisionalCornerSeals]))));
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify(
          derivedFrameReturns === undefined
            ? (nativeWallPositionMaterialBinding(value as NativeWallPositionRepairs | undefined) ?? null)
            : ["native-derived-frame-returns-v1", nativeWallPositionMaterialBinding(value as NativeWallPositionRepairs | undefined) ?? null, derivedFrameReturns],
        ),
      ),
    ),
  );
}
export function nativeSourceStairMaterialHash(
  value:
    | Omit<NativeSourceStairMaterial, "geometrySha256">
    | NativeSourceStairMaterial,
): string {
  const { geometrySha256: _, ...raw } = value as NativeSourceStairMaterial;
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(raw))));
}
const area = (parts: pc.MultiPolygon) =>
  parts.reduce(
    (sum, p) =>
      sum +
      p.reduce(
        (v, r, i) =>
          v +
          (i ? -1 : 1) *
            Math.abs(
              r.reduce((a, x, j) => {
                const y = r[(j + 1) % r.length]!;
                return a + x[0] * y[1] - y[0] * x[1];
              }, 0) / 2,
            ),
        0,
      ),
    0,
  );
/** A complete original-owner census and full-height-band projection can prove
 * absence of collision. An overlapping or unclassified original body cannot. */
export function validNativeSourceStairMaterial(
  value: NativeSourceStairMaterial | undefined,
  model: string,
  nativeStairId: number,
  points: P3[],
  wallPositionRepairs?: unknown,
  derivedFrameReturns?: unknown,
  provisionalCornerSeals?: unknown,
  exactNative = false,
): boolean {
  try {
    if (
      !value ||
      value.version !== 1 ||
      value.sourceModelSha256 !== model ||
      value.nativeStairId !== nativeStairId ||
      value.widthFeet !== 2 ||
      !/^[a-f0-9]{64}$/.test(value.evidenceSha256) ||
      value.sourceWallPositionRepairsSha256 !==
        nativeSourceStairPlacementHash(wallPositionRepairs, derivedFrameReturns, provisionalCornerSeals) ||
      value.geometrySha256 !== nativeSourceStairMaterialHash(value) ||
      JSON.stringify(value.pointsFeet) !== JSON.stringify(points) ||
      !Array.isArray(value.sourceElementIds) ||
      value.sourceElementIds.length > 100000 ||
      new Set(value.sourceElementIds).size !== value.sourceElementIds.length ||
      value.sourceElementIds.some(
        (id) => !Number.isSafeInteger(id) || id <= 0 || id === nativeStairId,
      ) ||
      !Array.isArray(value.bands) ||
      value.bands.length !== points.length - 1
    )
      return false;
    const census = new Set(value.sourceElementIds);
    for (let i = 0; i < value.bands.length; i++) {
      const band = value.bands[i]!,
        a = points[i]!,
        b = points[i + 1]!,
        dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy);
      if (
        band.segmentIndex !== i ||
        band.minimumElevationFeet !== Math.min(a[2], b[2]) ||
        band.maximumElevationFeet !== Math.max(a[2], b[2]) + 0.1 ||
        length < 1e-8 ||
        !Array.isArray(band.unclassifiedSourceElementIds) ||
        band.unclassifiedSourceElementIds.length ||
        !Array.isArray(band.sections) ||
        band.sections.length > 100000 ||
        new Set(band.sections.map((s) => s.nativeElementId)).size !==
          band.sections.length
      )
        return false;
      const nx = -dy / length,
        ny = dx / length,
        strip: pc.Polygon = [
          [
            [a[0] + nx, a[1] + ny],
            [b[0] + nx, b[1] + ny],
            [b[0] - nx, b[1] - ny],
            [a[0] - nx, a[1] - ny],
          ],
        ];
      for (const section of band.sections) {
        if (
          !census.has(section.nativeElementId) ||
          !Array.isArray(section.partsFeet) ||
          !section.partsFeet.length ||
          section.partsFeet.some(
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
                      x.some((v) => !Number.isFinite(v)),
                  ),
              ),
          )
        )
          return false;
        if (exactNative ? nativeRationalOverlay("intersection", [strip] as [number,number][][][], section.partsFeet).length > 0 : area(pc.intersection(strip, section.partsFeet)) > 1e-10)
          return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Only actual authored physical tread provenance is needed outside authoring.
 * Proposed foreign/body inventories remain in the master; accepted flight
 * receipts already carry their own complete runtime body/clearance evidence. */
export function nativeSourceStairPhysicalEvidence(value: NativeSourceStairMaterials | undefined): NativeSourceStairMaterials | undefined {
  if (!value?.authoredTreadRoles) return undefined;
  return { version: 1, sourceModelSha256: value.sourceModelSha256, flights: [], authoredTreadRoles: value.authoredTreadRoles };
}
