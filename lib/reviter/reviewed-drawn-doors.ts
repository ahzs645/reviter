/** Drawing-backed doors: a door the registered DWG draws through a solid native basic wall where
 * the Revit model has no door element. The record is a reviewedDoorApertures patch of kind
 * "dwg-drawn-door" with no native door id. Its opening is the host's two exact faces between the
 * drawn rough-opening caps; its swing is the raw DWG ARC transformed by the section registration
 * of the receipt-bound DwgDerivedOutlines; every cited registered segment carries the raw LINE
 * handle that the same registration maps onto it. It is a tagged, reversible assumption: only an
 * `applied` record cuts the host and yields a door, `proposed` and `restored` records are inert
 * (restoring brings back the uncut host and drops the door, its portals and its edge at the next
 * compile). The door edge keeps access unknown and never grants access.
 *
 * This module is portable (mirrored in OpenIndoorMaps app/indoor-project/reviewed-drawn-doors.ts):
 * record shape, synthetic identities, drawing verification and prepared-dataset binding. */
import * as DMath from "./deterministic-math.ts";
import { nativeDerivedFrameHash } from "./native-derived-frame-returns.ts";
import {
  validateDwgDerivedOutlines,
  type DwgDerivedOutlines,
} from "./native-provisional-corner-seals.ts";
import type { IndoorDataset } from "./indoor-contract.ts";

type P2 = [number, number];
export const DWG_DRAWN_DOOR = "dwg-drawn-door";
/** Evidence string of the one door edge a drawing-backed door adds. */
export const DRAWING_BACKED_DOOR_EVIDENCE = "drawing-backed-door";
export const DWG_DRAWN_DOOR_LIMITS = {
  /** Registered DWG lines against native faces and the drawn rough opening. */
  dwgToleranceFeet: 0.05,
  minWidthFeet: 2,
  maxWidthFeet: 10,
  maxDepthFeet: 3,
  /** The record's swing must equal the raw ARC through the receipt registration. */
  recordToleranceFeet: 1e-6,
  minSweepDegrees: 82,
  maxSweepDegrees: 98,
  /** The hinge lies within this distance of one rough-opening cap (jamb frame depth), and the
   * leaf reaches within this distance of the other cap. */
  jambAllowanceFeet: 0.5,
  /** Drawn leaf lines lie within this offset of the hinge to open-tip line (leaf thickness). */
  leafOffsetFeet: 0.25,
  leafCoverage: 0.9,
  /** Floor support strip checked on each side of the aperture. */
  thresholdStripFeet: 1,
} as const;
/** Synthetic dataset door identities: far above any Revit ElementId, below 2^53. */
export const DWG_DRAWN_DOOR_ELEMENT_BASE = 2 ** 52;

export type DwgDrawnDoorSegment = {
  role: "cap" | "face" | "leaf" | "jamb";
  /** Registered boundary-reference wallSegments index of the cited section. */
  index: number;
  segmentFeet: [P2, P2];
  /** Raw DWG LINE (drawing units) that the receipt registration maps onto segmentFeet. */
  rawLine: { handle: string; layer: string; pointsRaw: [P2, P2] };
};
export type DwgDrawnDoorEvidence = {
  sourceDwgSha256: string;
  sectionId: string;
  /** sha256 of JSON.stringify([sourceDwgSha256, registered boundary section]). */
  registrationSha256: string;
  /** sha256 of JSON.stringify([sourceDwgSha256, derived outline section]): the section
   * registration receipt that transforms the raw ARC and LINE handles. */
  derivedOutlinesSha256: string;
  toleranceFeet: number;
  arc: {
    handle: string;
    layer: string;
    centerRaw: P2;
    radiusRaw: number;
    /** DXF/DWG ARC start and end angles (counter-clockwise, radians, raw frame). */
    anglesRadians: [number, number];
  };
  segments: DwgDrawnDoorSegment[];
};
export type DwgDrawnDoorFields = {
  kind: typeof DWG_DRAWN_DOOR;
  hostWallNativeElementId: number;
  pointFeet: P2;
  roomKeys: [string, string];
  swing: {
    hingeFeet: P2;
    radiusFeet: number;
    closedLeafFeet: [P2, P2];
    openLeafTipFeet: P2;
    intoRoomKey: string;
  };
  dwgEvidence: DwgDrawnDoorEvidence;
  assumption: {
    kind: "drawing-backed";
    decisionId: string;
    authorizationRecorded: true;
  };
  state: "proposed" | "applied" | "restored";
};
type PatchLike = {
  kind?: string;
  state?: string;
  id: string;
  levelId: number;
  apertureFeet: P2[];
  normalFeet: P2;
  wallEvidence: { nativeElementId: number; partsFeet: P2[][] }[];
};
export type DwgDrawnDoorPatch = PatchLike & DwgDrawnDoorFields;

export const isDwgDrawnDoor = (p: { kind?: string }): p is DwgDrawnDoorPatch =>
  p.kind === DWG_DRAWN_DOOR;
/** Patches that cut material: every native-door kind, and applied drawing-backed doors. */
export const activeDoorAperturePatch = (p: { kind?: string; state?: string }) =>
  p.kind !== DWG_DRAWN_DOOR || p.state === "applied";
export function activeDoorAperturePatches<T extends { patches: { kind?: string; state?: string }[] }>(
  value: T | undefined,
): T | undefined {
  if (!value || value.patches.every(activeDoorAperturePatch)) return value;
  return { ...value, patches: value.patches.filter(activeDoorAperturePatch) };
}
/** Stable synthetic dataset identity (depends only on the level and the record id). */
export const dwgDrawnDoorElementId = (levelId: number, id: string) =>
  DWG_DRAWN_DOOR_ELEMENT_BASE +
  parseInt(nativeDerivedFrameHash([DWG_DRAWN_DOOR, levelId, id]).slice(0, 10), 16);
export const dwgDrawnDoorDatasetId = (p: { levelId: number; id: string }) =>
  `door:${p.levelId}:dwg:${p.id}`;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e7;
const point = (v: unknown): v is P2 => Array.isArray(v) && v.length === 2 && v.every(finite);
const ring = (v: unknown, n?: number) =>
  Array.isArray(v) && v.length >= 3 && v.length <= (n ?? 100) && (n === undefined || v.length === n) && v.every(point);
const digest = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 200) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const handle = (v: unknown) => typeof v === "string" && /^[0-9A-F]{1,16}$/i.test(v);
/** Structure only; geometry and drawing checks run in the compiler. */
export function dwgDrawnDoorShapeValid(v: unknown): boolean {
  const p = v as DwgDrawnDoorPatch & { nativeDoorId?: unknown; doorEvidence?: unknown; preparedDoorEvidence?: unknown; frameEvidence?: unknown[] };
  const d = p?.dwgEvidence,
    s = p?.swing;
  return (
    !!p &&
    p.kind === DWG_DRAWN_DOOR &&
    p.nativeDoorId === undefined &&
    p.doorEvidence === undefined &&
    p.preparedDoorEvidence === undefined &&
    Array.isArray(p.frameEvidence) &&
    p.frameEvidence.length === 0 &&
    text(p.id) &&
    Number.isSafeInteger(p.levelId) &&
    Number.isSafeInteger(p.hostWallNativeElementId) &&
    p.hostWallNativeElementId > 0 &&
    ring(p.apertureFeet, 4) &&
    point(p.normalFeet) &&
    Math.abs(DMath.hypot(...p.normalFeet) - 1) <= 1e-6 &&
    point(p.pointFeet) &&
    Array.isArray(p.roomKeys) &&
    p.roomKeys.length === 2 &&
    p.roomKeys.every((k) => text(k)) &&
    p.roomKeys[0] !== p.roomKeys[1] &&
    !!s &&
    point(s.hingeFeet) &&
    finite(s.radiusFeet) &&
    s.radiusFeet > 0 &&
    s.radiusFeet <= DWG_DRAWN_DOOR_LIMITS.maxWidthFeet &&
    Array.isArray(s.closedLeafFeet) &&
    s.closedLeafFeet.length === 2 &&
    s.closedLeafFeet.every(point) &&
    point(s.openLeafTipFeet) &&
    p.roomKeys.includes(s.intoRoomKey) &&
    Array.isArray(p.wallEvidence) &&
    p.wallEvidence.length === 1 &&
    p.wallEvidence[0]!.nativeElementId === p.hostWallNativeElementId &&
    Array.isArray(p.wallEvidence[0]!.partsFeet) &&
    p.wallEvidence[0]!.partsFeet.length > 0 &&
    p.wallEvidence[0]!.partsFeet.every((r) => ring(r)) &&
    !!d &&
    digest(d.sourceDwgSha256) &&
    digest(d.registrationSha256) &&
    digest(d.derivedOutlinesSha256) &&
    text(d.sectionId) &&
    finite(d.toleranceFeet) &&
    d.toleranceFeet > 0 &&
    d.toleranceFeet <= DWG_DRAWN_DOOR_LIMITS.dwgToleranceFeet &&
    !!d.arc &&
    handle(d.arc.handle) &&
    text(d.arc.layer) &&
    point(d.arc.centerRaw) &&
    finite(d.arc.radiusRaw) &&
    d.arc.radiusRaw > 0 &&
    point(d.arc.anglesRadians) &&
    Array.isArray(d.segments) &&
    d.segments.length >= 7 &&
    d.segments.length <= 200 &&
    d.segments.every(
      (g) =>
        !!g &&
        ["cap", "face", "leaf", "jamb"].includes(g.role) &&
        Number.isSafeInteger(g.index) &&
        g.index >= 0 &&
        Array.isArray(g.segmentFeet) &&
        g.segmentFeet.length === 2 &&
        g.segmentFeet.every(point) &&
        !!g.rawLine &&
        handle(g.rawLine.handle) &&
        text(g.rawLine.layer) &&
        Array.isArray(g.rawLine.pointsRaw) &&
        g.rawLine.pointsRaw.length === 2 &&
        g.rawLine.pointsRaw.every(point),
    ) &&
    new Set(d.segments.map((g) => g.index)).size === d.segments.length &&
    new Set(d.segments.map((g) => g.rawLine.handle)).size === d.segments.length &&
    d.segments.some((g) => g.role === "leaf") &&
    d.segments.filter((g) => g.role === "cap").length >= 2 &&
    d.segments.filter((g) => g.role === "face").length >= 4 &&
    !!p.assumption &&
    p.assumption.kind === "drawing-backed" &&
    text(p.assumption.decisionId) &&
    p.assumption.authorizationRecorded === true &&
    ["proposed", "applied", "restored"].includes(p.state)
  );
}

const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]!;
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const dist = (a: P2, b: P2) => DMath.hypot(a[0] - b[0], a[1] - b[1]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export type DwgDrawnDoorDrawingProof = {
  /** Along-wall coordinates (dot with u = [-n1, n0]) of the drawn rough-opening caps. */
  roughOpeningAlongFeet: [number, number];
  roughOpeningFeet: number;
  hingeFeet: P2;
  radiusFeet: number;
  sweepDegrees: number;
  closedLeafTipFeet: P2;
  openLeafTipFeet: P2;
  /** Sign along normalFeet of the side the leaf opens into. */
  openSide: 1 | -1;
};
type Section = { sectionId: string; levelId?: number; wallSegments: unknown[] };
/** Compile-time proof that the record is what the registered drawing draws. Throws a refusal. */
export function verifyDwgDrawnDoorDrawing(
  p: DwgDrawnDoorPatch,
  boundaryReference: { sourceSha256: string; sections: Section[] } | undefined,
  derivedOutlines: DwgDerivedOutlines | undefined,
): DwgDrawnDoorDrawingProof {
  const refuse = (why: string): never => {
    throw new Error(`Drawing-backed door ${p.id} refused: ${why}.`);
  };
  if (!dwgDrawnDoorShapeValid(p)) refuse("invalid record");
  const d = p.dwgEvidence,
    L = DWG_DRAWN_DOOR_LIMITS,
    tol = d.toleranceFeet;
  if (!boundaryReference || boundaryReference.sourceSha256 !== d.sourceDwgSha256)
    refuse("it does not cite this project's registered drawing");
  const section = boundaryReference!.sections.find((s) => s.sectionId === d.sectionId);
  if (!section || nativeDerivedFrameHash([boundaryReference!.sourceSha256, section]) !== d.registrationSha256)
    refuse(`registered section ${d.sectionId} differs from the cited one`);
  if (section!.levelId !== undefined && section!.levelId !== p.levelId)
    refuse(`registered section ${d.sectionId} belongs to level ${section!.levelId}`);
  if (!derivedOutlines) refuse("no derived-outline registration receipt is bound to this project");
  validateDwgDerivedOutlines(derivedOutlines!, boundaryReference);
  const receipt = derivedOutlines!.sections.find((s) => s.sectionId === d.sectionId);
  if (
    !receipt ||
    derivedOutlines!.sourceDwgSha256 !== d.sourceDwgSha256 ||
    receipt.boundarySectionSha256 !== d.registrationSha256 ||
    nativeDerivedFrameHash([derivedOutlines!.sourceDwgSha256, receipt]) !== d.derivedOutlinesSha256
  )
    refuse(`the registration receipt of ${d.sectionId} differs from the cited one`);
  const reg = receipt!.registration,
    rawTol = derivedOutlines!.derivation.registrationToleranceFeet,
    f = ([x, y]: P2): P2 => [reg.re * x - reg.im * y + reg.t[0], reg.im * x + reg.re * y + reg.t[1]];
  for (const g of d.segments) {
    if (!same(section!.wallSegments[g.index], g.segmentFeet))
      refuse(`registered segment #${g.index} was changed`);
    const q = g.rawLine.pointsRaw.map(f) as [P2, P2],
      e = Math.min(
        Math.max(dist(q[0], g.segmentFeet[0]), dist(q[1], g.segmentFeet[1])),
        Math.max(dist(q[0], g.segmentFeet[1]), dist(q[1], g.segmentFeet[0])),
      );
    if (!(e <= rawTol)) refuse(`raw LINE ${g.rawLine.handle} does not register onto segment #${g.index}`);
  }
  // Raw ARC through the same receipt registration (a similarity: scale and rotation).
  const scale = DMath.hypot(reg.re, reg.im),
    rotation = DMath.atan2(reg.im, reg.re),
    hinge = f(d.arc.centerRaw),
    radius = d.arc.radiusRaw * scale,
    [a0, a1] = d.arc.anglesRadians;
  let sweep = (a1 - a0) % (2 * Math.PI);
  if (sweep <= 0) sweep += 2 * Math.PI;
  const sweepDegrees = (sweep * 180) / Math.PI;
  if (sweepDegrees < L.minSweepDegrees || sweepDegrees > L.maxSweepDegrees)
    refuse(`ARC ${d.arc.handle} sweeps ${sweepDegrees.toFixed(2)} degrees, not a door swing`);
  const tip = (a: number): P2 => [hinge[0] + radius * DMath.cos(a + rotation), hinge[1] + radius * DMath.sin(a + rotation)];
  const n = p.normalFeet,
    u: P2 = [-n[1], n[0]],
    ends = [tip(a0), tip(a1)],
    closed = ends.find((e) => Math.abs(dot(sub(e, hinge), n)) <= tol),
    open = ends.find((e) => Math.abs(dot(sub(e, hinge), u)) <= tol);
  if (!closed || !open || closed === open) refuse(`ARC ${d.arc.handle} is not a quarter swing about the host axis`);
  const s = p.swing,
    R = L.recordToleranceFeet;
  if (
    dist(s.hingeFeet, hinge) > R ||
    Math.abs(s.radiusFeet - radius) > R ||
    dist(s.closedLeafFeet[0], hinge) > R ||
    dist(s.closedLeafFeet[1], closed!) > R ||
    dist(s.openLeafTipFeet, open!) > R
  )
    refuse(`the recorded swing differs from raw ARC ${d.arc.handle}`);
  // Drawn rough opening: caps across the wall at two along-wall positions.
  const as = p.apertureFeet.map((q) => dot(q, u)),
    ns = p.apertureFeet.map((q) => dot(q, n)),
    lo = Math.min(...as),
    hi = Math.max(...as),
    n0 = Math.min(...ns),
    n1 = Math.max(...ns);
  const caps = d.segments.filter((g) => g.role === "cap"),
    capAt: number[] = [];
  for (const g of caps) {
    const [a, b] = g.segmentFeet;
    if (Math.abs(dot(sub(b, a), u)) > tol) refuse(`cap #${g.index} is not across the wall`);
    if (Math.min(dot(a, n), dot(b, n)) < n0 - tol || Math.max(dot(a, n), dot(b, n)) > n1 + tol)
      refuse(`cap #${g.index} is not inside the host wall`);
    capAt.push((dot(a, u) + dot(b, u)) / 2);
  }
  const sorted = [...capAt].sort((a, b) => a - b),
    clusters: number[][] = [];
  for (const c of sorted)
    if (clusters.length && c - clusters.at(-1)!.at(-1)! <= tol) clusters.at(-1)!.push(c);
    else clusters.push([c]);
  if (clusters.length !== 2) refuse(`the cited caps draw ${clusters.length} opening end(s), not two`);
  const cLow = clusters[0]!.reduce((a, b) => a + b, 0) / clusters[0]!.length,
    cHigh = clusters[1]!.reduce((a, b) => a + b, 0) / clusters[1]!.length,
    rough = cHigh - cLow;
  if (rough < L.minWidthFeet || rough > L.maxWidthFeet) refuse(`the drawn rough opening is ${rough.toFixed(3)} ft`);
  if (lo < cLow - tol || hi > cHigh + tol)
    refuse(`the aperture (${(hi - lo).toFixed(3)} ft) is wider than the drawn rough opening (${rough.toFixed(3)} ft)`);
  if (lo > cLow + tol || hi < cHigh - tol)
    refuse(`the aperture (${(hi - lo).toFixed(3)} ft) does not span the drawn rough opening (${rough.toFixed(3)} ft)`);
  // Both drawn wall faces stop at both caps and never cross the opening.
  const stops = new Set<string>();
  for (const g of d.segments.filter((g) => g.role === "face")) {
    const [a, b] = g.segmentFeet,
      depth = (dot(a, n) + dot(b, n)) / 2,
      s0 = Math.min(dot(a, u), dot(b, u)),
      s1 = Math.max(dot(a, u), dot(b, u)),
      side = Math.abs(depth - n0) <= tol ? 0 : Math.abs(depth - n1) <= tol ? 1 : -1;
    if (Math.abs(dot(sub(b, a), n)) > tol || side < 0) refuse(`wall face #${g.index} is not on a host face`);
    if (s1 > cLow + tol && s0 < cHigh - tol) refuse(`wall face #${g.index} crosses the drawn opening`);
    if (Math.abs(s1 - cLow) <= tol) stops.add(`${side}:low`);
    if (Math.abs(s0 - cHigh) <= tol) stops.add(`${side}:high`);
  }
  if (stops.size !== 4) refuse("the drawn wall faces do not stop at the rough opening on both faces");
  for (const g of d.segments.filter((g) => g.role === "jamb"))
    if (g.segmentFeet.some((q) => dot(q, u) < cLow - tol || dot(q, u) > cHigh + tol || dot(q, n) < n0 - tol || dot(q, n) > n1 + tol))
      refuse(`jamb #${g.index} lies outside the opening`);
  // Swing: hinged at one jamb, the closed leaf spans the opening along the wall, the open leaf is
  // across it; the drawn leaf lines lie on that open leaf.
  const hU = dot(hinge, u),
    hN = dot(hinge, n);
  if (hU < cLow || hU > cHigh || hN < n0 - tol || hN > n1 + tol) refuse("the ARC hinge is not inside the opening");
  const toward = hU - cLow <= cHigh - hU ? 1 : -1,
    nearDistance = Math.min(hU - cLow, cHigh - hU),
    farDistance = Math.max(hU - cLow, cHigh - hU);
  if (nearDistance > L.jambAllowanceFeet) refuse("the ARC hinge is not at a jamb");
  if (dot(sub(closed!, hinge), u) * toward <= 0 || radius > farDistance + tol || radius < farDistance - L.jambAllowanceFeet)
    refuse("the closed leaf does not span the drawn opening");
  const openSide = dot(sub(open!, hinge), n) > 0 ? 1 : -1,
    leafDirection: P2 = [n[0] * openSide, n[1] * openSide];
  let covered = false;
  for (const g of d.segments.filter((g) => g.role === "leaf")) {
    const t = g.segmentFeet.map((q) => dot(sub(q, hinge), leafDirection)),
      w = g.segmentFeet.map((q) => dot(sub(q, hinge), u));
    if (t.some((x) => x < -(n1 - n0) - tol || x > radius + tol) || w.some((x) => Math.abs(x) > L.leafOffsetFeet))
      refuse(`leaf line #${g.index} is not on the drawn leaf`);
    if (Math.abs(w[1]! - w[0]!) <= tol && Math.max(...t) - Math.max(Math.min(...t), 0) >= L.leafCoverage * radius) covered = true;
  }
  if (!covered) refuse("no cited DWG line draws the open leaf");
  return {
    roughOpeningAlongFeet: [cLow, cHigh],
    roughOpeningFeet: rough,
    hingeFeet: hinge,
    radiusFeet: radius,
    sweepDegrees,
    closedLeafTipFeet: closed!,
    openLeafTipFeet: open!,
    openSide,
  };
}

// The compiler may change a ring's first corner or winding, not its coordinates or edge order.
function sameRingVertices(actual: P2[] | undefined, expected: P2[]) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return expected.some((_, offset) =>
    [1, -1].some((direction) =>
      expected.every((_, i) => {
        const p = actual[i],
          q = expected[(offset + direction * i + expected.length) % expected.length]!;
        return Array.isArray(p) && p.length === 2 && p[0] === q[0] && p[1] === q[1];
      }),
    ),
  );
}
/** A regenerated dataset carries exactly one synthetic door and one enabled drawing-backed door
 * edge for every applied record, and none for a proposed or restored one. */
export function validateDwgDrawnDoorBinding(p: DwgDrawnDoorPatch, data: IndoorDataset) {
  const id = dwgDrawnDoorDatasetId(p),
    elementId = dwgDrawnDoorElementId(p.levelId, p.id),
    doors = (data.doors ?? []).filter((d) => d.id === id || d.nativeElementId === elementId),
    edges = data.edges.filter((e) => e.id === id || e.nativeElementId === elementId);
  if (p.state !== "applied") {
    if (doors.length || edges.length) throw new Error(`Drawing-backed door ${p.id} is ${p.state} but the prepared dataset still has its door.`);
    return;
  }
  const keys = JSON.stringify([...p.roomKeys].sort()),
    door = doors[0],
    edge = edges[0];
  if (
    doors.length !== 1 ||
    edges.length !== 1 ||
    !door ||
    !edge ||
    door.id !== id ||
    door.levelId !== p.levelId ||
    door.nativeElementId !== elementId ||
    door.hostWallNativeElementId !== p.hostWallNativeElementId ||
    door.state !== "connected" ||
    !sameRingVertices(door.footprintFeet, p.apertureFeet) ||
    !same(door.normalFeet, p.normalFeet) ||
    !same(door.pointFeet, p.pointFeet) ||
    JSON.stringify([...door.roomKeys].sort()) !== keys ||
    edge.id !== id ||
    edge.kind !== "door" ||
    !edge.enabled ||
    edge.evidence !== DRAWING_BACKED_DOOR_EVIDENCE ||
    edge.accessible !== "unknown" ||
    edge.nativeElementId !== elementId ||
    JSON.stringify([...edge.roomKeys].sort()) !== keys
  )
    throw new Error(`Prepared drawing-backed door ${p.id} differs from its record. Regenerate the master.`);
}
