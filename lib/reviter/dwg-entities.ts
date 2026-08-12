/**
 * LibreDWG's decoded database, flattened to the entities the plan renderer
 * understands.
 *
 * Kept apart from the WASM so the mapping is ordinary data-in/data-out: the
 * worker owns the decoder, this owns the shapes, and `dwg-plan.ts` owns the
 * drawing. Field names are read defensively because LibreDWG's naming varies by
 * entity and by file.
 */
import { dwgEntityIsFinite } from "./dwg-plan.ts";
import type { DwgEntity } from "./dwg-plan.ts";
import { noteLimit } from "./limit-census.ts";

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
    /*
     * A bulge near a full turn takes `sin(|included| / 2)` to zero, and the
     * radius — and with it the centre this places — runs off to infinity. The
     * bulge is read straight from the file, so that is a two-byte edit away in
     * any drawing. The chord is real linework whatever the bulge says, so the
     * segment stays straight rather than the polyline being dropped: what is
     * lost is the curvature, which was never recoverable from these numbers.
     */
    if (!(Number.isFinite(radius) && Number.isFinite(centreX) && Number.isFinite(centreY))) {
      noteLimit("non-finite-drawing-geometry");
      continue;
    }
    const startAngle = Math.atan2(from[1] - centreY, from[0] - centreX);
    for (let step = 1; step < steps; step += 1) {
      const angle = startAngle + (included * step) / steps;
      const x = centreX + radius * Math.cos(angle);
      const y = centreY + radius * Math.sin(angle);
      // A finite radius on a finite centre can still overflow when both are
      // near the top of the double range; one note per arc, not per sample.
      if (!(Number.isFinite(x) && Number.isFinite(y))) {
        noteLimit("non-finite-drawing-geometry");
        break;
      }
      out.push([x, y]);
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

/**
 * One entity, or null when the file's fields do not describe a drawable one.
 *
 * Non-finite geometry is refused here, where it is produced, rather than where
 * it is drawn. `entityBounds` filters non-finite coordinates as it grows a box,
 * so an infinite radius still yields a plausible-looking extent and the only
 * symptom downstream is an SVG the browser will not parse — a blank reference
 * with nothing to say why. Refusing at the source makes the loss countable.
 */
export function convertDwgEntity(raw: RawEntity): DwgEntity | null {
  const entity = readDwgEntity(raw);
  if (!entity) return null;
  if (!dwgEntityIsFinite(entity)) {
    noteLimit("non-finite-drawing-geometry");
    return null;
  }
  return entity;
}

/**
 * Whether a polyline closes back on its first vertex.
 *
 * LibreDWG emits neither `closed` nor `isClosed` for any polyline — the bit is
 * in `flag`, and it is not the same bit on both shapes. The package's own SVG
 * converter is the authority for what it hands back: `svgConverter.js` reads
 * `lwpolyline.flag & 0x200` for LWPOLYLINE, which is the DWG-native bitfield
 * and not DXF group code 70, while the POLYLINE family keeps the DXF meaning of
 * bit 1 — `polyline.d.ts` documents it as "1: This is a closed polyline", and
 * `svgConverter.js` reads `polyline.flag & 0x1`. Reading 1 on an LWPOLYLINE
 * would pick up `plinegen` instead, which has nothing to do with closure.
 *
 * Getting this wrong is not subtle in the drawing: every closed room, wall
 * outline and column loses the segment back to its first vertex, and a closed
 * bulge polyline loses the arc that wraps.
 *
 * The explicit booleans are kept ahead of the flag as a fallback, in case a
 * producer other than LibreDWG sets them.
 */
const LWPOLYLINE_CLOSED_BIT = 0x200;
const POLYLINE_CLOSED_BIT = 0x1;

function polylineIsClosed(raw: RawEntity, type: string): boolean {
  if (raw.closed === true || raw.isClosed === true) return true;
  const flag = number(raw.flag);
  if (flag == null) return false;
  return (flag & (type === "LWPOLYLINE" ? LWPOLYLINE_CLOSED_BIT : POLYLINE_CLOSED_BIT)) !== 0;
}

function readDwgEntity(raw: RawEntity): DwgEntity | null {
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
      const closed = polylineIsClosed(raw, type);
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
      // POINT, HATCH, VIEWPORT, DIMENSION and the rest are dropped rather than
      // approximated: a plan reference wants linework it can be aligned
      // against, not a crosshair standing in for a block. INSERT is not dropped
      // — it is expanded before this point, by `convertDwgEntities`.
      return null;
  }
}

/** A 2D affine placement: scale, then rotate, then translate. */
type Placement = {
  originX: number; originY: number;
  scaleX: number; scaleY: number;
  cos: number; sin: number;
};

const IDENTITY: Placement = { originX: 0, originY: 0, scaleX: 1, scaleY: 1, cos: 1, sin: 0 };

function place(placement: Placement, x: number, y: number): [number, number] {
  const sx = x * placement.scaleX;
  const sy = y * placement.scaleY;
  return [
    placement.originX + sx * placement.cos - sy * placement.sin,
    placement.originY + sx * placement.sin + sy * placement.cos,
  ];
}

function compose(outer: Placement, inner: Placement): Placement {
  const [originX, originY] = place(outer, inner.originX, inner.originY);
  const angle = Math.atan2(outer.sin, outer.cos) + Math.atan2(inner.sin, inner.cos);
  return {
    originX, originY,
    scaleX: outer.scaleX * inner.scaleX,
    scaleY: outer.scaleY * inner.scaleY,
    cos: Math.cos(angle), sin: Math.sin(angle),
  };
}

/** Move an already-converted entity into the space a block reference puts it. */
function placeEntity(entity: DwgEntity, placement: Placement): DwgEntity | null {
  const uniform = Math.abs(placement.scaleX) === Math.abs(placement.scaleY)
    ? Math.abs(placement.scaleX) : null;
  const moved: DwgEntity = { ...entity };
  if (entity.points) moved.points = entity.points.map(([x, y]) => place(placement, x, y));
  if (entity.centre) {
    moved.centre = place(placement, entity.centre[0], entity.centre[1]);
    if (entity.radius != null) {
      // A circle under a non-uniform scale is an ellipse, which this shape
      // cannot hold. Rather than draw a wrong-shaped arc, the entity is
      // dropped; blocks scaled unevenly are rare and a missing symbol is
      // easier to see past than a misleading one.
      if (uniform == null) return null;
      moved.radius = entity.radius * uniform;
    }
    if (entity.height != null && uniform != null) moved.height = entity.height * uniform;
  }
  if (entity.startAngle != null && entity.endAngle != null) {
    const turn = Math.atan2(placement.sin, placement.cos);
    // A mirrored placement reverses the sweep; both ends flip and swap.
    const flipped = placement.scaleX * placement.scaleY < 0;
    const start = flipped ? -entity.endAngle : entity.startAngle;
    const end = flipped ? -entity.startAngle : entity.endAngle;
    moved.startAngle = start + turn;
    moved.endAngle = end + turn;
  }
  // The scales and the insertion point come from the file too, so a finite
  // entity under a validly-shaped transform can still land on infinity.
  if (!dwgEntityIsFinite(moved)) {
    noteLimit("non-finite-drawing-geometry");
    return null;
  }
  return moved;
}

function placementOf(raw: RawEntity): Placement {
  const origin = point(raw.insertionPoint ?? raw.position) ?? [0, 0];
  return {
    originX: origin[0], originY: origin[1],
    scaleX: number(raw.xScale) ?? 1,
    scaleY: number(raw.yScale) ?? 1,
    cos: Math.cos(radians(raw.rotation) ?? 0),
    sin: Math.sin(radians(raw.rotation) ?? 0),
  };
}

/** Blocks may reference blocks; this bounds a cycle rather than trusting files. */
const MAX_BLOCK_DEPTH = 8;

/**
 * How wide a single block reference may stamp its array.
 *
 * `MAX_BLOCK_DEPTH` bounds how deep references nest but says nothing about how
 * wide one of them spreads: `columnCount` and `rowCount` are read straight out
 * of the file and multiplied, so a reference hand-edited to 3,000 x 3,000 asks
 * for nine million copies of a block. Measured, that is 9,000,000 entities in
 * 21 seconds — long past the point the tab stops answering, and the drawing has
 * not been rendered yet.
 *
 * Both a per-axis span and a total are needed, because 1 x 9,000,000 costs
 * exactly what 3,000 x 3,000 costs. A MINSERT grid in real drafting is a
 * paving, ceiling-tile or parking-bay pattern — tens to low hundreds of copies;
 * every reference in the 2,330-reference survey drawing carries the default
 * 1 x 1. 512 per axis and 4,096 in total leave one to two orders of magnitude
 * of headroom over anything a drafter stamps, and still bound the worst case to
 * a few thousand copies of one block rather than nine million.
 */
const MAX_BLOCK_ARRAY_SPAN = 512;
const MAX_BLOCK_ARRAY_COPIES = 4_096;

/**
 * How many entities one drawing may expand to in total.
 *
 * The array caps bound one reference and `MAX_BLOCK_DEPTH` bounds nesting, but
 * eight levels of 4,096 still multiplies, and a file can simply declare a very
 * long entity list. This is the budget that does not depend on guessing which
 * of those a hostile file will use.
 *
 * The largest drawing in the corpus holds 202,501 model-space entities, laid
 * out as 54 plans on one sheet, before its 2,330 block references expand. A
 * million is roughly five times that, still renders, and is reached in about
 * two seconds — so a file that means it gets a truncated drawing and a warning,
 * where before it got a dead tab.
 */
export const MAX_DRAWING_ENTITIES = 1_000_000;

/**
 * The remaining entity allowance for one `convertDwgEntities` call.
 *
 * `noted` keeps the census honest: the budget is reached once per drawing, and
 * counting every entity it then refuses would report millions of rejections for
 * a single truncation.
 */
type EntityBudget = { remaining: number; noted: boolean };

/** Claim one entity's place in the budget, reporting the first refusal. */
function takeEntitySlot(budget: EntityBudget): boolean {
  if (budget.remaining > 0) {
    budget.remaining -= 1;
    return true;
  }
  if (!budget.noted) {
    budget.noted = true;
    noteLimit("max-drawing-entities");
  }
  return false;
}

function expandInsert(
  raw: RawEntity,
  blocks: ReadonlyMap<string, readonly RawEntity[]>,
  outer: Placement,
  depth: number,
  out: DwgEntity[],
  budget: EntityBudget,
) {
  if (depth >= MAX_BLOCK_DEPTH) return;
  const name = typeof raw.name === "string" ? raw.name : null;
  const contents = name == null ? undefined : blocks.get(name);
  if (!contents?.length) return;

  const own = placementOf(raw);
  // A single INSERT can stamp a grid of copies; the counts default to one.
  const declaredColumns = Math.max(1, Math.round(number(raw.columnCount) ?? 1));
  const declaredRows = Math.max(1, Math.round(number(raw.rowCount) ?? 1));
  let columns = Math.min(declaredColumns, MAX_BLOCK_ARRAY_SPAN);
  let rows = Math.min(declaredRows, MAX_BLOCK_ARRAY_SPAN);
  if (columns * rows > MAX_BLOCK_ARRAY_COPIES) {
    // Keep the grid's leading direction rather than truncating both axes to a
    // square: a clipped run of the pattern reads as a pattern, a square does not.
    rows = Math.max(1, Math.floor(MAX_BLOCK_ARRAY_COPIES / columns));
  }
  if (columns !== declaredColumns || rows !== declaredRows) {
    noteLimit("max-block-array-copies");
  }
  const columnSpacing = number(raw.columnSpacing) ?? 0;
  const rowSpacing = number(raw.rowSpacing) ?? 0;

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      // Array offsets are along the reference's own rotated axes.
      const stepped: Placement = column === 0 && row === 0 ? own : {
        ...own,
        originX: own.originX + column * columnSpacing * own.cos - row * rowSpacing * own.sin,
        originY: own.originY + column * columnSpacing * own.sin + row * rowSpacing * own.cos,
      };
      const placement = compose(outer, stepped);
      for (const inner of contents) {
        if (inner.isVisible === false) continue;
        if (inner.type === "INSERT") {
          expandInsert(inner, blocks, placement, depth + 1, out, budget);
          // A nested reference that used the budget up leaves nothing for the
          // copies still queued here. Reporting through the same claim keeps a
          // drawing that stops exactly on the budget from stopping silently.
          if (budget.remaining <= 0) {
            takeEntitySlot(budget);
            return;
          }
          continue;
        }
        // ATTDEF is the blank the block leaves for a value; the filled-in ATTRIB
        // is a sibling of the INSERT, so drawing both would print the prompt.
        if (inner.type === "ATTDEF") continue;
        const converted = convertDwgEntity(inner);
        if (!converted) continue;
        const moved = placeEntity(converted, placement);
        if (!moved) continue;
        if (!takeEntitySlot(budget)) return;
        out.push(moved);
      }
    }
  }
}

/**
 * Block definitions by name, from LibreDWG's block-record table.
 *
 * A block's contents hang off its `BLOCK_RECORD` entry, not off the database's
 * entity list — the entity list holds only what is in model and paper space. On
 * the sample survey drawing that is 16,377 entities behind 2,330 references:
 * window mullions, curtain walls and door leaves, which is exactly the detail
 * somebody aligns a floor against.
 */
export function dwgBlockDefinitions(database: unknown): Map<string, RawEntity[]> {
  const entries = (database as {
    tables?: { BLOCK_RECORD?: { entries?: unknown[] } };
  })?.tables?.BLOCK_RECORD?.entries ?? [];
  const blocks = new Map<string, RawEntity[]>();
  for (const entry of entries) {
    const record = entry as { name?: unknown; entities?: unknown };
    if (typeof record.name !== "string") continue;
    // Model and paper space are block records too, and are already drawn.
    if (/^\*(model|paper)_space/iu.test(record.name)) continue;
    if (!Array.isArray(record.entities) || !record.entities.length) continue;
    blocks.set(record.name, record.entities as RawEntity[]);
  }
  return blocks;
}

export function convertDwgEntities(
  raw: readonly unknown[],
  options: {
    ownerHandle?: string | null;
    /** Block contents by name; without them, block references draw nothing. */
    blocks?: ReadonlyMap<string, readonly RawEntity[]>;
    /**
     * How many entities this drawing may expand to, defaulting to
     * `MAX_DRAWING_ENTITIES`. A caller that knows it is working on something
     * smaller than a campus survey can say so.
     */
    maxEntities?: number;
  } = {},
): DwgEntity[] {
  const owner = options.ownerHandle;
  const blocks = options.blocks;
  const out: DwgEntity[] = [];
  const budget: EntityBudget = {
    remaining: options.maxEntities ?? MAX_DRAWING_ENTITIES,
    noted: false,
  };
  for (const entry of raw) {
    const entity = entry as RawEntity;
    if (owner != null) {
      const entityOwner = entity.ownerBlockRecordSoftId ?? entity.ownerHandle;
      if (entityOwner != null && String(entityOwner) !== owner) continue;
    }
    if (entity.isVisible === false) continue;
    if (entity.type === "INSERT") {
      if (blocks) expandInsert(entity, blocks, IDENTITY, 0, out, budget);
      if (budget.remaining <= 0) {
        takeEntitySlot(budget);
        break;
      }
      continue;
    }
    const converted = convertDwgEntity(entity);
    if (!converted) continue;
    if (!takeEntitySlot(budget)) break;
    out.push(converted);
  }
  return out;
}
