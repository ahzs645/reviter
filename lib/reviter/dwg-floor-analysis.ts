/** Drawing-only floor correspondence. Never creates native levels or routes. */
import polygonClipping from "polygon-clipping";
import type { Polygon, MultiPolygon } from "polygon-clipping";
import { fitFloorReferenceTransform, applyFloorReferenceTransform,
  type FloorReferenceTransform } from "./floor-reference-overlay.ts";

type Point = [number, number];
type Primitive = { sourceHandle: string; pointsMetres: Point[] };
type Area = { id: string; ringsMetres: Point[][]; sourceHandles: string[];
  runIds: string[]; conflictingRoomKeys?: string[] };
export type CadAnalysisFloor = {
  id: string; buildingCode: string; name: string; ordinal: number;
  alignment: { status: string; method?: string; overlapScore?: number; alternativeScore?: number };
  primitives: Primitive[]; stairAreas: Area[];
  rooms?: { key: string; number: string; name: string; anchorMetres: Point; source?: { handle: string } }[];
  stairs: { id: string; stairAreaId: string | null }[];
  stairReview: unknown[];
  regions: { roomKey: string; number: string; status: string }[];
};
export type CadFloorControl = {
  floorId: string; referenceFloorId: string;
  pairs: { id: string; sourceHandle: string; referenceHandle: string;
    pointMetres: Point; referencePointMetres: Point }[];
};
const identity: FloorReferenceTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const finite = (p: Point) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const distance = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], den = dx * dx + dy * dy;
  const t = den ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
function onSource(floor: CadAnalysisFloor, handle: string, p: Point) {
  const stroke = floor.primitives.find(v => v.sourceHandle === handle);
  return !!stroke && stroke.pointsMetres.slice(1).some((b, i) =>
    distance(p, stroke.pointsMetres[i]!, b) <= 0.00002);
}
function spread(points: Point[]) {
  const origin = points[0]!;
  return points.some(a => points.some(b => Math.abs(
    (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]),
  ) > 0.01));
}
/** Reuse Reviter's non-stretched fitter, lock drawing units and check finite source contacts. */
export function fitCadFloorControls(floor: CadAnalysisFloor, reference: CadAnalysisFloor, control: CadFloorControl) {
  if (floor.buildingCode !== reference.buildingCode || floor.id === reference.id
    || control.floorId !== floor.id || control.referenceFloorId !== reference.id) {
    throw new Error("Controls must join distinct floors in the same building.");
  }
  const pairs = control.pairs;
  if (!Array.isArray(pairs) || pairs.length < 3
    || new Set(pairs.map(p => p.id)).size !== pairs.length
    || new Set(pairs.map(p => JSON.stringify(p.pointMetres))).size !== pairs.length
    || new Set(pairs.map(p => JSON.stringify(p.referencePointMetres))).size !== pairs.length
    || pairs.some(p => !p.id || !finite(p.pointMetres) || !finite(p.referencePointMetres)
      || !onSource(floor, p.sourceHandle, p.pointMetres)
      || !onSource(reference, p.referenceHandle, p.referencePointMetres))
    || !spread(pairs.map(p => p.pointMetres)) || !spread(pairs.map(p => p.referencePointMetres))) {
    throw new Error("At least three distinct, distributed controls on original source strokes are required.");
  }
  const fitted = fitFloorReferenceTransform(pairs.map(p => ({
    reference: { x: p.pointMetres[0], y: p.pointMetres[1] },
    rvt: { x: p.referencePointMetres[0], y: p.referencePointMetres[1] },
  })));
  const scale = Math.hypot(fitted.transform.a, fitted.transform.b);
  if (!Number.isFinite(scale) || Math.abs(scale - 1) > 0.001) {
    throw new Error("Controls disagree with the established drawing scale; no stretching is allowed.");
  }
  // Fit only rigid rotation/translation after checking the uniform-scale result.
  const a = fitted.transform.a / scale, b = fitted.transform.b / scale;
  const mean = (key: "pointMetres" | "referencePointMetres"): Point => [
    pairs.reduce((s, p) => s + p[key][0], 0) / pairs.length,
    pairs.reduce((s, p) => s + p[key][1], 0) / pairs.length,
  ];
  const p = mean("pointMetres"), q = mean("referencePointMetres");
  const transform = { a, b, c: -b, d: a, e: q[0] - a * p[0] + b * p[1], f: q[1] - b * p[0] - a * p[1] };
  const errors = pairs.map(p => {
    const fitted = applyFloorReferenceTransform(transform, { x: p.pointMetres[0], y: p.pointMetres[1] });
    return Math.hypot(fitted.x - p.referencePointMetres[0], fitted.y - p.referencePointMetres[1]);
  });
  const rmsMetres = Math.sqrt(errors.reduce((sum, v) => sum + v * v, 0) / errors.length);
  const maximumMetres = Math.max(...errors);
  if (rmsMetres > 0.05 || maximumMetres > 0.1) throw new Error("Floor controls disagree; inspect the source features before alignment.");
  return { transform, rmsMetres, maximumMetres, controlCount: pairs.length,
    uniformScaleCheck: scale, controls: pairs, status: "control-checked-local-alignment" as const };
}
function areaOf(geometry: MultiPolygon) {
  const ringArea = (ring: number[][]) => Math.abs(ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return sum + p[0]! * q[1]! - q[0]! * p[1]!;
  }, 0)) / 2;
  return geometry.reduce((sum, p) => sum + p.reduce((s, r, i) => s + (i ? -1 : 1) * ringArea(r), 0), 0);
}
function shape(area: Area, transform: FloorReferenceTransform): Polygon {
  return area.ringsMetres.map(r => r.map(p => {
    const q = applyFloorReferenceTransform(transform, { x: p[0], y: p[1] });
    return [q.x, q.y];
  }));
}
export function analyzeCadFloors(floors: CadAnalysisFloor[], controls: CadFloorControl[] = []) {
  if (!floors.length || new Set(floors.map(f => f.id)).size !== floors.length
    || floors.some(f => !f.id || !f.buildingCode || !Number.isInteger(f.ordinal))) {
    throw new Error("Unique source floor identities and explicit drawing ordinals are required.");
  }
  if (new Set(controls.map(c => c.floorId)).size !== controls.length) throw new Error("Duplicate floor controls.");
  const byId = new Map(floors.map(f => [f.id, f]));
  const transforms = new Map<string, FloorReferenceTransform>();
  const registrations = controls.map(c => {
    const floor = byId.get(c.floorId), reference = byId.get(c.referenceFloorId);
    if (!floor || !reference) throw new Error("Controls refer to an absent drawing floor.");
    const base = floors.filter(f => f.buildingCode === floor.buildingCode).sort((a, b) => a.ordinal - b.ordinal)[0]!;
    if (reference.id !== base.id) throw new Error("Register each floor directly to its building's base drawing; no chained control fits.");
    const fit = fitCadFloorControls(floor, reference, c);
    transforms.set(floor.id, fit.transform);
    return { floorId: floor.id, referenceFloorId: reference.id, ...fit };
  });
  const candidates: { buildingCode: string; fromFloorId: string; toFloorId: string;
    fromAreaId: string; toAreaId: string; overlapRatio: number; alignmentStatus: string;
    sourceHandles: string[]; reviewRequired: string[]; routingEligible: false;
    servedFloorsVerified: false; physicalElevations: null; status: string }[] = [];
  const unresolved: { floorIds: string[]; areaIds: string[]; reason: string }[] = [];
  for (const building of new Set(floors.map(f => f.buildingCode))) {
    const levels = floors.filter(f => f.buildingCode === building).sort((a, b) => a.ordinal - b.ordinal);
    if (new Set(levels.map(f => f.ordinal)).size !== levels.length) throw new Error("Duplicate drawing ordinals in one building.");
    for (let i = 1; i < levels.length; i++) {
      const left = levels[i - 1]!, right = levels[i]!;
      if (right.ordinal - left.ordinal !== 1) {
        unresolved.push({ floorIds: [left.id, right.id], areaIds: [], reason: "Intermediate drawing floor missing; no skipped-floor connection inferred." });
        continue;
      }
      const scores: { ratio: number; x: Area; y: Area }[] = [];
      for (const x of left.stairAreas) for (const y of right.stairAreas) {
        if (x.conflictingRoomKeys?.length || y.conflictingRoomKeys?.length) continue;
        const a = shape(x, transforms.get(left.id) ?? identity), b = shape(y, transforms.get(right.id) ?? identity);
        try {
          const den = Math.min(areaOf([a]), areaOf([b]));
          if (den <= 0) continue;
          const ratio = areaOf(polygonClipping.intersection(a, b)) / den;
          if (ratio >= 0.3) scores.push({ ratio, x, y });
        } catch {
          unresolved.push({ floorIds: [left.id, right.id], areaIds: [x.id, y.id], reason: "Invalid or unstable footprint; correspondence omitted." });
        }
      }
      const controlChecked = [left, right].every(f => f.id === levels[0]!.id || transforms.has(f.id));
      const weak = [left, right].some(f => !transforms.has(f.id) && !["local-reference", "provisional", "saved-source-registration"].includes(f.alignment.status));
      for (const { ratio, x, y } of scores) {
        if (scores.filter(s => s.x.id === x.id).length !== 1 || scores.filter(s => s.y.id === y.id).length !== 1) {
          unresolved.push({ floorIds: [left.id, right.id], areaIds: [x.id, y.id], reason: "Multiple overlapping stair footprints; correspondence is ambiguous." });
          continue;
        }
        candidates.push({ buildingCode: building, fromFloorId: left.id, toFloorId: right.id,
          fromAreaId: x.id, toAreaId: y.id, overlapRatio: Number(ratio.toFixed(4)),
          alignmentStatus: controlChecked ? "control-checked-local" : weak ? "alignment-needs-review" : "provisional-drawing-alignment",
          sourceHandles: [...new Set([...x.sourceHandles, ...y.sourceHandles])],
          reviewRequired: [...(controlChecked ? [] : ["Confirm orientation with distributed original source controls"]),
            "Confirm flight/landing identity and continuous staircase", "Confirm native elevations, entrances and floor support", "Review access and accessibility separately"],
          status: "drawing-stair-correspondence-needs-review", routingEligible: false, servedFloorsVerified: false, physicalElevations: null });
      }
      for (const f of [left, right]) for (const a of f.stairAreas) {
        if (!candidates.some(c => c.fromFloorId === left.id && c.toFloorId === right.id && [c.fromAreaId, c.toAreaId].includes(a.id))) {
          unresolved.push({ floorIds: [left.id, right.id], areaIds: [a.id], reason: a.conflictingRoomKeys?.length
            ? "Stair ownership conflicts with non-stair room labels." : "No unique footprint match in this drawing alignment." });
        }
      }
    }
  }
  // Label families supplement footprint matching without inventing a landing.
  // A skipped drawing level remains flagged, even when the family reappears.
  const stairFamilies: { buildingCode: string; family: string; occurrences: {
    floorId: string; ordinal: number; roomKey: string; number: string; anchorMetres: Point;
    sourceHandle: string | null; nearbyAreaIds: string[] }[]; missingDrawingOrdinals: number[];
    status: string; routingEligible: false; servedFloorsVerified: false }[] = [];
  for (const building of new Set(floors.map(f => f.buildingCode))) {
    const groups = new Map<string, typeof stairFamilies[number]["occurrences"]>();
    for (const f of floors.filter(f => f.buildingCode === building).sort((a,b) => a.ordinal-b.ordinal)) {
      for (const r of f.rooms ?? []) {
        const match = /^([^-]+)-S\d(\d{2,3}[A-Z]?)$/i.exec(r.number);
        if (!match || match[1] !== building || !/^stairs?$/i.test(r.name.trim()) || !finite(r.anchorMetres)) continue;
        const key = building + "-S*" + match[2], values = groups.get(key) ?? [];
        values.push({ floorId: f.id, ordinal: f.ordinal, roomKey: r.key, number: r.number,
          anchorMetres: r.anchorMetres, sourceHandle: r.source?.handle ?? null,
          nearbyAreaIds: f.stairAreas.filter(a => a.ringsMetres.some(ring => ring.some(p => Math.hypot(p[0]-r.anchorMetres[0],p[1]-r.anchorMetres[1]) < 3))).map(a => a.id) });
        groups.set(key, values);
      }
    }
    for (const [family, occurrences] of groups) {
      const ordinals = new Set(occurrences.map(o => o.ordinal));
      const lo = Math.min(...ordinals), hi = Math.max(...ordinals);
      const missingDrawingOrdinals = Array.from({length: hi-lo+1},(_,i)=>lo+i).filter(n=>!ordinals.has(n));
      stairFamilies.push({ buildingCode: building, family, occurrences, missingDrawingOrdinals,
        status: occurrences.length === 1 ? "single-drawing-stair-label" : missingDrawingOrdinals.length
          ? "label-family-with-unrepresented-intermediate-stop" : "label-family-needs-flight-and-landing-review",
        routingEligible: false, servedFloorsVerified: false });
    }
  }
  return { format: "reviter-cad-floor-analysis", version: 1, coordinateSystem: "building-local-metres",
    registrations, floors: floors.map(f => ({ id: f.id, buildingCode: f.buildingCode, name: f.name,
      ordinal: f.ordinal, alignment: f.alignment, additionalTransform: transforms.get(f.id) ?? identity,
      physicalElevationMetres: null, nativeLevelId: null, roomRecords: f.regions.length,
      individualRegions: f.regions.filter(r => r.status === "closed-drawing-region-needs-review").length,
      sharedRegions: f.regions.filter(r => r.status === "shared-drawing-region").length,
      missingRegions: f.regions.filter(r => r.status === "not-recovered").length,
      stairFlights: f.stairs.length, boundedFootprints: f.stairAreas.length, stairReview: f.stairReview })),
    candidates, unresolved, stairFamilies, graphEdges: [], appliedToNativeGeometry: false,
    limits: ["A drawing match is not a verified stair route.", "No native stops, elevations, access or campus placement inferred.",
      "Original source geometry and polygon holes are retained; controls only define a separate comparison transform."] };
}
