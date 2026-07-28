#!/usr/bin/env node

/**
 * Compare the browser-safe Revit 2027 sampled-planar mesh audit with the
 * reference IFC by numeric Revit Tag.
 *
 * Usage:
 *   node scripts/audit-revit-2027-planar-ifc-parity.mjs \
 *     --ifc reference.ifc \
 *     --rvt-audit planar-topology.json \
 *     --json planar-ifc-parity.json
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { IfcAPI } from "web-ifc";

const argv = process.argv.slice(2);

function option(name) {
  const index = argv.indexOf(name);
  if (index >= 0 && argv[index + 1]) return resolve(argv[index + 1]);
  throw new Error(`Missing ${name}`);
}

const paths = {
  ifc: option("--ifc"),
  rvtAudit: option("--rvt-audit"),
  json: option("--json"),
};

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function scalar(value) {
  if (value == null) return null;
  return typeof value === "object" && "value" in value ? value.value : value;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

const ifcBytes = readFileSync(paths.ifc);
const rvtAuditBytes = readFileSync(paths.rvtAudit);
const rvtAudit = JSON.parse(rvtAuditBytes.toString("utf8"));
const rvtOwnerElements = new Map(
  (rvtAudit.sampledPlanarMesh?.elements ?? []).map((element) => [
    element.elementId,
    element,
  ]),
);
const rvtPlacedElements = new Map(
  (rvtAudit.sampledPlanarMesh?.instances ?? []).map((element) => [
    element.elementId,
    element,
  ]),
);
const rvtElements = new Map(rvtOwnerElements);
for (const [elementId, element] of rvtPlacedElements) {
  rvtElements.set(elementId, element);
}

const api = new IfcAPI();
await api.Init();
const model = api.OpenModel(ifcBytes, { COORDINATE_TO_ORIGIN: false });
if (model < 0) throw new Error("web-ifc could not open the reference IFC");

const elementByExpressId = new Map();
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
    elementByExpressId.set(expressId, { type, numericTag });
  }
}

const ifcGeometryByTag = new Map();
let ifcGeometryProducts = 0;
let ifcGeometryProductsWithNumericTag = 0;
let ifcTriangles = 0;
api.StreamAllMeshes(model, (mesh) => {
  ifcGeometryProducts += 1;
  const element = elementByExpressId.get(mesh.expressID);
  let triangleCount = 0;
  for (let index = 0; index < mesh.geometries.size(); index += 1) {
    const placed = mesh.geometries.get(index);
    const geometry = api.GetGeometry(model, placed.geometryExpressID);
    const indices = api.GetIndexArray(
      geometry.GetIndexData(),
      geometry.GetIndexDataSize(),
    );
    triangleCount += indices.length / 3;
    geometry.delete();
  }
  ifcTriangles += triangleCount;
  if (element?.numericTag == null) return;
  ifcGeometryProductsWithNumericTag += 1;
  const previous = ifcGeometryByTag.get(element.numericTag);
  ifcGeometryByTag.set(element.numericTag, {
    type: element.type,
    triangles: (previous?.triangles ?? 0) + triangleCount,
  });
});
api.CloseModel(model);

const matchedTags = [...rvtElements.keys()]
  .filter((tag) => ifcGeometryByTag.has(tag))
  .sort((left, right) => left - right);
const rvtOnlyTags = [...rvtElements.keys()]
  .filter((tag) => !ifcGeometryByTag.has(tag))
  .sort((left, right) => left - right);
const ifcOnlyTags = [...ifcGeometryByTag.keys()]
  .filter((tag) => !rvtElements.has(tag))
  .sort((left, right) => left - right);
const matchedRvtTriangles = sum(
  matchedTags.map((tag) => rvtElements.get(tag)?.triangles ?? 0),
);
const matchedIfcTriangles = sum(
  matchedTags.map((tag) => ifcGeometryByTag.get(tag)?.triangles ?? 0),
);
const exactTriangleCountTags = matchedTags.filter(
  (tag) =>
    rvtElements.get(tag)?.triangles === ifcGeometryByTag.get(tag)?.triangles,
);

const byIfcClass = new Map();
for (const tag of matchedTags) {
  const ifc = ifcGeometryByTag.get(tag);
  const rvt = rvtElements.get(tag);
  const row = byIfcClass.get(ifc.type) ?? {
    matchedTags: 0,
    rvtTriangles: 0,
    ifcTriangles: 0,
  };
  row.matchedTags += 1;
  row.rvtTriangles += rvt.triangles;
  row.ifcTriangles += ifc.triangles;
  byIfcClass.set(ifc.type, row);
}

const report = {
  inputs: {
    ifc: paths.ifc,
    ifcSha256: sha256(ifcBytes),
    rvtAudit: paths.rvtAudit,
    rvtAuditSha256: sha256(rvtAuditBytes),
  },
  scope: {
    comparisonKey: "numeric Revit Tag",
    rvtSampledPlanarOwnerTags: rvtOwnerElements.size,
    rvtPlacedInstanceTags: rvtPlacedElements.size,
    uniqueRvtProductCandidates: rvtElements.size,
    ifcGeometryProducts,
    ifcGeometryProductsWithNumericTag,
    uniqueIfcGeometryNumericTags: ifcGeometryByTag.size,
    matchedTags: matchedTags.length,
    rvtOnlyTags: rvtOnlyTags.length,
    ifcOnlyTags: ifcOnlyTags.length,
  },
  triangles: {
    rvtGeometryOwners: rvtAudit.sampledPlanarMesh?.triangles ?? 0,
    rvtPlacedInstances:
      rvtAudit.sampledPlanarMesh?.placedInstanceTriangles ?? 0,
    ifcAllGeometry: ifcTriangles,
    rvtOnMatchedTags: matchedRvtTriangles,
    ifcOnMatchedTags: matchedIfcTriangles,
    rvtToIfcRatioOnMatchedTags: ratio(
      matchedRvtTriangles,
      matchedIfcTriangles,
    ),
    exactTriangleCountTags: exactTriangleCountTags.length,
    exactTriangleCountRatio: ratio(
      exactTriangleCountTags.length,
      matchedTags.length,
    ),
  },
  coverage: {
    matchedRvtTagRatio: ratio(matchedTags.length, rvtElements.size),
    ifcGeometryTagCoverage: ratio(matchedTags.length, ifcGeometryByTag.size),
  },
  byIfcClass: Object.fromEntries(
    [...byIfcClass]
      .sort(
        (left, right) =>
          right[1].ifcTriangles - left[1].ifcTriangles ||
          left[0].localeCompare(right[0]),
      )
      .map(([name, value]) => [
        name,
        {
          ...value,
          rvtToIfcTriangleRatio: ratio(
            value.rvtTriangles,
            value.ifcTriangles,
          ),
        },
      ]),
  ),
  samples: {
    rvtOnlyTags: rvtOnlyTags.slice(0, 100),
    ifcOnlyTags: ifcOnlyTags.slice(0, 100),
    exactTriangleCountTags: exactTriangleCountTags.slice(0, 100),
  },
  interpretation: {
    geometry:
      "RVT candidates combine direct geometry owners with exact persisted instance-to-shared-owner placements; they still contain only certified single-loop planar sampled faces. IFC counts contain each matched product's complete exported geometry.",
    transforms:
      "Placed-instance bounds use the persisted instance basis and origin. Nested GArray/source-target transform chains remain outside this checkpoint, so world-bounds equality is not yet claimed.",
    triangles:
      "Equal triangle counts are diagnostic only because valid tessellation policies can produce different triangle counts.",
    materials:
      "The RVT sampled mesh deliberately carries null materials until an exact native face-material relation is bound.",
  },
};

mkdirSync(dirname(paths.json), { recursive: true });
writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
