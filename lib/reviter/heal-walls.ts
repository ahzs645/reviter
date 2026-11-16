/**
 * Wall-join analysis and conservative, auditable wall-join healing.
 *
 * Revit stores a basic wall as a location line plus a thickness and then
 * *cleans up* joins graphically: a wall that meets another at a T can have its
 * location line end anywhere inside the other wall's body — at its near face,
 * at its centreline, at its far face — and still draw as one closed plan.
 * Downstream consumers that join walls by their location lines (Pascal mitres
 * walls whose endpoints coincide; room finders flood between centrelines) see
 * each of those as an open end. Separately, a model can contain real modelling
 * gaps: a wall drawn a few centimetres short of the one it was meant to meet,
 * or two collinear runs a few millimetres out of line.
 *
 * This module is pure geometry over plain segment records:
 *
 * - `analyseWallEnds` classifies every end of every movable wall against its
 *   neighbours (shared node, on a centreline, inside a body, gap, overshoot,
 *   collinear gap/offset, free), with the distances that decide it;
 * - `healWalls` moves ends *along their own axis* (so a wall's line never
 *   rotates) to meet a neighbour's location line for T and L joins, snaps
 *   collinear continuations and near-coincident nodes together, and optionally
 *   merges collinear fragments. It never moves an end further than
 *   `maxMove`, never edits a `fixed` wall, and reports every edit with its
 *   before/after so the pass is auditable and reversible (`revertWallEdits`).
 *
 * All lengths are in the caller's unit. Tolerances are given in metres and
 * scaled by `unitsPerMetre` (1 for metres, 1 / 0.3048 for Revit feet).
 */

import type { ConvertResult, ElementBoundsRecord, WallArc, WallSolid } from "./types.ts";

export type Point2 = { x: number; y: number };

export type HealWall = {
  id: string;
  levelId?: number | string;
  start: Point2;
  end: Point2;
  thickness: number;
  baseElevation?: number;
  topElevation?: number;
  /**
   * A partner that may be joined *to* but is never edited — a curtain wall's
   * location line, a chord of a curved wall, a wall the caller wants pinned.
   */
  fixed?: boolean;
};

export type WallEndName = "start" | "end";

export type WallEndClass =
  /** Location line ends exactly on another wall's endpoint. */
  | "node"
  /** Location line ends exactly on another wall's centreline (a clean T). */
  | "on-line"
  /** Ends on the near face of another wall: joined only graphically. */
  | "at-face"
  /** Ends inside another wall's body, neither on its line nor at its face. */
  | "in-body"
  /** Butts the end zone of another wall at an L corner; bodies touch, lines do not meet. */
  | "corner-touch"
  /** Stops short of a crossing wall's body (a T or L that does not reach). */
  | "gap"
  /** Stops short of a collinear continuation. */
  | "collinear-gap"
  /** Meets a collinear continuation, but the two lines are laterally offset. */
  | "collinear-offset"
  /** Runs into a collinear continuation (the two runs overlap). */
  | "collinear-overlap"
  /** Passes right through a crossing wall and out of its far face. */
  | "overshoot"
  /** Another wall is within reach, but not ahead of this end. */
  | "near"
  /** Nothing within reach. */
  | "free";

export type WallEndReport = {
  wallId: string;
  end: WallEndName;
  point: Point2;
  class: WallEndClass;
  partnerId?: string;
  /**
   * Clear distance in the caller's unit: body-to-body gap for `gap`/`near`,
   * axial gap for `collinear-gap`, lateral offset for `collinear-offset`,
   * overlap length for `collinear-overlap`, protrusion past the far face for
   * `overshoot`, depth inside the partner for `in-body`, 0 otherwise.
   */
  distance: number;
  /**
   * Signed move along this wall's own axis that would put the end on the
   * partner's location line (positive extends, negative trims), when the two
   * lines cross.
   */
  extension?: number;
  /** Partner half-thickness divided by |sin(angle)|: the face distance along this axis. */
  partnerFaceReach?: number;
  /** Whether the partner line crossing falls near one of the partner's own ends. */
  partnerEnd?: WallEndName;
};

export type WallEditReason =
  | "tee-extend"
  | "tee-trim"
  | "corner"
  | "collinear-snap"
  | "node-snap"
  | "merge";

export type WallEdit = {
  wallId: string;
  end: WallEndName;
  before: Point2;
  after: Point2;
  /** Distance moved, in the caller's unit (0 for a merge, which moves no geometry). */
  moved: number;
  reason: WallEditReason;
  partnerId?: string;
  /** Class of the end in the pass that moved it (after any earlier pass). */
  fromClass: WallEndClass;
  /** For `merge`: the wall absorbed into `wallId`, which no longer exists. */
  mergedWallId?: string;
  mergedWall?: HealWall;
};

export type HealOptions = {
  /** Caller units per metre; 1 for metres, 1/0.3048 for feet. Default 1. */
  unitsPerMetre?: number;
  /** Ends closer than this are one node. Default 0.001 m. */
  nodeTolerance?: number;
  /** Search radius for classifying an end. Default 1.0 m. */
  searchRadius?: number;
  /** Largest clear gap (body to body, or collinear axial gap) healed. Default 0.15 m. */
  maxGap?: number;
  /** Hard cap on how far any one end is moved. Default 0.35 m. */
  maxMove?: number;
  /** Largest lateral misalignment snapped between collinear runs. Default 0.02 m. */
  maxCollinearOffset?: number;
  /** Two runs are collinear within this angle. Default 1 degree. */
  collinearAngleDegrees?: number;
  /** Two runs are a proper join (not grazing) above this angle. Default 5 degrees. */
  minJoinAngleDegrees?: number;
  /** Move ends that are in a partner's body onto its centreline. Default true. */
  normaliseInBody?: boolean;
  /** Trim ends that overshoot a crossing wall back to its centreline. Default true. */
  trimOvershoots?: boolean;
  /** Merge collinear, equal-thickness fragments that meet at a two-wall node. Default false. */
  mergeCollinear?: boolean;
  /**
   * Allow an L corner to be closed by pulling an end back to the node (the run
   * that went through to the outer face). Default false: corners only extend,
   * and a butt join becomes a T onto the through-run instead.
   */
  trimCorners?: boolean;
  /** Minimum vertical overlap for two walls to be partners, in metres. Default 0.05 m. */
  minZOverlap?: number;
};

type Resolved = Required<Omit<HealOptions, "unitsPerMetre">> & {
  collinearSine: number;
  minJoinSine: number;
};

/** Default tolerances, in metres and degrees; what `HealOptions` falls back to. */
export const HEAL_DEFAULTS = {
  nodeTolerance: 0.001,
  searchRadius: 1.0,
  maxGap: 0.15,
  maxMove: 0.35,
  maxCollinearOffset: 0.02,
  collinearAngleDegrees: 1,
  minJoinAngleDegrees: 5,
  normaliseInBody: true,
  trimOvershoots: true,
  mergeCollinear: false,
  trimCorners: false,
  minZOverlap: 0.05,
} as const satisfies Required<Omit<HealOptions, "unitsPerMetre">>;

const DEFAULTS = HEAL_DEFAULTS;

function resolve(options: HealOptions): Resolved {
  const scale = options.unitsPerMetre ?? 1;
  const length = (key: "nodeTolerance" | "searchRadius" | "maxGap" | "maxMove" | "maxCollinearOffset" | "minZOverlap") =>
    (options[key] ?? DEFAULTS[key]) * scale;
  const collinearAngleDegrees = options.collinearAngleDegrees ?? DEFAULTS.collinearAngleDegrees;
  const minJoinAngleDegrees = options.minJoinAngleDegrees ?? DEFAULTS.minJoinAngleDegrees;
  return {
    nodeTolerance: length("nodeTolerance"),
    searchRadius: length("searchRadius"),
    maxGap: length("maxGap"),
    maxMove: length("maxMove"),
    maxCollinearOffset: length("maxCollinearOffset"),
    minZOverlap: length("minZOverlap"),
    collinearAngleDegrees,
    minJoinAngleDegrees,
    normaliseInBody: options.normaliseInBody ?? DEFAULTS.normaliseInBody,
    trimOvershoots: options.trimOvershoots ?? DEFAULTS.trimOvershoots,
    mergeCollinear: options.mergeCollinear ?? DEFAULTS.mergeCollinear,
    trimCorners: options.trimCorners ?? DEFAULTS.trimCorners,
    collinearSine: Math.sin((collinearAngleDegrees * Math.PI) / 180),
    minJoinSine: Math.sin((minJoinAngleDegrees * Math.PI) / 180),
  };
}

// ── Geometry ────────────────────────────────────────────────────────────────

const sub = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point2, b: Point2) => a.x * b.x + a.y * b.y;
const cross = (a: Point2, b: Point2) => a.x * b.y - a.y * b.x;
const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const along = (p: Point2, u: Point2, s: number): Point2 => ({ x: p.x + u.x * s, y: p.y + u.y * s });

type Frame = { origin: Point2; u: Point2; length: number };

function frameOf(wall: HealWall): Frame | null {
  const d = sub(wall.end, wall.start);
  const length = Math.hypot(d.x, d.y);
  if (!(length > 0)) return null;
  return { origin: wall.start, u: { x: d.x / length, y: d.y / length }, length };
}

function endPoint(wall: HealWall, end: WallEndName) {
  return end === "start" ? wall.start : wall.end;
}

/** Unit vector pointing out of the wall through `end`. */
function outward(frame: Frame, end: WallEndName): Point2 {
  return end === "end" ? frame.u : { x: -frame.u.x, y: -frame.u.y };
}

function zOverlaps(a: HealWall, b: HealWall, minimum: number) {
  if (a.baseElevation == null || a.topElevation == null || b.baseElevation == null || b.topElevation == null) {
    return a.levelId === b.levelId;
  }
  return Math.min(a.topElevation, b.topElevation) - Math.max(a.baseElevation, b.baseElevation) >= minimum;
}

/** Station of `p` along the partner frame and its perpendicular distance from the (infinite) line. */
function project(frame: Frame, p: Point2) {
  const d = sub(p, frame.origin);
  return { t: dot(d, frame.u), offset: cross(frame.u, d) };
}

function distanceToSegment(frame: Frame, p: Point2) {
  const { t, offset } = project(frame, p);
  if (t < 0) return dist(p, frame.origin);
  if (t > frame.length) return dist(p, along(frame.origin, frame.u, frame.length));
  return Math.abs(offset);
}

// ── Spatial index ───────────────────────────────────────────────────────────

class SegmentIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly walls: readonly HealWall[];
  private readonly cell: number;
  constructor(walls: readonly HealWall[], cell: number, pad: (wall: HealWall) => number) {
    this.walls = walls;
    this.cell = cell;
    walls.forEach((wall, index) => {
      const r = pad(wall);
      const x0 = Math.floor((Math.min(wall.start.x, wall.end.x) - r) / cell);
      const x1 = Math.floor((Math.max(wall.start.x, wall.end.x) + r) / cell);
      const y0 = Math.floor((Math.min(wall.start.y, wall.end.y) - r) / cell);
      const y1 = Math.floor((Math.max(wall.start.y, wall.end.y) + r) / cell);
      // Very long walls are rare; cap the insertion loop by walking the
      // segment rather than its whole AABB when it is diagonal.
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) {
          if ((x1 - x0) * (y1 - y0) > 64) {
            const cx = (x + 0.5) * cell; const cy = (y + 0.5) * cell;
            const frame = frameOf(wall);
            if (frame && distanceToSegment(frame, { x: cx, y: cy }) > r + cell) continue;
          }
          const key = `${x},${y}`;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(index); else this.cells.set(key, [index]);
        }
      }
    });
  }

  near(p: Point2): number[] {
    const x = Math.floor(p.x / this.cell); const y = Math.floor(p.y / this.cell);
    const found = new Set<number>();
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
      for (const index of this.cells.get(`${x + dx},${y + dy}`) ?? []) found.add(index);
    }
    return [...found].sort((a, b) => a - b);
  }

  wall(index: number) { return this.walls[index]!; }
}

// ── Classification ──────────────────────────────────────────────────────────

const CLASS_RANK: Record<WallEndClass, number> = {
  node: 0,
  "on-line": 1,
  "at-face": 2,
  "in-body": 3,
  "corner-touch": 3,
  "collinear-overlap": 4,
  overshoot: 5,
  "collinear-offset": 6,
  "collinear-gap": 7,
  gap: 8,
  near: 9,
  free: 10,
};

/** Is this end joined at the location-line level (what Pascal and graph room finders need)? */
export function isLineJoined(report: Pick<WallEndReport, "class">) {
  return report.class === "node" || report.class === "on-line";
}

/** Is this end physically closed (its body meets another body)? */
export function isBodyJoined(report: Pick<WallEndReport, "class">) {
  return isLineJoined(report) || report.class === "at-face" || report.class === "in-body" || report.class === "corner-touch"
    || report.class === "collinear-overlap" || report.class === "overshoot";
}

function classifyAgainst(
  wall: HealWall,
  frame: Frame,
  end: WallEndName,
  partner: HealWall,
  partnerFrame: Frame,
  o: Resolved,
): WallEndReport | null {
  const p = endPoint(wall, end);
  const out = outward(frame, end);
  const k = partner.thickness / 2;
  const h = wall.thickness / 2;
  const tol = o.nodeTolerance;
  const base = { wallId: wall.id, end, point: p, partnerId: partner.id };

  const toStart = dist(p, partner.start);
  const toEnd = dist(p, partner.end);
  if (Math.min(toStart, toEnd) <= tol) return { ...base, class: "node", distance: 0 };

  const { t, offset } = project(partnerFrame, p);
  const sine = cross(out, partnerFrame.u);
  const absSine = Math.abs(sine);

  if (absSine < o.collinearSine) {
    // Collinear (or parallel) partner: only a continuation counts, i.e. the
    // partner must lie ahead of this end on (nearly) the same line.
    const lateral = Math.abs(offset);
    if (lateral > Math.max(h, k) + tol) return null;
    const near = dot(sub(partner.start, p), out) < dot(sub(partner.end, p), out) ? "start" : "end";
    const nearPoint = endPoint(partner, near);
    const axial = dot(sub(nearPoint, p), out);
    const farAxial = dot(sub(endPoint(partner, near === "start" ? "end" : "start"), p), out);
    if (farAxial < -tol) return null; // partner is entirely behind this end
    if (lateral > tol && lateral <= Math.max(h, k) + tol && Math.abs(axial) <= o.searchRadius) {
      if (axial < -tol) return { ...base, class: "collinear-overlap", distance: Math.min(-axial, farAxial), partnerEnd: near };
      return { ...base, class: axial > tol ? "collinear-gap" : "collinear-offset", distance: axial > tol ? axial : lateral, partnerEnd: near };
    }
    if (axial > tol && axial <= o.searchRadius) return { ...base, class: "collinear-gap", distance: axial, partnerEnd: near };
    if (axial < -tol) return { ...base, class: "collinear-overlap", distance: Math.min(-axial, farAxial), partnerEnd: near };
    return null;
  }

  // Crossing partner. Distance along our own axis to the partner's centreline.
  const s = offset / sine;
  const faceReach = k / absSine;
  const crossing = along(p, out, s);
  const tc = project(partnerFrame, crossing).t;
  const length = partnerFrame.length;
  // Our half-thickness measured along the partner: how far past the partner's
  // end our body still covers it at an L corner.
  const ownReach = h / Math.max(absSine, o.minJoinSine);
  const partnerEnd: WallEndName | undefined = tc <= ownReach + tol ? "start" : tc >= length - ownReach - tol ? "end" : undefined;
  const crossingInReach = tc >= -ownReach - tol && tc <= length + ownReach + tol;

  const within = t >= -tol && t <= length + tol;
  const lateral = Math.abs(offset);
  const joint = { extension: s, partnerFaceReach: faceReach, partnerEnd };
  if (within && lateral <= tol) return { ...base, class: "on-line", distance: 0, ...joint };
  if (within && lateral <= k + tol) {
    const atFace = Math.abs(lateral - k) <= tol;
    return { ...base, class: atFace ? "at-face" : "in-body", distance: atFace ? 0 : k - lateral, ...joint };
  }

  // Outside the partner's body: measure from our end *cap* (both corners), not
  // just the centre point, so an angled or corner butt counts as touching.
  const n = { x: -out.y, y: out.x };
  const capGap = capToBodyDistance(along(p, n, h), along(p, n, -h), partnerFrame, k);
  const overshoots = s < -tol && -s <= frame.length && crossingInReach;
  if (overshoots && -s - faceReach > tol) {
    // Our run passes through the partner; only an end that stops within reach
    // past its far face is an overshoot of *this* partner.
    return -s - faceReach <= o.searchRadius ? { ...base, class: "overshoot", distance: -s - faceReach, ...joint } : null;
  }
  if (capGap <= tol) {
    return { ...base, class: partnerEnd && !(tc > tol && tc < length - tol) ? "corner-touch" : "in-body", distance: 0, ...joint };
  }
  if (capGap > o.searchRadius) return null;
  if (s > 0 && tc >= -ownReach - o.searchRadius && tc <= length + ownReach + o.searchRadius) {
    return { ...base, class: "gap", distance: capGap, ...joint };
  }
  return { ...base, class: "near", distance: capGap };
}

function segmentDistance(a: Point2, b: Point2, c: Point2, d: Point2) {
  const o1 = cross(sub(b, a), sub(c, a)); const o2 = cross(sub(b, a), sub(d, a));
  const o3 = cross(sub(d, c), sub(a, c)); const o4 = cross(sub(d, c), sub(b, c));
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  const pointSeg = (q: Point2, s0: Point2, s1: Point2) => {
    const e = sub(s1, s0); const l2 = dot(e, e);
    const u = l2 ? Math.max(0, Math.min(1, dot(sub(q, s0), e) / l2)) : 0;
    return dist(q, along(s0, e, u));
  };
  return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
}

/** Clear distance from a wall's end cap to another wall's rectangular body (0 when touching). */
function capToBodyDistance(a: Point2, b: Point2, frame: Frame, k: number) {
  const inBody = (q: Point2) => { const { t, offset } = project(frame, q); return t >= 0 && t <= frame.length && Math.abs(offset) <= k; };
  if (inBody(a) || inBody(b)) return 0;
  const n = { x: -frame.u.y, y: frame.u.x };
  const s0 = frame.origin; const s1 = along(frame.origin, frame.u, frame.length);
  const corners = [along(s0, n, k), along(s1, n, k), along(s1, n, -k), along(s0, n, -k)];
  let best = Infinity;
  for (let i = 0; i < 4; i += 1) best = Math.min(best, segmentDistance(a, b, corners[i]!, corners[(i + 1) % 4]!));
  return best;
}

function better(a: WallEndReport, b: WallEndReport) {
  const rank = CLASS_RANK[a.class] - CLASS_RANK[b.class];
  if (rank) return rank < 0;
  if (a.distance !== b.distance) return a.distance < b.distance;
  return (a.partnerId ?? "") < (b.partnerId ?? "");
}

function buildIndex(walls: readonly HealWall[], o: Resolved) {
  const cell = Math.max(o.searchRadius * 2, 1e-6);
  return new SegmentIndex(walls, cell, (wall) => wall.thickness / 2 + o.searchRadius);
}

function classifyEnd(wall: HealWall, end: WallEndName, index: SegmentIndex, o: Resolved): WallEndReport {
  const frame = frameOf(wall);
  const p = endPoint(wall, end);
  let best: WallEndReport = { wallId: wall.id, end, point: p, class: "free", distance: Infinity };
  if (!frame) return best;
  for (const candidate of index.near(p)) {
    const partner = index.wall(candidate);
    if (partner.id === wall.id || !zOverlaps(wall, partner, o.minZOverlap)) continue;
    const partnerFrame = frameOf(partner);
    if (!partnerFrame) continue;
    const report = classifyAgainst(wall, frame, end, partner, partnerFrame, o);
    if (report && better(report, best)) best = report;
  }
  return best;
}

/** Ids of every wall this end is line- or body-joined to. */
function endContacts(wall: HealWall, end: WallEndName, index: SegmentIndex, o: Resolved): Set<string> {
  const contacts = new Set<string>();
  const frame = frameOf(wall);
  if (!frame) return contacts;
  for (const candidate of index.near(endPoint(wall, end))) {
    const partner = index.wall(candidate);
    if (partner.id === wall.id || !zOverlaps(wall, partner, o.minZOverlap)) continue;
    const partnerFrame = frameOf(partner);
    if (!partnerFrame) continue;
    const report = classifyAgainst(wall, frame, end, partner, partnerFrame, o);
    if (report && isBodyJoined(report)) contacts.add(partner.id);
  }
  return contacts;
}

/** Classify both ends of every non-fixed wall. Deterministic in input order. */
export function analyseWallEnds(walls: readonly HealWall[], options: HealOptions = {}): WallEndReport[] {
  const o = resolve(options);
  const index = buildIndex(walls, o);
  const reports: WallEndReport[] = [];
  for (const wall of walls) {
    if (wall.fixed) continue;
    reports.push(classifyEnd(wall, "start", index, o), classifyEnd(wall, "end", index, o));
  }
  return reports;
}

export type WallEndSummary = Record<WallEndClass, number> & { ends: number; lineOpen: number; bodyOpen: number };

export function summariseWallEnds(reports: readonly WallEndReport[]): WallEndSummary {
  const summary = Object.fromEntries(Object.keys(CLASS_RANK).map((key) => [key, 0])) as WallEndSummary;
  summary.ends = reports.length; summary.lineOpen = 0; summary.bodyOpen = 0;
  for (const report of reports) {
    summary[report.class] += 1;
    if (!isLineJoined(report)) summary.lineOpen += 1;
    if (!isBodyJoined(report)) summary.bodyOpen += 1;
  }
  return summary;
}

// ── Healing ─────────────────────────────────────────────────────────────────

type Proposal = {
  moves: { wall: number; end: WallEndName; to: Point2; fromClass: WallEndClass }[];
  reason: WallEditReason;
  partnerId: string;
  cost: number;
  /** Ends this proposal relies on staying where they are. */
  locks?: { wall: number; end: WallEndName }[];
};

function cloneWall(wall: HealWall): HealWall {
  return { ...wall, start: { ...wall.start }, end: { ...wall.end } };
}

function lineIntersection(a: Frame, b: Frame): Point2 | null {
  const det = cross(a.u, b.u);
  if (Math.abs(det) < 1e-12) return null;
  const s = cross(sub(b.origin, a.origin), b.u) / det;
  return along(a.origin, a.u, s);
}

function proposalsFor(
  walls: readonly HealWall[],
  indexOf: Map<string, number>,
  reports: Map<string, WallEndReport>,
  o: Resolved,
): Proposal[] {
  const proposals: Proposal[] = [];
  const key = (id: string, end: WallEndName) => `${id}:${end}`;
  const open = (id: string, end: WallEndName) => {
    const report = reports.get(key(id, end));
    return report ? !isLineJoined(report) : false;
  };

  for (const report of reports.values()) {
    if (isLineJoined(report) || !report.partnerId) continue;
    const wi = indexOf.get(report.wallId)!;
    const pi = indexOf.get(report.partnerId)!;
    const wall = walls[wi]!; const partner = walls[pi]!;
    const frame = frameOf(wall); const partnerFrame = frameOf(partner);
    if (!frame || !partnerFrame) continue;

    switch (report.class) {
      case "gap":
      case "at-face":
      case "in-body":
      case "corner-touch":
      case "overshoot": {
        if (report.extension == null) break;
        if (report.class === "gap" && report.distance > o.maxGap) break;
        if ((report.class === "at-face" || report.class === "in-body" || report.class === "corner-touch") && !o.normaliseInBody) break;
        if (report.class === "overshoot" && (!o.trimOvershoots || report.distance > o.maxGap)) break;
        if (Math.abs(report.extension) > o.maxMove) break;
        const crossing = lineIntersection(frame, partnerFrame);
        if (!crossing) break;
        // L corner: the crossing is at (or beyond) one of the partner's ends
        // and that end is itself open, so both ends move to the corner.
        const t = project(partnerFrame, crossing).t;
        const tolerance = o.nodeTolerance;
        const partnerEnd: WallEndName | null = t <= tolerance ? "start" : t >= partnerFrame.length - tolerance ? "end" : null;
        if (partnerEnd) {
          // Pulling an end *back* to a corner node shrinks the body that a
          // butt join relies on (the run that went to the outer face). Unless
          // asked, corners are only closed by extending.
          const subjectRetreats = report.extension < -tolerance;
          const partnerRetreats = dot(sub(crossing, endPoint(partner, partnerEnd)), outward(partnerFrame, partnerEnd)) < -tolerance;
          if (!o.trimCorners && subjectRetreats) break;
          if (partner.fixed || !open(partner.id, partnerEnd)) {
            // Partner end already joined elsewhere (or pinned). Extending onto
            // its line beyond its end would create a dangling crossing; only
            // accept it when the crossing is the partner's endpoint itself.
            if (dist(crossing, endPoint(partner, partnerEnd)) > tolerance) break;
            proposals.push({ moves: [{ wall: wi, end: report.end, to: endPoint(partner, partnerEnd), fromClass: report.class }], reason: "corner", partnerId: partner.id, cost: Math.abs(report.extension), locks: [{ wall: pi, end: partnerEnd }] });
            break;
          }
          const partnerMove = dist(crossing, endPoint(partner, partnerEnd));
          if (partnerMove > o.maxMove || (!o.trimCorners && partnerRetreats)) break;
          // The partner end must be near the corner too, or this is a T onto
          // an extension of the partner that nothing drew.
          const partnerReport = reports.get(key(partner.id, partnerEnd));
          if (partnerMove > wall.thickness / 2 / Math.max(Math.abs(cross(frame.u, partnerFrame.u)), o.minJoinSine) + o.maxGap + tolerance) break;
          proposals.push({
            moves: [
              { wall: wi, end: report.end, to: crossing, fromClass: report.class },
              { wall: pi, end: partnerEnd, to: crossing, fromClass: partnerReport?.class ?? "free" },
            ],
            reason: "corner",
            partnerId: partner.id,
            cost: Math.abs(report.extension) + partnerMove,
          });
          break;
        }
        if (t < 0 || t > partnerFrame.length) break;
        proposals.push({
          moves: [{ wall: wi, end: report.end, to: crossing, fromClass: report.class }],
          reason: report.extension >= 0 ? "tee-extend" : "tee-trim",
          partnerId: partner.id,
          cost: Math.abs(report.extension),
        });
        break;
      }
      case "collinear-gap":
      case "collinear-offset": {
        if (!report.partnerEnd) break;
        const target = endPoint(partner, report.partnerEnd);
        const lateral = Math.abs(project(frame, target).offset);
        const axialGap = report.class === "collinear-gap" ? report.distance : 0;
        if (lateral > o.maxCollinearOffset || axialGap > o.maxGap) break;
        const partnerOpen = !partner.fixed && open(partner.id, report.partnerEnd);
        if (partnerOpen && Math.abs(partner.thickness - wall.thickness) <= o.nodeTolerance) {
          const mid = { x: (target.x + report.point.x) / 2, y: (target.y + report.point.y) / 2 };
          const partnerReport = reports.get(key(partner.id, report.partnerEnd));
          proposals.push({
            moves: [
              { wall: wi, end: report.end, to: mid, fromClass: report.class },
              { wall: pi, end: report.partnerEnd, to: mid, fromClass: partnerReport?.class ?? report.class },
            ],
            reason: "collinear-snap",
            partnerId: partner.id,
            cost: dist(mid, report.point) * 2,
          });
        } else {
          proposals.push({ moves: [{ wall: wi, end: report.end, to: { ...target }, fromClass: report.class }], reason: "collinear-snap", partnerId: partner.id, cost: dist(target, report.point), locks: [{ wall: pi, end: report.partnerEnd }] });
        }
        break;
      }
      case "near": {
        // Two ends within snapping distance that are neither collinear nor a
        // proper crossing: collapse onto one node only when they are already
        // almost coincident.
        const nearestEnd: WallEndName = dist(partner.start, report.point) <= dist(partner.end, report.point) ? "start" : "end";
        const nearest = endPoint(partner, nearestEnd);
        const gap = dist(nearest, report.point);
        if (gap <= Math.min(o.maxCollinearOffset, o.maxMove)) {
          proposals.push({ moves: [{ wall: wi, end: report.end, to: { ...nearest }, fromClass: report.class }], reason: "node-snap", partnerId: partner.id, cost: gap, locks: [{ wall: pi, end: nearestEnd }] });
        }
        break;
      }
      default:
        break;
    }
  }
  return proposals;
}

function joinGroup(report: WallEndReport | undefined) {
  if (!report) return 2;
  return isLineJoined(report) ? 0 : isBodyJoined(report) ? 1 : 2;
}

function applyProposals(
  walls: HealWall[],
  proposals: Proposal[],
  o: Resolved,
  edits: WallEdit[],
  reports: Map<string, WallEndReport>,
  index: SegmentIndex,
) {
  const reasonRank: Record<WallEditReason, number> = { "collinear-snap": 0, corner: 1, "tee-extend": 2, "tee-trim": 2, "node-snap": 3, merge: 4 };
  proposals.sort((a, b) => a.cost - b.cost || reasonRank[a.reason] - reasonRank[b.reason]
    || walls[a.moves[0]!.wall]!.id.localeCompare(walls[b.moves[0]!.wall]!.id) || a.moves[0]!.end.localeCompare(b.moves[0]!.end));
  const used = new Set<string>();
  const current = new Map(reports);
  let applied = 0;
  for (const proposal of proposals) {
    const keys = [...proposal.moves, ...(proposal.locks ?? [])].map((move) => `${move.wall}:${move.end}`);
    if (keys.some((k) => used.has(k))) continue;
    const valid = proposal.moves.every((move) => {
      const wall = walls[move.wall]!;
      if (wall.fixed) return false;
      const before = endPoint(wall, move.end);
      if (dist(before, move.to) > o.maxMove + 1e-12) return false;
      // Never collapse or flip a wall.
      const other = endPoint(wall, move.end === "start" ? "end" : "start");
      const oldVector = sub(before, other); const newVector = sub(move.to, other);
      return Math.hypot(newVector.x, newVector.y) > o.nodeTolerance && dot(oldVector, newVector) > 0;
    });
    if (!valid) continue;

    // Apply tentatively, then re-read every end in the neighbourhood: no end —
    // moved or not — may lose a contact it had with any wall (line or body),
    // nor drop from line-joined to body-joined to open. This is what stops a
    // trim from pulling a wall's end off a finish layer or out from under a
    // third wall teed into it.
    const undo = proposal.moves.map((move) => ({ wall: walls[move.wall]!, end: move.end, before: { ...endPoint(walls[move.wall]!, move.end) } }));
    const affected = new Set<number>();
    for (const [i, move] of proposal.moves.entries()) {
      for (const j of [...index.near(undo[i]!.before), ...index.near(move.to)]) affected.add(j);
    }
    const ends = [...affected].sort((a, b) => a - b).filter((i) => !walls[i]!.fixed)
      .flatMap((i) => (["start", "end"] as const).map((end) => ({ wall: walls[i]!, end })));
    const contactsBefore = ends.map(({ wall, end }) => endContacts(wall, end, index, o));
    for (const move of proposal.moves) walls[move.wall]![move.end] = { ...move.to };
    const updates = new Map<string, WallEndReport>();
    let worse = false;
    for (const [n, { wall, end }] of ends.entries()) {
      const k = `${wall.id}:${end}`;
      const now = classifyEnd(wall, end, index, o);
      if (joinGroup(now) > joinGroup(current.get(k))) { worse = true; break; }
      const after = endContacts(wall, end, index, o);
      for (const id of contactsBefore[n]!) if (!after.has(id)) { worse = true; break; }
      if (worse) break;
      updates.set(k, now);
    }
    if (worse) {
      for (const item of undo) item.wall[item.end] = item.before;
      continue;
    }
    for (const [k, r] of updates) current.set(k, r);
    for (const [i, move] of proposal.moves.entries()) {
      const wall = walls[move.wall]!;
      const before = undo[i]!.before;
      if (dist(before, move.to) === 0) continue;
      edits.push({ wallId: wall.id, end: move.end, before, after: { ...move.to }, moved: dist(before, move.to), reason: proposal.reason, partnerId: proposal.partnerId, fromClass: move.fromClass });
    }
    keys.forEach((k) => used.add(k));
    applied += 1;
  }
  return applied;
}

function mergeCollinear(walls: HealWall[], o: Resolved, edits: WallEdit[]): HealWall[] {
  // Nodes shared by exactly two walls, both ending there, collinear, equal
  // thickness and height. Merge the later id into the earlier one.
  const nodes = new Map<string, { wall: number; end: WallEndName }[]>();
  const grid = Math.max(o.nodeTolerance, 1e-9);
  const nodeKey = (p: Point2) => `${Math.round(p.x / grid)},${Math.round(p.y / grid)}`;
  walls.forEach((wall, index) => {
    for (const end of ["start", "end"] as const) {
      const k = nodeKey(endPoint(wall, end));
      const list = nodes.get(k); if (list) list.push({ wall: index, end }); else nodes.set(k, [{ wall: index, end }]);
    }
  });
  const removed = new Set<number>();
  // Walls touching a node mid-span (T onto it) also block a merge there.
  const index = buildIndex(walls, o);
  for (const [, members] of [...nodes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.length !== 2) continue;
    const [a, b] = members as [{ wall: number; end: WallEndName }, { wall: number; end: WallEndName }];
    if (a.wall === b.wall || removed.has(a.wall) || removed.has(b.wall)) continue;
    const wa = walls[a.wall]!; const wb = walls[b.wall]!;
    if (wa.fixed || wb.fixed) continue;
    if (Math.abs(wa.thickness - wb.thickness) > o.nodeTolerance) continue;
    if (wa.baseElevation !== wb.baseElevation || wa.topElevation !== wb.topElevation || wa.levelId !== wb.levelId) continue;
    const fa = frameOf(wa); const fb = frameOf(wb);
    if (!fa || !fb || Math.abs(cross(fa.u, fb.u)) > o.collinearSine * 0.1) continue;
    const node = endPoint(wa, a.end);
    const tee = index.near(node).some((i) => {
      if (i === a.wall || i === b.wall) return false;
      const other = walls[i]!; const frame = frameOf(other);
      return frame != null && zOverlaps(wa, other, o.minZOverlap) && distanceToSegment(frame, node) <= other.thickness / 2 + o.nodeTolerance;
    });
    if (tee) continue;
    const [keep, drop, dropEnd] = wa.id.localeCompare(wb.id) <= 0 ? [a, b, b.end] : [b, a, a.end];
    const keepWall = walls[keep.wall]!; const dropWall = walls[drop.wall]!;
    const farPoint = endPoint(dropWall, dropEnd === "start" ? "end" : "start");
    const before = { ...endPoint(keepWall, keep.end) };
    edits.push({ wallId: keepWall.id, end: keep.end, before, after: { ...farPoint }, moved: 0, reason: "merge", partnerId: dropWall.id, fromClass: "node", mergedWallId: dropWall.id, mergedWall: cloneWall(dropWall) });
    keepWall[keep.end] = { ...farPoint };
    removed.add(drop.wall);
  }
  return walls.filter((_, i) => !removed.has(i));
}

export type HealResult = {
  walls: HealWall[];
  edits: WallEdit[];
  before: WallEndSummary;
  after: WallEndSummary;
  reportsBefore: WallEndReport[];
  reportsAfter: WallEndReport[];
};

/**
 * Heal wall joins. Input walls are not mutated. Two passes: the first applies
 * collinear snaps (the only edit that can turn a line), the second re-reads the
 * geometry and applies along-axis T/L edits, which never change a wall's line
 * and so cannot invalidate one another.
 */
export function healWalls(input: readonly HealWall[], options: HealOptions = {}): HealResult {
  const o = resolve(options);
  const walls = input.map(cloneWall);
  const indexOf = new Map(walls.map((wall, i) => [wall.id, i]));
  if (indexOf.size !== walls.length) throw new Error("healWalls: wall ids must be unique");
  const edits: WallEdit[] = [];
  const reportsBefore = analyseWallEnds(walls, options);

  const pass = (filter: (p: Proposal) => boolean) => {
    const index = buildIndex(walls, o);
    const reports = new Map<string, WallEndReport>();
    for (const wall of walls) {
      if (wall.fixed) continue;
      for (const end of ["start", "end"] as const) reports.set(`${wall.id}:${end}`, classifyEnd(wall, end, index, o));
    }
    return applyProposals(walls, proposalsFor(walls, indexOf, reports, o).filter(filter), o, edits, reports, index);
  };
  pass((p) => p.reason === "collinear-snap");
  // Re-run the along-axis pass until stable: closing one corner can make a
  // neighbouring end's partner resolvable (bounded; each end moves once).
  const moved = new Set<string>();
  for (let round = 0; round < 3; round += 1) {
    const before = edits.length;
    pass((p) => p.reason !== "collinear-snap" && p.moves.every((m) => !moved.has(`${m.wall}:${m.end}`)));
    for (const edit of edits.slice(before)) moved.add(`${indexOf.get(edit.wallId)}:${edit.end}`);
    if (edits.length === before) break;
  }
  const healed = o.mergeCollinear ? mergeCollinear(walls, o, edits) : walls;
  const reportsAfter = analyseWallEnds(healed, options);
  return {
    walls: healed,
    edits,
    before: summariseWallEnds(reportsBefore),
    after: summariseWallEnds(reportsAfter),
    reportsBefore,
    reportsAfter,
  };
}

/** Undo `edits` (in reverse) on a healed wall list, restoring merged walls. */
export function revertWallEdits(healed: readonly HealWall[], edits: readonly WallEdit[]): HealWall[] {
  const walls = healed.map(cloneWall);
  const byId = new Map(walls.map((wall) => [wall.id, wall]));
  for (const edit of [...edits].reverse()) {
    const wall = byId.get(edit.wallId);
    if (!wall) throw new Error(`revertWallEdits: missing wall ${edit.wallId}`);
    wall[edit.end] = { ...edit.before };
    if (edit.mergedWall) {
      const restored = cloneWall(edit.mergedWall);
      walls.push(restored); byId.set(restored.id, restored);
    }
  }
  return walls;
}

// ── ConvertResult adapter (the integration point) ───────────────────────────


const WALL_CATEGORY_ID = -2_000_011;
const FEET_PER_METRE = 1 / 0.3048;
const ARC_CHORDS = 8;

export type ConvertHealResult = {
  /** A shallow copy of the input whose wall records carry healed solids. */
  result: ConvertResult;
  /** Every edit, keyed by `${elementId}` or `${elementId}_${solidIndex}` wall ids. */
  edits: WallEdit[];
  before: WallEndSummary;
  after: WallEndSummary;
};

function arcChords(arc: WallArc): [Point2, Point2][] {
  const points: Point2[] = [];
  for (let i = 0; i <= ARC_CHORDS; i += 1) {
    const a = arc.startAngle + ((arc.endAngle - arc.startAngle) * i) / ARC_CHORDS;
    points.push({
      x: arc.centre.x + arc.radius * (Math.cos(a) * arc.xDir.x + Math.sin(a) * arc.yDir.x),
      y: arc.centre.y + arc.radius * (Math.cos(a) * arc.xDir.y + Math.sin(a) * arc.yDir.y),
    });
  }
  return points.slice(1).map((point, i) => [points[i]!, point]);
}

/**
 * Heal the wall joins of a conversion without touching the input. Drawn basic
 * walls (one HealWall per recovered solid) are movable; wall-category records
 * that are not drawn (curtain-wall location lines) and curved-wall chords are
 * fixed partners. Levels come from `Element.m_assocLevelId`; partners are
 * matched by height overlap, so a tall wall on one level still joins walls on
 * the next. Feed `result` to `deriveRoomsForLevel` or `makePascalScene`
 * unchanged — both read only `elementBounds[].solids`.
 */
export function healConvertResult(result: ConvertResult, options: Omit<HealOptions, "unitsPerMetre"> = {}): ConvertHealResult {
  const drawn = new Set<number>();
  for (const mesh of result.meshes) for (const id of mesh.elementIds ?? []) drawn.add(id);
  const level = new Map((result.nativeAssociatedLevelRelations ?? []).map((r) => [r.elementId, r.levelId]));
  const walls: HealWall[] = [];
  const source = new Map<string, { record: ElementBoundsRecord; index: number }>();
  for (const record of result.elementBounds) {
    if (record.categoryId !== WALL_CATEGORY_ID || !record.solids?.length && !record.solid && !record.arcs?.length) continue;
    const fixed = drawn.size > 0 && !drawn.has(record.elementId);
    const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
    solids.forEach((solid, index) => {
      const id = index === 0 ? `${record.elementId}` : `${record.elementId}_${index}`;
      walls.push({ id, levelId: level.get(record.elementId), start: { ...solid.start }, end: { ...solid.end }, thickness: solid.thickness, baseElevation: solid.baseElevation, topElevation: solid.topElevation, fixed });
      source.set(id, { record, index });
    });
    (record.arcs ?? []).forEach((arc, arcIndex) => arcChords(arc).forEach(([start, end], i) => {
      walls.push({ id: `${record.elementId}_arc${arcIndex}_${i}`, levelId: level.get(record.elementId), start, end, thickness: arc.thickness, baseElevation: arc.baseElevation, topElevation: arc.topElevation, fixed: true });
    }));
  }
  const healed = healWalls(walls, { ...options, unitsPerMetre: FEET_PER_METRE });
  const byRecord = new Map<ElementBoundsRecord, Map<number, HealWall>>();
  for (const wall of healed.walls) {
    const entry = source.get(wall.id);
    if (!entry || wall.fixed) continue;
    const map = byRecord.get(entry.record) ?? new Map<number, HealWall>();
    map.set(entry.index, wall);
    byRecord.set(entry.record, map);
  }
  const elementBounds = result.elementBounds.map((record) => {
    const healedSolids = byRecord.get(record);
    if (!healedSolids) return record;
    const solids: WallSolid[] = (record.solids?.length ? record.solids : record.solid ? [record.solid] : []).map((solid, index) => {
      const wall = healedSolids.get(index);
      if (!wall) return solid;
      const startMoved = wall.start.x !== solid.start.x || wall.start.y !== solid.start.y;
      const endMoved = wall.end.x !== solid.end.x || wall.end.y !== solid.end.y;
      if (!startMoved && !endMoved) return solid;
      // Joined corners describe the trim at the old end; drop them where it moved.
      return { ...solid, start: { ...wall.start }, end: { ...wall.end }, startCorners: startMoved ? undefined : solid.startCorners, endCorners: endMoved ? undefined : solid.endCorners };
    });
    const original = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
    if (solids.every((solid, index) => solid === original[index])) return record;
    const length = (s: WallSolid) => Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
    const longest = solids.reduce((a, b) => (length(b) > length(a) ? b : a));
    return { ...record, solids, solid: longest };
  });
  return { result: { ...result, elementBounds }, edits: healed.edits, before: healed.before, after: healed.after };
}
