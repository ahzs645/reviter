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
 */
import { readFileSync } from "node:fs";

import { IfcAPI } from "web-ifc";

import { convertRvtBytes } from "../lib/reviter/convert.ts";
import { framingBoundsOfRecords, solidBounds } from "../lib/reviter/bounds-records.ts";
import { selectDisplayBounds } from "../lib/reviter/scene.ts";

import type { Bounds3, ElementBoundsRecord } from "../lib/reviter/types.ts";

const FEET_PER_METRE = 3.280839895;

/** Agreement bands, in feet. */
const CLOSE = 0.5;

const [rvtPath, ifcPath] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
if (!rvtPath || !ifcPath) {
  console.error("usage: overlay-diff.ts <model.rvt> <model.ifc>");
  process.exit(2);
}

type Box = [number, number, number, number, number, number];

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

const products = readProducts(readFileSync(ifcPath, "latin1"));

const api = new IfcAPI();
await api.Init();
const modelID = api.OpenModel(new Uint8Array(readFileSync(ifcPath)));

/** World AABB per IFC product, already mapped into the recovered model's frame. */
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
  // One Revit element can leave the exporter as several products that all
  // carry its id — a floor sketched in three regions becomes three `IfcSlab`s
  // tagged the same. Keeping only the last made the recovery look oversized by
  // the distance between the regions, and produced a "floors are drawn too
  // big" result that was entirely an artefact of this line: 20% of slabs
  // measured over a foot out, against 3% once the boxes are unioned. Stair
  // flights moved further still, from a 3.79 ft median overhang to 0.16.
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
console.log(`export products with geometry: ${truth.size}`);

const rvt = readFileSync(rvtPath);
const outcome = convertRvtBytes(
  new Uint8Array(rvt.buffer, rvt.byteOffset, rvt.byteLength),
  rvtPath.split("/").pop() ?? "model.rvt",
  { revitVersion: 2027 },
);
if (!outcome.ok) {
  console.error(`conversion failed: ${outcome.error}`);
  process.exit(1);
}
const drawn = selectDisplayBounds(
  outcome.elementBounds.filter((record) => solidBounds(record) || (record.loops?.length ?? 0) > 0),
).records;
const byId = new Map(drawn.map((record) => [record.elementId, record]));

// --- does the recovered model sit where the export says the building is? -----
const buildingBox: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
for (const { box } of truth.values()) {
  for (let axis = 0; axis < 3; axis += 1) {
    buildingBox[axis] = Math.min(buildingBox[axis]!, box[axis]!);
    buildingBox[axis + 3] = Math.max(buildingBox[axis + 3]!, box[axis + 3]!);
  }
}
const round = (values: number[]) => values.map((value) => Math.round(value * 10) / 10);
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
  const axes = ["x", "y", "z"] as const;
  for (const axis of axes) {
    absolute.min[axis] = Math.min(absolute.min[axis], record.boundsFeet.min[axis]);
    absolute.max[axis] = Math.max(absolute.max[axis], record.boundsFeet.max[axis]);
  }
}
const framing = framingBoundsOfRecords(drawn);
const wanted = [
  (buildingBox[0]! + buildingBox[3]!) / 2,
  (buildingBox[1]! + buildingBox[4]!) / 2,
  (buildingBox[2]! + buildingBox[5]!) / 2,
];
console.log(`\nbuilding centre, export      ${round(wanted).join(", ")}`);
console.log(`  from the outermost record  ${round(centre(absolute)).join(", ")}`);
console.log(`  as the scene is framed     ${round(centre(framing)).join(", ")}`);
console.log(`  framing error              ${round(centre(framing).map((v, i) => v - wanted[i]!)).join(", ")} ft`);

const pad = 50;
const strays = drawn.filter((record) => {
  const { min, max } = record.boundsFeet;
  return (
    max.x < buildingBox[0]! - pad || min.x > buildingBox[3]! + pad ||
    max.y < buildingBox[1]! - pad || min.y > buildingBox[4]! + pad ||
    max.z < buildingBox[2]! - pad || min.z > buildingBox[5]! + pad
  );
});
console.log(`\nrecords drawn wholly outside the export's building volume: ${strays.length}`);
for (const record of strays.slice(0, 10)) {
  console.log(`   ${record.elementId} code ${record.recordCode}/${record.recordCount}` +
    ` ${record.categoryName ?? "(uncategorised)"}`);
}

// --- envelope agreement, per product type ------------------------------------
const pairs = new Map<string, { centre: number[]; size: number[] }>();
const push = (type: string, dCentre: number, dSize: number) => {
  const entry = pairs.get(type) ?? { centre: [], size: [] };
  entry.centre.push(dCentre);
  entry.size.push(dSize);
  pairs.set(type, entry);
};
/**
 * The extent of what the viewer actually draws for a record, following the same
 * precedence `buildBoundsMeshes` uses. Comparing the record's envelope instead
 * would measure something the user never sees — for a placed family the drawn
 * shape is its oriented box, not its axis-aligned bounds.
 */
function drawnBounds(record: ElementBoundsRecord): Box {
  const box: Box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number, z: number) => {
    box[0] = Math.min(box[0]!, x); box[3] = Math.max(box[3]!, x);
    box[1] = Math.min(box[1]!, y); box[4] = Math.max(box[4]!, y);
    box[2] = Math.min(box[2]!, z); box[5] = Math.max(box[5]!, z);
  };
  if (record.loops?.length) {
    for (const ring of record.loops) for (const [x, y] of ring) add(x, y, record.boundsFeet.min.z);
    add(record.boundsFeet.min.x, record.boundsFeet.min.y, record.boundsFeet.max.z);
    return box;
  }
  if (record.orientedBox) {
    for (const [x, y, z] of record.orientedBox) add(x, y, z);
    return box;
  }
  if (record.quads?.length) {
    for (const quad of record.quads) for (const [x, y, z] of quad.corners) add(x, y, z);
    return box;
  }
  const solids = record.solids?.length ? record.solids : record.solid ? [record.solid] : [];
  if (solids.length) {
    for (const solid of solids) {
      const half = solid.thickness / 2;
      for (const end of [solid.start, solid.end]) {
        add(end.x - half, end.y - half, solid.baseElevation);
        add(end.x + half, end.y + half, solid.topElevation);
      }
    }
    return box;
  }
  return [
    record.boundsFeet.min.x, record.boundsFeet.min.y, record.boundsFeet.min.z,
    record.boundsFeet.max.x, record.boundsFeet.max.y, record.boundsFeet.max.z,
  ];
}

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
  push(type, dCentre, dSize);
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
console.log(`\n${"IFC product type".padEnd(22)}${"drawn".padStart(8)}` +
  `${"centre ok".padStart(11)}${"size ok".padStart(9)}${"median dc".padStart(11)}${"median ds".padStart(11)}`);
console.log("-".repeat(72));
for (const [type, entry] of [...pairs].sort((a, b) => b[1].centre.length - a[1].centre.length)) {
  if (entry.centre.length < 10) continue;
  const okCentre = (entry.centre.filter((value) => value < CLOSE).length / entry.centre.length) * 100;
  const okSize = (entry.size.filter((value) => value < CLOSE).length / entry.size.length) * 100;
  console.log(
    type.padEnd(22) + String(entry.centre.length).padStart(8) +
    `${okCentre.toFixed(1)}%`.padStart(11) + `${okSize.toFixed(1)}%`.padStart(9) +
    median(entry.centre).toFixed(3).padStart(11) + median(entry.size).toFixed(3).padStart(11),
  );
}
console.log(`\n"ok" means within ${CLOSE} ft on every axis; dc is centre error, ds size error.`);
