#!/usr/bin/env node

/** Reproducible topology and world-extent statistics for a GLB. */
import { readFileSync } from "node:fs";

import * as THREE from "three";

import {
  isEntryPoint,
  optionValue,
  positionals,
  writeJsonReport,
} from "./lib/rvt-harness.ts";

type Accessor = {
  componentType: number;
  count: number;
  normalized?: boolean;
  min?: number[];
  max?: number[];
};
type Primitive = { attributes?: { POSITION?: number }; indices?: number; mode?: number };
type GlbDocument = {
  asset?: { generator?: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{
    mesh?: number; children?: number[]; matrix?: number[]; translation?: number[];
    rotation?: number[]; scale?: number[];
  }>;
  meshes?: Array<{ primitives?: Primitive[] }>;
  accessors?: Accessor[];
  materials?: unknown[];
};

export type GlbStatistics = {
  generator: string | null;
  materialCount: number;
  meshDefinitions: number;
  meshInstances: number;
  trianglePrimitives: number;
  linePrimitives: number;
  storedTriangles: number;
  instantiatedTriangles: number;
  bounds: { min: number[]; max: number[] } | null;
  spans: number[] | null;
};

export function readGlbDocument(bytes: Uint8Array): GlbDocument {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 || view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error("Expected a glTF 2.0 binary GLB with a JSON first chunk.");
  }
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).replace(/[\0\s]+$/u, ""),
  ) as GlbDocument;
}

function normalizedComponent(value: number, accessor: Accessor): number {
  if (!accessor.normalized) return value;
  switch (accessor.componentType) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32_767, -1);
    case 5123: return value / 65_535;
    case 5125: return value / 4_294_967_295;
    default: return value;
  }
}

function primitiveTriangles(document: GlbDocument, primitive: Primitive): number {
  if ((primitive.mode ?? 4) !== 4) return 0;
  const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
  return accessorIndex == null ? 0 : (document.accessors?.[accessorIndex]?.count ?? 0) / 3;
}

function localMatrix(node: NonNullable<GlbDocument["nodes"]>[number]): THREE.Matrix4 {
  if (node.matrix?.length === 16) return new THREE.Matrix4().fromArray(node.matrix);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(node.translation ?? [0, 0, 0]) as [number, number, number]),
    new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1]) as [number, number, number, number]),
    new THREE.Vector3(...(node.scale ?? [1, 1, 1]) as [number, number, number]),
  );
}

function expandAccessorBounds(box: THREE.Box3, accessor: Accessor | undefined, matrix: THREE.Matrix4) {
  if (!accessor?.min || !accessor.max || accessor.min.length < 3 || accessor.max.length < 3) return;
  for (const x of [accessor.min[0]!, accessor.max[0]!])
    for (const y of [accessor.min[1]!, accessor.max[1]!])
      for (const z of [accessor.min[2]!, accessor.max[2]!])
        box.expandByPoint(new THREE.Vector3(
          normalizedComponent(x, accessor), normalizedComponent(y, accessor),
          normalizedComponent(z, accessor),
        ).applyMatrix4(matrix));
}

export function analyzeGlbDocument(document: GlbDocument): GlbStatistics {
  const meshes = document.meshes ?? [];
  const nodes = document.nodes ?? [];
  let storedTriangles = 0, trianglePrimitives = 0, linePrimitives = 0;
  for (const mesh of meshes) for (const primitive of mesh.primitives ?? []) {
    if ((primitive.mode ?? 4) === 4) {
      trianglePrimitives += 1;
      storedTriangles += primitiveTriangles(document, primitive);
    } else if ((primitive.mode ?? 4) === 1) linePrimitives += 1;
  }

  const roots = document.scenes?.[document.scene ?? 0]?.nodes ?? [];
  const bounds = new THREE.Box3();
  let meshInstances = 0, instantiatedTriangles = 0;
  const visit = (nodeIndex: number, parent: THREE.Matrix4, ancestors: Set<number>) => {
    if (ancestors.has(nodeIndex)) throw new Error(`GLB node cycle at ${nodeIndex}.`);
    const node = nodes[nodeIndex];
    if (!node) throw new Error(`GLB scene references missing node ${nodeIndex}.`);
    const world = parent.clone().multiply(localMatrix(node));
    if (node.mesh != null) {
      const mesh = meshes[node.mesh];
      if (!mesh) throw new Error(`GLB node ${nodeIndex} references missing mesh ${node.mesh}.`);
      meshInstances += 1;
      for (const primitive of mesh.primitives ?? []) {
        instantiatedTriangles += primitiveTriangles(document, primitive);
        const positionIndex = primitive.attributes?.POSITION;
        if (positionIndex != null) expandAccessorBounds(bounds, document.accessors?.[positionIndex], world);
      }
    }
    const next = new Set(ancestors).add(nodeIndex);
    for (const child of node.children ?? []) visit(child, world, next);
  };
  for (const root of roots) visit(root, new THREE.Matrix4(), new Set());
  const finite = !bounds.isEmpty() && bounds.min.toArray().every(Number.isFinite) &&
    bounds.max.toArray().every(Number.isFinite);
  return {
    generator: document.asset?.generator ?? null,
    materialCount: document.materials?.length ?? 0,
    meshDefinitions: meshes.length,
    meshInstances,
    trianglePrimitives,
    linePrimitives,
    storedTriangles,
    instantiatedTriangles,
    bounds: finite ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null,
    spans: finite ? bounds.getSize(new THREE.Vector3()).toArray() : null,
  };
}

if (isEntryPoint(import.meta.url)) {
  const [glbPath] = positionals("--json");
  const jsonPath = optionValue("--json");
  if (!glbPath) {
    console.error("usage: glb-statistics.ts <model.glb> [--json <report.json>]");
    process.exit(2);
  }
  const report = analyzeGlbDocument(readGlbDocument(readFileSync(glbPath)));
  if (jsonPath) writeJsonReport(jsonPath, report);
  console.log(JSON.stringify(report, null, 2));
}
