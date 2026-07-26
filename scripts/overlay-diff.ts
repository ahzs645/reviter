/**
 * Geometric overlay: put the recovered model and the paired export in the same
 * frame and measure where they disagree.
 *
 * `audit-coverage.ts` answers "is this element present". This answers "is it in
 * the right place and the right size", which is the other half of the question
 * and the one a count cannot reach — an element can be drawn, and drawn wrong.
 *
 *   node --experimental-strip-types scripts/overlay-diff.ts model.rvt model.ifc
 *
 * Frames. `web-ifc` returns metres in a Y-up frame; the recovered model is in
 * feet, Z-up. The mapping is the same one `ifc-reference.ts` applies when it
 * draws the reference geometry — `(x, y, z) -> (x, -z, y)` — with a metre to
 * foot scale. The script reports how well matched elements line up, so a wrong
 * frame shows up as a total mismatch rather than a silent offset.
 *
 * The measurement is also exported — `readTruthBoxes`, `computeOverlay`,
 * `printOverlay` — so `verify-pair.ts` can run it beside the coverage audit
 * against one conversion rather than decoding the model twice.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { IfcAPI } from "web-ifc";

import { convertModel } from "./audit-coverage.ts";
import { framingBoundsOfRecords, solidBounds } from "../lib/reviter/bounds-records.ts";
import { selectDisplayBounds } from "../lib/reviter/scene.ts";

import type { Bounds3, ConvertResult, ElementBoundsRecord } from "../lib/reviter/types.ts";

const FEET_PER_METRE = 3.280839895;

/** Agreement bands, in feet. */
const CLOSE = 0.5;

/**
 * How far past the export's own hull a drawn record may reach before it counts
 * as escaping the building. A foot is under a wall thickness, so anything over
 * it is a record placed rather than merely rounded.
 */
const HULL_SLACK_FEET = 1;

export type Box = [number, number, number, number, number, number];

/** `#id=IFCTYPE(...)` products and their Revit element id, by express id. */
function readProducts(text: string): Map<number, { type: string; tag: number }> {
  const products = new Map<number, { type: string; tag: number }>();
  const entity = /^#(\d+) *= *(IFC[A-Z0-9]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    let tag = 0;
    for (const quoted of match[3]!.matchAll(/'([^']*)'/g)) {
      if (/^\d+$/.test(quoted[1]!)) tag = Number(quoted[1]!);
    }
    if (tag) products.set(Number(match[1]!), { type: match[2]!, tag });
  }
  return products;
}

/**
 * World AABB per Revit element id, read out of the export and mapped into the
 * recovered model's frame.
 *
 * **One Revit element can leave the exporter as several products that all carry
 * its id** — a floor sketched in three regions becomes three `IfcSlab`s tagged
 * the same. Keeping only the last made the recovery look oversized by the
 * distance between the regions, and produced a "floors are drawn too big"
 * result that was entirely an artefact of one line: 20% of slabs measured over
 * a foot out, against 3% once the boxes are unioned. Railings went from 6% to
 * 0%. The union is therefore load-bearing, not an optimisation.
 */
export async function readTruthBoxes(
  ifcPath: string,
): Promise<Map<number, { type: string; box: Box }>> {
  const products = readProducts(readFileSync(ifcPath, "latin1"));
  const api = new IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new Uint8Array(readFileSync(ifcPath)));

  const truth = new Map<number, { type: string; box: Box }>();
  api.StreamAllMeshes(modelID, (mesh) => {
    const product = products.get(mesh.expressID);
    if (!product) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    const parts = mesh.geometries;
    for (let part = 0; part < parts.size(); part += 1) {
      const item = parts.get(part);
      const geometry = api.GetGeometry(modelID, item.geometryExpressID);
      const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const m = item.flatTransformation;
      for (let v = 0; v + 2 < vertices.length; v += 6) {
        const x = vertices[v]!, y = vertices[v + 1]!, z = vertices[v + 2]!;
        // Y-up metres -> Z-up feet.
        const wx = (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) * FEET_PER_METRE;
        const wy = -(m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) * FEET_PER_METRE;
        const wz = (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) * FEET_PER_METRE;
        if (wx < minX) minX = wx;
        if (wy < minY) minY = wy;
        if (wz < minZ) minZ = wz;
        if (wx > maxX) maxX = wx;
        if (wy > maxY) maxY = wy;
        if (wz > maxZ) maxZ = wz;
      }
      geometry.delete();
    }
    if (!Number.isFinite(minX)) return;
    const existing = truth.get(product.tag);
    if (!existing) {
      truth.set(product.tag, { type: product.type, box: [minX, minY, minZ, maxX, maxY, maxZ] });
      return;
    }
    const box = existing.box;
    box[0] = Math.min(box[0]!, minX);
    box[1] = Math.min(box[1]!, minY);
    box[2] = Math.min(box[2]!, minZ);
    box[3] = Math.max(box[3]!, maxX);
    box[4] = Math.max(box[4]!, maxY);
    box[5] = Math.max(box[5]!, maxZ);
  });
  return truth;
}

/**
 * The extent of what the viewer actually draws for a record, following the same
 * precedence `buildBoundsMeshes` uses. Comparing the record's envelope instead
 * would measure something the user never sees — for a placed family the drawn
 * shape is its oriented box, not its axis-aligned bounds.
 */
export function drawnBounds(record: ElementBoundsRecord): Box {
  const box: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, z: number) => {
    box[0] = Math.min(box[0]!, x); box[3] = Math.max(box[3]!, x);
    box[1] = Math.min(box[1]!, y); box[4] = Math.max(box[4]!, y);
    box[2] = Math.min(box[2]!, z); box[5] = Math.max(box[5]!, z);
  };
  if (record.loops?.length) {
    // The ring gives the plan and the record gives the thickness; adding the
    // record's own corner to carry the top also widened the plan to the
    // record's, which is the thing the ring is there to replace.
    for (const ring of record.loops) {
      for (const [x, y] of ring) {
        add(x, y, record.boundsFeet.min.z);
        add(x, y, record.boundsFeet.max.z);
      }
    }
    return box;
  }
  if (record.orientedBox) {
    for (const [x, y, z] of record.orientedBox) add(x, y, z);
    return box;
  }
  // Native faces are no longer drawn: measured across every class that owns
  // them the element's own envelope is closer for 168 of the 225 concerned.
  const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
  if (solids.length) {
    // A solid is drawn as an *oriented* box — `solidGeometry` offsets the
    // centreline by half a thickness along its own normal. Adding half a
    // thickness to both x and y instead, as this did, measures a box a full
    // thickness longer than the one on screen: for a 25.242 ft wall 1.148 ft
    // thick it reported 26.390. Correcting the measurement alone, with no
    // change to what is drawn, took `IfcWallStandardCase` size agreement from
    // 55.3% to 83.4% and `IfcWall` from 40.2% to 59.1% — more than half of the
    // "wall size" gap this file used to explain away was the metric.
    for (const solid of solids) {
      const dx = solid.end.x - solid.start.x;
      const dy = solid.end.y - solid.start.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = (-dy / length) * solid.thickness * 0.5;
      const ny = (dx / length) * solid.thickness * 0.5;
      for (const end of [solid.start, solid.end]) {
        for (const sign of [1, -1]) {
          add(end.x + nx * sign, end.y + ny * sign, solid.baseElevation);
          add(end.x + nx * sign, end.y + ny * sign, solid.topElevation);
        }
      }
    }
    return box;
  }
  // A curved wall is drawn as the annulus sector its cylinder triple describes,
  // so measuring its envelope would measure the rectangle the arc replaced.
  if (record.arcs?.length) {
    for (const arc of record.arcs) {
      const sweep = arc.endAngle - arc.startAngle;
      const segments = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 32)));
      for (let step = 0; step <= segments; step += 1) {
        const angle = arc.startAngle + (sweep * step) / segments;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const ux = cos * arc.xDir.x + sin * arc.yDir.x;
        const uy = cos * arc.xDir.y + sin * arc.yDir.y;
        for (const radius of [arc.radius - arc.thickness / 2, arc.radius + arc.thickness / 2]) {
          for (const z of [arc.baseElevation, arc.topElevation]) {
            add(arc.centre.x + radius * ux, arc.centre.y + radius * uy, z);
          }
        }
      }
    }
    return box;
  }
  return [
    record.boundsFeet.min.x, record.boundsFeet.min.y, record.boundsFeet.min.z,
    record.boundsFeet.max.x, record.boundsFeet.max.y, record.boundsFeet.max.z,
  ];
}

export type ClassAgreement = {
  type: string;
  matched: number;
  centreOkPercent: number;
  sizeOkPercent: number;
  medianCentreError: number;
  medianSizeError: number;
};

export type EscapedRecord = {
  elementId: number;
  overhangFeet: number;
  categoryName?: string;
  recordCode?: number;
};

export type OverlayResult = {
  /** Export products that carry a Revit id and produced geometry. */
  truthCount: number;
  /** The export's own hull, in the recovered model's frame. */
  buildingBox: Box;
  exportCentre: number[];
  outermostRecordCentre: number[];
  framingCentre: number[];
  framingErrorFeet: number[];
  /**
   * Records drawn reaching past the export's hull by more than
   * `HULL_SLACK_FEET`, worst first. This is the measurement that catches a
   * bounds rule that has stopped generalising: a misread envelope lands
   * somewhere the building is not.
   */
  escaped: EscapedRecord[];
  worstOverhangFeet: number;
  drawnCount: number;
  byClass: ClassAgreement[];
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Put the recovered model and the export in one frame and measure the gap. */
export function computeOverlay(
  outcome: ConvertResult,
  truth: Map<number, { type: string; box: Box }>,
): OverlayResult {
  const drawn = selectDisplayBounds(
    outcome.elementBounds.filter((record) => solidBounds(record) || (record.loops?.length ?? 0) > 0),
  ).records;
  const byId = new Map(drawn.map((record) => [record.elementId, record]));

  const buildingBox: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const { box } of truth.values()) {
    for (let axis = 0; axis < 3; axis += 1) {
      buildingBox[axis] = Math.min(buildingBox[axis]!, box[axis]!);
      buildingBox[axis + 3] = Math.max(buildingBox[axis + 3]!, box[axis + 3]!);
    }
  }
  const centre = (bounds: Bounds3) => [
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    (bounds.min.z + bounds.max.z) / 2,
  ];
  const absolute: Bounds3 = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (const record of drawn) {
    for (const axis of ["x", "y", "z"] as const) {
      absolute.min[axis] = Math.min(absolute.min[axis], record.boundsFeet.min[axis]);
      absolute.max[axis] = Math.max(absolute.max[axis], record.boundsFeet.max[axis]);
    }
  }
  const framingCentre = centre(framingBoundsOfRecords(drawn));
  const exportCentre = [
    (buildingBox[0]! + buildingBox[3]!) / 2,
    (buildingBox[1]! + buildingBox[4]!) / 2,
    (buildingBox[2]! + buildingBox[5]!) / 2,
  ];

  // How far each drawn record reaches past the hull, measured on the geometry
  // the viewer draws rather than on the record's envelope: a sketch-bounded
  // element is drawn from its ring, which is a different and usually smaller
  // thing, and reading the envelope instead put two floors on this list that
  // are in fact inside the building.
  const escaped: EscapedRecord[] = [];
  let worstOverhangFeet = 0;
  for (const record of drawn) {
    const box = drawnBounds(record);
    let overhang = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      overhang = Math.max(
        overhang,
        buildingBox[axis]! - box[axis]!,
        box[axis + 3]! - buildingBox[axis + 3]!,
      );
    }
    worstOverhangFeet = Math.max(worstOverhangFeet, overhang);
    if (overhang > HULL_SLACK_FEET) {
      escaped.push({
        elementId: record.elementId,
        overhangFeet: overhang,
        categoryName: record.categoryName,
        recordCode: record.recordCode,
      });
    }
  }
  escaped.sort((a, b) => b.overhangFeet - a.overhangFeet);

  const pairs = new Map<string, { centre: number[]; size: number[] }>();
  for (const [tag, { type, box }] of truth) {
    const record = byId.get(tag);
    if (!record) continue;
    const got = drawnBounds(record);
    let dCentre = 0;
    let dSize = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      dCentre = Math.max(dCentre, Math.abs(
        (got[axis]! + got[axis + 3]!) / 2 - (box[axis]! + box[axis + 3]!) / 2,
      ));
      dSize = Math.max(dSize, Math.abs(
        (got[axis + 3]! - got[axis]!) - (box[axis + 3]! - box[axis]!),
      ));
    }
    const entry = pairs.get(type) ?? { centre: [], size: [] };
    entry.centre.push(dCentre);
    entry.size.push(dSize);
    pairs.set(type, entry);
  }

  const byClass: ClassAgreement[] = [...pairs]
    .filter(([, entry]) => entry.centre.length >= 10)
    .sort((a, b) => b[1].centre.length - a[1].centre.length)
    .map(([type, entry]) => ({
      type,
      matched: entry.centre.length,
      centreOkPercent: (entry.centre.filter((value) => value < CLOSE).length / entry.centre.length) * 100,
      sizeOkPercent: (entry.size.filter((value) => value < CLOSE).length / entry.size.length) * 100,
      medianCentreError: median(entry.centre),
      medianSizeError: median(entry.size),
    }));

  return {
    truthCount: truth.size,
    buildingBox,
    exportCentre,
    outermostRecordCentre: centre(absolute),
    framingCentre,
    framingErrorFeet: framingCentre.map((value, axis) => value - exportCentre[axis]!),
    escaped,
    worstOverhangFeet,
    drawnCount: drawn.length,
    byClass,
  };
}

export function printOverlay(result: OverlayResult): void {
  const round = (values: number[]) => values.map((value) => Math.round(value * 10) / 10);
  console.log(`export products with geometry: ${result.truthCount}`);
  console.log(`\nbuilding centre, export      ${round(result.exportCentre).join(", ")}`);
  console.log(`  from the outermost record  ${round(result.outermostRecordCentre).join(", ")}`);
  console.log(`  as the scene is framed     ${round(result.framingCentre).join(", ")}`);
  console.log(`  framing error              ${round(result.framingErrorFeet).join(", ")} ft`);

  console.log(`\nrecords drawn past the export's hull by over ${HULL_SLACK_FEET} ft: ${result.escaped.length}`);
  for (const record of result.escaped.slice(0, 10)) {
    console.log(`   ${record.elementId} by ${record.overhangFeet.toFixed(1)} ft` +
      `  ${record.categoryName ?? "(uncategorised)"}`);
  }

  console.log(`\n${"IFC product type".padEnd(22)}${"drawn".padStart(8)}` +
    `${"centre ok".padStart(11)}${"size ok".padStart(9)}${"median dc".padStart(11)}${"median ds".padStart(11)}`);
  console.log("-".repeat(72));
  for (const row of result.byClass) {
    console.log(
      row.type.padEnd(22) + String(row.matched).padStart(8) +
      `${row.centreOkPercent.toFixed(1)}%`.padStart(11) + `${row.sizeOkPercent.toFixed(1)}%`.padStart(9) +
      row.medianCentreError.toFixed(3).padStart(11) + row.medianSizeError.toFixed(3).padStart(11),
    );
  }
  console.log(`\n"ok" means within ${CLOSE} ft on every axis; dc is centre error, ds size error.`);
}

/** True when this module is the process entry point rather than an import. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fileURLToPath(import.meta.url) === resolve(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const [rvtPath, ifcPath] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  if (!rvtPath || !ifcPath) {
    console.error("usage: overlay-diff.ts <model.rvt> <model.ifc>");
    process.exit(2);
  }
  const truth = await readTruthBoxes(ifcPath);
  printOverlay(computeOverlay(convertModel(rvtPath), truth));
}
