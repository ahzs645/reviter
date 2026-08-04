#!/usr/bin/env node

/** Find generic native wall faces that remain beside a compound-layer body. */
import { readFileSync, writeFileSync } from "node:fs";

import * as THREE from "three";
import { IfcAPI } from "web-ifc";

import { convertModel } from "./audit-coverage.ts";

import type { Bounds3, MeshData } from "../lib/reviter/types.ts";

const positional = process.argv.slice(2).filter((argument, index, arguments_) =>
  !argument.startsWith("--") &&
  arguments_[index - 1] !== "--json" &&
  arguments_[index - 1] !== "--element"
);
const [rvtPath, ifcPath] = positional;
const jsonIndex = process.argv.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : undefined;
const focusElementIds = new Set(process.argv.flatMap((argument, index, arguments_) =>
  arguments_[index - 1] === "--element" && /^\d+$/.test(argument)
    ? [Number(argument)]
    : []));
if (!rvtPath) {
  throw new Error(
    "usage: audit-wall-material-residuals.ts <model.rvt> [model.ifc] [--element id] [--json report.json]",
  );
}

type SurfaceStats = {
  triangles: number;
  bounds: Bounds3;
  materials: Set<number>;
  horizontal: number;
  vertical: number;
  sloped: number;
  samples: [number, number, number][];
};

type WallStats = {
  preferred: SurfaceStats;
  generic: SurfaceStats;
};

const emptyBounds = (): Bounds3 => ({
  min: { x: Infinity, y: Infinity, z: Infinity },
  max: { x: -Infinity, y: -Infinity, z: -Infinity },
});

const emptySurface = (): SurfaceStats => ({
  triangles: 0,
  bounds: emptyBounds(),
  materials: new Set(),
  horizontal: 0,
  vertical: 0,
  sloped: 0,
  samples: [],
});

function vertex(mesh: MeshData, index: number): [number, number, number] {
  const offset = index * 3;
  return [
    mesh.positions[offset]!,
    mesh.positions[offset + 1]!,
    mesh.positions[offset + 2]!,
  ];
}

function addTriangle(
  stats: SurfaceStats,
  points: readonly [number, number, number][],
  materialId: number | undefined,
): void {
  stats.triangles += 1;
  if (materialId != null) stats.materials.add(materialId);
  for (const [x, y, z] of points) {
    stats.bounds.min.x = Math.min(stats.bounds.min.x, x);
    stats.bounds.min.y = Math.min(stats.bounds.min.y, y);
    stats.bounds.min.z = Math.min(stats.bounds.min.z, z);
    stats.bounds.max.x = Math.max(stats.bounds.max.x, x);
    stats.bounds.max.y = Math.max(stats.bounds.max.y, y);
    stats.bounds.max.z = Math.max(stats.bounds.max.z, z);
  }
  stats.samples.push([
    (points[0]![0] + points[1]![0] + points[2]![0]) / 3,
    (points[0]![1] + points[1]![1] + points[2]![1]) / 3,
    (points[0]![2] + points[1]![2] + points[2]![2]) / 3,
  ]);
  const [a, b, c] = points;
  const ab = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const ac = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  const nx = ab[1]! * ac[2]! - ab[2]! * ac[1]!;
  const ny = ab[2]! * ac[0]! - ab[0]! * ac[2]!;
  const nz = ab[0]! * ac[1]! - ab[1]! * ac[0]!;
  const length = Math.hypot(nx, ny, nz);
  if (length <= 1e-12) return;
  const verticalComponent = Math.abs(nz) / length;
  if (verticalComponent >= 0.95) stats.horizontal += 1;
  else if (verticalComponent <= 0.05) stats.vertical += 1;
  else stats.sloped += 1;
}

const result = convertModel(rvtPath);
const wallIds = new Set(
  result.elementBounds
    .filter((record) => record.categoryId === -2_000_011)
    .map((record) => record.elementId),
);
const preferredMaterials = new Map<number, Set<number>>();
for (const assignment of result.nativeCompoundLayerMaterialAssignments ?? []) {
  const materials = preferredMaterials.get(assignment.elementId) ?? new Set<number>();
  materials.add(assignment.materialId);
  preferredMaterials.set(assignment.elementId, materials);
}

const walls = new Map<number, WallStats>();
for (const mesh of result.meshes) {
  if (mesh.source !== "native-brep" || !mesh.elementIds?.length) continue;
  for (let triangle = 0; triangle < mesh.elementIds.length; triangle += 1) {
    const elementId = mesh.elementIds[triangle]!;
    if (!wallIds.has(elementId)) continue;
    const offset = triangle * 3;
    const points = [
      vertex(mesh, mesh.indices[offset]!),
      vertex(mesh, mesh.indices[offset + 1]!),
      vertex(mesh, mesh.indices[offset + 2]!),
    ] as const;
    const stats = walls.get(elementId) ?? {
      preferred: emptySurface(),
      generic: emptySurface(),
    };
    const isPreferred =
      mesh.nativeMaterialElementId != null &&
      preferredMaterials.get(elementId)?.has(mesh.nativeMaterialElementId);
    addTriangle(
      isPreferred ? stats.preferred : stats.generic,
      points,
      mesh.nativeMaterialElementId,
    );
    walls.set(elementId, stats);
  }
}

const candidates = [...walls].flatMap(([elementId, stats]) => {
  const preferred = stats.preferred.bounds;
  const generic = stats.generic.bounds;
  const overhangFeet = stats.generic.triangles > 0
    ? Math.max(
        preferred.min.x - generic.min.x,
        preferred.min.y - generic.min.y,
        preferred.min.z - generic.min.z,
        generic.max.x - preferred.max.x,
        generic.max.y - preferred.max.y,
        generic.max.z - preferred.max.z,
      )
    : Number.NEGATIVE_INFINITY;
  const hasMixedSlopedBody =
    stats.preferred.triangles >= 8 &&
    stats.generic.triangles > 0 &&
    stats.preferred.horizontal > 0 &&
    stats.preferred.vertical > 0 &&
    stats.preferred.sloped > 0;
  const hasMixedRectangularOverfillBody =
    stats.preferred.triangles >= 8 &&
    stats.generic.triangles > 0 &&
    stats.preferred.horizontal > 0 &&
    stats.preferred.vertical > 0 &&
    stats.preferred.sloped === 0 &&
    preferred.min.z - generic.min.z < 0.5 &&
    overhangFeet >= 0.5;
  if (
    !hasMixedSlopedBody &&
    !hasMixedRectangularOverfillBody &&
    !focusElementIds.has(elementId)
  ) {
    return [];
  }
  return [{
    elementId,
    hasMixedSlopedBody,
    hasMixedRectangularOverfillBody,
    preferredTriangles: stats.preferred.triangles,
    genericTriangles: stats.generic.triangles,
    preferredMaterials: [...stats.preferred.materials].sort((a, b) => a - b),
    genericMaterials: [...stats.generic.materials].sort((a, b) => a - b),
    overhangFeet,
    preferredBounds: preferred,
    genericBounds: generic,
    preferredSamples: stats.preferred.samples,
    genericSamples: stats.generic.samples,
  }];
}).sort((left, right) => right.overhangFeet - left.overhangFeet);

type IfcTriangle = THREE.Triangle;

async function ifcTrianglesByTag(
  path: string,
  wanted: ReadonlySet<number>,
): Promise<Map<number, IfcTriangle[]>> {
  const products = new Map<number, number>();
  const text = readFileSync(path, "latin1");
  const entity = /^#(\d+) *= *(IFC[A-Z0-9]+)\(([\s\S]*?)\);\s*$/gm;
  for (let match = entity.exec(text); match; match = entity.exec(text)) {
    let tag = 0;
    for (const quoted of match[3]!.matchAll(/'([^']*)'/g)) {
      if (/^\d+$/.test(quoted[1]!)) tag = Number(quoted[1]!);
    }
    if (wanted.has(tag)) products.set(Number(match[1]!), tag);
  }

  const api = new IfcAPI();
  await api.Init();
  const modelId = api.OpenModel(new Uint8Array(readFileSync(path)));
  const triangles = new Map<number, IfcTriangle[]>();
  const point = (
    vertices: Float32Array,
    vertexIndex: number,
    matrix: number[],
  ): THREE.Vector3 => {
    const offset = vertexIndex * 6;
    const x = vertices[offset]!;
    const y = vertices[offset + 1]!;
    const z = vertices[offset + 2]!;
    return new THREE.Vector3(
      (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) * 3.280839895,
      -(matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) * 3.280839895,
      (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) * 3.280839895,
    );
  };
  api.StreamAllMeshes(modelId, (mesh) => {
    const tag = products.get(mesh.expressID);
    if (tag == null) return;
    const output = triangles.get(tag) ?? [];
    for (let part = 0; part < mesh.geometries.size(); part += 1) {
      const placed = mesh.geometries.get(part);
      const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
      const vertices = api.GetVertexArray(
        geometry.GetVertexData(),
        geometry.GetVertexDataSize(),
      );
      const indices = api.GetIndexArray(
        geometry.GetIndexData(),
        geometry.GetIndexDataSize(),
      );
      for (let index = 0; index + 2 < indices.length; index += 3) {
        output.push(new THREE.Triangle(
          point(vertices, indices[index]!, placed.flatTransformation),
          point(vertices, indices[index + 1]!, placed.flatTransformation),
          point(vertices, indices[index + 2]!, placed.flatTransformation),
        ));
      }
      geometry.delete();
    }
    triangles.set(tag, output);
  });
  api.CloseModel(modelId);
  return triangles;
}

const ifcTriangles = ifcPath
  ? await ifcTrianglesByTag(ifcPath, new Set(candidates.map(({ elementId }) => elementId)))
  : new Map<number, IfcTriangle[]>();
const distanceSummary = (
  samples: readonly [number, number, number][],
  triangles: readonly IfcTriangle[],
) => {
  const closest = new THREE.Vector3();
  const distances = samples.map(([x, y, z]) => {
    const sample = new THREE.Vector3(
      x + result.origin.x,
      y + result.origin.y,
      z + result.origin.z,
    );
    return Math.min(...triangles.map((triangle) =>
      sample.distanceTo(triangle.closestPointToPoint(sample, closest))));
  }).sort((a, b) => a - b);
  return {
    samples: distances.length,
    medianFeet: distances[Math.floor(distances.length / 2)] ?? null,
    maxFeet: distances.at(-1) ?? null,
    within005Feet: distances.filter((distance) => distance <= 0.05).length,
  };
};

const measuredCandidates = candidates.map((candidate) => {
  const triangles = ifcTriangles.get(candidate.elementId) ?? [];
  const { preferredSamples, genericSamples, ...published } = candidate;
  return {
    ...published,
    ...(triangles.length
      ? {
          ifcTriangles: triangles.length,
          preferredToIfc: distanceSummary(preferredSamples, triangles),
          genericToIfc: distanceSummary(genericSamples, triangles),
        }
      : {}),
  };
});

const report = {
  schemaVersion: 1,
  generatedBy: "scripts/audit-wall-material-residuals.ts",
  nativeWallsWithMaterialFaces: walls.size,
  remainingMixedSlopedBodies: candidates.filter(({ hasMixedSlopedBody }) =>
    hasMixedSlopedBody).length,
  remainingMixedRectangularOverfillBodies: candidates.filter(
    ({ hasMixedRectangularOverfillBody }) => hasMixedRectangularOverfillBody,
  ).length,
  candidates: measuredCandidates,
};
console.log(JSON.stringify(report, null, 2));
if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
