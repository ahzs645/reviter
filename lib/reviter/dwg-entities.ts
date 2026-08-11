/**
 * LibreDWG's decoded database, flattened to the entities the plan renderer
 * understands.
 *
 * Kept apart from the WASM so the mapping is ordinary data-in/data-out: the
 * worker owns the decoder, this owns the shapes, and `dwg-plan.ts` owns the
 * drawing. Field names are read defensively because LibreDWG's naming varies by
 * entity and by file.
 */
import type { DwgEntity } from "./dwg-plan.ts";

/** LibreDWG hands back plain objects whose fields differ per entity type. */
type RawEntity = Record<string, unknown> & { type?: string; layer?: string };

type Point = { x: number; y: number };

function point(value: unknown): [number, number] | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as Partial<Point>;
  return Number.isFinite(x) && Number.isFinite(y) ? [x as number, y as number] : null;
}

function points(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  const out: [number, number][] = [];
  for (const entry of value) {
    const resolved = point(entry);
    if (resolved) out.push(resolved);
  }
  return out;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Angles arrive in degrees on some entities and radians on others, with no flag
 * to say which. Values beyond a full turn can only be degrees.
 */
function radians(value: unknown): number | undefined {
  const raw = number(value);
  if (raw == null) return undefined;
  return Math.abs(raw) > Math.PI * 2 + 1e-6 ? (raw * Math.PI) / 180 : raw;
}

function text(entity: RawEntity): string | undefined {
  for (const key of ["text", "textString", "value", "contents", "defaultValue"]) {
    const candidate = entity[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

/**
 * Tessellate a polyline whose segments carry DWG bulges (the tangent of a
 * quarter of the included angle). A bulge of zero is a straight run.
 */
function expandBulges(
  vertices: readonly [number, number][],
  bulges: readonly number[],
  closed: boolean,
): [number, number][] {
  if (!bulges.some((bulge) => Math.abs(bulge) > 1e-9)) return [...vertices];
  const out: [number, number][] = [];
  const last = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < last; index += 1) {
    const from = vertices[index]!;
    const to = vertices[(index + 1) % vertices.length]!;
    out.push(from);
    const bulge = bulges[index] ?? 0;
    if (Math.abs(bulge) <= 1e-9) continue;
    const included = 4 * Math.atan(bulge);
    const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (!(chord > 1e-9)) continue;
    const radius = chord / (2 * Math.sin(Math.abs(included) / 2));
    const steps = Math.max(2, Math.min(32, Math.ceil(Math.abs(included) / 0.25)));
    // Centre sits off the chord midpoint, on the side the bulge's sign picks.
    const midX = (from[0] + to[0]) / 2;
    const midY = (from[1] + to[1]) / 2;
    const height = radius * Math.cos(Math.abs(included) / 2) * (bulge < 0 ? 1 : -1);
    const normalX = -(to[1] - from[1]) / chord;
    const normalY = (to[0] - from[0]) / chord;
    const centreX = midX + normalX * height;
    const centreY = midY + normalY * height;
    const startAngle = Math.atan2(from[1] - centreY, from[0] - centreX);
    for (let step = 1; step < steps; step += 1) {
      const angle = startAngle + (included * step) / steps;
      out.push([centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle)]);
    }
  }
  if (!closed) out.push(vertices.at(-1)!);
  return out;
}

/** A cubic B-spline sampled along its span, rather than its control polygon. */
function sampleSpline(control: readonly [number, number][], degree: number): [number, number][] {
  if (control.length <= 2) return [...control];
  const order = Math.min(Math.max(degree, 1), 3) + 1;
  if (control.length < order) return [...control];
  // Clamped uniform knots: enough for the open splines drawings actually use,
  // and far closer than drawing the control polygon as if it were the curve.
  const knots: number[] = [];
  const spans = control.length - order + 1;
  for (let index = 0; index < order; index += 1) knots.push(0);
  for (let index = 1; index < spans; index += 1) knots.push(index / spans);
  for (let index = 0; index < order; index += 1) knots.push(1);

  const basis = (index: number, level: number, t: number): number => {
    if (level === 0) {
      return t >= knots[index]! && t < knots[index + 1]! ? 1 : 0;
    }
    const leftSpan = knots[index + level]! - knots[index]!;
    const rightSpan = knots[index + level + 1]! - knots[index + 1]!;
    const left = leftSpan > 1e-12 ? ((t - knots[index]!) / leftSpan) * basis(index, level - 1, t) : 0;
    const right = rightSpan > 1e-12
      ? ((knots[index + level + 1]! - t) / rightSpan) * basis(index + 1, level - 1, t)
      : 0;
    return left + right;
  };

  const samples = Math.min(160, Math.max(16, control.length * 6));
  const out: [number, number][] = [];
  for (let step = 0; step <= samples; step += 1) {
    const t = Math.min(0.999999, step / samples);
    let x = 0;
    let y = 0;
    for (let index = 0; index < control.length; index += 1) {
      const weight = basis(index, order - 1, t);
      if (!weight) continue;
      x += control[index]![0] * weight;
      y += control[index]![1] * weight;
    }
    out.push([x, y]);
  }
  out.push(control.at(-1)!);
  return out;
}

/**
 * The handle of the `*Model_Space` block record, which owns the drawing proper.
 * Paper-space layouts are viewports onto it and carry only sheet furniture.
 */
export function modelSpaceHandle(database: unknown): string | null {
  const records = (database as { tables?: { BLOCK_RECORD?: { entries?: unknown[] } } })
    ?.tables?.BLOCK_RECORD?.entries;
  if (!Array.isArray(records)) return null;
  for (const record of records) {
    const entry = record as { name?: unknown; handle?: unknown };
    if (typeof entry.name === "string" && /^\*model_space$/iu.test(entry.name)) {
      return entry.handle == null ? null : String(entry.handle);
    }
  }
  return null;
}

export function convertDwgEntity(raw: RawEntity): DwgEntity | null {
  const layer = typeof raw.layer === "string" ? raw.layer : "0";
  const type = typeof raw.type === "string" ? raw.type : "";
  const base: Pick<DwgEntity, "type" | "layer"> = { type, layer };

  switch (type) {
    case "LINE": {
      const from = point(raw.startPoint);
      const to = point(raw.endPoint);
      return from && to ? { ...base, points: [from, to] } : null;
    }
    case "LWPOLYLINE":
    case "POLYLINE":
    case "POLYLINE2D":
    case "POLYLINE3D": {
      const vertices = points(raw.vertices ?? raw.points ?? raw.controlPoints);
      if (vertices.length < 2) return null;
      const bulges = Array.isArray(raw.bulges)
        ? (raw.bulges as unknown[]).map((bulge) => number(bulge) ?? 0)
        : (raw.vertices as { bulge?: unknown }[] | undefined)?.map((vertex) => number(vertex?.bulge) ?? 0) ?? [];
      const closed = raw.closed === true || raw.isClosed === true;
      return { ...base, points: expandBulges(vertices, bulges, closed), closed };
    }
    case "CIRCLE": {
      const centre = point(raw.center ?? raw.centre);
      const radius = number(raw.radius);
      return centre && radius ? { ...base, centre, radius } : null;
    }
    case "ARC": {
      const centre = point(raw.center ?? raw.centre);
      const radius = number(raw.radius);
      const startAngle = radians(raw.startAngle);
      const endAngle = radians(raw.endAngle);
      if (!centre || !radius || startAngle == null || endAngle == null) return null;
      return { ...base, centre, radius, startAngle, endAngle };
    }
    case "ELLIPSE": {
      const centre = point(raw.center ?? raw.centre);
      const majorAxis = point(raw.majorAxisEndPoint ?? raw.majorAxis ?? raw.endPoint);
      if (!centre || !majorAxis) return null;
      // The DWG carries the minor/major ratio; a renderer that assumes a half
      // ratio draws every ellipse in the drawing at the wrong proportion.
      const axisRatio = number(raw.axisRatio) ?? number(raw.minorToMajorRatio) ?? 1;
      const start = radians(raw.startAngle) ?? 0;
      const end = radians(raw.endAngle) ?? Math.PI * 2;
      const major = Math.hypot(majorAxis[0], majorAxis[1]);
      const rotation = Math.atan2(majorAxis[1], majorAxis[0]);
      const minor = major * axisRatio;
      let sweep = end - start;
      while (sweep <= 0) sweep += Math.PI * 2;
      const steps = Math.max(12, Math.min(96, Math.ceil(sweep / 0.12)));
      const sampled: [number, number][] = [];
      for (let step = 0; step <= steps; step += 1) {
        const angle = start + (sweep * step) / steps;
        const x = major * Math.cos(angle);
        const y = minor * Math.sin(angle);
        sampled.push([
          centre[0] + x * Math.cos(rotation) - y * Math.sin(rotation),
          centre[1] + x * Math.sin(rotation) + y * Math.cos(rotation),
        ]);
      }
      return { ...base, points: sampled };
    }
    case "SPLINE": {
      const control = points(raw.controlPoints ?? raw.fitPoints ?? raw.points);
      if (control.length < 2) return null;
      const degree = number(raw.degree) ?? 3;
      return { ...base, points: sampleSpline(control, degree) };
    }
    case "SOLID":
    case "3DFACE": {
      const corners = [raw.corner1, raw.corner2, raw.corner4, raw.corner3]
        .map(point)
        .filter((corner): corner is [number, number] => corner != null);
      const fallback = corners.length ? corners : points(raw.points ?? raw.vertices);
      return fallback.length >= 3 ? { ...base, points: fallback, closed: true } : null;
    }
    case "TEXT":
    case "MTEXT":
    case "ATTRIB": {
      const centre = point(raw.startPoint ?? raw.insertionPoint ?? raw.position ?? raw.center);
      const value = text(raw);
      if (!centre || !value) return null;
      return { ...base, centre, text: value, height: number(raw.height ?? raw.textHeight) };
    }
    default:
      // POINT, INSERT, HATCH, VIEWPORT, DIMENSION and the rest are dropped
      // rather than approximated: a plan reference wants linework it can be
      // aligned against, not a crosshair standing in for a block.
      return null;
  }
}

export function convertDwgEntities(
  raw: readonly unknown[],
  options: { ownerHandle?: string | null } = {},
): DwgEntity[] {
  const owner = options.ownerHandle;
  const out: DwgEntity[] = [];
  for (const entry of raw) {
    const entity = entry as RawEntity;
    if (owner != null) {
      const entityOwner = entity.ownerBlockRecordSoftId ?? entity.ownerHandle;
      if (entityOwner != null && String(entityOwner) !== owner) continue;
    }
    if (entity.isVisible === false) continue;
    const converted = convertDwgEntity(entity);
    if (converted) out.push(converted);
  }
  return out;
}
