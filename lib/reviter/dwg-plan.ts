/**
 * Turning a DWG's model space into floor-plan references.
 *
 * A survey DWG of a campus is not one drawing. This one holds 202,501
 * model-space entities laid out side by side — 54 plans' worth — and the
 * paper-space layouts that name them ("02 Plant LVL 1") are viewports onto that
 * shared space. LibreDWG exposes a viewport's paper-space rectangle but not the
 * model-space region it looks at, so the layouts cannot be used to cut the
 * drawing up. The plans are separated by wide empty margins instead, which is
 * what this splits on.
 *
 * Everything here is pure and takes plain entities, so it is testable without
 * loading a 4 MB WASM decoder; `dwg-worker.ts` supplies the entities.
 */
import { noteLimit } from "./limit-census.ts";

/** The entity subset the plan renderer understands, flattened from LibreDWG. */
export type DwgEntity = {
  type: string;
  layer: string;
  /** Straight runs: a polyline of already-resolved points. */
  points?: readonly (readonly [number, number])[];
  /** Circles and arcs, which stay analytic so they do not tessellate twice. */
  centre?: readonly [number, number];
  radius?: number;
  /** Radians, counter-clockwise from +x. Absent on a full circle. */
  startAngle?: number;
  endAngle?: number;
  /** Ellipse support: the major axis offset from the centre, and minor/major. */
  majorAxis?: readonly [number, number];
  axisRatio?: number;
  text?: string;
  height?: number;
  closed?: boolean;
};

export type DwgBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type DwgSection = {
  /** Index into the section list; stable for a given entity array. */
  id: number;
  bounds: DwgBounds;
  entityCount: number;
  /** Width and height in the drawing's own units. */
  widthUnits: number;
  heightUnits: number;
};

const EMPTY: DwgBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

function grow(bounds: DwgBounds, x: number, y: number): DwgBounds {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return bounds;
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  return bounds;
}

export function entityBounds(entity: DwgEntity): DwgBounds | null {
  const bounds: DwgBounds = { ...EMPTY };
  if (entity.centre && Number.isFinite(entity.radius)) {
    const radius = Math.abs(entity.radius!);
    grow(bounds, entity.centre[0] - radius, entity.centre[1] - radius);
    grow(bounds, entity.centre[0] + radius, entity.centre[1] + radius);
  }
  if (entity.majorAxis && entity.centre) {
    const reach = Math.hypot(entity.majorAxis[0], entity.majorAxis[1]);
    grow(bounds, entity.centre[0] - reach, entity.centre[1] - reach);
    grow(bounds, entity.centre[0] + reach, entity.centre[1] + reach);
  }
  for (const point of entity.points ?? []) grow(bounds, point[0], point[1]);
  return Number.isFinite(bounds.minX) ? bounds : null;
}

/**
 * Whether every number an entity carries is a finite coordinate.
 *
 * `grow` above drops non-finite values as it widens a box, which is right for
 * bounds and actively misleading everywhere else: an entity whose radius came
 * out `Infinity` still contributes a plausible extent through its other fields,
 * so the drawing looks measured while its path data is unparseable. SVG has no
 * such tolerance — one `Infinity` in a `d` attribute makes the browser reject
 * the entire document, and every other layer's linework goes with it. So the
 * entity is refused whole rather than drawn with the bad number filtered out:
 * a partly-drawn arc is a wrong drawing, and a missing one is a reported gap.
 */
export function dwgEntityIsFinite(entity: DwgEntity): boolean {
  for (const value of [
    entity.radius, entity.startAngle, entity.endAngle, entity.height, entity.axisRatio,
  ]) {
    if (value != null && !Number.isFinite(value)) return false;
  }
  for (const pair of [entity.centre, entity.majorAxis]) {
    if (pair && !(Number.isFinite(pair[0]) && Number.isFinite(pair[1]))) return false;
  }
  for (const point of entity.points ?? []) {
    if (!(Number.isFinite(point[0]) && Number.isFinite(point[1]))) return false;
  }
  return true;
}

export function unionBounds(all: readonly DwgBounds[]): DwgBounds | null {
  const bounds: DwgBounds = { ...EMPTY };
  for (const one of all) {
    grow(bounds, one.minX, one.minY);
    grow(bounds, one.maxX, one.maxY);
  }
  return Number.isFinite(bounds.minX) ? bounds : null;
}

type Box = { bounds: DwgBounds; centreX: number; centreY: number };

/**
 * The widest empty run along one axis, and where to cut it.
 *
 * Relative to the region being examined, not to the whole drawing: that is what
 * lets the same rule separate sheets and then stop, because a plan's internal
 * courtyards are small next to the plan while the margin between two plans is
 * not small next to the pair.
 */
function widestGap(boxes: readonly Box[], axis: "x" | "y", low: number, high: number) {
  const spans = boxes
    .map((box) => axis === "x"
      ? [box.bounds.minX, box.bounds.maxX] as const
      : [box.bounds.minY, box.bounds.maxY] as const)
    .sort((left, right) => left[0] - right[0]);
  let reach = low;
  let best = { width: 0, at: low };
  for (const [from, to] of spans) {
    if (from > reach) {
      const width = from - reach;
      if (width > best.width) best = { width, at: reach + width / 2 };
    }
    reach = Math.max(reach, to);
  }
  if (high > reach) {
    const width = high - reach;
    if (width > best.width) best = { width, at: reach + width / 2 };
  }
  return best;
}

/**
 * Split model space into the drawings it actually contains.
 *
 * Recursive: find the widest empty band across the region, and cut only if it is
 * wide relative to the region itself. A sheet of plans separated by margins
 * splits; a single plan, whose own gaps are small next to its extent, is left
 * whole. An earlier version thresholded against the whole drawing's span and
 * shredded any sparse plan into one section per line — see the "single drawing"
 * test, which is that bug.
 */
export function dwgSections(
  entities: readonly DwgEntity[],
  options: {
    splitRatio?: number;
    minimumEntities?: number;
    maximumSections?: number;
    /** Entities larger than this fraction of the sheet are sheet furniture. */
    outsizedRatio?: number;
  } = {},
): DwgSection[] {
  const all: Box[] = [];
  for (const entity of entities) {
    const bounds = entityBounds(entity);
    if (!bounds) continue;
    all.push({
      bounds,
      centreX: (bounds.minX + bounds.maxX) / 2,
      centreY: (bounds.minY + bounds.maxY) / 2,
    });
  }
  if (!all.length) return [];

  /*
   * Sheet furniture does not belong to a plan and must not decide where the
   * plans are. This drawing carries reference squares 100,000 units across on a
   * 1.6-million-unit sheet: a handful of them span every margin, and a gap that
   * something crosses is not a gap, so splitting saw one section holding all
   * 199,411 entities. They are excluded from the decision and re-admitted
   * afterwards by whichever section they land in.
   */
  const whole = unionBounds(all.map((box) => box.bounds))!;
  const outsized = Math.max(whole.maxX - whole.minX, whole.maxY - whole.minY)
    * (options.outsizedRatio ?? 0.04);
  const ordinary = all.filter((box) =>
    Math.max(box.bounds.maxX - box.bounds.minX, box.bounds.maxY - box.bounds.minY) <= outsized);
  // Only when it really is furniture: sheet furniture is a handful of things.
  // If most of the drawing looks "outsized" then the drawing is simply one plan
  // at its own scale, and excluding it would leave nothing to split on.
  const boxes = ordinary.length >= all.length * 0.9 ? ordinary : all;
  if (!boxes.length) return [];
  const splitRatio = options.splitRatio ?? 0.18;
  const minimumEntities = options.minimumEntities ?? 25;
  const maximumSections = options.maximumSections ?? 256;

  const found: { bounds: DwgBounds; count: number }[] = [];
  const queue: Box[][] = [boxes];
  while (queue.length && found.length < maximumSections) {
    const region = queue.pop()!;
    const bounds = unionBounds(region.map((box) => box.bounds));
    if (!bounds) continue;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const extent = Math.max(width, height, 1e-9);

    const horizontal = widestGap(region, "x", bounds.minX, bounds.maxX);
    const vertical = widestGap(region, "y", bounds.minY, bounds.maxY);
    const axis = horizontal.width >= vertical.width ? "x" : "y";
    const gap = axis === "x" ? horizontal : vertical;

    // No size guard here: a scrap of stray linework sitting well away from a
    // plan has to be separated so it can be dropped, and refusing to split a
    // small region merged it into whichever plan it was nearest instead. The
    // ratio test is what stops the recursion, and `maximumSections` bounds it.
    if (region.length > 1 && gap.width > extent * splitRatio) {
      const left = region.filter((box) => (axis === "x" ? box.centreX : box.centreY) < gap.at);
      const right = region.filter((box) => (axis === "x" ? box.centreX : box.centreY) >= gap.at);
      if (left.length && right.length) { queue.push(left, right); continue; }
    }
    found.push({ bounds, count: region.length });
  }

  /*
   * `minimumEntities` is a scrap filter, and a scrap is only a scrap next to a
   * plan. When the split found exactly one region there is nothing for it to be
   * a scrap of — it is the drawing, whatever its size — and dropping it returns
   * no sections at all for a file that decoded perfectly well. A twenty-entity
   * site plan is a real drawing; it is just a small one.
   */
  const kept = found.length === 1
    ? found
    : found.filter((section) => section.count >= minimumEntities);

  return kept
    // Largest first: the plan someone wants is rarely the smallest scrap.
    .sort((left, right) => right.count - left.count)
    .map((section, index) => ({
      id: index,
      bounds: section.bounds,
      entityCount: section.count,
      widthUnits: section.bounds.maxX - section.bounds.minX,
      heightUnits: section.bounds.maxY - section.bounds.minY,
    }));
}

/**
 * The extent to draw a whole drawing at, or null when it has no geometry.
 *
 * A drawing can decode perfectly and still yield no sections: several scraps,
 * none of them big enough to be a plan. The caller then has real coordinates
 * and no box to put them in, and the box it used to fall back on was the unit
 * square — which puts every line outside the viewBox and hands back a blank
 * white image, reported as a successful decode. Nothing about that is honest,
 * and nothing about it was necessary: the extent of a drawing with no sections
 * is simply the extent of its entities.
 *
 * Sections are still preferred where there are any, because they are what
 * crops sheet furniture and stray linework out of the reference.
 */
export function dwgDrawingBounds(
  entities: readonly DwgEntity[],
  sections: readonly DwgSection[],
): DwgBounds | null {
  // One drawing per sheet is the common case; a sheet of many plans keeps its
  // whole extent so nothing is silently cropped away from the reference.
  if (sections.length === 1) return sections[0]!.bounds;
  const fromSections = unionBounds(sections.map((section) => section.bounds));
  if (fromSections) return fromSections;
  const boxes: DwgBounds[] = [];
  for (const entity of entities) {
    const box = entityBounds(entity);
    if (box) boxes.push(box);
  }
  return unionBounds(boxes);
}

export function entitiesWithin(
  entities: readonly DwgEntity[],
  bounds: DwgBounds,
): DwgEntity[] {
  const inside: DwgEntity[] = [];
  for (const entity of entities) {
    const box = entityBounds(entity);
    if (!box) continue;
    const centreX = (box.minX + box.maxX) / 2;
    const centreY = (box.minY + box.maxY) / 2;
    if (centreX < bounds.minX || centreX > bounds.maxX) continue;
    if (centreY < bounds.minY || centreY > bounds.maxY) continue;
    inside.push(entity);
  }
  return inside;
}

const round = (value: number) => {
  const fixed = Math.round(value * 100) / 100;
  return Object.is(fixed, -0) ? 0 : fixed;
};

function arcPath(
  centre: readonly [number, number],
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  // SVG arcs are described by their endpoints and a sweep flag, so a DWG's
  // centre/angles pair has to be resolved to points. A DWG arc always runs
  // counter-clockwise from start to end.
  let sweep = endAngle - startAngle;
  while (sweep <= 0) sweep += Math.PI * 2;
  const from: [number, number] = [
    centre[0] + radius * Math.cos(startAngle),
    centre[1] + radius * Math.sin(startAngle),
  ];
  const to: [number, number] = [
    centre[0] + radius * Math.cos(startAngle + sweep),
    centre[1] + radius * Math.sin(startAngle + sweep),
  ];
  const large = sweep > Math.PI ? 1 : 0;
  return `M${round(from[0])} ${round(from[1])}A${round(radius)} ${round(radius)} 0 ${large} 1 ${round(to[0])} ${round(to[1])}`;
}

/**
 * One SVG for one section, with every entity of a layer batched into a single
 * path. Emitting an element per entity is what made the library's own whole-file
 * SVG 36 MB and unrenderable; a hundred thousand `M…L…` pairs in a handful of
 * paths is a fraction of that and draws in one pass per layer.
 */
export function dwgSectionSvg(
  entities: readonly DwgEntity[],
  box: DwgBounds,
  options: { strokeUnits?: number; includeText?: boolean } = {},
): string {
  // A viewBox is as fatal as a path: `viewBox="Infinity …"` is rejected before
  // any of the linework is read. Callers that derive a box from `unionBounds`
  // cannot produce one, but the empty box that function starts from is all
  // infinities, so a caller that forwards it unchecked must not take the
  // document down with it.
  const finite = [box.minX, box.minY, box.maxX, box.maxY].every((value) =>
    Number.isFinite(value));
  if (!finite) noteLimit("non-finite-drawing-geometry");
  const bounds = finite ? box : { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const width = Math.max(1e-6, bounds.maxX - bounds.minX);
  const height = Math.max(1e-6, bounds.maxY - bounds.minY);
  const stroke = options.strokeUnits ?? Math.max(width, height) / 2_000;

  const byLayer = new Map<string, string[]>();
  const texts: string[] = [];
  const push = (layer: string, segment: string) => {
    const list = byLayer.get(layer);
    if (list) list.push(segment); else byLayer.set(layer, [segment]);
  };

  for (const entity of entities) {
    // The producers in `dwg-entities.ts` refuse non-finite geometry where it is
    // computed, which is where the cause is still visible. This is the backstop
    // for entities that reached the renderer some other way, and it is the last
    // point at which one bad number can still be contained to one entity.
    if (!dwgEntityIsFinite(entity)) {
      noteLimit("non-finite-drawing-geometry");
      continue;
    }
    const layer = entity.layer || "0";
    if (entity.points?.length) {
      const [first, ...rest] = entity.points;
      let path = `M${round(first![0])} ${round(first![1])}`;
      for (const point of rest) path += `L${round(point[0])} ${round(point[1])}`;
      if (entity.closed) path += "Z";
      push(layer, path);
      continue;
    }
    if (entity.centre && Number.isFinite(entity.radius)) {
      const radius = Math.abs(entity.radius!);
      if (entity.startAngle == null || entity.endAngle == null) {
        // A full circle needs two half arcs: one arc cannot close on itself.
        const [cx, cy] = entity.centre;
        push(layer,
          `M${round(cx - radius)} ${round(cy)}` +
          `A${round(radius)} ${round(radius)} 0 1 0 ${round(cx + radius)} ${round(cy)}` +
          `A${round(radius)} ${round(radius)} 0 1 0 ${round(cx - radius)} ${round(cy)}`);
      } else {
        push(layer, arcPath(entity.centre, radius, entity.startAngle, entity.endAngle));
      }
      continue;
    }
    if (options.includeText !== false && entity.text && entity.centre) {
      const size = entity.height && entity.height > 0 ? entity.height : Math.max(width, height) / 260;
      texts.push(
        `<text x="${round(entity.centre[0])}" y="${round(-entity.centre[1])}" font-size="${round(size)}">` +
        `${escapeXml(entity.text)}</text>`,
      );
    }
  }

  const layers = [...byLayer.entries()]
    .map(([layer, segments]) =>
      `<path data-dwg-layer="${escapeXml(layer)}" d="${segments.join("")}"/>`)
    .join("");

  // The Y flip is on the group rather than baked into every coordinate: DWG is
  // Y-up and SVG is Y-down, and one transform is cheaper than 200,000 negations.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(bounds.minX)} ${round(-bounds.maxY)} ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}" role="img" aria-label="Floor plan recovered from a DWG drawing" data-dwg-units-wide="${round(width)}" data-dwg-units-high="${round(height)}">
  <style>
    .dwg{fill:none;stroke:#111827;stroke-width:${round(stroke)};stroke-linecap:round;stroke-linejoin:round}
    .dwg-text{fill:#111827;font-family:system-ui,sans-serif}
  </style>
  <rect x="${round(bounds.minX)}" y="${round(-bounds.maxY)}" width="${round(width)}" height="${round(height)}" fill="#fffdf7"/>
  <g class="dwg" transform="scale(1 -1)">${layers}</g>
  <g class="dwg-text" transform="scale(1 -1)"><g transform="scale(1 -1)">${texts.join("")}</g></g>
</svg>`;
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[character]!));
}

/** AutoCAD `$INSUNITS`, for the few files that declare one. */
export const DWG_UNIT_FEET: Readonly<Record<number, number>> = {
  1: 1 / 12,       // inches
  2: 1,            // feet
  4: 1 / 304.8,    // millimetres
  5: 1 / 30.48,    // centimetres
  6: 1 / 0.3048,   // metres
};

/**
 * Feet per drawing unit, or null when the file does not say. `$INSUNITS` is 0 —
 * "unitless" — on plenty of real drawings, including the UNBC floor plan, so a
 * caller must be able to carry on without it rather than guess a scale.
 */
export function dwgFeetPerUnit(insunits: number | undefined): number | null {
  if (insunits == null) return null;
  return DWG_UNIT_FEET[insunits] ?? null;
}
