#!/usr/bin/env node

/**
 * Post-decode comparison of exact RVT cone-apex-sector triangles with complete
 * IFC product meshes sharing the same numeric Revit Tag.
 *
 * Usage:
 *   node scripts/audit-revit-2027-cone-apex-ifc-parity.mjs \
 *     --ifc reference.ifc --cone-audit cone-apex-sector.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { IfcAPI } from "web-ifc";

const argv = process.argv.slice(2);

function option(name) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]);
  throw new Error(`missing ${name}`);
}

function scalar(value) {
  if (value == null) return null;
  return typeof value === "object" && "value" in value ? value.value : value;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

const paths = {
  ifc: option("--ifc"),
  coneAudit: option("--cone-audit"),
};
const audit = JSON.parse(readFileSync(paths.coneAudit, "utf8"));
const accepted = audit.rows.filter(
  (row) => row.classification === "exact-apex-sector-tessellated",
);
const rvtByTag = new Map();
for (const face of accepted) {
  const existing = rvtByTag.get(face.elementId) ?? {
    faces: 0,
    triangles: 0,
  };
  existing.faces += 1;
  existing.triangles += face.triangleCount;
  rvtByTag.set(face.elementId, existing);
}

const bytes = readFileSync(paths.ifc);
const api = new IfcAPI();
await api.Init();
const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
if (model < 0) throw new Error("web-ifc could not open the reference IFC");

const products = new Map();
for (const typeCode of api.GetIfcEntityList(model)) {
  if (!api.IsIfcElement(typeCode)) continue;
  const type = api.GetNameFromTypeCode(typeCode);
  const ids = api.GetLineIDsWithType(model, typeCode, false);
  for (let index = 0; index < ids.size(); index += 1) {
    const expressId = ids.get(index);
    const line = api.GetLine(model, expressId, false);
    const tag = scalar(line.Tag);
    const numericTag =
      typeof tag === "string" && /^\d+$/u.test(tag) ? Number(tag) : null;
    products.set(expressId, { type, numericTag });
  }
}

const ifcByTag = new Map();
api.StreamAllMeshes(model, (mesh) => {
  const product = products.get(mesh.expressID);
  if (product?.numericTag == null) return;
  let triangles = 0;
  for (let index = 0; index < mesh.geometries.size(); index += 1) {
    const placed = mesh.geometries.get(index);
    const geometry = api.GetGeometry(model, placed.geometryExpressID);
    triangles += geometry.GetIndexDataSize() / 3;
    geometry.delete();
  }
  const existing = ifcByTag.get(product.numericTag);
  ifcByTag.set(product.numericTag, {
    type: product.type,
    triangles: triangles + (existing?.triangles ?? 0),
  });
});
api.CloseModel(model);

const rows = [...rvtByTag]
  .map(([tag, rvt]) => {
    const ifc = ifcByTag.get(tag);
    return {
      tag,
      ifcType: ifc?.type ?? null,
      coneApexSectorFaces: rvt.faces,
      rvtConeApexSectorTriangles: rvt.triangles,
      ifcCompleteProductTriangles: ifc?.triangles ?? null,
      rvtConeSubsetToIfcCompleteRatio:
        ifc == null ? null : ratio(rvt.triangles, ifc.triangles),
    };
  })
  .sort((left, right) => left.tag - right.tag);
const matched = rows.filter((row) => row.ifcType != null);
const rvtTriangles = matched.reduce(
  (total, row) => total + row.rvtConeApexSectorTriangles,
  0,
);
const ifcTriangles = matched.reduce(
  (total, row) => total + row.ifcCompleteProductTriangles,
  0,
);

console.log(JSON.stringify({
  inputs: paths,
  scope: {
    comparisonKey: "numeric Revit Tag",
    certifiedRvtConeApexSectorFaces: accepted.length,
    certifiedRvtConeApexSectorOwners: rvtByTag.size,
    matchedIfcProducts: matched.length,
    unmatchedRvtOwnerTags: rows.length - matched.length,
  },
  triangles: {
    rvtCertifiedConeApexSectorTrianglesOnMatchedTags: rvtTriangles,
    ifcCompleteProductTrianglesOnMatchedTags: ifcTriangles,
    coneSubsetToCompleteIfcRatio: ratio(rvtTriangles, ifcTriangles),
    interpretation:
      "RVT counts only exact apex-sector cone faces; IFC counts each " +
      "matched product's complete exported mesh, so equality is not expected.",
  },
  rows,
}, null, 2));
