/** Owner-adopted generic FLOOR-EDGE rules for the native indoor envelope barrier.
 *
 * Where one level's walking floor meets a floor at another height, or a hole in its own slab, the
 * envelope enclosure would otherwise leak over the edge (an ankle cut under a raised slab, a +4 ft
 * cut into a lower storey's airspace, a curtain slot that opens only onto an atrium). Each rule adds
 * BARRIER rows only; the envelope supplement is still (bounded faces at every cut) ∩ original walking
 * support − authored envelope, so no rule ever makes a non-floor walkable.
 *
 *   step       a higher original walking slab whose top lies within STEP_RISE_FEET above a cut is
 *              solid at that cut (band [z − STEP_RISE_FEET, z)).
 *   drop-edge  the part of a lower original walking slab (DROP_MIN..DROP_MAX ft below) that this
 *              level's own walking slabs do not cover is a boundary for this level
 *              (band [e + BAND_BASE, e + BAND_TOP)).
 *   void-edge  a hole of this level's own slab that no original walking slab fills between
 *              e − VOID_BELOW and e + VOID_ABOVE is a barrier (band [e + BAND_BASE, e + VOID_ABOVE)).
 *
 * Connectors: where a native stair/ramp, or a qualified recipe stair/ramp, climbs across a rule
 * edge (its vertical extent spans the edge's whole height change), its footprint (treads,
 * landings, ramp surface) and explicit attachment areas are removed from that rule's row, so the
 * rule never closes a connector or moves its attachment. The row records the connector ids it
 * yielded to. Exact rational overlay throughout (no buffering, no tolerance, no bounding-box
 * geometry, no room outlines); bounding boxes only prefilter candidate pairs conservatively. Row
 * parts below `minPartSqFt` are dropped (a sub-ulp crack is not an edge).
 * Inputs are processed in a canonical order so output bytes do not depend on input order. */
import { nativeRationalOverlay, type NativeRationalOverlayInput } from "./native-rational-overlay.ts";
import { nativeExactPartsForProposals } from "./native-exact-planar-topology.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

type Point = [number, number];
type Ring = Point[];
type Parts = Ring[][];

export const NATIVE_FLOOR_EDGE_RULE_IDS = {
  step: "native-floor-edge-step-v1",
  "drop-edge": "native-floor-edge-drop-v1",
  "void-edge": "native-floor-edge-void-v1",
} as const;
export type NativeFloorEdgeRuleName = keyof typeof NATIVE_FLOOR_EDGE_RULE_IDS;
export const NATIVE_FLOOR_EDGE_RULE_NAMES = Object.keys(NATIVE_FLOOR_EDGE_RULE_IDS) as NativeFloorEdgeRuleName[];
/** Rule constants (feet). They are part of the rule versions above; changing one is a new rule. */
export const NATIVE_FLOOR_EDGE_CONSTANTS = Object.freeze({
  ownLevelFeet: 0.05,
  /** A stair or ramp whose end lies within this of an edge height ends at that edge: the source run
   * can stop a tread or finish thickness short of the slab top it arrives on (the same
   * walkable-step allowance as dropMinFeet / voidBelowFeet). */
  connectorEndFeet: 0.5,
  stepRiseFeet: 4,
  dropMinFeet: 0.5,
  dropMaxFeet: 8,
  voidBelowFeet: 0.5,
  voidAboveFeet: 7,
  bandBaseFeet: 0.05,
  bandTopFeet: 7,
  minPartSqFt: 0.01,
});

/** Reviewed project setting: which rules the owner adopted and under which recorded decision. */
export type NativeFloorEdgeRules = {
  version: 1;
  sourceModelSha256: string;
  rules: NativeFloorEdgeRuleName[];
  decisionId: string;
  notes?: string;
};
export type NativeFloorEdgeConnector = {
  id: string;
  kind: "stair" | "ramp";
  /** native: the source model draws the connector; recipe: a qualified reviewed recipe does. */
  sources: ("native" | "recipe")[];
  bottomElevationFeet: number;
  topElevationFeet: number;
  /** Plan footprint: treads, landings, ramp surface. */
  footprintFeet: Parts;
  /** Optional explicit attachment areas (landing approaches) that the rules must not cover. */
  attachmentsFeet?: Parts;
};
export type NativeFloorEdgeFloor = { nativeElementId: number; elevationFeet: number; partsFeet: Parts };
export type NativeFloorEdgeRow = {
  id: string;
  rule: (typeof NATIVE_FLOOR_EDGE_RULE_IDS)[NativeFloorEdgeRuleName];
  state: "applied";
  decisionId: string;
  levelId: number;
  elevationFeet: number;
  baseElevationFeet: number;
  topElevationFeet: number;
  sourceSlabNativeElementId: number;
  sourceSlabElevationFeet: number;
  sourceHole?: { partIndex: number; ringIndex: number };
  /** Connectors whose footprint/attachment was removed from this row. */
  yieldedConnectorIds: string[];
  partsFeet: Parts;
  areaSqFt: number;
};

const finite = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7);
const validParts = (ps: unknown): ps is Parts => Array.isArray(ps) && ps.every((part) => Array.isArray(part) && part.length > 0 && part.every((r) => Array.isArray(r) && r.length >= 3 && r.every(finite)));
const ringArea = (r: Ring) => Math.abs(r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]!; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
const partArea = (p: Ring[]) => p.reduce((a, r, i) => a + (i ? -1 : 1) * ringArea(r), 0);
const partsArea = (ps: Parts) => ps.reduce((s, p) => s + partArea(p), 0);
type Box = [number, number, number, number];
const boxOf = (ps: Parts): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const part of ps) for (const p of part[0] ?? []) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  return [x0, y0, x1, y1];
};
/** Conservative: positive-area overlap needs strictly overlapping boxes. */
const boxesOverlap = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const overlay = (op: "difference" | "intersection", a: Parts, ...b: Parts[]) => nativeExactPartsForProposals(nativeRationalOverlay(op, a as NativeRationalOverlayInput, ...(b as NativeRationalOverlayInput[]))) as Parts;
const keep = (ps: Parts) => ps.filter((p) => partArea(p) >= NATIVE_FLOOR_EDGE_CONSTANTS.minPartSqFt);

export function validateNativeFloorEdgeRules(value: NativeFloorEdgeRules | undefined, model?: string): void {
  if (value === undefined) return;
  if (!value || value.version !== 1 || typeof value.sourceModelSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sourceModelSha256) || (model && value.sourceModelSha256 !== model) ||
    !Array.isArray(value.rules) || !value.rules.length || value.rules.some((r) => !NATIVE_FLOOR_EDGE_RULE_NAMES.includes(r)) || new Set(value.rules).size !== value.rules.length ||
    typeof value.decisionId !== "string" || !value.decisionId.trim() || value.decisionId.length > 200 ||
    (value.notes !== undefined && (typeof value.notes !== "string" || value.notes.length > 10000)))
    throw new Error("Invalid native floor-edge rule setting: it needs this model, one or more known rules and the recorded owner decision.");
}

export function validateNativeFloorEdgeConnectors(connectors: readonly NativeFloorEdgeConnector[]): void {
  const ids = new Set<string>();
  for (const c of connectors) {
    if (!c || typeof c.id !== "string" || !c.id.trim() || c.id.length > 300 || ids.has(c.id) || (c.kind !== "stair" && c.kind !== "ramp") ||
      !Array.isArray(c.sources) || !c.sources.length || c.sources.some((s) => s !== "native" && s !== "recipe") ||
      !Number.isFinite(c.bottomElevationFeet) || !Number.isFinite(c.topElevationFeet) || c.bottomElevationFeet > c.topElevationFeet ||
      !validParts(c.footprintFeet) || !c.footprintFeet.length || (c.attachmentsFeet !== undefined && !validParts(c.attachmentsFeet)))
      throw new Error(`Invalid floor-edge connector ${String(c?.id)}.`);
    ids.add(c.id);
  }
}

/** Rows of every adopted rule for one level. `cutElevationsFeet` are the level's material cuts; a
 * row is emitted only when its band contains at least one of them. */
export function deriveNativeFloorEdgeRows(input: {
  levelId: number;
  elevationFeet: number;
  cutElevationsFeet: number[];
  floors: NativeFloorEdgeFloor[];
  connectors?: NativeFloorEdgeConnector[];
  settings: NativeFloorEdgeRules;
}): NativeFloorEdgeRow[] {
  const { levelId, elevationFeet: e, settings } = input;
  const K = NATIVE_FLOOR_EDGE_CONSTANTS;
  if (!Number.isSafeInteger(levelId) || !Number.isFinite(e) || !input.cutElevationsFeet.length || input.cutElevationsFeet.some((c) => !Number.isFinite(c)))
    throw new Error("Floor-edge rules need a native level and its material cuts.");
  validateNativeFloorEdgeRules(settings);
  for (const f of input.floors) if (!Number.isSafeInteger(f.nativeElementId) || !Number.isFinite(f.elevationFeet) || !validParts(f.partsFeet)) throw new Error("Invalid original walking slab for floor-edge rules.");
  const connectors = [...(input.connectors ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  validateNativeFloorEdgeConnectors(connectors);
  const floors = [...input.floors].filter((f) => f.partsFeet.length).sort((a, b) => a.elevationFeet - b.elevationFeet || a.nativeElementId - b.nativeElementId);
  const own = floors.filter((f) => Math.abs(f.elevationFeet - e) < K.ownLevelFeet);
  const ownParts = own.flatMap((f) => f.partsFeet);
  const active = (base: number, top: number) => input.cutElevationsFeet.some((c) => base <= c && c < top);
  const connectorBoxes = new Map(connectors.map((c) => [c.id, boxOf([...c.footprintFeet, ...(c.attachmentsFeet ?? [])])]));
  /** Remove the footprint/attachment of every connector that spans the whole height change [lo, hi]
   * (it climbs across this edge, or ends at it within connectorEndFeet) and overlaps the row. */
  const yieldTo = (parts: Parts, lo: number, hi: number) => {
    const yielded: string[] = [];
    let out = parts;
    for (const c of connectors) {
      if (!out.length) break;
      if (!(c.bottomElevationFeet <= lo + K.connectorEndFeet && c.topElevationFeet >= hi - K.connectorEndFeet)) continue;
      if (!boxesOverlap(boxOf(out), connectorBoxes.get(c.id)!)) continue;
      const cut = [...c.footprintFeet, ...(c.attachmentsFeet ?? [])];
      if (!overlay("intersection", out, cut).some((p) => partArea(p) > 0)) continue;
      out = overlay("difference", out, cut);
      yielded.push(c.id);
    }
    return { parts: keep(out), yielded };
  };
  const rows: NativeFloorEdgeRow[] = [];
  const push = (rule: NativeFloorEdgeRuleName, suffix: string, slab: NativeFloorEdgeFloor, base: number, top: number, parts: Parts, lo: number, hi: number, sourceHole?: { partIndex: number; ringIndex: number }) => {
    const kept = keep(parts);
    if (!kept.length) return;
    const { parts: final, yielded } = yieldTo(kept, lo, hi);
    if (!final.length) return;
    rows.push({
      id: `${NATIVE_FLOOR_EDGE_RULE_IDS[rule]}:${levelId}:${slab.nativeElementId}${suffix}`,
      rule: NATIVE_FLOOR_EDGE_RULE_IDS[rule], state: "applied", decisionId: settings.decisionId,
      levelId, elevationFeet: e, baseElevationFeet: base, topElevationFeet: top,
      sourceSlabNativeElementId: slab.nativeElementId, sourceSlabElevationFeet: slab.elevationFeet,
      ...(sourceHole ? { sourceHole } : {}), yieldedConnectorIds: yielded, partsFeet: final, areaSqFt: partsArea(final),
    });
  };
  const rules = new Set(settings.rules);
  if (rules.has("step")) for (const f of floors) {
    if (!(f.elevationFeet >= e + K.ownLevelFeet)) continue;
    const base = f.elevationFeet - K.stepRiseFeet, top = f.elevationFeet;
    if (!active(base, top)) continue;
    push("step", "", f, base, top, f.partsFeet, e, f.elevationFeet);
  }
  if (rules.has("drop-edge")) for (const f of floors) {
    const drop = e - f.elevationFeet;
    if (!(drop >= K.dropMinFeet && drop <= K.dropMaxFeet)) continue;
    const base = e + K.bandBaseFeet, top = e + K.bandTopFeet;
    if (!active(base, top)) continue;
    push("drop-edge", "", f, base, top, ownParts.length ? overlay("difference", f.partsFeet, ownParts) : f.partsFeet, f.elevationFeet, e);
  }
  if (rules.has("void-edge")) {
    const base = e + K.bandBaseFeet, top = e + K.voidAboveFeet;
    const near = floors.filter((f) => f.elevationFeet >= e - K.voidBelowFeet && f.elevationFeet <= e + K.voidAboveFeet).flatMap((f) => f.partsFeet);
    if (active(base, top)) for (const slab of own) slab.partsFeet.forEach((part, partIndex) => part.slice(1).forEach((hole, k) => {
      const ringIndex = k + 1;
      // the slab itself never covers its own hole; every walking slab in the band may fill it
      push("void-edge", `:${partIndex}.${ringIndex}`, slab, base, top, overlay("difference", [[hole]], near), e, e, { partIndex, ringIndex });
    }));
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Barrier corrections of one cut (same contract as reviewed correction rows). */
export function nativeFloorEdgeCorrectionsAt(rows: readonly NativeFloorEdgeRow[], cutElevationFeet: number) {
  return rows.filter((r) => r.baseElevationFeet <= cutElevationFeet && cutElevationFeet < r.topElevationFeet).map((r) => ({ id: r.id, assumption: false, partsFeet: r.partsFeet }));
}

/** Provenance checksum of a level's floor-edge rows (ids, rules, bands, sources, yielded connectors, geometry). */
export function nativeFloorEdgeRowsSha256(rows: readonly NativeFloorEdgeRow[]): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(rows.map((r) => [r.id, r.rule, r.decisionId, r.levelId, r.elevationFeet, r.baseElevationFeet, r.topElevationFeet, r.sourceSlabNativeElementId, r.sourceSlabElevationFeet, r.sourceHole ?? null, r.yieldedConnectorIds, r.partsFeet])))));
}

export const nativeFloorEdgeRuleOfRowId = (id: string): NativeFloorEdgeRuleName | undefined =>
  NATIVE_FLOOR_EDGE_RULE_NAMES.find((name) => id.startsWith(`${NATIVE_FLOOR_EDGE_RULE_IDS[name]}:`));
