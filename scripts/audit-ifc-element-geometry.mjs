#!/usr/bin/env node

/**
 * Post-decode IFC geometry oracle for one numeric Revit Tag.
 *
 * This script intentionally does not participate in RVT decoding or choose
 * surface parameterization. It reports only the exported IFC mesh after an
 * RVT-side geometry path has already been proven.
 *
 * Usage:
 *   node scripts/audit-ifc-element-geometry.mjs reference.ifc 245109
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { IfcAPI } from "web-ifc";

const ifcPath = process.argv[2] ? resolve(process.argv[2]) : null;
const targetTag = Number(process.argv[3]);
const expectedDimensions =
  process.argv.length >= 7
    ? process.argv.slice(4, 7).map(Number)
    : null;
const dimensionTolerance = Number(process.argv[7] ?? 1e-6);
if (!ifcPath || !Number.isSafeInteger(targetTag)) {
  throw new Error(
    "usage: node scripts/audit-ifc-element-geometry.mjs " +
      "reference.ifc tag [sizeXFeet sizeYFeet sizeZFeet toleranceFeet]",
  );
}
if (
  expectedDimensions &&
  (
    !expectedDimensions.every(
      (value) => Number.isFinite(value) && value >= 0,
    ) ||
    !Number.isFinite(dimensionTolerance) ||
    dimensionTolerance < 0
  )
) {
  throw new Error("shape dimensions or tolerance are invalid");
}

const FEET_PER_METRE = 3.280839895;

function scalar(value) {
  if (value == null) return null;
  return typeof value === "object" && "value" in value ? value.value : value;
}

function emptyBounds() {
  return {
    minimum: [Infinity, Infinity, Infinity],
    maximum: [-Infinity, -Infinity, -Infinity],
  };
}

function includePoint(bounds, x, y, z) {
  bounds.minimum[0] = Math.min(bounds.minimum[0], x);
  bounds.minimum[1] = Math.min(bounds.minimum[1], y);
  bounds.minimum[2] = Math.min(bounds.minimum[2], z);
  bounds.maximum[0] = Math.max(bounds.maximum[0], x);
  bounds.maximum[1] = Math.max(bounds.maximum[1], y);
  bounds.maximum[2] = Math.max(bounds.maximum[2], z);
}

const bytes = readFileSync(ifcPath);
const api = new IfcAPI();
await api.Init();
const model = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
if (model < 0) throw new Error("web-ifc could not open the reference IFC");

const elements = new Map();
for (const typeCode of api.GetIfcEntityList(model)) {
  if (!api.IsIfcElement(typeCode)) continue;
  const type = api.GetNameFromTypeCode(typeCode);
  const ids = api.GetLineIDsWithType(model, typeCode, false);
  for (let index = 0; index < ids.size(); index += 1) {
    const expressId = ids.get(index);
    const line = api.GetLine(model, expressId, false);
    const tag = scalar(line.Tag);
    elements.set(expressId, { type, tag });
  }
}

const products = [];
const shapeCandidates = [];
api.StreamAllMeshes(model, (mesh) => {
  const element = elements.get(mesh.expressID);
  if (!element) return;
  const productBounds = emptyBounds();
  let productTriangles = 0;
  let productPositions = 0;
  const geometries = [];
  for (let index = 0; index < mesh.geometries.size(); index += 1) {
    const placed = mesh.geometries.get(index);
    const geometry = api.GetGeometry(model, placed.geometryExpressID);
    const indices = api.GetIndexArray(
      geometry.GetIndexData(),
      geometry.GetIndexDataSize(),
    );
    const vertices = api.GetVertexArray(
      geometry.GetVertexData(),
      geometry.GetVertexDataSize(),
    );
    const geometryBounds = emptyBounds();
    const matrix = placed.flatTransformation;
    for (let vertex = 0; vertex + 2 < vertices.length; vertex += 6) {
      const x = vertices[vertex];
      const y = vertices[vertex + 1];
      const z = vertices[vertex + 2];
      // web-ifc is Y-up metres; the browser RVT path is Z-up feet.
      const rvtX =
        (matrix[0] * x +
          matrix[4] * y +
          matrix[8] * z +
          matrix[12]) *
        FEET_PER_METRE;
      const rvtY =
        -(matrix[2] * x +
          matrix[6] * y +
          matrix[10] * z +
          matrix[14]) *
        FEET_PER_METRE;
      const rvtZ =
        (matrix[1] * x +
          matrix[5] * y +
          matrix[9] * z +
          matrix[13]) *
        FEET_PER_METRE;
      includePoint(geometryBounds, rvtX, rvtY, rvtZ);
      includePoint(productBounds, rvtX, rvtY, rvtZ);
    }
    const triangleCount = indices.length / 3;
    const positionCount = vertices.length / 6;
    productTriangles += triangleCount;
    productPositions += positionCount;
    geometries.push({
      geometryExpressId: placed.geometryExpressID,
      positions: positionCount,
      triangles: triangleCount,
      boundsFeetRvtAxes: geometryBounds,
    });
    geometry.delete();
  }
  const product = {
    expressId: mesh.expressID,
    ifcType: element.type,
    tag: element.tag,
    positions: productPositions,
    triangles: productTriangles,
    boundsFeetRvtAxes: productBounds,
    geometries,
  };
  if (element.tag === String(targetTag)) products.push(product);
  if (expectedDimensions) {
    const actual = productBounds.minimum.map(
      (minimum, axis) => productBounds.maximum[axis] - minimum,
    );
    const sortedActual = [...actual].sort((left, right) => left - right);
    const sortedExpected = [...expectedDimensions].sort(
      (left, right) => left - right,
    );
    const maximumDimensionErrorFeet = Math.max(
      ...sortedActual.map((value, axis) =>
        Math.abs(value - sortedExpected[axis])
      ),
    );
    if (maximumDimensionErrorFeet <= dimensionTolerance) {
      shapeCandidates.push({
        ...product,
        dimensionsFeetRvtAxes: actual,
        maximumSortedDimensionErrorFeet: maximumDimensionErrorFeet,
      });
    }
  }
});
api.CloseModel(model);

console.log(JSON.stringify({
  ifcPath,
  targetTag,
  coordinateMapping:
    "IFC Y-up metres -> RVT Z-up feet: (x, y, z) -> (x, -z, y)",
  products,
  shapeSearch:
    expectedDimensions == null
      ? null
      : {
          expectedDimensionsFeet: expectedDimensions,
          comparison:
            "axis-order-independent world AABB dimensions; diagnostic only",
          toleranceFeet: dimensionTolerance,
          candidates: shapeCandidates,
        },
}, null, 2));
