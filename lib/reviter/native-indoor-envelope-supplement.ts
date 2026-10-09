/** Reproducible supplement to authored nativeIndoorEnvelopes (installed from candidate patch F).
 *
 * The historical envelope generator is not recoverable; reviter only validates, hashes and
 * indexes the authored field. Once separately reviewed, reversible corrections (provisional
 * seals, derived frame returns, drawing-backed assumption rows) are applied, the enclosure must be
 * re-derived or the corrected spaces stay outside the envelope and receive no native cell.
 *
 * Rule (deliberately conservative, no tolerance, no dilation, no bounding boxes, no room outlines):
 *   face(cut)  = bounded complement faces of the exact union of the barrier at that cut
 *   enclosed   = INTERSECTION of face(cut) over every supplied cut (a parapet bounded only at the
 *                ankle cut, or a facade open at any cut, is not enclosed)
 *   supplement = enclosed ∩ original native walking support − authored envelope
 * Barrier = finite original native material sections (approximate curtain-host footprints are
 * excluded, matching the authored envelope evidence), every physical door footprint closed for
 * ENCLOSURE only (portals/access unchanged), and explicitly reviewed correction rows active at the
 * cut. Authored parts are kept byte-identical; supplement parts are appended and carry their own
 * evidence, correction ids and assumption ids. */
import { nativeRationalOverlay, type NativeRationalParts, type NativeRationalOverlayInput } from "./native-rational-overlay.ts";
import { nativeExactPartsForProposals, nativeRationalPointInRing } from "./native-exact-planar-topology.ts";
import { Rational, add, sub, mul, compare, rationalScalarToIEEE as nativeRationalScalarToIEEE } from "./vendor/native-rational-overlay-arithmetic.mjs";
import { nativeIndoorEnvelopeHash, verifyNativeIndoorEnvelopes, type NativeIndoorEnvelopes } from "./native-indoor-envelopes.ts";
import { recoverNativeWallJunctionRepairs } from "./native-room-presentation.ts";
import type { IndoorDataset } from "./indoor-contract.ts";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

type Point = [number, number];
type Ring = Point[];
type Parts = Ring[][];
export type NativeEnvelopeCorrection = { id: string; assumption: boolean; partsFeet: Parts };
export type NativeEnvelopeCutBarrier = {
  cutElevationFeet: number;
  material: { nativeElementId: number; partsFeet: Parts }[];
  doorClosures: { nativeElementId: number; footprintFeet: Ring }[];
  corrections: NativeEnvelopeCorrection[];
};
export type NativeEnvelopeSupplement = {
  version: 1;
  method: "bounded-faces-intersection-over-cuts-v1";
  levelId: number;
  elevationFeet: number;
  cutElevationsFeet: number[];
  partsFeet: Parts;
  areaSqFt: number;
  sourceElementIds: number[];
  correctionIds: string[];
  assumptionIds: string[];
  evidenceSha256: string;
};
const finite = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e7);
const validParts = (ps: Parts) => Array.isArray(ps) && ps.every((part) => Array.isArray(part) && part.length > 0 && part.every((r) => Array.isArray(r) && r.length >= 3 && r.every(finite)));
const ringArea = (r: Ring) => Math.abs(r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]!; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
const partsArea = (ps: Parts) => ps.reduce((s, p) => s + p.reduce((a, r, i) => a + (i ? -1 : 1) * ringArea(r), 0), 0);

/** Exact bounded faces of the complement of a barrier union. Islands inside a cavity stay solid.
 * Pinch-aware: two material parts that meet only at a point close the free space there (a point
 * contact is not a passage). The union keeps such parts separate, so faces are traced on the exact
 * union boundary as a planar graph: every boundary edge with its free side on the left, turning
 * minimally at each vertex. Counter-clockwise cycles bound faces; clockwise cycles are island or
 * outer boundaries. Vertex identity is exact (rational); IEEE values only order edge directions. */
export function nativeBoundedFaces(barrier: Parts): NativeRationalParts {
  if (!barrier.length) return [];
  const union = nativeRationalOverlay("union", [barrier[0]!] as NativeRationalOverlayInput, ...barrier.slice(1).map((p) => [p] as NativeRationalOverlayInput));
  type RP = NativeRationalParts[number][number][number];
  const key = (p: RP) => `${p[0].n}/${p[0].d},${p[1].n}/${p[1].d}`;
  const ieeeCache = new Map<RP, Point>();
  const ieee = (p: RP): Point => { let v = ieeeCache.get(p); if (!v) ieeeCache.set(p, v = [nativeRationalScalarToIEEE(p[0]), nativeRationalScalarToIEEE(p[1])]); return v; };
  // Orientation: IEEE shoelace when clearly signed, exact rational sum otherwise.
  const signedArea = (ring: RP[]) => {
    let f = 0;
    for (let i = 0; i < ring.length; i++) { const a = ieee(ring[i]!), b = ieee(ring[(i + 1) % ring.length]!); f += a[0] * b[1] - b[0] * a[1]; }
    if (Math.abs(f) > 1e-6) return Math.sign(f);
    let s: number | Rational = new Rational(0n);
    for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; s = add(s, sub(mul(a[0], b[1]), mul(b[0], a[1]))); }
    return compare(s, new Rational(0n));
  };
  type Edge = { from: RP; to: RP; fromKey: string; toKey: string; angle: number; used: boolean };
  const out = new Map<string, Edge[]>();
  for (const part of union) part.forEach((ring0, index) => {
    let ring = ring0.length > 1 && key(ring0[0]!) === key(ring0[ring0.length - 1]!) ? ring0.slice(0, -1) : ring0;
    if (ring.length < 3) return;
    const sign = signedArea(ring);
    // material on the left: exterior counter-clockwise, holes clockwise
    if ((index === 0 && sign < 0) || (index > 0 && sign > 0)) ring = [...ring].reverse();
    for (let i = 0; i < ring.length; i++) {
      // free-side half-edge = reversed material edge
      const from = ring[(i + 1) % ring.length]!, to = ring[i]!;
      const fromKey = key(from), toKey = key(to);
      if (fromKey === toKey) continue;
      const f = ieee(from), t = ieee(to);
      const e: Edge = { from, to, fromKey, toKey, angle: Math.atan2(t[1] - f[1], t[0] - f[0]), used: false };
      out.set(fromKey, [...(out.get(fromKey) ?? []), e]);
    }
  });
  const cycles: RP[][] = [];
  for (const edges of out.values()) for (const start of edges) {
    if (start.used) continue;
    const ring: RP[] = [];
    let e: Edge | undefined = start, guard = 0;
    while (e && !e.used && guard++ < 10_000_000) {
      e.used = true; ring.push(e.from);
      const f = ieee(e.to), back = ieee(e.from), inAngle = Math.atan2(back[1] - f[1], back[0] - f[0]);
      let best: Edge | undefined, bestTurn = Infinity;
      for (const c of out.get(e.toKey) ?? []) {
        if (c.used && c !== start) continue;
        let turn = inAngle - c.angle; while (turn <= 0) turn += 2 * Math.PI; while (turn > 2 * Math.PI) turn -= 2 * Math.PI;
        if (turn < bestTurn) { bestTurn = turn; best = c; }
      }
      if (best === start) break;
      e = best;
    }
    if (ring.length >= 3) cycles.push(ring);
  }
  const signs = new Map(cycles.map((r) => [r, signedArea(r)]));
  const faces = cycles.filter((r) => signs.get(r)! > 0);
  const islands = cycles.filter((r) => signs.get(r)! < 0);
  const box = (r: RP[]) => { const ps = r.map(ieee); return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))]; };
  const faceInfo = faces.map((f) => { const b = box(f); return { f, b, area: (b[2] - b[0]) * (b[3] - b[1]) }; }).sort((x, y) => x.area - y.area);
  const holes = new Map<RP[], RP[][]>(faces.map((f) => [f, []]));
  for (const island of islands) {
    const ib = box(island);
    for (const { f, b } of faceInfo) {
      if (ib[0] < b[0] || ib[1] < b[1] || ib[2] > b[2] || ib[3] > b[3]) continue;
      // exact: the first island vertex strictly off the face boundary decides containment
      let side = 0;
      for (const p of island) { side = nativeRationalPointInRing(p, f); if (side) break; }
      if (side === 1) { holes.get(f)!.push(island); break; }
    }
  }
  return faces.map((f) => [f, ...holes.get(f)!]);
}

export function deriveNativeIndoorEnvelopeSupplement(input: {
  levelId: number;
  elevationFeet: number;
  cuts: NativeEnvelopeCutBarrier[];
  walkingSupportPartsFeet: Parts;
  authoredPartsFeet: Parts;
}): NativeEnvelopeSupplement {
  const { levelId, elevationFeet, cuts } = input;
  if (!Number.isSafeInteger(levelId) || !Number.isFinite(elevationFeet) || !cuts.length || cuts.length > 16)
    throw new Error("Envelope supplement needs a native level and 1-16 material cuts.");
  if (cuts.some((c) => !Number.isFinite(c.cutElevationFeet) || c.cutElevationFeet <= elevationFeet || c.cutElevationFeet > elevationFeet + 20))
    throw new Error("Envelope supplement cut heights must lie above the level and within 20 ft.");
  if (new Set(cuts.map((c) => c.cutElevationFeet)).size !== cuts.length) throw new Error("Duplicate envelope cut height.");
  if (!validParts(input.walkingSupportPartsFeet) || !input.walkingSupportPartsFeet.length) throw new Error("Envelope supplement needs original native walking support.");
  let enclosed: NativeRationalParts | undefined;
  const sourceIds = new Set<number>(), correctionIds = new Set<string>(), assumptionIds = new Set<string>();
  for (const cut of cuts) {
    const barrier: Parts = [];
    for (const m of cut.material) {
      if (!Number.isSafeInteger(m.nativeElementId) || m.nativeElementId <= 0 || !validParts(m.partsFeet)) throw new Error("Invalid original native material section.");
      barrier.push(...m.partsFeet); sourceIds.add(m.nativeElementId);
    }
    for (const d of cut.doorClosures) {
      if (!Array.isArray(d.footprintFeet) || d.footprintFeet.length < 3 || !d.footprintFeet.every(finite)) throw new Error("Invalid physical door footprint.");
      barrier.push([d.footprintFeet]);
    }
    for (const c of cut.corrections) {
      if (typeof c.id !== "string" || !c.id.trim() || !validParts(c.partsFeet)) throw new Error("Invalid reviewed envelope correction.");
      barrier.push(...c.partsFeet); correctionIds.add(c.id); if (c.assumption) assumptionIds.add(c.id);
    }
    const faces = nativeBoundedFaces(barrier);
    enclosed = enclosed === undefined ? faces : (enclosed.length && faces.length ? nativeRationalOverlay("intersection", enclosed, faces) : []);
    if (!enclosed.length) break;
  }
  let supplement: NativeRationalParts = enclosed?.length ? nativeRationalOverlay("intersection", enclosed, input.walkingSupportPartsFeet as NativeRationalOverlayInput) : [];
  if (supplement.length && input.authoredPartsFeet.length) supplement = nativeRationalOverlay("difference", supplement, input.authoredPartsFeet as NativeRationalOverlayInput);
  const partsFeet = nativeExactPartsForProposals(supplement) as Parts;
  const body = { levelId, elevationFeet, cutElevationsFeet: cuts.map((c) => c.cutElevationFeet), partsFeet, sourceElementIds: [...sourceIds].sort((a, b) => a - b), correctionIds: [...correctionIds].sort(), assumptionIds: [...assumptionIds].sort() };
  return { version: 1, method: "bounded-faces-intersection-over-cuts-v1", ...body, areaSqFt: partsArea(partsFeet), evidenceSha256: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(body)))) };
}

export type NativeIndoorEnvelopeSupplementRecord = Omit<NativeEnvelopeSupplement, "partsFeet"> & { partStartIndex: number; partCount: number };
type SupplementedLevel = NativeIndoorEnvelopes["levels"][number] & { supplements?: NativeIndoorEnvelopeSupplementRecord[] };
type SupplementedEnvelopes = Omit<NativeIndoorEnvelopes, "levels"> & { authoredGeometrySha256?: string; levels: SupplementedLevel[] };

/** Append supplements. Authored parts, sourceElementIds, cuts, evidence and provisional bindings
 * stay byte-identical; each supplement records its own parts range, sources, correction and
 * assumption ids. `authoredGeometrySha256` keeps the authored checksum so the authored envelope
 * can be recovered exactly (source/prepared parity) and the supplement reversed. */
export async function mergeNativeIndoorEnvelopeSupplements(envelopes: NativeIndoorEnvelopes, supplements: NativeEnvelopeSupplement[], model: string): Promise<NativeIndoorEnvelopes> {
  await verifyNativeIndoorEnvelopes(envelopes, model);
  if ((envelopes as unknown as SupplementedEnvelopes).authoredGeometrySha256 !== undefined || envelopes.levels.some((l) => (l as SupplementedLevel).supplements !== undefined))
    throw new Error("Authored native indoor envelopes already carry a supplement; supplements are derived, never authored.");
  let changed = false;
  const levels = envelopes.levels.map((level) => {
    const own = supplements.filter((s) => s.levelId === level.levelId && Math.abs(s.elevationFeet - level.elevationFeet) < 1e-9 && s.partsFeet.length);
    if (!own.length) return level;
    changed = true;
    let start = level.partsFeet.length;
    const records = own.map((s) => {
      const { partsFeet, ...rest } = s;
      const record = { ...rest, partStartIndex: start, partCount: partsFeet.length };
      start += partsFeet.length;
      return record;
    });
    return { ...level, partsFeet: [...level.partsFeet, ...own.flatMap((s) => s.partsFeet)], supplements: records };
  });
  if (!changed) return envelopes;
  const geometrySha256 = await nativeIndoorEnvelopeHash({ version: 1, sourceModelSha256: envelopes.sourceModelSha256, levels });
  // Key order follows the authored object so the authored envelope is recovered byte for byte.
  const result = { ...envelopes, levels, geometrySha256, authoredGeometrySha256: envelopes.geometrySha256 } as NativeIndoorEnvelopes;
  await verifyNativeIndoorEnvelopes(result, model);
  validateNativeIndoorEnvelopeSupplements(result);
  return result;
}

/** Structural check of derived supplement records (parts appended contiguously after authored parts). */
export function validateNativeIndoorEnvelopeSupplements(value: NativeIndoorEnvelopes | undefined) {
  const v = value as unknown as SupplementedEnvelopes | undefined;
  if (!v) return;
  const any = v.levels.some((l) => l.supplements !== undefined);
  if (!any) { if (v.authoredGeometrySha256 !== undefined) throw new Error("Native envelope supplement binding without supplements."); return; }
  if (typeof v.authoredGeometrySha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.authoredGeometrySha256)) throw new Error("Native envelope supplement lost its authored checksum.");
  for (const level of v.levels) {
    if (level.supplements === undefined) continue;
    if (!Array.isArray(level.supplements) || !level.supplements.length) throw new Error("Invalid native envelope supplement records.");
    let next = level.supplements[0]!.partStartIndex;
    for (const s of level.supplements) {
      if (s.version !== 1 || s.method !== "bounded-faces-intersection-over-cuts-v1" || s.levelId !== level.levelId || s.elevationFeet !== level.elevationFeet ||
        !Number.isSafeInteger(s.partStartIndex) || !Number.isSafeInteger(s.partCount) || s.partCount < 1 || s.partStartIndex !== next ||
        !/^[a-f0-9]{64}$/.test(s.evidenceSha256) || !Array.isArray(s.correctionIds) || !Array.isArray(s.assumptionIds) || s.assumptionIds.some((id) => !s.correctionIds.includes(id)) ||
        !Array.isArray(s.cutElevationsFeet) || s.cutElevationsFeet.some((z) => !level.cutElevationsFeet.includes(z)))
        throw new Error("Invalid native envelope supplement records.");
      next += s.partCount;
    }
    if (next !== level.partsFeet.length || level.supplements[0]!.partStartIndex < 1) throw new Error("Native envelope supplement parts must follow every authored part.");
  }
}

/** Exact authored envelope (supplement parts and records removed), for source/prepared parity. */
export async function nativeIndoorEnvelopeAuthored(value: NativeIndoorEnvelopes | undefined): Promise<NativeIndoorEnvelopes | undefined> {
  const v = value as unknown as SupplementedEnvelopes | undefined;
  if (!v || v.authoredGeometrySha256 === undefined) return value;
  validateNativeIndoorEnvelopeSupplements(v);
  const levels = v.levels.map((level) => {
    if (!level.supplements) return level;
    const { supplements, ...authored } = level;
    return { ...authored, partsFeet: level.partsFeet.slice(0, supplements[0]!.partStartIndex) };
  });
  const { authoredGeometrySha256, ...rest } = v;
  const authored = { ...rest, geometrySha256: authoredGeometrySha256, levels } as unknown as NativeIndoorEnvelopes;
  if (await nativeIndoorEnvelopeHash(authored) !== authoredGeometrySha256) throw new Error("Native envelope supplement does not preserve the authored envelope.");
  return authored;
}

/** Barrier adapter for a compiled dataset at one material cut. Approximate curtain-host
 * footprints (sections carrying sourceAssemblyChildIds) are excluded; their finite members remain. */
export function nativeEnvelopeBarrierFromDataset(
  data: Pick<IndoorDataset, "doors"> & { nativeMaterialSections?: { levels: { levelId: number; elevationFeet: number; cutElevationFeet: number; sections: { nativeElementId: number; kind: string; partsFeet: Parts; sourceAssemblyChildIds?: number[] }[] }[] } },
  levelId: number,
  cutElevationFeet: number,
  reviewedCorrections: NativeEnvelopeCorrection[],
  options: {
    productionJunctionRepairs?: boolean;
    /** Close physical doors of ANY native level whose door leaf spans the cut height. Without it only
     * the level's own doors close, and an intermediate-level cut that passes through another storey's
     * doorway leaves that doorway open (observed: Floor 0.5 at +4 ft runs through Floor 1 entrances). */
    doorVerticalExtentFeet?: (door: NonNullable<IndoorDataset["doors"]>[number]) => [number, number] | undefined;
  } = {},
): NativeEnvelopeCutBarrier {
  const row = data.nativeMaterialSections?.levels.find((l) => l.levelId === levelId && Math.abs(l.cutElevationFeet - cutElevationFeet) < 1e-6);
  if (!row) throw new Error(`No original material section for level ${levelId} at ${cutElevationFeet}.`);
  const finiteSections = row.sections.filter((s) => !s.sourceAssemblyChildIds);
  const doors = (data.doors ?? []).filter((d) => {
    if (!d.footprintFeet || d.footprintFeet.length < 3) return false;
    if (d.levelId === levelId) return true;
    const extent = options.doorVerticalExtentFeet?.(d);
    return !!extent && extent[0] < cutElevationFeet && cutElevationFeet < extent[1];
  });
  const corrections = [...reviewedCorrections];
  if (options.productionJunctionRepairs) {
    const ownDoors = doors.filter((d) => d.levelId === levelId);
    const walls = finiteSections.flatMap((s) => s.partsFeet.map((part) => ({ levelId, nativeElementId: s.nativeElementId, kind: s.kind, approximate: false, ringsFeet: part }))) as unknown as IndoorDataset["walls"];
    for (const r of recoverNativeWallJunctionRepairs(walls, ownDoors as NonNullable<IndoorDataset["doors"]>))
      corrections.push({ id: `production-junction:${levelId}:${cutElevationFeet}:${r.nativeWallElementId}-${r.supportingElementId}:${r.repairKind}`, assumption: false, partsFeet: [r.ringsFeet as Ring[]] });
  }
  return {
    cutElevationFeet,
    material: finiteSections.map((s) => ({ nativeElementId: s.nativeElementId, partsFeet: s.partsFeet })),
    doorClosures: doors.map((d) => ({ nativeElementId: d.nativeElementId!, footprintFeet: d.footprintFeet as Ring })),
    corrections,
  };
}

type ZRow = { id: string; state?: string; baseElevationFeet: number; topElevationFeet: number; partsFeet: Parts; assumption?: unknown };
/** Compiler step: derive and append supplements for every authored envelope level from the
 * original material sections at that level's own authored cut heights. The barrier consumes every
 * applied reviewed correction row whose vertical band contains the cut (provisional/drawing-backed
 * seals of any role, derived frame returns), the level's reviewed wall-position repairs, production
 * junction repairs, physical door footprints of the level, reviewed door boundary closures, and the
 * physical doors of any other level whose own native leaf extent spans the cut. Reviewed indoor
 * exclusions are removed from the supplement. Returns the envelopes unchanged when nothing is added. */
export async function supplementNativeIndoorEnvelopes(input: {
  envelopes: NativeIndoorEnvelopes | undefined;
  model: string;
  materialSections: Parameters<typeof nativeEnvelopeBarrierFromDataset>[0]["nativeMaterialSections"];
  walkingSupportFloors: { elevationFeet: number; partsFeet: Parts }[];
  doors: { levelId: number; nativeElementId: number; footprintFeet?: Ring; verticalExtentFeet?: [number, number] }[];
  provisionalRows?: ZRow[];
  frameReturnRows?: ZRow[];
  wallPositionRepairs?: { id: string; levelId: number; ringsFeet: Ring[] }[];
  exclusions?: { id: string; levelId: number; elevationFeet: number; partsFeet: Parts }[];
}): Promise<{ envelopes: NativeIndoorEnvelopes | undefined; supplements: NativeEnvelopeSupplement[] }> {
  const { envelopes, model } = input;
  if (!envelopes || !input.materialSections) return { envelopes, supplements: [] };
  const supplements: NativeEnvelopeSupplement[] = [];
  const doorExtent = new Map(input.doors.map((d) => [d, d.verticalExtentFeet] as const));
  for (const level of envelopes.levels) {
    const cuts = level.cutElevationsFeet.filter((z) => input.materialSections!.levels.some((l) => l.levelId === level.levelId && Math.abs(l.cutElevationFeet - z) < 1e-6));
    if (!cuts.length) continue;
    const support = input.walkingSupportFloors.filter((f) => Math.abs(f.elevationFeet - level.elevationFeet) < 0.05).flatMap((f) => f.partsFeet);
    if (!support.length) continue;
    const barriers = cuts.map((cut) => {
      const active = (r: ZRow) => (r.state === undefined || r.state === "applied") && r.baseElevationFeet <= cut && cut < r.topElevationFeet && r.partsFeet.length > 0;
      const corrections: NativeEnvelopeCorrection[] = [
        ...(input.provisionalRows ?? []).filter(active).map((r) => ({ id: r.id, assumption: true, partsFeet: r.partsFeet })),
        ...(input.frameReturnRows ?? []).filter(active).map((r) => ({ id: r.id, assumption: false, partsFeet: r.partsFeet })),
        ...(input.wallPositionRepairs ?? []).filter((w) => w.levelId === level.levelId).map((w) => ({ id: w.id, assumption: false, partsFeet: [w.ringsFeet] })),
      ];
      return nativeEnvelopeBarrierFromDataset({ doors: input.doors as never, nativeMaterialSections: input.materialSections }, level.levelId, cut, corrections, {
        productionJunctionRepairs: true,
        doorVerticalExtentFeet: (d) => doorExtent.get(d as never),
      });
    });
    const s = deriveNativeIndoorEnvelopeSupplement({ levelId: level.levelId, elevationFeet: level.elevationFeet, cuts: barriers, walkingSupportPartsFeet: support, authoredPartsFeet: level.partsFeet });
    let parts = s.partsFeet;
    const excluded = (input.exclusions ?? []).filter((a) => a.levelId === level.levelId && Math.abs(a.elevationFeet - level.elevationFeet) < 0.15).flatMap((a) => a.partsFeet);
    if (parts.length && excluded.length) parts = nativeExactPartsForProposals(nativeRationalOverlay("difference", parts as NativeRationalOverlayInput, excluded as NativeRationalOverlayInput)) as Parts;
    if (!parts.length) continue;
    if (parts === s.partsFeet) { supplements.push(s); continue; }
    const body = { levelId: s.levelId, elevationFeet: s.elevationFeet, cutElevationsFeet: s.cutElevationsFeet, partsFeet: parts, sourceElementIds: s.sourceElementIds, correctionIds: s.correctionIds, assumptionIds: s.assumptionIds };
    supplements.push({ version: 1, method: s.method, ...body, areaSqFt: partsArea(parts), evidenceSha256: bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(body)))) });
  }
  return { envelopes: supplements.length ? await mergeNativeIndoorEnvelopeSupplements(envelopes, supplements, model) : envelopes, supplements };
}
