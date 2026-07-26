/**
 * Where the recovery draws a straight box around something that is not straight.
 *
 *   node --experimental-strip-types scripts/footprint-audit.ts model.rvt model.ifc
 *   node --experimental-strip-types scripts/footprint-audit.ts model.rvt model.ifc --json run.json
 *
 * ## Why this exists
 *
 * `overlay-diff.ts` compares boxes to boxes: centre and size, per element,
 * against the export. That is the right measure for a wall drawn along its own
 * location line, and it is blind to the defect that is most visible on screen —
 * an element whose *shape* is not a box at all being drawn as one.
 *
 * An axis-aligned box around a wall at 45 degrees has almost the right centre
 * and almost the right size and is still a large rectangle where the wall is a
 * thin sliver. The centre agreement for such an element can be 100%.
 *
 * So this measures a different quantity: how much of its own plan bounding box
 * an element's footprint actually fills. A rectangle aligned to the model axes
 * fills 1.00. A quarter-round wall fills pi/4 = 0.785. A wall at 45 degrees
 * fills its thickness over its length, which for a 1 ft wall 30 ft long is
 * 0.03. Computing that for the export's footprint and for the geometry the
 * viewer actually draws, the difference is the plan area the recovery invents.
 *
 * ## What it separates, and why that matters
 *
 * A low fill has two quite different causes and they need different fixes, so
 * they are reported apart, by the footprint's fill against its own *minimum-
 * area* rectangle rather than its axis-aligned one:
 *
 *   - **diagonal**: fills its min-area rectangle. A straight element at an
 *     angle to the model axes — a rectangle is a rectangle at any rotation.
 *   - **curved**: does not. A quarter round fills pi/4 of it. These are
 *     recoverable from the element's own cylinder triple; see the README
 *     section "Curved walls are written the way straight ones are".
 *
 * Counting hull corners was tried for this and is wrong, because how far an
 * arc's turns fall below any angular merge threshold depends entirely on how
 * finely the exporter tessellated it.
 *
 * Reporting one number for both would have hidden that, and did: the visible
 * complaint was about curves and the measurable defect is nearly all diagonals.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { convertModel } from "./audit-coverage.ts";
import { drawnBounds } from "./overlay-diff.ts";

import type { ElementBoundsRecord } from "../lib/reviter/types.ts";

const FEET_PER_METRE = 3.280839895013123;

/** Below this a footprint is too small for its fill ratio to mean anything. */
const MIN_BBOX_SQ_FEET = 40;

/** Fill at or above this is a box, and drawing it as one is correct. */
const FILL_IS_A_BOX = 0.92;

/**
 * Fill against the footprint's own *minimum-area* rectangle, below which it is
 * curved rather than merely angled.
 *
 * Counting hull corners was tried first and is wrong: it needs an angular
 * threshold to merge near-collinear runs, and how far an arc's turns fall below
 * that threshold depends entirely on how finely the exporter tessellated it. A
 * 64-segment quarter round has 1.4 degrees per step and collapses to three
 * corners, reading as a triangle.
 *
 * The minimum-area rectangle needs no threshold and no tessellation assumption.
 * A rectangle at any angle fills its own min-area rectangle exactly, so the
 * measure is rotation-invariant by construction; a quarter round fills pi/4 of
 * it however many segments it was written with.
 */
const CURVED_BELOW_RECT_FILL = 0.92;

/** Fill this much above the export's counts as drawn straight. */
const STRAIGHTENED_BY = 0.05;

export type Point2 = [number, number];

export type FootprintRow = {
  elementId: number;
  ifcType: string;
  categoryName?: string;
  /** Fill ratio of the export's footprint against its own plan box. */
  exportFill: number;
  /** Fill ratio of what the viewer draws. */
  drawnFill: number;
  /** Fill against the footprint's own minimum-area rectangle. */
  rectFill: number;
  shape: "curved" | "diagonal";
  /** Plan area the recovery adds, in square feet. */
  addedSqFeet: number;
  drawnAs: string;
};

export type FootprintAudit = {
  /** Export products carrying a Revit id and producing geometry. */
  truthCount: number;
  /** Of those, the ones whose footprint is not a box. */
  notBoxCount: number;
  /** Of those, the ones the recovery draws as a box anyway. */
  straightenedCount: number;
  curvedCount: number;
  diagonalCount: number;
  curvedAddedSqFeet: number;
  diagonalAddedSqFeet: number;
  /** Non-box footprints the recovery already follows, by the route it used. */
  followedBy: Record<string, number>;
  rows: FootprintRow[];
};

export function hull(points: Point2[]): Point2[] {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (source: Point2[]) => {
    const out: Point2[] = [];
    for (const point of source) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, point) <= 0) {
        out.pop();
      }
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}

export function ringArea(ring: Point2[]): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const here = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    total += here[0] * next[1] - next[0] * here[1];
  }
  return Math.abs(total) / 2;
}

/**
 * Area of the smallest rectangle enclosing a hull, at any rotation.
 *
 * Rotating calipers: the minimum-area rectangle always has a side flush with a
 * hull edge, so aligning to each edge in turn and taking the smallest axis-
 * aligned box is exact rather than a search.
 */
export function minAreaRect(ring: Point2[]): number {
  if (ring.length < 3) return 0;
  let best = Infinity;
  for (let index = 0; index < ring.length; index += 1) {
    const here = ring[index]!;
    const next = ring[(index + 1) % ring.length]!;
    const length = Math.hypot(next[0] - here[0], next[1] - here[1]);
    if (length < 1e-12) continue;
    const cos = (next[0] - here[0]) / length;
    const sin = (next[1] - here[1]) / length;
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const [x, y] of ring) {
      const u = x * cos + y * sin;
      const v = -x * sin + y * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best) best = area;
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * How much of its own minimum-area rectangle a footprint fills. A rectangle at
 * any angle scores 1.00; a quarter round scores pi/4. This is what separates a
 * curve from an angle, and unlike a corner count it does not depend on how
 * finely the exporter tessellated the curve.
 */
export function rectFill(ring: Point2[]): number {
  const rect = minAreaRect(ring);
  return rect > 0 ? ringArea(ring) / rect : 1;
}

/** Hull area over the area of the point set's own plan bounding box. */
export function planFill(
  points: Point2[],
): { fill: number; boxArea: number; rectFill: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const boxArea = (maxX - minX) * (maxY - minY);
  const ring = hull(points);
  if (ring.length < 3 || boxArea <= 0) return { fill: 1, boxArea, rectFill: 1 };
  return { fill: ringArea(ring) / boxArea, boxArea, rectFill: rectFill(ring) };
}

/** Which route the viewer took for a record, in `buildBoundsMeshes` order. */
export function drawnRoute(record: ElementBoundsRecord): string {
  if (record.railPath) return "rail path";
  if (record.loops?.length) return "sketch ring";
  if (record.orientedBox) return "oriented box";
  if (record.solids?.length || record.solid) return "rebuilt solid";
  if (record.arcs?.length) return "curved wall arc";
  return "envelope";
}

/**
 * Plan corners of what the viewer draws. `drawnBounds` already follows the
 * viewer's precedence but returns an axis-aligned box, which would make every
 * element read as fill 1.00; the oriented routes are therefore unpacked here.
 */
export function drawnPlanPoints(record: ElementBoundsRecord): Point2[] {
  if (record.loops?.length) {
    return record.loops.flatMap((ring) => ring.map(([x, y]) => [x, y] as Point2));
  }
  if (record.orientedBox) return record.orientedBox.map(([x, y]) => [x, y] as Point2);
  const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
  if (solids.length) {
    const points: Point2[] = [];
    for (const solid of solids) {
      const dx = solid.end.x - solid.start.x;
      const dy = solid.end.y - solid.start.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = (-dy / length) * solid.thickness * 0.5;
      const ny = (dx / length) * solid.thickness * 0.5;
      for (const end of [solid.start, solid.end]) {
        for (const sign of [1, -1]) points.push([end.x + nx * sign, end.y + ny * sign]);
      }
    }
    return points;
  }
  if (record.arcs?.length) {
    const points: Point2[] = [];
    for (const arc of record.arcs) {
      const sweep = arc.endAngle - arc.startAngle;
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 32)));
      for (let step = 0; step <= steps; step += 1) {
        const angle = arc.startAngle + (sweep * step) / steps;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const ux = cos * arc.xDir.x + sin * arc.yDir.x;
        const uy = cos * arc.xDir.y + sin * arc.yDir.y;
        for (const radius of [arc.radius - arc.thickness / 2, arc.radius + arc.thickness / 2]) {
          points.push([arc.centre.x + radius * ux, arc.centre.y + radius * uy]);
        }
      }
    }
    return points;
  }
  const box = drawnBounds(record);
  return [
    [box[0]!, box[1]!], [box[3]!, box[1]!], [box[3]!, box[4]!], [box[0]!, box[4]!],
  ];
}

/**
 * Plan footprints from the export, unioned per Revit id. The union is
 * load-bearing for the same reason it is in `overlay-diff.ts`: one Revit
 * element can leave the exporter as several products sharing one `Tag`, and
 * keeping the last would measure a fragment of the element against the whole.
 */
/**
 * `#id=IFCTYPE(...)` products by express id, with the Revit element id.
 *
 * The tag is the **last all-digit quoted attribute anywhere in the entity**, the
 * same reading `readIfcProducts` uses. Taking the last comma-separated field of
 * the first line instead is wrong, and wrong in a way that looks like a decoder
 * defect: `Tag` is the final attribute only for some types, so `IFCSLAB(...,
 * '400238', .FLOOR.)` ends in `.FLOOR.` and `IFCDOOR` ends in two dimensions.
 * Those products never entered the map and every mesh they own was skipped —
 * 2,425 Revit ids the export does give geometry to, wholesale: 1,912 doors, 229
 * railings, 161 slabs, 121 stair flights, 92 stairs, 46 coverings, 20 roofs, 20
 * windows, 12 ramps, 20 roofs. Downstream that made `compare-view.ts` paint
 * every slab, door, railing, stair and window as having no export product,
 * which read on screen as a sheet lying over the building, and made this file
 * report 63 phantom "orphan floors" that are in fact matched to 0.000 ft.
 * No `verify-pair.ts` assertion used these functions, so nothing shipped was
 * affected.
 */
function readProductsByExpressId(text: string): Map<number, { type: string; tag: number }> {
  const products = new Map<number, { type: string; tag: number }>();
  const entity = /^#(\d+) *= *(IFC[A-Z0-9]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    let tag = 0;
    for (const quoted of match[3]!.matchAll(/'([^']*)'/g)) {
      if (/^\d+$/.test(quoted[1]!)) tag = Number(quoted[1]!);
    }
    if (tag) products.set(Number(match[1]), { type: match[2]!, tag });
  }
  return products;
}

export async function streamTruthVertices(
  ifcPath: string,
  visit: (tag: number, type: string, x: number, y: number, z: number) => void,
): Promise<void> {
  const { IfcAPI } = await import("web-ifc");
  const products = readProductsByExpressId(readFileSync(ifcPath, "latin1"));
  const api = new IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new Uint8Array(readFileSync(ifcPath)));
  api.StreamAllMeshes(modelID, (mesh) => {
    const product = products.get(mesh.expressID);
    if (!product) return;
    const parts = mesh.geometries;
    for (let part = 0; part < parts.size(); part += 1) {
      const item = parts.get(part);
      const geometry = api.GetGeometry(modelID, item.geometryExpressID);
      const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const m = item.flatTransformation;
      for (let v = 0; v + 2 < vertices.length; v += 6) {
        const x = vertices[v]!, y = vertices[v + 1]!, z = vertices[v + 2]!;
        // Y-up metres -> Z-up feet, as everywhere else in this repo.
        visit(
          product.tag,
          product.type,
          (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) * FEET_PER_METRE,
          -(m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * FEET_PER_METRE,
          (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) * FEET_PER_METRE,
        );
      }
      geometry.delete();
    }
  });
}

export async function readTruthFootprints(
  ifcPath: string,
): Promise<Map<number, { type: string; points: Point2[] }>> {
  const { IfcAPI } = await import("web-ifc");
  const products = readProductsByExpressId(readFileSync(ifcPath, "latin1"));

  const api = new IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new Uint8Array(readFileSync(ifcPath)));
  const truth = new Map<number, { type: string; points: Point2[] }>();
  api.StreamAllMeshes(modelID, (mesh) => {
    const product = products.get(mesh.expressID);
    if (!product) return;
    const points: Point2[] = [];
    const parts = mesh.geometries;
    for (let part = 0; part < parts.size(); part += 1) {
      const item = parts.get(part);
      const geometry = api.GetGeometry(modelID, item.geometryExpressID);
      const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const m = item.flatTransformation;
      for (let v = 0; v + 2 < vertices.length; v += 6) {
        const x = vertices[v]!, y = vertices[v + 1]!, z = vertices[v + 2]!;
        // Y-up metres -> Z-up feet, as everywhere else in this repo.
        points.push([
          (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) * FEET_PER_METRE,
          -(m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * FEET_PER_METRE,
        ]);
      }
      geometry.delete();
    }
    if (!points.length) return;
    const existing = truth.get(product.tag);
    if (existing) existing.points.push(...points);
    else truth.set(product.tag, { type: product.type, points });
  });
  return truth;
}

export function auditFootprints(
  records: ElementBoundsRecord[],
  truth: Map<number, { type: string; points: Point2[] }>,
): FootprintAudit {
  const byId = new Map(records.map((record) => [record.elementId, record]));
  const rows: FootprintRow[] = [];
  const followedBy: Record<string, number> = {};
  let notBoxCount = 0;

  for (const [elementId, product] of truth) {
    const exportPlan = planFill(product.points);
    if (exportPlan.boxArea < MIN_BBOX_SQ_FEET) continue;
    if (exportPlan.fill >= FILL_IS_A_BOX) continue;
    const record = byId.get(elementId);
    if (!record) continue;
    notBoxCount += 1;

    const drawnPlan = planFill(drawnPlanPoints(record));
    const route = drawnRoute(record);
    if (drawnPlan.fill - exportPlan.fill <= STRAIGHTENED_BY) {
      followedBy[route] = (followedBy[route] ?? 0) + 1;
      continue;
    }
    rows.push({
      elementId,
      ifcType: product.type,
      categoryName: record.categoryName,
      exportFill: exportPlan.fill,
      drawnFill: drawnPlan.fill,
      rectFill: exportPlan.rectFill,
      shape: exportPlan.rectFill < CURVED_BELOW_RECT_FILL ? "curved" : "diagonal",
      addedSqFeet: (drawnPlan.fill - exportPlan.fill) * exportPlan.boxArea,
      drawnAs: route,
    });
  }

  rows.sort((a, b) => b.addedSqFeet - a.addedSqFeet);
  const curved = rows.filter((row) => row.shape === "curved");
  const diagonal = rows.filter((row) => row.shape === "diagonal");
  const sum = (list: FootprintRow[]) => list.reduce((total, row) => total + row.addedSqFeet, 0);
  return {
    truthCount: truth.size,
    notBoxCount,
    straightenedCount: rows.length,
    curvedCount: curved.length,
    diagonalCount: diagonal.length,
    curvedAddedSqFeet: sum(curved),
    diagonalAddedSqFeet: sum(diagonal),
    followedBy,
    rows,
  };
}

export function printFootprintAudit(audit: FootprintAudit): void {
  const round = (value: number) => Math.round(value).toLocaleString();
  console.log(`
export products with a footprint    ${audit.truthCount.toLocaleString()}
  not a box in plan                 ${audit.notBoxCount.toLocaleString()}
  drawn as a box anyway             ${audit.straightenedCount.toLocaleString()}
    curved                          ${String(audit.curvedCount).padStart(5)}   ${round(audit.curvedAddedSqFeet)} sq ft added
    diagonal                        ${String(audit.diagonalCount).padStart(5)}   ${round(audit.diagonalAddedSqFeet)} sq ft added
`);

  const followed = Object.entries(audit.followedBy).sort((a, b) => b[1] - a[1]);
  if (followed.length) {
    console.log("non-box footprints the recovery already follows");
    for (const [route, count] of followed) {
      console.log(`  ${route.padEnd(18)} ${String(count).padStart(6)}`);
    }
  }

  const byType = new Map<string, { n: number; added: number }>();
  for (const row of audit.rows) {
    const entry = byType.get(row.ifcType) ?? { n: 0, added: 0 };
    entry.n += 1;
    entry.added += row.addedSqFeet;
    byType.set(row.ifcType, entry);
  }
  if (byType.size) {
    console.log("\nIFC product type              drawn straight    plan sq ft added");
    console.log("------------------------------------------------------------------");
    for (const [type, entry] of [...byType].sort((a, b) => b[1].added - a[1].added)) {
      console.log(
        `${type.padEnd(28)} ${String(entry.n).padStart(13)}    ${round(entry.added).padStart(16)}`,
      );
    }
  }

  if (audit.rows.length) {
    console.log("\nworst 20 by plan area added");
    console.log("id           type                 shape     fill   rect   ours   drawn as        added");
    for (const row of audit.rows.slice(0, 20)) {
      console.log(
        `${String(row.elementId).padEnd(12)} ${row.ifcType.padEnd(20)} ${row.shape.padEnd(9)} ` +
          `${row.exportFill.toFixed(2)}   ${row.rectFill.toFixed(2)}   ${row.drawnFill.toFixed(2)}   ${row.drawnAs.padEnd(15)} ` +
          `${round(row.addedSqFeet).padStart(7)}`,
      );
    }
  }
}

/** True when this module was run directly rather than imported. */
function isEntryPoint(): boolean {
  const invoked = process.argv[1] ?? "";
  return invoked.endsWith("footprint-audit.ts") || invoked.endsWith("footprint-audit.js");
}

if (isEntryPoint()) {
  const [rvtPath, ifcPath] = process.argv.slice(2);
  const jsonIndex = process.argv.indexOf("--json");
  if (!rvtPath || !ifcPath) {
    console.error("usage: footprint-audit.ts <model.rvt> <model.ifc> [--json <path>]");
    process.exit(2);
  }
  // The export is read first: it is the cheaper of the two and a bad path
  // should not cost a conversion before saying so.
  const truth = await readTruthFootprints(ifcPath);
  const outcome = convertModel(rvtPath);
  const audit = auditFootprints(outcome.elementBounds, truth);
  console.log(`\n${rvtPath.split("/").pop()} against ${ifcPath.split("/").pop()}`);
  printFootprintAudit(audit);
  if (jsonIndex >= 0 && process.argv[jsonIndex + 1]) {
    writeFileSync(process.argv[jsonIndex + 1]!, `${JSON.stringify(audit, null, 2)}\n`);
  }
}
