import { cleanRoomBoundary, containsRoomPoint, directoryRoomArea, isHallway, roomArea, validRoomBoundary, type DirectoryRoom, type RoomPoint } from "./room-directory.ts";
import type { ArchitecturalPlanGeometry } from "./architectural-plan.ts";
import type { DwgEntity, DwgBounds } from "./dwg-plan.ts";

export type BoundarySegment = [RoomPoint, RoomPoint];
export type BoundarySection = { sectionId: string; levelId: number; registrationErrorFeet: number; wallSegments: BoundarySegment[]; doorSegments: BoundarySegment[] };
export type BoundaryReference = { format: "reviter-boundary-reference"; version: 1; coordinateSystem: "revit-model-feet"; sourceSha256: string; sections: BoundarySection[] };
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
const length = ([a, b]: BoundarySegment) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const edges = (ps: RoomPoint[]): BoundarySegment[] => ps.map((p, i) => [p, ps[(i + 1) % ps.length]!]);

/** Recover the saved registration from matching DWG anchors, without estimating a new alignment. */
export function registerBoundaryReference(rooms: readonly DirectoryRoom[], entities: readonly DwgEntity[], sheets: readonly { name: string; bounds: DwgBounds }[], sourceSha256: string): BoundaryReference {
  const sections: BoundarySection[] = [];
  // A survey sheet can contain plans at distinct levels (#1/#2 annotations).
  // Fit each saved registration separately and keep its original section identity.
  const registeredSheets = sheets.flatMap(sheet => {
    const names = new Set(rooms.map(r => r.dwg?.sectionId).filter((name):name is string => !!name && (name === sheet.name || name.replace(/ #\d+$/, "") === sheet.name)));
    return [...names].map(name => ({...sheet, name}));
  });
  for (const sheet of registeredSheets) {
    const matches = rooms.filter((r) => r.dwg?.sectionId === sheet.name && r.dwg?.sha256 === sourceSha256 && Array.isArray(r.dwg.anchorDwg))
      .map((r) => ({ raw: r.dwg!.anchorDwg as RoomPoint, model: r.labelPointFeet, levelId: r.levelId }));
    if (matches.length < 3 || new Set(matches.map((s) => s.levelId)).size !== 1) continue;
    function fit(samples: typeof matches) {
      const mean = (key: "raw" | "model"): RoomPoint => samples.reduce<RoomPoint>((a, s) => [a[0] + s[key][0] / samples.length, a[1] + s[key][1] / samples.length], [0, 0]);
      const raw = mean("raw"); const model = mean("model"); let denominator = 0; let re = 0; let im = 0;
      for (const sample of samples) {
        const x = sample.raw[0] - raw[0]; const y = sample.raw[1] - raw[1]; const u = sample.model[0] - model[0]; const v = sample.model[1] - model[1];
        denominator += x * x + y * y; re += x * u + y * v; im += x * v - y * u;
      }
      re /= denominator; im /= denominator;
      const transform = (p: readonly number[]): RoomPoint => [model[0] + re * (p[0]! - raw[0]) - im * (p[1]! - raw[1]), model[1] + im * (p[0]! - raw[0]) + re * (p[1]! - raw[1])];
      return { transform, scale: Math.hypot(re, im) };
    }
    let fitted = fit(matches);
    const residual = (s: typeof matches[number]) => { const p = fitted.transform(s.raw); return Math.hypot(p[0] - s.model[0], p[1] - s.model[1]); };
    // A few manually moved labels should not distort the original survey registration.
    const median = matches.map(residual).sort((a, b) => a - b)[Math.floor(matches.length / 2)]!;
    const inliers = matches.filter((s) => residual(s) <= Math.max(.1, median * 3));
    if (inliers.length < 3) continue;
    fitted = fit(inliers);
    const error = Math.max(...inliers.map(residual));
    if (!Number.isFinite(fitted.scale) || fitted.scale <= 0 || error > .1) continue;
    const inside = (p: readonly number[]) => p[0]! >= sheet.bounds.minX && p[0]! <= sheet.bounds.maxX && p[1]! >= sheet.bounds.minY && p[1]! <= sheet.bounds.maxY;
    const wallSegments: BoundarySegment[] = []; const swings: { centre: RoomPoint; radius: number; ends: RoomPoint[] }[] = [];
    for (const entity of entities) {
      if (!/wall/i.test(entity.layer) || !(entity.points?.some(inside) || entity.centre && inside(entity.centre))) continue;
      if (entity.points) {
        const ps = entity.points.map(fitted.transform);
        for (let i = 1; i < ps.length; i++) wallSegments.push([ps[i - 1]!, ps[i]!]);
        if (entity.closed && ps.length > 2) wallSegments.push([ps.at(-1)!, ps[0]!]);
      }
      if (entity.centre && entity.radius && entity.type === "ARC" && entity.startAngle != null && entity.endAngle != null) {
        const radius = entity.radius * fitted.scale;
        const end = (angle: number) => fitted.transform([entity.centre![0] + entity.radius! * Math.cos(angle), entity.centre![1] + entity.radius! * Math.sin(angle)]);
        let sweep = entity.endAngle - entity.startAngle; while (sweep < 0) sweep += Math.PI * 2;
        if (radius >= .9 && radius <= 8 && Math.abs(sweep - Math.PI / 2) < .05) swings.push({ centre: fitted.transform(entity.centre), radius, ends: [end(entity.startAngle), end(entity.endAngle)] });
        else {
          const n = Math.min(512, Math.max(2, Math.ceil(radius * sweep / .15)));
          for (let i = 0; i < n; i++) wallSegments.push([end(entity.startAngle + sweep * i / n), end(entity.startAngle + sweep * (i + 1) / n)]);
        }
      }
    }
    const doorSegments: BoundarySegment[] = [];
    for (const swing of swings) {
      // A closed leaf continues the wall on BOTH sides. Open leaf/frame lines
      // within the gap cannot count as evidence for the threshold direction.
      const support = (p: RoomPoint) => {
        const dx = (p[0] - swing.centre[0]) / swing.radius; const dy = (p[1] - swing.centre[1]) / swing.radius;
        let left = 0; let right = 0;
        for (const [a, b] of wallSegments) {
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (l < .4 || Math.abs(cross(dx, dy, b[0] - a[0], b[1] - a[1])) / l > .01) continue;
          if (Math.abs(cross(a[0] - swing.centre[0], a[1] - swing.centre[1], dx, dy)) > .5) continue;
          const ta = (a[0] - swing.centre[0]) * dx + (a[1] - swing.centre[1]) * dy; const tb = (b[0] - swing.centre[0]) * dx + (b[1] - swing.centre[1]) * dy;
          left += Math.max(0, Math.min(Math.max(ta, tb), -.2) - Math.max(Math.min(ta, tb), -3));
          right += Math.max(0, Math.min(Math.max(ta, tb), swing.radius + 3) - Math.max(Math.min(ta, tb), swing.radius + .2));
        }
        return Math.min(left, right) * 10 + left + right;
      };
      const scores = swing.ends.map(support); const closed = scores[0]! > scores[1]! ? 0 : 1;
      if (scores[closed]! < 5 || Math.abs(scores[0]! - scores[1]!) < 1) continue;
      const end = swing.ends[closed]!; const dx = (end[0] - swing.centre[0]) / swing.radius; const dy = (end[1] - swing.centre[1]) / swing.radius;
      const offsets = new Set<number>();
      for (const [a, b] of wallSegments) {
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l < 1 || Math.abs(cross(dx, dy, b[0] - a[0], b[1] - a[1])) / l > .01) continue;
        const off = cross(a[0] - swing.centre[0], a[1] - swing.centre[1], dx, dy);
        const ta = (a[0] - swing.centre[0]) * dx + (a[1] - swing.centre[1]) * dy; const tb = (b[0] - swing.centre[0]) * dx + (b[1] - swing.centre[1]) * dy;
        if (Math.abs(off) < .8 && Math.max(ta, tb) > -2 && Math.min(ta, tb) < swing.radius + 2) offsets.add(Math.round(off * 10000) / 10000);
      }
      for (const off of offsets) doorSegments.push([[swing.centre[0] - dx * .6 + dy * off, swing.centre[1] - dy * .6 - dx * off], [end[0] + dx * .6 + dy * off, end[1] + dy * .6 - dx * off]]);
    }
    sections.push({ sectionId: sheet.name, levelId: matches[0]!.levelId, registrationErrorFeet: error, wallSegments, doorSegments });
  }
  return { format: "reviter-boundary-reference", version: 1, coordinateSystem: "revit-model-feet", sourceSha256, sections };
}

/** Split intersections, join tiny drafting seams, and walk the left face of every half-edge. */
export function boundaryFaces(lines: readonly BoundarySegment[], tolerance = .04): { polygon: RoomPoint[]; signedArea: number }[] {
  const segments = lines.filter((s) => length(s) > .02).map(([a, b]) => ({ a, b, ts: [0, 1], dx: b[0] - a[0], dy: b[1] - a[1] }));
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
    const a = segments[i]!; const b = segments[j]!;
    if (Math.min(a.a[0], a.b[0]) > Math.max(b.a[0], b.b[0]) + tolerance || Math.max(a.a[0], a.b[0]) < Math.min(b.a[0], b.b[0]) - tolerance
      || Math.min(a.a[1], a.b[1]) > Math.max(b.a[1], b.b[1]) + tolerance || Math.max(a.a[1], a.b[1]) < Math.min(b.a[1], b.b[1]) - tolerance) continue;
    const denominator = cross(a.dx, a.dy, b.dx, b.dy);
    if (Math.abs(denominator) < 1e-8) {
      // Split collinear overlaps too. Otherwise one edge can pass through a
      // graph node and the face walk returns a crossing or repeated boundary.
      if (Math.abs(cross(b.a[0]-a.a[0], b.a[1]-a.a[1], a.dx, a.dy)) > 1e-7) continue;
      const project = (p:RoomPoint, s:typeof a) => ((p[0]-s.a[0])*s.dx+(p[1]-s.a[1])*s.dy)/(s.dx*s.dx+s.dy*s.dy);
      for (const p of [b.a,b.b]) { const t=project(p,a); if(t>0 && t<1)a.ts.push(t); }
      for (const p of [a.a,a.b]) { const t=project(p,b); if(t>0 && t<1)b.ts.push(t); }
      continue;
    }
    const dx = b.a[0] - a.a[0]; const dy = b.a[1] - a.a[1]; const t = cross(dx, dy, b.dx, b.dy) / denominator; const u = cross(dx, dy, a.dx, a.dy) / denominator;
    const ta = tolerance / Math.hypot(a.dx, a.dy); const tb = tolerance / Math.hypot(b.dx, b.dy);
    if (t >= -ta && t <= 1 + ta && u >= -tb && u <= 1 + tb) { a.ts.push(Math.max(0, Math.min(1, t))); b.ts.push(Math.max(0, Math.min(1, u))); }
  }
  const nodes: { p: RoomPoint; adjacent: Set<number>; ordered: number[] }[] = []; const hash = new Map<string, number[]>();
  const key = (x: number, y: number) => `${x},${y}`;
  function node(p: RoomPoint) {
    const gx = Math.floor(p[0] / tolerance); const gy = Math.floor(p[1] / tolerance);
    for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) for (const n of hash.get(key(x, y)) ?? []) {
      if (Math.hypot(nodes[n]!.p[0] - p[0], nodes[n]!.p[1] - p[1]) < tolerance) return n;
    }
    const id = nodes.length; nodes.push({ p, adjacent: new Set(), ordered: [] });
    const k = key(gx, gy); hash.set(k, [...hash.get(k) ?? [], id]); return id;
  }
  for (const s of segments) {
    s.ts.sort((a, b) => a - b); const ids = s.ts.map((t) => node([s.a[0] + t * s.dx, s.a[1] + t * s.dy]));
    for (let i = 1; i < ids.length; i++) { const a = ids[i - 1]!; const b = ids[i]!; if (a !== b) { nodes[a]!.adjacent.add(b); nodes[b]!.adjacent.add(a); } }
  }
  for (const n of nodes) n.ordered = [...n.adjacent].sort((a, b) => Math.atan2(nodes[a]!.p[1] - n.p[1], nodes[a]!.p[0] - n.p[0]) - Math.atan2(nodes[b]!.p[1] - n.p[1], nodes[b]!.p[0] - n.p[0]));
  const used = new Set<string>(); const faces: { polygon: RoomPoint[]; signedArea: number }[] = [];
  for (let a = 0; a < nodes.length; a++) for (const b of nodes[a]!.ordered) {
    if (used.has(key(a, b))) continue;
    const cycle: number[] = []; let u = a; let v = b;
    do {
      used.add(key(u, v)); cycle.push(u); const adjacent = nodes[v]!.ordered;
      const w = adjacent[(adjacent.indexOf(u) + adjacent.length - 1) % adjacent.length]!; u = v; v = w;
    } while (!(u === a && v === b) && cycle.length < segments.length * 4);
    // Remove dangling lines that were visited in both directions; they do not enclose space.
    let changed = true;
    while (changed && cycle.length >= 3) {
      changed = false;
      for (let i = 0; i < cycle.length; i++) if (cycle[(i + cycle.length - 1) % cycle.length] === cycle[(i + 1) % cycle.length]) {
        const previous = (i + cycle.length - 1) % cycle.length;
        cycle.splice(i, 1); cycle.splice(previous < i ? previous : cycle.length - 1, 1); changed = true; break;
      }
    }
    // A face can walk around an island via a bridge and revisit a node.
    // Extract the simple outer and hole cycles instead of returning a polygon
    // that touches itself. Keep the orientation of every component.
    const stack:number[]=[]; const position=new Map<number,number>(); const simple:number[][]=[];
    for(const n of [...cycle,cycle[0]!]) {
      const at=position.get(n);
      if(at!=null){const loop=stack.slice(at);if(loop.length>=3)simple.push(loop);for(const removed of stack.slice(at+1))position.delete(removed);stack.splice(at+1);}
      else {position.set(n,stack.length);stack.push(n);}
    }
    for(const loop of simple){
      const polygon = cleanRoomBoundary(loop.map((n) => nodes[n]!.p));
      const signedArea = polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]!; return sum + cross(p[0], p[1], q[0], q[1]); }, 0) / 2;
      if (Math.abs(signedArea) > 1 && !faces.some(f=>Math.sign(f.signedArea)===Math.sign(signedArea) && f.polygon.length===polygon.length && Math.abs(f.signedArea-signedArea)<1e-7 && f.polygon.every(p=>polygon.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-7)))) faces.push({ polygon, signedArea });
    }
  }
  return faces;
}

export function rebuildRoomBoundaries(rooms: readonly DirectoryRoom[], reference: BoundaryReference, geometry: ArchitecturalPlanGeometry, nativeBarrierFaces = false): { rooms: DirectoryRoom[]; rebuilt: number; unresolved: string[] } {
  const replacements = new Map<string, DirectoryRoom>(); let rebuilt = 0; const unresolved: string[] = [];
  for (const section of reference.sections) {
    const members = rooms.filter((r) => r.levelId === section.levelId && r.dwg?.sectionId === section.sectionId && r.dwg?.sha256 === reference.sourceSha256);
    if (!members.length) continue;
    const points = section.wallSegments.flat(); if (!points.length) continue;
    const minX = Math.min(...points.map((p) => p[0])); const maxX = Math.max(...points.map((p) => p[0])); const minY = Math.min(...points.map((p) => p[1])); const maxY = Math.max(...points.map((p) => p[1]));
    const doors = geometry.doors.filter((d) => d.polygon.some((p) => p[0] >= minX - 1 && p[0] <= maxX + 1 && p[1] >= minY - 1 && p[1] <= maxY + 1));
    // Display recovery can compose actual native wall/column faces with the
    // registered drawing. Do not substitute approximate analytical rectangles:
    // precise physical faces close missing drawing edges without inventing a
    // room divider or adding any routing permission. Existing callers retain
    // their original registered-only face graph unless they request this mode.
    const nativeFaces = nativeBarrierFaces ? [...geometry.walls,...geometry.columns].filter(w=>!w.approximate&&w.polygon.some(p=>p[0]>=minX-1&&p[0]<=maxX+1&&p[1]>=minY-1&&p[1]<=maxY+1)).flatMap(w=>edges(w.polygon)) : [];
    const faces = boundaryFaces([...section.wallSegments, ...section.doorSegments, ...doors.flatMap((d) => edges(d.polygon)),...nativeFaces]);
    const positive = faces.filter((f) => f.signedArea > 0 && validRoomBoundary(f.polygon)).sort((a, b) => a.signedArea - b.signedArea);
    const candidates = members.map((r) => ({ room: r, face: positive.find((f) => containsRoomPoint(r.labelPointFeet, f.polygon)) }));
    for (const { room, face } of candidates) {
      if (!face) { unresolved.push(room.key); continue; }
      const holes = faces.filter((f) => f.signedArea < 0 && validRoomBoundary(f.polygon) && f.polygon.every((p) => containsRoomPoint(p, face.polygon)))
        .filter((f, _, all) => !all.some((outer) => outer !== f && Math.abs(outer.signedArea) > Math.abs(f.signedArea) && containsRoomPoint(f.polygon[0]!, outer.polygon))).map((f) => f.polygon);
      const occupants = candidates.filter((c) => c.face === face && !holes.some((h) => containsRoomPoint(c.room.labelPointFeet, h)));
      // Open coffee alcoves can sit inside a circulation face. Private rooms
      // sharing a face indicate a missing barrier and prevent automatic merging.
      if (occupants.length > 1 && (!isHallway(room) || occupants.some((c) => !isHallway(c.room) && !/^(coffee|open lounge)$/i.test(c.room.name ?? "")))) { unresolved.push(room.key); continue; }
      const shared = occupants.filter((c) => isHallway(room) ? isHallway(c.room) : c.room.key === room.key);
      if (holes.some((h) => containsRoomPoint(room.labelPointFeet, h))) { unresolved.push(room.key); continue; }
      const area = roomArea(face.polygon) - holes.reduce((sum, h) => sum + roomArea(h), 0);
      const oldArea = shared.filter((c, i) => !c.room.circulationGroup || shared.findIndex((other) => other.room.circulationGroup === c.room.circulationGroup) === i)
        .reduce((sum, c) => sum + directoryRoomArea(c.room), 0);
      if (area < oldArea * .5 || area > oldArea * 1.8) { unresolved.push(room.key); continue; }
      replacements.set(room.key, { ...room, polygonFeet: face.polygon, holesFeet: holes, circulationGroup: isHallway(room) && shared.length > 1 ? `survey:${section.levelId}:${section.sectionId}:${positive.indexOf(face)}` : undefined,
        boundaryReview: { method: "registered-survey-walls-and-model-doors", registrationErrorFeet: section.registrationErrorFeet, sharedRoomKeys: shared.map((c) => c.room.key) },
        source: { ...(room.source as Record<string, unknown> ?? {}), polygon: "vector-walls" }, updatedAt: new Date().toISOString() });
      rebuilt++;
    }
  }
  for (const room of rooms) if (!replacements.has(room.key) && !unresolved.includes(room.key)) unresolved.push(room.key);
  return { rooms: rooms.map((r) => replacements.get(r.key) ?? r), rebuilt, unresolved };
}
