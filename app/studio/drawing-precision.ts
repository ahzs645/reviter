import { dwgEntityIsFinite, entityBounds, type DwgBounds, type DwgEntity } from "../../lib/reviter/dwg-plan.ts";

export type DrawingPoint = readonly [number, number];
export type SnapKind = "endpoint" | "midpoint" | "centre" | "intersection" | "nearest";
export type DrawingSnap = { point: DrawingPoint; kind: SnapKind; entity: number; layer: string; distance: number };
const distance = (a: DrawingPoint, b: DrawingPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function nearestSegment(p: DrawingPoint, a: DrawingPoint, b: DrawingPoint): DrawingPoint {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}
function segments(entity: DwgEntity): Array<readonly [DrawingPoint, DrawingPoint]> {
  const points = entity.points ?? [], out: Array<readonly [DrawingPoint, DrawingPoint]> = [];
  for (let i = 1; i < points.length; i++) out.push([points[i - 1]!, points[i]!]);
  if (entity.closed && points.length > 2) out.push([points.at(-1)!, points[0]!]);
  return out;
}
function onArc(entity: DwgEntity, angle: number): boolean {
  if (entity.startAngle == null || entity.endAngle == null) return true;
  const turn = Math.PI * 2, norm = (n: number) => (n % turn + turn) % turn;
  return norm(angle - entity.startAngle) <= norm(entity.endAngle - entity.startAngle) + 1e-9;
}
function intersection(a: DrawingPoint, b: DrawingPoint, c: DrawingPoint, d: DrawingPoint): DrawingPoint | null {
  const abx = b[0] - a[0], aby = b[1] - a[1], cdx = d[0] - c[0], cdy = d[1] - c[1];
  const denominator = abx * cdy - aby * cdx;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((c[0] - a[0]) * cdy - (c[1] - a[1]) * cdx) / denominator;
  const u = ((c[0] - a[0]) * aby - (c[1] - a[1]) * abx) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * abx, a[1] + t * aby] : null;
}

/** Entity-level grid: queries inspect nearby geometry, not every point on every move. */
export class DrawingSnapIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly broad: number[] = [];
  private readonly cell: number;
  private readonly origin: DrawingPoint;
  private readonly entities: readonly DwgEntity[];
  constructor(entities: readonly DwgEntity[], bounds: DwgBounds) {
    this.entities = entities;
    this.origin = [bounds.minX, bounds.minY];
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    this.cell = Number.isFinite(span) ? Math.max(1e-9, span / Math.max(1, Math.min(256, Math.sqrt(entities.length)))) : 1;
    entities.forEach((entity, index) => {
      if (!dwgEntityIsFinite(entity)) return;
      const box = entityBounds(entity); if (!box) return;
      const [x0, x1, y0, y1] = this.range(box);
      if (![x0, x1, y0, y1].every(Number.isSafeInteger) || (x1 - x0 + 1) * (y1 - y0 + 1) > 64) { this.broad.push(index); return; }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = `${x}:${y}`, entries = this.cells.get(key);
        if (entries) entries.push(index); else this.cells.set(key, [index]);
      }
    });
  }
  private range(b: DwgBounds) { return [Math.floor((b.minX - this.origin[0]) / this.cell), Math.floor((b.maxX - this.origin[0]) / this.cell), Math.floor((b.minY - this.origin[1]) / this.cell), Math.floor((b.maxY - this.origin[1]) / this.cell)] as const; }
  snap(p: DrawingPoint, tolerance: number, modes: ReadonlySet<SnapKind>, hidden: ReadonlySet<string>): DrawingSnap | null {
    if (!(Number.isFinite(tolerance) && tolerance > 0) || !p.every(Number.isFinite)) return null;
    const [x0, x1, y0, y1] = this.range({ minX: p[0] - tolerance, maxX: p[0] + tolerance, minY: p[1] - tolerance, maxY: p[1] + tolerance });
    const nearby = new Set(this.broad);
    // A zoomed-out query can span the whole grid; scanning cells remains bounded.
    if (![x0, x1, y0, y1].every(Number.isSafeInteger) || (x1 - x0 + 1) * (y1 - y0 + 1) > 4096) this.entities.forEach((_, i) => nearby.add(i));
    else for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const i of this.cells.get(`${x}:${y}`) ?? []) nearby.add(i);
    const hits: DrawingSnap[] = [];
    const lines: Array<{ pair: readonly [DrawingPoint, DrawingPoint]; entity: number }> = [];
    const offer = (point: DrawingPoint, kind: SnapKind, entity: number) => {
      const gap = distance(point, p);
      if (modes.has(kind) && gap <= tolerance) hits.push({ point, kind, entity, layer: this.entities[entity]!.layer, distance: gap });
    };
    for (const i of nearby) {
      const entity = this.entities[i]!;
      if (hidden.has(entity.layer)) continue;
      const box = entityBounds(entity);
      if (!box || p[0] < box.minX - tolerance || p[0] > box.maxX + tolerance || p[1] < box.minY - tolerance || p[1] > box.maxY + tolerance) continue;
      // Curved polylines/splines may contain recovered samples: these are never
      // advertised as analytic curve endpoints or midpoints.
      const linear = /^(LINE|LWPOLYLINE|POLYLINE|POLYLINE2D|POLYLINE3D)$/i.test(entity.type) && !entity.sampled;
      for (const pair of segments(entity)) {
        if (linear) { offer(pair[0], "endpoint", i); offer(pair[1], "endpoint", i); offer([(pair[0][0] + pair[1][0]) / 2, (pair[0][1] + pair[1][1]) / 2], "midpoint", i); }
        offer(nearestSegment(p, ...pair), "nearest", i);
        if (linear && distance(nearestSegment(p, ...pair), p) <= tolerance && lines.length < 64) lines.push({ pair, entity: i });
      }
      if (entity.centre && entity.radius != null) {
        const [x, y] = entity.centre, radius = Math.abs(entity.radius);
        offer(entity.centre, "centre", i);
        if (entity.startAngle != null && entity.endAngle != null) {
          for (const angle of [entity.startAngle, entity.endAngle]) offer([x + radius * Math.cos(angle), y + radius * Math.sin(angle)], "endpoint", i);
          const sweep = ((entity.endAngle - entity.startAngle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
          const angle = entity.startAngle + sweep / 2; offer([x + radius * Math.cos(angle), y + radius * Math.sin(angle)], "midpoint", i);
        }
        const angle = Math.atan2(p[1] - y, p[0] - x);
        if (onArc(entity, angle)) offer([x + radius * Math.cos(angle), y + radius * Math.sin(angle)], "nearest", i);
      }
    }
    if (modes.has("intersection")) for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) {
      const hit = intersection(...lines[a]!.pair, ...lines[b]!.pair);
      if (hit) offer(hit, "intersection", lines[a]!.entity);
    }
    const priority: Record<SnapKind, number> = { endpoint: 0, intersection: 1, midpoint: 2, centre: 3, nearest: 4 };
    hits.sort((a, b) => priority[a.kind] - priority[b.kind] || a.distance - b.distance || a.entity - b.entity);
    return hits[0] ?? null;
  }
}

export function constrainedPoint(anchor: DrawingPoint, point: DrawingPoint, mode: "free" | "ortho" | "polar"): DrawingPoint {
  if (mode === "free") return point;
  const dx = point[0] - anchor[0], dy = point[1] - anchor[1];
  if (mode === "ortho") return Math.abs(dx) >= Math.abs(dy) ? [point[0], anchor[1]] : [anchor[0], point[1]];
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(dx, dy);
  return [anchor[0] + Math.cos(angle) * length, anchor[1] + Math.sin(angle) * length];
}

/** Match object-fit: contain / SVG xMidYMid meet, including letterbox space. */
export function drawingPointAt(client: DrawingPoint, rect: { left: number; top: number; width: number; height: number }, bounds: DwgBounds): { point: DrawingPoint; unitsPerPixel: number } | null {
  const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
  const scale = Math.min(rect.width / w, rect.height / h);
  if (!(scale > 0 && Number.isFinite(scale))) return null;
  const x = (client[0] - rect.left - (rect.width - w * scale) / 2) / scale;
  const y = (client[1] - rect.top - (rect.height - h * scale) / 2) / scale;
  return x >= 0 && x <= w && y >= 0 && y <= h ? { point: [bounds.minX + x, bounds.maxY - y], unitsPerPixel: 1 / scale } : null;
}
