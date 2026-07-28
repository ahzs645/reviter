#!/usr/bin/env node

/**
 * Compare a browser-safe Revit 2027 owner-mesh audit with the reference IFC
 * by numeric Revit Tag. A certified-browser payload is preferred; the legacy
 * sampled-planar payload remains accepted for baseline comparisons.
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
const FEET_PER_METRE = 3.280839895;
const BOUNDS_TOLERANCES_FEET = [1e-6, 1 / 64, 1 / 12, 0.5];

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

function quantile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
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

function includeBounds(target, source) {
  for (let axis = 0; axis < 3; axis += 1) {
    target.minimum[axis] = Math.min(
      target.minimum[axis],
      source.minimum[axis],
    );
    target.maximum[axis] = Math.max(
      target.maximum[axis],
      source.maximum[axis],
    );
  }
}

function boundsError(rvt, ifc) {
  const centre = [];
  const size = [];
  const corners = [];
  for (let axis = 0; axis < 3; axis += 1) {
    centre.push(
      Math.abs(
        (rvt.minimum[axis] + rvt.maximum[axis]) / 2 -
          (ifc.minimum[axis] + ifc.maximum[axis]) / 2,
      ),
    );
    size.push(
      Math.abs(
        (rvt.maximum[axis] - rvt.minimum[axis]) -
          (ifc.maximum[axis] - ifc.minimum[axis]),
      ),
    );
    corners.push(
      Math.abs(rvt.minimum[axis] - ifc.minimum[axis]),
      Math.abs(rvt.maximum[axis] - ifc.maximum[axis]),
    );
  }
  return {
    maximumCentreErrorFeet: Math.max(...centre),
    maximumSizeErrorFeet: Math.max(...size),
    maximumCornerErrorFeet: Math.max(...corners),
  };
}

function errorDistribution(rows, field) {
  const values = rows.map((row) => row[field]);
  return {
    medianFeet: quantile(values, 0.5),
    p95Feet: quantile(values, 0.95),
    maximumFeet: values.length === 0 ? null : Math.max(...values),
  };
}

function toleranceCounts(rows) {
  return Object.fromEntries(
    BOUNDS_TOLERANCES_FEET.map((tolerance) => {
      const count = rows.filter(
        (row) => row.maximumCornerErrorFeet <= tolerance,
      ).length;
      return [
        `${tolerance}ft`,
        {
          count,
          ratio: ratio(count, rows.length),
        },
      ];
    }),
  );
}

const ifcBytes = readFileSync(paths.ifc);
const rvtAuditBytes = readFileSync(paths.rvtAudit);
const rvtAudit = JSON.parse(rvtAuditBytes.toString("utf8"));
const rvtMesh =
  Array.isArray(rvtAudit.certifiedBrowserMesh?.elements) &&
    Array.isArray(rvtAudit.certifiedBrowserMesh?.instances)
    ? rvtAudit.certifiedBrowserMesh
    : rvtAudit.sampledPlanarMesh;
const rvtMeshScope =
  rvtMesh === rvtAudit.certifiedBrowserMesh
    ? "certified-browser"
    : "sampled-planar";
const allNestedOwnerElements =
  rvtMeshScope === "certified-browser" &&
  Array.isArray(rvtAudit.certifiedBrowserMesh?.nestedInstances?.elements)
    ? rvtAudit.certifiedBrowserMesh.nestedInstances.elements
    : [];
const completeNestedOwnerElements = allNestedOwnerElements.filter(
  (element) => element.complete === true,
);
const partialNestedOwnerElements = allNestedOwnerElements.filter(
  (element) => element.complete !== true,
);
const nestedOwnerIds = new Set(
  allNestedOwnerElements.map((element) => element.elementId),
);
const rawRvtOwnerElements = new Map(
  (rvtMesh?.elements ?? []).map((element) => [
    element.elementId,
    element,
  ]),
);
// A nested owner is atomic: its direct fragment is not a valid product
// candidate by itself. Remove every nested root from the direct map, then add
// back only compositions whose complete flag certifies every source mesh.
const rvtOwnerElements = new Map(
  [...rawRvtOwnerElements].filter(([elementId]) => !nestedOwnerIds.has(elementId)),
);
const rvtNestedOwnerElements = new Map(
  completeNestedOwnerElements.map((element) => [
    element.elementId,
    element,
  ]),
);
const rvtPlacedElements = new Map(
  (rvtMesh?.instances ?? []).map((element) => [
    element.elementId,
    element,
  ]),
);
const rvtElements = new Map(rvtOwnerElements);
for (const [elementId, element] of rvtPlacedElements) {
  rvtElements.set(elementId, element);
}
for (const [elementId, element] of rvtNestedOwnerElements) {
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
  const bounds = emptyBounds();
  for (let index = 0; index < mesh.geometries.size(); index += 1) {
    const placed = mesh.geometries.get(index);
    const geometry = api.GetGeometry(model, placed.geometryExpressID);
    const indices = api.GetIndexArray(
      geometry.GetIndexData(),
      geometry.GetIndexDataSize(),
    );
    triangleCount += indices.length / 3;
    const vertices = api.GetVertexArray(
      geometry.GetVertexData(),
      geometry.GetVertexDataSize(),
    );
    const matrix = placed.flatTransformation;
    for (let vertex = 0; vertex + 2 < vertices.length; vertex += 6) {
      const x = vertices[vertex];
      const y = vertices[vertex + 1];
      const z = vertices[vertex + 2];
      // web-ifc is Y-up metres; the browser RVT path is Z-up feet.
      includePoint(
        bounds,
        (matrix[0] * x +
          matrix[4] * y +
          matrix[8] * z +
          matrix[12]) *
          FEET_PER_METRE,
        -(matrix[2] * x +
          matrix[6] * y +
          matrix[10] * z +
          matrix[14]) *
          FEET_PER_METRE,
        (matrix[1] * x +
          matrix[5] * y +
          matrix[9] * z +
          matrix[13]) *
          FEET_PER_METRE,
      );
    }
    geometry.delete();
  }
  ifcTriangles += triangleCount;
  if (element?.numericTag == null) return;
  ifcGeometryProductsWithNumericTag += 1;
  const previous = ifcGeometryByTag.get(element.numericTag);
  if (previous) includeBounds(bounds, previous.bounds);
  ifcGeometryByTag.set(element.numericTag, {
    type: element.type,
    triangles: (previous?.triangles ?? 0) + triangleCount,
    bounds,
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
const directGeometryOwnerIds = new Set(
  rvtAudit.topologyInventory?.directGeometryOwnerElementIds ?? [],
);
const decodedPlacementLinks = new Map(
  (rvtAudit.topologyInventory?.placementLinks ?? []).map((placement) => [
    placement.elementId,
    placement.geometryOwnerId,
  ]),
);
function ifcOnlyReason(tag) {
  if (nestedOwnerIds.has(tag)) {
    return "nested-owner-incomplete-proxy-only";
  }
  if (directGeometryOwnerIds.has(tag)) {
    return "direct-geometry-owner-without-certified-mesh";
  }
  const geometryOwnerId = decodedPlacementLinks.get(tag);
  if (geometryOwnerId == null) return "no-direct-owner-or-placement";
  return directGeometryOwnerIds.has(geometryOwnerId)
    ? "placement-to-owner-without-certified-mesh"
    : "placement-to-unreplayed-owner";
}
const ifcOnlyByReason = new Map();
const ifcOnlyByClass = new Map();
const unreplayedPlacementOwners = new Map();
for (const tag of ifcOnlyTags) {
  const ifc = ifcGeometryByTag.get(tag);
  const reason = ifcOnlyReason(tag);
  const reasonRow = ifcOnlyByReason.get(reason) ?? {
    tags: 0,
    ifcTriangles: 0,
  };
  reasonRow.tags += 1;
  reasonRow.ifcTriangles += ifc.triangles;
  ifcOnlyByReason.set(reason, reasonRow);

  const classRow = ifcOnlyByClass.get(ifc.type) ?? {
    tags: 0,
    ifcTriangles: 0,
    reasons: new Map(),
  };
  classRow.tags += 1;
  classRow.ifcTriangles += ifc.triangles;
  classRow.reasons.set(reason, (classRow.reasons.get(reason) ?? 0) + 1);
  ifcOnlyByClass.set(ifc.type, classRow);

  if (reason === "placement-to-unreplayed-owner") {
    const geometryOwnerId = decodedPlacementLinks.get(tag);
    const ownerRow = unreplayedPlacementOwners.get(geometryOwnerId) ?? {
      placedTags: 0,
      ifcTriangles: 0,
      classes: new Map(),
      sampleTags: [],
    };
    ownerRow.placedTags += 1;
    ownerRow.ifcTriangles += ifc.triangles;
    ownerRow.classes.set(
      ifc.type,
      (ownerRow.classes.get(ifc.type) ?? 0) + 1,
    );
    if (ownerRow.sampleTags.length < 10) ownerRow.sampleTags.push(tag);
    unreplayedPlacementOwners.set(geometryOwnerId, ownerRow);
  }
}
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
const matchedPlacedTags = [...rvtPlacedElements.keys()]
  .filter((tag) => ifcGeometryByTag.has(tag))
  .sort((left, right) => left - right);
const matchedDirectOwnerTags = [...rvtOwnerElements.keys()]
  .filter((tag) => ifcGeometryByTag.has(tag))
  .sort((left, right) => left - right);
const matchedNestedOwnerTags = [...rvtNestedOwnerElements.keys()]
  .filter((tag) => ifcGeometryByTag.has(tag))
  .sort((left, right) => left - right);
const referencedOwnerPlacedTags = [...rvtPlacedElements]
  .filter(([, element]) =>
    element.geometrySource === "composed-referenced-owner"
  )
  .map(([tag]) => tag)
  .sort((left, right) => left - right);
const boundsRows = matchedPlacedTags.map((tag) => ({
  tag,
  type: ifcGeometryByTag.get(tag).type,
  geometryOwnerId: rvtPlacedElements.get(tag).geometryOwnerId,
  geometrySource: rvtPlacedElements.get(tag).geometrySource ?? null,
  rvtTriangles: rvtPlacedElements.get(tag).triangles,
  ifcTriangles: ifcGeometryByTag.get(tag).triangles,
  exactTriangleCount:
    rvtPlacedElements.get(tag).triangles ===
    ifcGeometryByTag.get(tag).triangles,
  ...boundsError(
    rvtPlacedElements.get(tag),
    ifcGeometryByTag.get(tag).bounds,
  ),
}));
const referencedOwnerPlacementBoundsRows = boundsRows.filter(
  (row) => row.geometrySource === "composed-referenced-owner",
);
const directOwnerBoundsRows = matchedDirectOwnerTags.map((tag) => ({
  tag,
  type: ifcGeometryByTag.get(tag).type,
  rvtTriangles: rvtOwnerElements.get(tag).triangles,
  ifcTriangles: ifcGeometryByTag.get(tag).triangles,
  exactTriangleCount:
    rvtOwnerElements.get(tag).triangles ===
    ifcGeometryByTag.get(tag).triangles,
  ...boundsError(
    rvtOwnerElements.get(tag),
    ifcGeometryByTag.get(tag).bounds,
  ),
}));
const nestedOwnerBoundsRows = matchedNestedOwnerTags.map((tag) => ({
  tag,
  type: ifcGeometryByTag.get(tag).type,
  occurrences: rvtNestedOwnerElements.get(tag).occurrences,
  rvtTriangles: rvtNestedOwnerElements.get(tag).triangles,
  ifcTriangles: ifcGeometryByTag.get(tag).triangles,
  exactTriangleCount:
    rvtNestedOwnerElements.get(tag).triangles ===
    ifcGeometryByTag.get(tag).triangles,
  ...boundsError(
    rvtNestedOwnerElements.get(tag),
    ifcGeometryByTag.get(tag).bounds,
  ),
}));
const boundsRowByTag = new Map(boundsRows.map((row) => [row.tag, row]));
const directOwnerBoundsRowByTag = new Map(
  directOwnerBoundsRows.map((row) => [row.tag, row]),
);
const coincidentBoundsAndTriangleCount = boundsRows.filter(
  (row) =>
    row.exactTriangleCount &&
    row.maximumCornerErrorFeet <= BOUNDS_TOLERANCES_FEET[0],
);
const coincidentDirectOwnerBoundsAndTriangleCount =
  directOwnerBoundsRows.filter(
    (row) =>
      row.exactTriangleCount &&
      row.maximumCornerErrorFeet <= BOUNDS_TOLERANCES_FEET[0],
  );

const byIfcClass = new Map();
for (const tag of matchedTags) {
  const ifc = ifcGeometryByTag.get(tag);
  const rvt = rvtElements.get(tag);
  const row = byIfcClass.get(ifc.type) ?? {
    matchedTags: 0,
    rvtTriangles: 0,
    ifcTriangles: 0,
    placedBoundsTags: 0,
    placedBoundsWithinHalfFoot: 0,
    directOwnerBoundsTags: 0,
    directOwnerBoundsWithinHalfFoot: 0,
    coincidentBoundsAndTriangleCount: 0,
    coincidentDirectOwnerBoundsAndTriangleCount: 0,
  };
  row.matchedTags += 1;
  row.rvtTriangles += rvt.triangles;
  row.ifcTriangles += ifc.triangles;
  const boundsRow = boundsRowByTag.get(tag);
  if (boundsRow) {
    row.placedBoundsTags += 1;
    if (boundsRow.maximumCornerErrorFeet <= 0.5) {
      row.placedBoundsWithinHalfFoot += 1;
    }
    if (
      boundsRow.exactTriangleCount &&
      boundsRow.maximumCornerErrorFeet <= BOUNDS_TOLERANCES_FEET[0]
    ) {
      row.coincidentBoundsAndTriangleCount += 1;
    }
  }
  const directOwnerBoundsRow = directOwnerBoundsRowByTag.get(tag);
  if (directOwnerBoundsRow) {
    row.directOwnerBoundsTags += 1;
    if (directOwnerBoundsRow.maximumCornerErrorFeet <= 0.5) {
      row.directOwnerBoundsWithinHalfFoot += 1;
    }
    if (
      directOwnerBoundsRow.exactTriangleCount &&
      directOwnerBoundsRow.maximumCornerErrorFeet <=
        BOUNDS_TOLERANCES_FEET[0]
    ) {
      row.coincidentDirectOwnerBoundsAndTriangleCount += 1;
    }
  }
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
    rvtMeshScope,
    rawRvtGeometryOwnerTags: rawRvtOwnerElements.size,
    rvtGeometryOwnerTags: rvtOwnerElements.size,
    rvtPlacedInstanceTags: rvtPlacedElements.size,
    rvtReferencedOwnerPlacedInstanceTags: referencedOwnerPlacedTags.length,
    matchedReferencedOwnerPlacedInstanceTags:
      referencedOwnerPlacementBoundsRows.length,
    rvtNestedOwnerTags: allNestedOwnerElements.length,
    rvtCompleteNestedOwnerTags: rvtNestedOwnerElements.size,
    rvtPartialNestedOwnerTagsExcluded: partialNestedOwnerElements.length,
    matchedCompleteNestedOwnerTags: matchedNestedOwnerTags.length,
    uniqueRvtProductCandidates: rvtElements.size,
    ifcGeometryProducts,
    ifcGeometryProductsWithNumericTag,
    uniqueIfcGeometryNumericTags: ifcGeometryByTag.size,
    matchedTags: matchedTags.length,
    matchedPlacedInstanceTags: matchedPlacedTags.length,
    rvtOnlyTags: rvtOnlyTags.length,
    ifcOnlyTags: ifcOnlyTags.length,
  },
  triangles: {
    rvtGeometryOwners: sum(
      [...rvtOwnerElements.values()].map((element) => element.triangles),
    ),
    rvtPlacedInstances: rvtMesh?.placedInstanceTriangles ?? 0,
    rvtReferencedOwnerPlacedInstances: sum(
      referencedOwnerPlacedTags.map(
        (tag) => rvtPlacedElements.get(tag)?.triangles ?? 0,
      ),
    ),
    rvtCompleteNestedOwners: sum(
      [...rvtNestedOwnerElements.values()].map(
        (element) => element.triangles,
      ),
    ),
    rvtPartialNestedOwnersExcluded: sum(
      partialNestedOwnerElements.map((element) => element.triangles),
    ),
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
  ifcOnlyDiagnosis: {
    scope:
      "numeric IFC geometry Tags absent from the certified RVT owner+placement candidate set",
    unreplayedPlacementOwnerCount: unreplayedPlacementOwners.size,
    byReason: Object.fromEntries(
      [...ifcOnlyByReason].sort(
        (left, right) => right[1].tags - left[1].tags,
      ),
    ),
    byIfcClass: Object.fromEntries(
      [...ifcOnlyByClass]
        .sort((left, right) => right[1].tags - left[1].tags)
        .map(([type, row]) => [
          type,
          {
            tags: row.tags,
            ifcTriangles: row.ifcTriangles,
            reasons: Object.fromEntries(
              [...row.reasons].sort(
                (left, right) => right[1] - left[1],
              ),
            ),
          },
        ]),
    ),
    unreplayedPlacementOwners: [...unreplayedPlacementOwners]
      .sort(
        (left, right) =>
          right[1].placedTags - left[1].placedTags ||
          left[0] - right[0],
      )
      .slice(0, 100)
      .map(([geometryOwnerId, row]) => ({
        geometryOwnerId,
        placedTags: row.placedTags,
        ifcTriangles: row.ifcTriangles,
        classes: Object.fromEntries(
          [...row.classes].sort((left, right) => right[1] - left[1]),
        ),
        sampleTags: row.sampleTags,
      })),
  },
  worldBounds: {
    scope:
      "persisted RVT instances with a matched numeric IFC Tag; direct geometry-owner coordinates are not assumed to be world coordinates",
    comparedTags: boundsRows.length,
    frame:
      "IFC Y-up metres mapped to RVT Z-up feet as (x, y, z) -> (x, -z, y)",
    maximumCornerError: errorDistribution(
      boundsRows,
      "maximumCornerErrorFeet",
    ),
    maximumCentreError: errorDistribution(
      boundsRows,
      "maximumCentreErrorFeet",
    ),
    maximumSizeError: errorDistribution(
      boundsRows,
      "maximumSizeErrorFeet",
    ),
    withinMaximumCornerError: toleranceCounts(boundsRows),
    coincidentBoundsAndTriangleCount: {
      toleranceFeet: BOUNDS_TOLERANCES_FEET[0],
      count: coincidentBoundsAndTriangleCount.length,
      ratio: ratio(
        coincidentBoundsAndTriangleCount.length,
        boundsRows.length,
      ),
      interpretation:
        "diagnostic only: equal triangle counts plus coincident world AABBs do not prove identical topology or vertex positions",
    },
  },
  referencedOwnerPlacementBoundsDiagnostic: {
    scope:
      "placed instances resolved through complete non-direct referenced GRep owner compositions",
    comparedTags: referencedOwnerPlacementBoundsRows.length,
    frame:
      "IFC Y-up metres mapped to RVT Z-up feet as (x, y, z) -> (x, -z, y)",
    maximumCornerError: errorDistribution(
      referencedOwnerPlacementBoundsRows,
      "maximumCornerErrorFeet",
    ),
    maximumCentreError: errorDistribution(
      referencedOwnerPlacementBoundsRows,
      "maximumCentreErrorFeet",
    ),
    maximumSizeError: errorDistribution(
      referencedOwnerPlacementBoundsRows,
      "maximumSizeErrorFeet",
    ),
    withinMaximumCornerError: toleranceCounts(
      referencedOwnerPlacementBoundsRows,
    ),
  },
  directOwnerBoundsDiagnostic: {
    scope:
      "matched direct GRep owner coordinates compared to IFC world AABBs without applying a placement; agreement is measured but does not by itself prove that every direct-owner coordinate frame is world space",
    comparedTags: directOwnerBoundsRows.length,
    frame:
      "IFC Y-up metres mapped to RVT Z-up feet as (x, y, z) -> (x, -z, y)",
    maximumCornerError: errorDistribution(
      directOwnerBoundsRows,
      "maximumCornerErrorFeet",
    ),
    maximumCentreError: errorDistribution(
      directOwnerBoundsRows,
      "maximumCentreErrorFeet",
    ),
    maximumSizeError: errorDistribution(
      directOwnerBoundsRows,
      "maximumSizeErrorFeet",
    ),
    withinMaximumCornerError: toleranceCounts(directOwnerBoundsRows),
    coincidentBoundsAndTriangleCount: {
      toleranceFeet: BOUNDS_TOLERANCES_FEET[0],
      count: coincidentDirectOwnerBoundsAndTriangleCount.length,
      ratio: ratio(
        coincidentDirectOwnerBoundsAndTriangleCount.length,
        directOwnerBoundsRows.length,
      ),
      interpretation:
        "diagnostic only: equal triangle counts plus coincident AABBs do not prove identical topology, vertex positions, or a general owner coordinate-space rule",
    },
  },
  nestedOwnerBoundsDiagnostic: {
    scope:
      "complete:true nested symbol compositions only; partial compositions are excluded atomically and remain proxy-only",
    comparedTags: nestedOwnerBoundsRows.length,
    frame:
      "IFC Y-up metres mapped to RVT Z-up feet as (x, y, z) -> (x, -z, y)",
    maximumCornerError: errorDistribution(
      nestedOwnerBoundsRows,
      "maximumCornerErrorFeet",
    ),
    maximumCentreError: errorDistribution(
      nestedOwnerBoundsRows,
      "maximumCentreErrorFeet",
    ),
    maximumSizeError: errorDistribution(
      nestedOwnerBoundsRows,
      "maximumSizeErrorFeet",
    ),
    withinMaximumCornerError: toleranceCounts(nestedOwnerBoundsRows),
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
          placedBoundsWithinHalfFootRatio: ratio(
            value.placedBoundsWithinHalfFoot,
            value.placedBoundsTags,
          ),
          directOwnerBoundsWithinHalfFootRatio: ratio(
            value.directOwnerBoundsWithinHalfFoot,
            value.directOwnerBoundsTags,
          ),
          coincidentBoundsAndTriangleCountRatio: ratio(
            value.coincidentBoundsAndTriangleCount,
            value.placedBoundsTags,
          ),
          coincidentDirectOwnerBoundsAndTriangleCountRatio: ratio(
            value.coincidentDirectOwnerBoundsAndTriangleCount,
            value.directOwnerBoundsTags,
          ),
        },
      ]),
  ),
  samples: {
    rvtOnlyTags: rvtOnlyTags.slice(0, 100),
    ifcOnlyTags: ifcOnlyTags.slice(0, 100),
    exactTriangleCountTags: exactTriangleCountTags.slice(0, 100),
    worstPlacedBoundsTags: [...boundsRows]
      .sort(
        (left, right) =>
          right.maximumCornerErrorFeet - left.maximumCornerErrorFeet,
      )
      .slice(0, 100),
    worstReferencedOwnerPlacementBoundsTags: [
      ...referencedOwnerPlacementBoundsRows,
    ]
      .sort(
        (left, right) =>
          right.maximumCornerErrorFeet - left.maximumCornerErrorFeet,
      )
      .slice(0, 100),
    worstDirectOwnerBoundsTags: [...directOwnerBoundsRows]
      .sort(
        (left, right) =>
          right.maximumCornerErrorFeet - left.maximumCornerErrorFeet,
      )
      .slice(0, 100),
    worstNestedOwnerBoundsTags: [...nestedOwnerBoundsRows]
      .sort(
        (left, right) =>
          right.maximumCornerErrorFeet - left.maximumCornerErrorFeet,
      )
      .slice(0, 100),
  },
  interpretation: {
    geometry:
      rvtMeshScope === "certified-browser"
        ? "RVT candidates combine direct geometry owners, exact persisted instance-to-shared-owner placements, and only complete:true nested symbol compositions with the certified planar, Cylinder, Cone apex-sector, and Arc/SurfRev face subsets. Partial nested compositions are excluded atomically. IFC counts contain each matched product's complete exported geometry."
        : "RVT candidates combine direct geometry owners with exact persisted instance-to-shared-owner placements; they contain only certified single-loop planar sampled faces. IFC counts contain each matched product's complete exported geometry.",
    transforms:
      "Placed-instance bounds use the persisted instance basis and origin. Referenced non-direct owners and nested GInstance roots use the exact symbolElementId graph and native outer*inner transform order; only complete compositions enter this checkpoint.",
    triangles:
      "Equal triangle counts are diagnostic only because valid tessellation policies can produce different triangle counts.",
    materials:
      "This parity audit does not load MaterialElem definitions; the reusable owner mesh APIs bind exact positive face materials when those independently decoded definitions are supplied.",
  },
};

mkdirSync(dirname(paths.json), { recursive: true });
writeFileSync(paths.json, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
