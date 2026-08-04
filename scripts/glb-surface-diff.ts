#!/usr/bin/env node

/**
 * Surface-level comparison of a recovered GLB and a visual-reference GLB.
 *
 * Unlike an AABB audit, this catches local holes and protrusions. Both scenes
 * are sampled into the same metre-space voxel grid after a scale-and-centre
 * registration. The output is directional: red is recovered-only surface and
 * grey is reference-only surface.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";

type Accessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
};
type BufferView = { buffer?: number; byteOffset?: number; byteLength: number; byteStride?: number };
type Primitive = {
  attributes?: { POSITION?: number };
  indices?: number;
  material?: number;
  mode?: number;
};
type GlbMaterial = {
  name?: string;
  alphaMode?: string;
  pbrMetallicRoughness?: { baseColorFactor?: number[] };
};
type Node = {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extensions?: {
    EXT_mesh_gpu_instancing?: {
      attributes?: {
        TRANSLATION?: number;
        ROTATION?: number;
        SCALE?: number;
      };
    };
  };
};
type GlbDocument = {
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Node[];
  meshes?: Array<{ name?: string; primitives?: Primitive[] }>;
  materials?: GlbMaterial[];
  accessors?: Accessor[];
  bufferViews?: BufferView[];
};

type ParsedGlb = { document: GlbDocument; binary: Uint8Array };
type Bounds = { min: [number, number, number]; max: [number, number, number] };
export type Registration = {
  scale: number;
  sourceCenter: [number, number, number];
  referenceCenter: [number, number, number];
};
export type VoxelGrid = {
  cellMetres: number;
  min: [number, number, number];
  size: [number, number, number];
};
export type SurfaceDiff = {
  recoveredVoxels: number;
  referenceVoxels: number;
  recoveredOnly: number[];
  referenceOnly: number[];
  recoveredCoverage: number;
  referenceCoverage: number;
};

type VoxelCollection = {
  readonly size: number;
  has(index: number): boolean;
  [Symbol.iterator](): Iterator<number>;
};

type VoxelAccumulator = { add(index: number): void };

export type SurfaceOrientation =
  | "horizontalUp"
  | "horizontalDown"
  | "vertical"
  | "obliqueUp"
  | "obliqueDown";

export type ResidualDisposition =
  | "retainedNativeGlazingShell"
  | "retainedCertifiedNativeSurface"
  | "retainedClosedStairRun"
  | "review";

export type ResidualVerticalBand =
  | "none"
  | "full-height"
  | "top-edge"
  | "bottom-edge"
  | "interior";

const SURFACE_ORIENTATIONS: readonly SurfaceOrientation[] = [
  "horizontalUp",
  "horizontalDown",
  "vertical",
  "obliqueUp",
  "obliqueDown",
];

const ORIENTATION_MASK: Record<SurfaceOrientation, number> = {
  horizontalUp: 1 << 0,
  horizontalDown: 1 << 1,
  vertical: 1 << 2,
  obliqueUp: 1 << 3,
  obliqueDown: 1 << 4,
};

/** Classify a Y-up GLB triangle by its signed face normal. */
export function surfaceOrientation(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): SurfaceOrientation {
  const normal = new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a));
  const length = normal.length();
  const up = length > 1e-12 ? normal.y / length : 0;
  if (up >= 0.9) return "horizontalUp";
  if (up <= -0.9) return "horizontalDown";
  if (Math.abs(up) <= 0.1) return "vertical";
  return up > 0 ? "obliqueUp" : "obliqueDown";
}

/**
 * Separate detail retained from the native RVT from geometry that still needs
 * review. The visual-reference GLB is optimized and is not an authority for
 * deleting a pane back face or the closure of a solid stair tread.
 */
export function residualDisposition(
  meshLabel: string,
  material?: GlbMaterial,
): ResidualDisposition {
  if (/^Stairs Runs(?:\s|$)/u.test(meshLabel)) return "retainedClosedStairRun";
  const alpha = material?.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1;
  if (
    meshLabel.startsWith("Certified native BRep") &&
    (material?.alphaMode === "BLEND" || alpha < 0.995)
  ) {
    return "retainedNativeGlazingShell";
  }
  if (meshLabel.startsWith("Certified native BRep")) {
    return "retainedCertifiedNativeSurface";
  }
  return "review";
}

class VoxelBitmap implements VoxelCollection {
  readonly bits: Uint8Array;
  size = 0;

  constructor(length: number) {
    this.bits = new Uint8Array(length);
  }

  add(index: number) {
    if (this.bits[index]) return;
    this.bits[index] = 1;
    this.size += 1;
  }

  has(index: number) {
    return this.bits[index] === 1;
  }

  *[Symbol.iterator](): Iterator<number> {
    for (let index = 0; index < this.bits.length; index += 1) {
      if (this.bits[index]) yield index;
    }
  }
}

class SparseVoxelSet implements VoxelCollection {
  readonly indices = new Set<number>();

  get size() {
    return this.indices.size;
  }

  add(index: number) {
    this.indices.add(index);
  }

  has(index: number) {
    return this.indices.has(index);
  }

  [Symbol.iterator](): Iterator<number> {
    return this.indices.values();
  }
}

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};
const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

function parseGlb(bytes: Uint8Array): ParsedGlb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 28 || view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 || view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error("Expected a glTF 2.0 binary GLB.");
  }
  const jsonLength = view.getUint32(12, true);
  const document = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).replace(/[\0\s]+$/u, ""),
  ) as GlbDocument;
  const binaryHeader = 20 + jsonLength;
  if (binaryHeader + 8 > bytes.byteLength || view.getUint32(binaryHeader + 4, true) !== 0x004e4942) {
    throw new Error("GLB has no binary geometry chunk.");
  }
  const binaryLength = view.getUint32(binaryHeader, true);
  return {
    document,
    binary: bytes.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength),
  };
}

function nodeMatrix(node: Node): THREE.Matrix4 {
  if (node.matrix?.length === 16) return new THREE.Matrix4().fromArray(node.matrix);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(node.translation ?? [0, 0, 0]) as [number, number, number]),
    new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1]) as [number, number, number, number]),
    new THREE.Vector3(...(node.scale ?? [1, 1, 1]) as [number, number, number]),
  );
}

/**
 * Decode EXT_mesh_gpu_instancing transforms in glTF's T * R * S order.
 *
 * Autodesk's UNBC GLB stores thousands of repeated doors, frames and fixtures
 * this way. Treating an instancing node as one ordinary mesh silently samples
 * its family definition at the origin and turns every real placement into a
 * false visual residual.
 */
function gpuInstanceMatrices(parsed: ParsedGlb, node: Node): THREE.Matrix4[] {
  const attributes = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
  if (!attributes) return [new THREE.Matrix4()];
  const translation = attributes.TRANSLATION == null
    ? null
    : accessorReader(parsed, attributes.TRANSLATION);
  const rotation = attributes.ROTATION == null
    ? null
    : accessorReader(parsed, attributes.ROTATION);
  const scale = attributes.SCALE == null
    ? null
    : accessorReader(parsed, attributes.SCALE);
  const readers = [translation, rotation, scale].filter(
    (reader): reader is ReturnType<typeof accessorReader> => reader != null,
  );
  if (!readers.length) return [new THREE.Matrix4()];
  const count = readers[0]!.count;
  if (readers.some((reader) => reader.count !== count)) {
    throw new Error("EXT_mesh_gpu_instancing accessors have different counts.");
  }
  if (translation && translation.components < 3) {
    throw new Error("EXT_mesh_gpu_instancing TRANSLATION is not VEC3.");
  }
  if (rotation && rotation.components < 4) {
    throw new Error("EXT_mesh_gpu_instancing ROTATION is not VEC4.");
  }
  if (scale && scale.components < 3) {
    throw new Error("EXT_mesh_gpu_instancing SCALE is not VEC3.");
  }
  return Array.from({ length: count }, (_, index) => {
    const position = translation
      ? new THREE.Vector3(
          translation.value(index, 0),
          translation.value(index, 1),
          translation.value(index, 2),
        )
      : new THREE.Vector3();
    const quaternion = rotation
      ? new THREE.Quaternion(
          rotation.value(index, 0),
          rotation.value(index, 1),
          rotation.value(index, 2),
          rotation.value(index, 3),
        ).normalize()
      : new THREE.Quaternion();
    const instanceScale = scale
      ? new THREE.Vector3(
          scale.value(index, 0),
          scale.value(index, 1),
          scale.value(index, 2),
        )
      : new THREE.Vector3(1, 1, 1);
    return new THREE.Matrix4().compose(position, quaternion, instanceScale);
  });
}

function readComponent(view: DataView, offset: number, type: number): number {
  switch (type) {
    case 5120: return view.getInt8(offset);
    case 5121: return view.getUint8(offset);
    case 5122: return view.getInt16(offset, true);
    case 5123: return view.getUint16(offset, true);
    case 5125: return view.getUint32(offset, true);
    case 5126: return view.getFloat32(offset, true);
    default: throw new Error(`Unsupported accessor component type ${type}.`);
  }
}

function normalizeComponent(value: number, type: number): number {
  switch (type) {
    case 5120: return Math.max(value / 127, -1);
    case 5121: return value / 255;
    case 5122: return Math.max(value / 32_767, -1);
    case 5123: return value / 65_535;
    case 5125: return value / 4_294_967_295;
    default: return value;
  }
}

function accessorReader(parsed: ParsedGlb, index: number) {
  const accessor = parsed.document.accessors?.[index];
  if (!accessor || accessor.bufferView == null) throw new Error(`Missing accessor ${index}.`);
  const bufferView = parsed.document.bufferViews?.[accessor.bufferView];
  if (!bufferView || (bufferView.buffer ?? 0) !== 0) {
    throw new Error(`Accessor ${index} does not use the GLB binary buffer.`);
  }
  const components = TYPE_COMPONENTS[accessor.type];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  if (!components || !componentBytes) throw new Error(`Unsupported accessor ${index}.`);
  const stride = bufferView.byteStride ?? components * componentBytes;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(
    parsed.binary.buffer,
    parsed.binary.byteOffset,
    parsed.binary.byteLength,
  );
  return {
    count: accessor.count,
    components,
    value(item: number, component = 0) {
      const value = readComponent(
        view,
        start + item * stride + component * componentBytes,
        accessor.componentType,
      );
      return accessor.normalized ? normalizeComponent(value, accessor.componentType) : value;
    },
  };
}

function sceneInstances(parsed: ParsedGlb): Array<{
  primitive: Primitive;
  matrix: THREE.Matrix4;
  label: string;
  material?: GlbMaterial;
}> {
  const instances: Array<{
    primitive: Primitive;
    matrix: THREE.Matrix4;
    label: string;
    material?: GlbMaterial;
  }> = [];
  const nodes = parsed.document.nodes ?? [];
  const meshes = parsed.document.meshes ?? [];
  const roots = parsed.document.scenes?.[parsed.document.scene ?? 0]?.nodes ?? [];
  const visit = (nodeIndex: number, parent: THREE.Matrix4, ancestors: Set<number>) => {
    if (ancestors.has(nodeIndex)) throw new Error(`GLB node cycle at ${nodeIndex}.`);
    const node = nodes[nodeIndex];
    if (!node) throw new Error(`Missing GLB node ${nodeIndex}.`);
    const world = parent.clone().multiply(nodeMatrix(node));
    if (node.mesh != null) {
      const mesh = meshes[node.mesh];
      if (!mesh) throw new Error(`Missing GLB mesh ${node.mesh}.`);
      const instanceMatrices = gpuInstanceMatrices(parsed, node);
      const baseLabel = mesh.name ?? node.name ?? `Mesh ${node.mesh + 1}`;
      for (let instance = 0; instance < instanceMatrices.length; instance += 1) {
        const matrix = world.clone().multiply(instanceMatrices[instance]!);
        const label = instanceMatrices.length > 1
          ? `${baseLabel} · instance ${instance + 1}`
          : baseLabel;
        for (const primitive of mesh.primitives ?? []) {
          if ((primitive.mode ?? 4) === 4 && primitive.attributes?.POSITION != null) {
            instances.push({
              primitive,
              matrix,
              label,
              material: primitive.material == null
                ? undefined
                : parsed.document.materials?.[primitive.material],
            });
          }
        }
      }
    }
    const next = new Set(ancestors).add(nodeIndex);
    for (const child of node.children ?? []) visit(child, world, next);
  };
  for (const root of roots) visit(root, new THREE.Matrix4(), new Set());
  return instances;
}

function expand(bounds: Bounds, x: number, y: number, z: number) {
  bounds.min[0] = Math.min(bounds.min[0], x);
  bounds.min[1] = Math.min(bounds.min[1], y);
  bounds.min[2] = Math.min(bounds.min[2], z);
  bounds.max[0] = Math.max(bounds.max[0], x);
  bounds.max[1] = Math.max(bounds.max[1], y);
  bounds.max[2] = Math.max(bounds.max[2], z);
}

function geometryBounds(parsed: ParsedGlb): Bounds {
  const bounds: Bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  const point = new THREE.Vector3();
  for (const { primitive, matrix } of sceneInstances(parsed)) {
    const positions = accessorReader(parsed, primitive.attributes!.POSITION!);
    for (let index = 0; index < positions.count; index += 1) {
      point.set(positions.value(index, 0), positions.value(index, 1), positions.value(index, 2));
      point.applyMatrix4(matrix);
      expand(bounds, point.x, point.y, point.z);
    }
  }
  if (!bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) {
    throw new Error("GLB scene contains no finite triangle positions.");
  }
  return bounds;
}

function center(bounds: Bounds): [number, number, number] {
  return [0, 1, 2].map((axis) => (bounds.min[axis]! + bounds.max[axis]!) / 2) as [number, number, number];
}

function spans(bounds: Bounds): [number, number, number] {
  return [0, 1, 2].map((axis) => bounds.max[axis]! - bounds.min[axis]!) as [number, number, number];
}

export function deriveRegistration(source: Bounds, reference: Bounds): Registration {
  const sourceSpans = spans(source);
  const referenceSpans = spans(reference);
  const ratios = sourceSpans.flatMap((span, axis) =>
    span > 1e-6 && referenceSpans[axis]! > 1e-6 ? [referenceSpans[axis]! / span] : []
  ).sort((a, b) => a - b);
  if (!ratios.length) throw new Error("Cannot register empty scene bounds.");
  const scale = ratios[Math.floor(ratios.length / 2)]!;
  return { scale, sourceCenter: center(source), referenceCenter: center(reference) };
}

function registeredBounds(bounds: Bounds, registration: Registration): Bounds {
  const out: Bounds = { min: [0, 0, 0], max: [0, 0, 0] };
  for (let axis = 0; axis < 3; axis += 1) {
    out.min[axis] = (bounds.min[axis]! - registration.sourceCenter[axis]!) * registration.scale +
      registration.referenceCenter[axis]!;
    out.max[axis] = (bounds.max[axis]! - registration.sourceCenter[axis]!) * registration.scale +
      registration.referenceCenter[axis]!;
  }
  return out;
}

export function makeVoxelGrid(bounds: Bounds, cellMetres: number): VoxelGrid {
  const min = bounds.min.map((value) => Math.floor(value / cellMetres) * cellMetres - cellMetres) as
    [number, number, number];
  const size = [0, 1, 2].map((axis) =>
    Math.ceil((bounds.max[axis]! - min[axis]!) / cellMetres) + 2
  ) as [number, number, number];
  return { cellMetres, min, size };
}

function voxelIndex(grid: VoxelGrid, x: number, y: number, z: number): number {
  const ix = Math.floor((x - grid.min[0]) / grid.cellMetres);
  const iy = Math.floor((y - grid.min[1]) / grid.cellMetres);
  const iz = Math.floor((z - grid.min[2]) / grid.cellMetres);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= grid.size[0] || iy >= grid.size[1] || iz >= grid.size[2]) {
    return -1;
  }
  return ix + grid.size[0] * (iy + grid.size[1] * iz);
}

export function voxelCenter(grid: VoxelGrid, index: number): [number, number, number] {
  const ix = index % grid.size[0];
  const yz = Math.floor(index / grid.size[0]);
  const iy = yz % grid.size[1];
  const iz = Math.floor(yz / grid.size[1]);
  return [
    grid.min[0] + (ix + 0.5) * grid.cellMetres,
    grid.min[1] + (iy + 0.5) * grid.cellMetres,
    grid.min[2] + (iz + 0.5) * grid.cellMetres,
  ];
}

function transformPosition(
  target: THREE.Vector3,
  registration: Registration,
) {
  target.set(
    (target.x - registration.sourceCenter[0]) * registration.scale + registration.referenceCenter[0],
    (target.y - registration.sourceCenter[1]) * registration.scale + registration.referenceCenter[1],
    (target.z - registration.sourceCenter[2]) * registration.scale + registration.referenceCenter[2],
  );
}

function addTriangleSamples(
  voxels: VoxelAccumulator,
  grid: VoxelGrid,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  spacing: number,
  orientationBits?: Uint8Array,
  orientationMask = 0,
) {
  const divisions = Math.min(512, Math.max(1, Math.ceil(Math.max(
    a.distanceTo(b), b.distanceTo(c), c.distanceTo(a),
  ) / spacing)));
  for (let row = 0; row <= divisions; row += 1) {
    for (let column = 0; column <= divisions - row; column += 1) {
      const u = row / divisions;
      const v = column / divisions;
      const w = 1 - u - v;
      const index = voxelIndex(
        grid,
        a.x * w + b.x * u + c.x * v,
        a.y * w + b.y * u + c.y * v,
        a.z * w + b.z * u + c.z * v,
      );
      if (index >= 0) {
        voxels.add(index);
        if (orientationBits) orientationBits[index] |= orientationMask;
      }
    }
  }
}

function samplePrimitive(
  parsed: ParsedGlb,
  primitive: Primitive,
  matrix: THREE.Matrix4,
  registration: Registration,
  grid: VoxelGrid,
  voxels: VoxelAccumulator,
  orientationBits?: Uint8Array,
) {
  const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
  const positions = accessorReader(parsed, primitive.attributes!.POSITION!);
  const indices = primitive.indices == null ? null : accessorReader(parsed, primitive.indices);
  const count = indices?.count ?? positions.count;
  for (let triangle = 0; triangle + 2 < count; triangle += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      const index = indices ? indices.value(triangle + corner) : triangle + corner;
      vertices[corner].set(
        positions.value(index, 0),
        positions.value(index, 1),
        positions.value(index, 2),
      ).applyMatrix4(matrix);
      transformPosition(vertices[corner], registration);
    }
    const orientation = surfaceOrientation(vertices[0], vertices[1], vertices[2]);
    addTriangleSamples(
      voxels,
      grid,
      vertices[0],
      vertices[1],
      vertices[2],
      grid.cellMetres * 0.72,
      orientationBits,
      ORIENTATION_MASK[orientation],
    );
  }
}

function sampleScene(
  parsed: ParsedGlb,
  registration: Registration,
  grid: VoxelGrid,
): VoxelBitmap {
  const voxels = new VoxelBitmap(grid.size[0] * grid.size[1] * grid.size[2]);
  for (const { primitive, matrix } of sceneInstances(parsed)) {
    samplePrimitive(parsed, primitive, matrix, registration, grid, voxels);
  }
  return voxels;
}

function hasNeighbour(voxels: VoxelCollection, grid: VoxelGrid, index: number): boolean {
  const ix = index % grid.size[0];
  const yz = Math.floor(index / grid.size[0]);
  const iy = yz % grid.size[1];
  const iz = Math.floor(yz / grid.size[1]);
  for (let dz = -1; dz <= 1; dz += 1) {
    if (iz + dz < 0 || iz + dz >= grid.size[2]) continue;
    for (let dy = -1; dy <= 1; dy += 1) {
      if (iy + dy < 0 || iy + dy >= grid.size[1]) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        if (ix + dx < 0 || ix + dx >= grid.size[0]) continue;
        const neighbour = ix + dx + grid.size[0] * (iy + dy + grid.size[1] * (iz + dz));
        if (voxels.has(neighbour)) return true;
      }
    }
  }
  return false;
}

export function compareVoxels(
  recovered: VoxelCollection,
  reference: VoxelCollection,
  grid: VoxelGrid,
): SurfaceDiff {
  const recoveredOnly = [...recovered].filter((index) => !hasNeighbour(reference, grid, index));
  const referenceOnly = [...reference].filter((index) => !hasNeighbour(recovered, grid, index));
  return {
    recoveredVoxels: recovered.size,
    referenceVoxels: reference.size,
    recoveredOnly,
    referenceOnly,
    recoveredCoverage: recovered.size ? 1 - recoveredOnly.length / recovered.size : 1,
    referenceCoverage: reference.size ? 1 - referenceOnly.length / reference.size : 1,
  };
}

function regions(indices: readonly number[], grid: VoxelGrid, regionMetres = 10) {
  const counts = new Map<string, number>();
  for (const index of indices) {
    const [x, y, z] = voxelCenter(grid, index);
    const key = `${Math.floor(x / regionMetres)},${Math.floor(y / regionMetres)},${Math.floor(z / regionMetres)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, voxels]) => {
    const [x, y, z] = key.split(",").map(Number);
    return {
      minMetres: [x! * regionMetres, y! * regionMetres, z! * regionMetres],
      maxMetres: [(x! + 1) * regionMetres, (y! + 1) * regionMetres, (z! + 1) * regionMetres],
      voxels,
    };
  }).sort((left, right) => right.voxels - left.voxels).slice(0, 20);
}

function recoveredResidualsByMesh(
  parsed: ParsedGlb,
  registration: Registration,
  grid: VoxelGrid,
  reference: VoxelCollection,
) {
  const length = grid.size[0] * grid.size[1] * grid.size[2];
  const dispositionBits = new Uint8Array(length);
  const dispositionMask: Record<ResidualDisposition, number> = {
    retainedNativeGlazingShell: 1 << 0,
    retainedCertifiedNativeSurface: 1 << 1,
    retainedClosedStairRun: 1 << 2,
    review: 1 << 3,
  };
  const meshes = sceneInstances(parsed).map(({ primitive, matrix, label, material }) => {
    const voxels = new VoxelBitmap(length);
    const orientationBits = new Uint8Array(length);
    samplePrimitive(parsed, primitive, matrix, registration, grid, voxels, orientationBits);
    const disposition = residualDisposition(label, material);
    let recoveredOnly = 0;
    const recoveredOnlyIndices: number[] = [];
    const sampledBounds: Bounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    const residualBounds: Bounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    const byOrientation = Object.fromEntries(SURFACE_ORIENTATIONS.map((orientation) => [
      orientation,
      { voxels: 0, recoveredOnly: 0 },
    ])) as Record<SurfaceOrientation, { voxels: number; recoveredOnly: number }>;
    for (const index of voxels) {
      const [x, y, z] = voxelCenter(grid, index);
      expand(sampledBounds, x, y, z);
      const isRecoveredOnly = !hasNeighbour(reference, grid, index);
      if (isRecoveredOnly) {
        recoveredOnly += 1;
        recoveredOnlyIndices.push(index);
        expand(residualBounds, x, y, z);
        dispositionBits[index] |= dispositionMask[disposition];
      }
      const bits = orientationBits[index]!;
      for (const orientation of SURFACE_ORIENTATIONS) {
        if ((bits & ORIENTATION_MASK[orientation]) === 0) continue;
        byOrientation[orientation].voxels += 1;
        if (isRecoveredOnly) byOrientation[orientation].recoveredOnly += 1;
      }
    }
    return {
      mesh: label,
      voxels: voxels.size,
      recoveredOnly,
      recoveredOnlyShare: voxels.size ? recoveredOnly / voxels.size : 0,
      boundsMetres: voxels.size ? sampledBounds : null,
      recoveredOnlyBoundsMetres: recoveredOnly ? residualBounds : null,
      recoveredOnlyVerticalBand: residualVerticalBand(
        voxels.size ? sampledBounds : null,
        recoveredOnly ? residualBounds : null,
        grid.cellMetres,
      ),
      recoveredOnlyRegions: regions(recoveredOnlyIndices, grid, 2),
      disposition,
      recoveredOnlyByOrientation: byOrientation,
    };
  }).sort((left, right) => right.recoveredOnly - left.recoveredOnly);
  const summary = {
    retainedNativeGlazingShell: 0,
    retainedCertifiedNativeSurface: 0,
    retainedClosedStairRun: 0,
    mixedRetainedDetail: 0,
    review: 0,
  };
  const reviewRecoveredOnlyIndices: number[] = [];
  for (let index = 0; index < dispositionBits.length; index += 1) {
    const bits = dispositionBits[index]!;
    if (!bits) continue;
    if (bits & dispositionMask.review) {
      summary.review += 1;
      reviewRecoveredOnlyIndices.push(index);
    } else if ([
      dispositionMask.retainedNativeGlazingShell,
      dispositionMask.retainedCertifiedNativeSurface,
      dispositionMask.retainedClosedStairRun,
    ].filter((mask) => bits & mask).length > 1) {
      summary.mixedRetainedDetail += 1;
    } else if (bits & dispositionMask.retainedNativeGlazingShell) {
      summary.retainedNativeGlazingShell += 1;
    } else if (bits & dispositionMask.retainedCertifiedNativeSurface) {
      summary.retainedCertifiedNativeSurface += 1;
    } else if (bits & dispositionMask.retainedClosedStairRun) {
      summary.retainedClosedStairRun += 1;
    }
  }
  return { meshes, summary, reviewRecoveredOnlyIndices };
}

function referenceResidualsByMesh(
  parsed: ParsedGlb,
  registration: Registration,
  grid: VoxelGrid,
  recovered: VoxelCollection,
) {
  return sceneInstances(parsed).map(({ primitive, matrix, label, material }) => {
    const voxels = new SparseVoxelSet();
    samplePrimitive(parsed, primitive, matrix, registration, grid, voxels);
    let referenceOnly = 0;
    const sampledBounds: Bounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    const bounds: Bounds = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
    };
    for (const index of voxels) {
      const [x, y, z] = voxelCenter(grid, index);
      expand(sampledBounds, x, y, z);
      const isReferenceOnly = !hasNeighbour(recovered, grid, index);
      if (isReferenceOnly) {
        referenceOnly += 1;
        expand(bounds, x, y, z);
      }
    }
    return {
      mesh: label,
      material: material?.name ?? null,
      baseColorFactor: material?.pbrMetallicRoughness?.baseColorFactor ?? null,
      voxels: voxels.size,
      boundsMetres: voxels.size ? sampledBounds : null,
      referenceOnly,
      referenceOnlyShare: voxels.size ? referenceOnly / voxels.size : 0,
      referenceOnlyBoundsMetres: referenceOnly ? bounds : null,
      referenceOnlyVerticalBand: residualVerticalBand(
        voxels.size ? sampledBounds : null,
        referenceOnly ? bounds : null,
        grid.cellMetres,
      ),
    };
  }).sort((left, right) => right.referenceOnly - left.referenceOnly);
}

/**
 * Describe where a reference-only residual sits in a Y-up mesh. This prevents
 * an interior opening/join residual from being reported as a missing roof or
 * parapet merely because it appears near a silhouette in one camera view.
 */
export function residualVerticalBand(
  meshBounds: Bounds | null,
  residualBounds: Bounds | null,
  toleranceMetres = 0,
): ResidualVerticalBand {
  if (!meshBounds || !residualBounds) return "none";
  const touchesBottom = residualBounds.min[1] <= meshBounds.min[1] + toleranceMetres;
  const touchesTop = residualBounds.max[1] >= meshBounds.max[1] - toleranceMetres;
  if (touchesBottom && touchesTop) return "full-height";
  if (touchesTop) return "top-edge";
  if (touchesBottom) return "bottom-edge";
  return "interior";
}

export function renderDiffSvg(diff: SurfaceDiff, grid: VoxelGrid): string {
  const width = 1400;
  const height = 900;
  const pad = 30;
  const project = ([x, y, z]: [number, number, number]): [number, number, number] => [x - z, (x + z) * 0.45 - y * 1.8, x + z + y];
  const MAX_VISUAL_POINTS_PER_SIDE = 80_000;
  const thin = (indices: readonly number[]) => {
    const step = Math.max(1, Math.ceil(indices.length / MAX_VISUAL_POINTS_PER_SIDE));
    return indices.filter((_, index) => index % step === 0);
  };
  const all = [
    ...thin(diff.referenceOnly).map((index) => ({ index, kind: "reference" as const })),
    ...thin(diff.recoveredOnly).map((index) => ({ index, kind: "recovered" as const })),
  ];
  const projected = all.map((entry) => ({ ...entry, point: project(voxelCenter(grid, entry.index)) }));
  let minX = -1, maxX = 1, minY = -1, maxY = 1;
  for (const { point } of projected) {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  const scale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2 - 46) / (maxY - minY));
  const paths = (kind: "reference" | "recovered") => projected
    .filter((entry) => entry.kind === kind)
    .sort((left, right) => left.point[2] - right.point[2])
    .map(({ point }) => {
      const x = pad + (point[0] - minX) * scale;
      const y = 46 + pad + (point[1] - minY) * scale;
      const r = kind === "recovered" ? 1.2 : 0.9;
      return `M${(x - r).toFixed(1)} ${(y - r).toFixed(1)}h${(r * 2).toFixed(1)}v${(r * 2).toFixed(1)}h-${(r * 2).toFixed(1)}Z`;
    }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#f7f6f3"/>
<text x="30" y="31" font-family="ui-sans-serif,system-ui" font-size="18" font-weight="650" fill="#1d252b">Recovered RVT / Autodesk GLB surface difference</text>
<path d="${paths("reference")}" fill="#8b9298" fill-opacity="0.65"/>
<path d="${paths("recovered")}" fill="#d62929" fill-opacity="0.84"/>
<g font-family="ui-sans-serif,system-ui" font-size="13" fill="#354047"><rect x="1040" y="17" width="12" height="12" fill="#d62929"/><text x="1059" y="28">RVT-only surface</text><rect x="1210" y="17" width="12" height="12" fill="#8b9298"/><text x="1229" y="28">GLB-only surface</text></g>
</svg>\n`;
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    min: [0, 1, 2].map((axis) => Math.min(a.min[axis]!, b.min[axis]!)) as [number, number, number],
    max: [0, 1, 2].map((axis) => Math.max(a.max[axis]!, b.max[axis]!)) as [number, number, number],
  };
}

export function compareGlbs(recoveredBytes: Uint8Array, referenceBytes: Uint8Array, cellMetres = 0.5) {
  const recovered = parseGlb(recoveredBytes);
  const reference = parseGlb(referenceBytes);
  const recoveredBounds = geometryBounds(recovered);
  const referenceBounds = geometryBounds(reference);
  const registration = deriveRegistration(recoveredBounds, referenceBounds);
  const alignedRecoveredBounds = registeredBounds(recoveredBounds, registration);
  const grid = makeVoxelGrid(unionBounds(alignedRecoveredBounds, referenceBounds), cellMetres);
  const recoveredVoxels = sampleScene(recovered, registration, grid);
  const identity: Registration = {
    scale: 1,
    sourceCenter: center(referenceBounds),
    referenceCenter: center(referenceBounds),
  };
  const referenceVoxels = sampleScene(reference, identity, grid);
  const diff = compareVoxels(recoveredVoxels, referenceVoxels, grid);
  const recoveredResiduals = recoveredResidualsByMesh(
    recovered,
    registration,
    grid,
    referenceVoxels,
  );
  const referenceResiduals = referenceResidualsByMesh(
    reference,
    identity,
    grid,
    recoveredVoxels,
  );
  return {
    schemaVersion: 1,
    generatedBy: "scripts/glb-surface-diff.ts",
    cellMetres,
    neighbourToleranceMetres: cellMetres * Math.sqrt(3),
    registration,
    recoveredBounds,
    alignedRecoveredBounds,
    referenceBounds,
    diff,
    regions: {
      recoveredOnly: regions(diff.recoveredOnly, grid),
      referenceOnly: regions(diff.referenceOnly, grid),
    },
    residualClassification: {
      ...recoveredResiduals.summary,
      meaning: {
        retainedNativeGlazingShell:
          "Native transparent pane thickness/back/edge surfaces absent from the optimized visual-reference GLB; retained.",
        retainedCertifiedNativeSurface:
          "Certified native RVT BRep surface absent from the optimized visual-reference GLB; retained unless paired IFC evidence contradicts it.",
        retainedClosedStairRun:
          "Closed tread/riser surfaces reconstructed from native StairsRun evidence but simplified by the visual-reference GLB; retained.",
        review:
          "Recovered-only surface not explained by the conservative retained-evidence rules.",
      },
    },
    recoveredOnlyByMesh: recoveredResiduals.meshes,
    referenceOnlyByMesh: referenceResiduals,
    reviewRecoveredOnlyIndices: recoveredResiduals.reviewRecoveredOnlyIndices,
    grid,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const positional = args.filter((argument, index) =>
    !argument.startsWith("--") &&
    !["--json", "--svg", "--actionable-svg", "--cell"].includes(args[index - 1] ?? "")
  );
  const [recoveredPath, referencePath] = positional;
  const jsonIndex = args.indexOf("--json");
  const svgIndex = args.indexOf("--svg");
  const actionableSvgIndex = args.indexOf("--actionable-svg");
  const cellIndex = args.indexOf("--cell");
  if (!recoveredPath || !referencePath) {
    throw new Error("usage: glb-surface-diff.ts recovered.glb reference.glb [--cell 0.5] [--json report.json] [--svg diff.svg] [--actionable-svg review.svg]");
  }
  const cellMetres = cellIndex >= 0 ? Number(args[cellIndex + 1]) : 0.5;
  if (!Number.isFinite(cellMetres) || cellMetres <= 0) throw new Error("--cell must be positive.");
  const report = compareGlbs(readFileSync(recoveredPath), readFileSync(referencePath), cellMetres);
  const { reviewRecoveredOnlyIndices, ...serializableReport } = report;
  const json = `${JSON.stringify({ ...serializableReport, diff: {
    ...report.diff,
    recoveredOnly: report.diff.recoveredOnly.length,
    referenceOnly: report.diff.referenceOnly.length,
  }, reviewResidual: {
    recoveredOnly: reviewRecoveredOnlyIndices.length,
    recoveredCoverage: report.diff.recoveredVoxels
      ? 1 - reviewRecoveredOnlyIndices.length / report.diff.recoveredVoxels
      : 1,
  }, grid: { ...report.grid, occupiedIndicesOmitted: true } }, null, 2)}\n`;
  if (jsonIndex >= 0 && args[jsonIndex + 1]) writeFileSync(args[jsonIndex + 1]!, json);
  if (svgIndex >= 0 && args[svgIndex + 1]) writeFileSync(args[svgIndex + 1]!, renderDiffSvg(report.diff, report.grid));
  if (actionableSvgIndex >= 0 && args[actionableSvgIndex + 1]) {
    writeFileSync(args[actionableSvgIndex + 1]!, renderDiffSvg({
      ...report.diff,
      recoveredOnly: reviewRecoveredOnlyIndices,
      recoveredCoverage: report.diff.recoveredVoxels
        ? 1 - reviewRecoveredOnlyIndices.length / report.diff.recoveredVoxels
        : 1,
    }, report.grid).replace(
      "Recovered RVT / Autodesk GLB surface difference",
      "Recovered RVT / Autodesk GLB review residual",
    ));
  }
  console.log(json.trimEnd());
}
