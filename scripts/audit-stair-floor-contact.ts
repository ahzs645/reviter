#!/usr/bin/env node

/**
 * Measure every recovered stair-run endpoint against the floor, landing, or
 * adjacent stair-flight triangles that the viewer actually renders.
 *
 * Broad element bounds are not sufficient for this audit: a floor with a stair
 * opening can contain the endpoint in its AABB while still leaving a visible
 * gap. The endpoint is therefore sampled across its full native tread edge and
 * measured against rendered triangles, with IFC boxes retained only as an
 * independent diagnostic cross-check.
 */
import { writeFileSync } from "node:fs";

import { convertModel } from "./audit-coverage.ts";
import { readTruthBoxes, type Box } from "./overlay-diff.ts";
import type { ElementBoundsRecord, Point3 } from "../lib/reviter/types.ts";

const [rvtPath, ifcPath] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
const jsonIndex = process.argv.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : undefined;
if (!rvtPath || !ifcPath) {
  throw new Error("usage: audit-stair-floor-contact.ts <model.rvt> <model.ifc> [--json report.json]");
}

const STAIRS_RUN_CATEGORY = -2000919;
const STAIRS_LANDING_CATEGORY = -2000920;
const FLOOR_CATEGORY = -2000032;
const ENDPOINT_SAMPLES = 7;
const CANDIDATE_PLAN_SLACK_FEET = 12;
const CANDIDATE_VERTICAL_SLACK_FEET = 4;
const CONTACT_TOLERANCE_FEET = 0.25;
const VISIBLE_GAP_FEET = 0.5;

type Triangle = {
  elementId: number;
  categoryId: number | null;
  categoryName: string | null;
  a: Point3;
  b: Point3;
  c: Point3;
};

type Endpoint = {
  edge: [Point3, Point3];
  samples: Point3[];
};

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function add(a: Point3, b: Point3): Point3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(point: Point3, factor: number): Point3 {
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}

function dot(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function squaredDistance(a: Point3, b: Point3): number {
  const delta = subtract(a, b);
  return dot(delta, delta);
}

/** Closest point on a triangle, from Real-Time Collision Detection §5.1.5. */
function closestPointOnTriangle(point: Point3, triangle: Triangle): Point3 {
  const ab = subtract(triangle.b, triangle.a);
  const ac = subtract(triangle.c, triangle.a);
  const ap = subtract(point, triangle.a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return triangle.a;

  const bp = subtract(point, triangle.b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return triangle.b;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    return add(triangle.a, scale(ab, d1 / (d1 - d3)));
  }

  const cp = subtract(point, triangle.c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return triangle.c;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    return add(triangle.a, scale(ac, d2 / (d2 - d6)));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const edge = subtract(triangle.c, triangle.b);
    return add(triangle.b, scale(edge, (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  }

  const denominator = 1 / (va + vb + vc);
  return add(triangle.a, add(scale(ab, vb * denominator), scale(ac, vc * denominator)));
}

function pointBoxDistance(point: Point3, box: Box): number {
  const closest: Point3 = [
    clamp(point[0], box[0], box[3]),
    clamp(point[1], box[1], box[4]),
    clamp(point[2], box[2], box[5]),
  ];
  return Math.sqrt(squaredDistance(point, closest));
}

function planDistanceToBounds(point: Point3, record: ElementBoundsRecord): number {
  const { min, max } = record.boundsFeet;
  return Math.hypot(
    point[0] < min.x ? min.x - point[0] : point[0] > max.x ? point[0] - max.x : 0,
    point[1] < min.y ? min.y - point[1] : point[1] > max.y ? point[1] - max.y : 0,
  );
}

function verticalDistanceToBounds(point: Point3, record: ElementBoundsRecord): number {
  const { min, max } = record.boundsFeet;
  return point[2] < min.z ? min.z - point[2] : point[2] > max.z ? point[2] - max.z : 0;
}

function sampleEdge(edge: [Point3, Point3]): Point3[] {
  return Array.from({ length: ENDPOINT_SAMPLES }, (_, index) => {
    const fraction = index / (ENDPOINT_SAMPLES - 1);
    return [
      edge[0][0] + (edge[1][0] - edge[0][0]) * fraction,
      edge[0][1] + (edge[1][1] - edge[0][1]) * fraction,
      edge[0][2] + (edge[1][2] - edge[0][2]) * fraction,
    ];
  });
}

function endpoints(record: ElementBoundsRecord): { bottom: Endpoint; top: Endpoint } | null {
  const first = record.stairTreads?.[0];
  const last = record.stairTreads?.at(-1);
  if (!first || !last) return null;
  const bottomEdge: [Point3, Point3] = [
    [first[0][0], first[0][1], record.boundsFeet.min.z],
    [first[3][0], first[3][1], record.boundsFeet.min.z],
  ];
  const topEdge: [Point3, Point3] = [
    [last[1][0], last[1][1], record.boundsFeet.max.z],
    [last[2][0], last[2][1], record.boundsFeet.max.z],
  ];
  return {
    bottom: { edge: bottomEdge, samples: sampleEdge(bottomEdge) },
    top: { edge: topEdge, samples: sampleEdge(topEdge) },
  };
}

const result = convertModel(rvtPath);
const truth = await readTruthBoxes(ifcPath);
const recordById = new Map(result.elementBounds.map((record) => [record.elementId, record]));
const stairRuns = result.elementBounds.filter((record) => record.categoryId === STAIRS_RUN_CATEGORY);
const supportRecords = result.elementBounds.filter((record) =>
  record.categoryId === FLOOR_CATEGORY ||
  record.categoryId === STAIRS_LANDING_CATEGORY ||
  record.categoryId === STAIRS_RUN_CATEGORY,
);
const supportIds = new Set(supportRecords.map((record) => record.elementId));
const trianglesByElement = new Map<number, Triangle[]>();

for (const mesh of result.meshes) {
  if (!mesh.elementIds?.length) continue;
  const triangleCount = Math.min(mesh.elementIds.length, Math.floor(mesh.indices.length / 3));
  for (let face = 0; face < triangleCount; face += 1) {
    const elementId = mesh.elementIds[face]!;
    if (!supportIds.has(elementId)) continue;
    const record = recordById.get(elementId);
    const points = [0, 1, 2].map((corner): Point3 => {
      const vertex = mesh.indices[face * 3 + corner]! * 3;
      return [
        mesh.positions[vertex]! + result.origin.x,
        mesh.positions[vertex + 1]! + result.origin.y,
        mesh.positions[vertex + 2]! + result.origin.z,
      ];
    });
    const group = trianglesByElement.get(elementId) ?? [];
    group.push({
      elementId,
      categoryId: record?.categoryId ?? null,
      categoryName: record?.categoryName ?? null,
      a: points[0]!,
      b: points[1]!,
      c: points[2]!,
    });
    trianglesByElement.set(elementId, group);
  }
}

function measureEndpoint(stair: ElementBoundsRecord, endpoint: Endpoint) {
  const center = endpoint.samples[Math.floor(endpoint.samples.length / 2)]!;
  const candidates = supportRecords.filter((record) =>
    record.elementId !== stair.elementId &&
    planDistanceToBounds(center, record) <= CANDIDATE_PLAN_SLACK_FEET &&
    verticalDistanceToBounds(center, record) <= CANDIDATE_VERTICAL_SLACK_FEET,
  );
  const candidateTriangles = candidates.flatMap((record) => trianglesByElement.get(record.elementId) ?? []);
  const samples = endpoint.samples.map((point) => {
    let nearest: { triangle: Triangle; point: Point3; distanceFeet: number } | null = null;
    for (const triangle of candidateTriangles) {
      const closest = closestPointOnTriangle(point, triangle);
      const distanceFeet = Math.sqrt(squaredDistance(point, closest));
      if (!nearest || distanceFeet < nearest.distanceFeet) {
        nearest = { triangle, point: closest, distanceFeet };
      }
    }
    return nearest == null ? { point, distanceFeet: null, nearest: null } : {
      point,
      distanceFeet: nearest.distanceFeet,
      nearest: {
        elementId: nearest.triangle.elementId,
        categoryId: nearest.triangle.categoryId,
        categoryName: nearest.triangle.categoryName,
        point: nearest.point,
      },
    };
  });
  const distances = samples.flatMap((sample) => sample.distanceFeet == null ? [] : [sample.distanceFeet]);
  const nearestSample = samples
    .filter((sample) => sample.distanceFeet != null)
    .sort((left, right) => left.distanceFeet! - right.distanceFeet!)[0] ?? null;
  const sorted = [...distances].sort((left, right) => left - right);

  const ifcCandidates = [...truth.entries()].filter(([elementId, entry]) =>
    elementId !== stair.elementId &&
    (entry.type === "IFCSLAB" || entry.type === "IFCSTAIRFLIGHT"),
  );
  const nearestIfc = ifcCandidates
    .map(([elementId, entry]) => ({
      elementId,
      type: entry.type,
      distanceFeet: pointBoxDistance(center, entry.box),
    }))
    .sort((left, right) => left.distanceFeet - right.distanceFeet)[0] ?? null;

  return {
    edge: endpoint.edge,
    sampleCount: samples.length,
    minimumDistanceFeet: sorted[0] ?? null,
    medianDistanceFeet: sorted[Math.floor(sorted.length / 2)] ?? null,
    maximumDistanceFeet: sorted.at(-1) ?? null,
    nearestRenderedSupport: nearestSample?.nearest ?? null,
    nearestIfcSupport: nearestIfc,
    classification:
      !distances.length ? "unmeasurable" :
      (sorted.at(-1) ?? Infinity) <= CONTACT_TOLERANCE_FEET ? "full-edge-contact" :
      (sorted[0] ?? Infinity) <= CONTACT_TOLERANCE_FEET ? "partial-edge-contact" :
      (sorted[0] ?? Infinity) >= VISIBLE_GAP_FEET ? "visible-gap-candidate" :
      "near-contact",
    samples,
  };
}

const runs = stairRuns.map((record) => {
  const runEndpoints = endpoints(record);
  const ifc = truth.get(record.elementId);
  return {
    elementId: record.elementId,
    renderGeometryProvenance: record.renderGeometryProvenance ?? null,
    treadCount: record.stairTreads?.length ?? 0,
    beginWithRiser: record.stairBeginWithRiser ?? null,
    endWithRiser: record.stairEndWithRiser ?? null,
    bounds: record.boundsFeet,
    ifcFlightBounds: ifc?.type === "IFCSTAIRFLIGHT" ? ifc.box : null,
    bottom: runEndpoints ? measureEndpoint(record, runEndpoints.bottom) : null,
    top: runEndpoints ? measureEndpoint(record, runEndpoints.top) : null,
  };
});

const endpointRows = runs.flatMap((run) => [
  ...(run.bottom ? [{ elementId: run.elementId, end: "bottom", ...run.bottom }] : []),
  ...(run.top ? [{ elementId: run.elementId, end: "top", ...run.top }] : []),
]);
const counts = Object.fromEntries(
  ["full-edge-contact", "partial-edge-contact", "near-contact", "visible-gap-candidate", "unmeasurable"]
    .map((classification) => [
      classification,
      endpointRows.filter((endpoint) => endpoint.classification === classification).length,
    ]),
);
const suspected = endpointRows
  .filter((endpoint) => endpoint.classification === "visible-gap-candidate")
  .sort((left, right) => (right.minimumDistanceFeet ?? 0) - (left.minimumDistanceFeet ?? 0));
const report = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-stair-floor-contact.ts",
  thresholdsFeet: {
    fullEdgeContact: CONTACT_TOLERANCE_FEET,
    visibleGap: VISIBLE_GAP_FEET,
  },
  stairRuns: runs.length,
  measuredRuns: runs.filter((run) => run.bottom && run.top).length,
  unmeasuredRuns: runs.filter((run) => !run.bottom || !run.top).map((run) => run.elementId),
  endpointCounts: counts,
  suspectedVisibleGaps: suspected.map(({ samples: _samples, ...endpoint }) => endpoint),
  runs,
};

console.log(JSON.stringify({
  ...report,
  runs: undefined,
  suspectedVisibleGaps: report.suspectedVisibleGaps.slice(0, 30),
}, null, 2));
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
