import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

type Point = [number, number, number];
export type NativeStairOwnedDisplayInventory = {
  version: 1;
  sourceModelSha256: string;
  geometrySha256: string;
  evidenceSha256: string;
  nativeStairId: number;
  nativeRunId: number;
  completeOriginalOwnedBody: true;
  unclassifiedBodyOwnerIds: number[];
  sourceGeometry: "original-float64-owned-brep";
  semanticTreadRoles: "unresolved";
  displayOverrideApplied: false;
  originalFrameSha256: string;
  originalRootDeclarationSha256: string;
  originalBodySha256: string;
  sourceChildElementIds: number[];
  declaredTreadQueues: {
    sourceDeclaredPath: "StairsRun.m_oGeom4TreadFaces";
    sourceFrameOffset: number;
    sourceClassSlot: number;
    token: number;
    dynamicBodyReplayed: false;
  }[];
  faces: {
    originalFaceToken: number;
    sourceChildElementIds: number[];
    originalTriangleIndices: number[];
  }[];
  trianglesFeet: [Point, Point, Point][];
};

const digest = (value: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
export const nativeStairOwnedDisplayBodyHash = (value: Pick<NativeStairOwnedDisplayInventory, "faces" | "trianglesFeet">) =>
  digest({ faces: value.faces, trianglesFeet: value.trianglesFeet });
export function nativeStairOwnedDisplayInventoryHash(value: Omit<NativeStairOwnedDisplayInventory, "geometrySha256"> | NativeStairOwnedDisplayInventory): string {
  const { geometrySha256: _, ...facts } = value as NativeStairOwnedDisplayInventory;
  return digest(facts);
}

/** Evidence-only carrier. Complete owned mesh replay does not identify walking
 * treads, authorize a display substitution, or certify a navigation surface. */
export function validateNativeStairOwnedDisplayInventory(value: NativeStairOwnedDisplayInventory, sourceModelSha256: string, ownership?: { stairElementId: number; runAndLandingIds: number[] }[]): void {
  const fail = () => { throw new Error("Invalid pending original stair display inventory."); };
  const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const id = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
  if (!value || value.version !== 1 || !hash(value.sourceModelSha256) || value.sourceModelSha256 !== sourceModelSha256 ||
    !id(value.nativeStairId) || !id(value.nativeRunId) || value.completeOriginalOwnedBody !== true ||
    value.sourceGeometry !== "original-float64-owned-brep" || value.semanticTreadRoles !== "unresolved" || value.displayOverrideApplied !== false ||
    !hash(value.evidenceSha256) || !hash(value.originalFrameSha256) || !hash(value.originalRootDeclarationSha256) ||
    !Array.isArray(value.unclassifiedBodyOwnerIds) || value.unclassifiedBodyOwnerIds.length ||
    !Array.isArray(value.sourceChildElementIds) || !value.sourceChildElementIds.length || value.sourceChildElementIds.some(v => !id(v)) ||
    new Set(value.sourceChildElementIds).size !== value.sourceChildElementIds.length ||
    !Array.isArray(value.declaredTreadQueues) || !value.declaredTreadQueues.length || value.declaredTreadQueues.some(q =>
      q.sourceDeclaredPath !== "StairsRun.m_oGeom4TreadFaces" || !Number.isSafeInteger(q.sourceFrameOffset) || q.sourceFrameOffset < 0 || !id(q.sourceClassSlot) || !id(q.token) || q.dynamicBodyReplayed !== false) ||
    !Array.isArray(value.trianglesFeet) || !value.trianglesFeet.length || value.trianglesFeet.length > 1000000 || value.trianglesFeet.some(t => !Array.isArray(t) || t.length !== 3 || t.some(p => !Array.isArray(p) || p.length !== 3 || p.some(v => !Number.isFinite(v)))) ||
    !Array.isArray(value.faces) || !value.faces.length || value.faces.length > 1000000) fail();
  if (ownership && ownership.filter(a => a.stairElementId === value.nativeStairId && a.runAndLandingIds.includes(value.nativeRunId)).length !== 1) fail();
  const seen = new Set<number>();
  for (const face of value.faces) {
    if (!id(face.originalFaceToken) || !Array.isArray(face.sourceChildElementIds) || !face.sourceChildElementIds.length || face.sourceChildElementIds.some(v => !value.sourceChildElementIds.includes(v)) ||
      !Array.isArray(face.originalTriangleIndices) || !face.originalTriangleIndices.length) fail();
    for (const index of face.originalTriangleIndices) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= value.trianglesFeet.length || seen.has(index)) fail();
      seen.add(index);
    }
  }
  if (seen.size !== value.trianglesFeet.length || value.originalBodySha256 !== nativeStairOwnedDisplayBodyHash(value) || value.geometrySha256 !== nativeStairOwnedDisplayInventoryHash(value)) fail();
}

/** Exact horizontal surfaces of the owned body, including support/nosing lips.
 * They are deliberately not emitted as semantic treads. No rounding, merging,
 * area threshold or nearest-height comparison changes the original inventory. */
export function nativeStairOwnedHorizontalEvidence(value: NativeStairOwnedDisplayInventory) {
  validateNativeStairOwnedDisplayInventory(value, value.sourceModelSha256);
  return value.faces.flatMap((face, faceIndex) => face.originalTriangleIndices.flatMap(index => {
    const [a, b, c] = value.trianglesFeet[index];
    const normalZ = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    return a[2] === b[2] && b[2] === c[2] && normalZ > 0 ? [{
      faceIndex, originalFaceToken: face.originalFaceToken, originalTriangleIndex: index,
      elevationFeet: a[2], triangleFeet: [a, b, c] as [Point, Point, Point],
      semanticRole: "unresolved-horizontal-owned-body-surface" as const,
    }] : [];
  }));
}
