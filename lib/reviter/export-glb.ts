/** glTF 2.0 binary export of the recovered scene. */
import type { ConvertResult } from "./types.ts";

function vectorExtents(values: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < values.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = values[index + axis]!;
      min[axis] = Math.min(min[axis]!, value);
      max[axis] = Math.max(max[axis]!, value);
    }
  }
  return { min, max };
}

function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let index = 0; index < indices.length; index += 3) {
    const ia = indices[index]! * 3;
    const ib = indices[index + 1]! * 3;
    const ic = indices[index + 2]! * 3;
    const abx = positions[ib]! - positions[ia]!;
    const aby = positions[ib + 1]! - positions[ia + 1]!;
    const abz = positions[ib + 2]! - positions[ia + 2]!;
    const acx = positions[ic]! - positions[ia]!;
    const acy = positions[ic + 1]! - positions[ia + 1]!;
    const acz = positions[ic + 2]! - positions[ia + 2]!;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const vertex of [ia, ib, ic]) {
      normals[vertex] += nx;
      normals[vertex + 1] += ny;
      normals[vertex + 2] += nz;
    }
  }
  for (let index = 0; index < normals.length; index += 3) {
    const length = Math.hypot(normals[index]!, normals[index + 1]!, normals[index + 2]!) || 1;
    normals[index] /= length;
    normals[index + 1] /= length;
    normals[index + 2] /= length;
  }
  return normals;
}

export function makeGlb(result: ConvertResult): ArrayBuffer {
  const binaryParts: Uint8Array[] = [];
  const bufferViews: Array<Record<string, number>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const meshes: Array<Record<string, unknown>> = [];
  const nodes: Array<Record<string, unknown>> = [];
  let binaryLength = 0;

  const addView = (array: Float32Array | Uint32Array, target: number): number => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const index = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binaryLength, byteLength: bytes.byteLength, target });
    binaryParts.push(bytes);
    binaryLength += bytes.byteLength;
    return index;
  };

  for (const mesh of result.meshes) {
    if (!mesh.positions.length || !mesh.indices.length) continue;
    const positionView = addView(mesh.positions, 34_962);
    const normalView = addView(vertexNormals(mesh.positions, mesh.indices), 34_962);
    const indexView = addView(mesh.indices, 34_963);
    const extents = vectorExtents(mesh.positions);
    const positionAccessor = accessors.push({
      bufferView: positionView,
      componentType: 5_126,
      count: mesh.positions.length / 3,
      type: "VEC3",
      min: extents.min,
      max: extents.max,
    }) - 1;
    const indexAccessor = accessors.push({
      bufferView: indexView,
      componentType: 5_125,
      count: mesh.indices.length,
      type: "SCALAR",
    }) - 1;
    const normalAccessor = accessors.push({
      bufferView: normalView,
      componentType: 5_126,
      count: mesh.positions.length / 3,
      type: "VEC3",
    }) - 1;
    const meshIndex = meshes.push({
      name: mesh.name,
      primitives: [{
        attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
        indices: indexAccessor,
        material: Math.min(mesh.materialIndex, Math.max(0, result.materials.length - 1)),
        ...(mesh.nativeMaterialElementId == null
          ? {}
          : {
              extras: {
                revitMaterialElementId: mesh.nativeMaterialElementId,
                evidence: "persisted-face-material",
              },
            }),
      }],
    }) - 1;
    nodes.push({ name: mesh.name, mesh: meshIndex });
  }
  const meshNodes = nodes.map((_, index) => index);
  const rootNode = nodes.push({
    name: "Revit Z-up to glTF Y-up",
    rotation: [-0.7071067811865476, 0, 0, 0.7071067811865476],
    children: meshNodes,
  }) - 1;

  const binary = new Uint8Array(binaryLength);
  let binaryOffset = 0;
  for (const part of binaryParts) {
    binary.set(part, binaryOffset);
    binaryOffset += part.byteLength;
  }
  const document = {
    asset: { version: "2.0", generator: "Reviter client-only RVT converter" },
    scene: 0,
    scenes: [{ name: result.fileName, nodes: [rootNode] }],
    nodes,
    meshes,
    materials: result.materials.map((material) => ({
      name: material.name,
      pbrMetallicRoughness: {
        baseColorFactor: material.baseColorLinear,
        metallicFactor: material.metallic,
        roughnessFactor: material.roughness,
      },
      doubleSided: material.doubleSided,
      ...(material.baseColorLinear[3] < 1 ? { alphaMode: "BLEND" } : {}),
      extras: {
        source: material.source,
        assignedElements: material.assignedElements,
      },
    })),
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews,
    accessors,
    extras: {
      sourceFile: result.fileName,
      method: result.method,
      originFeet: result.origin,
      sourceUpAxis: "Z",
      gltfUpAxis: "Y",
      warnings: result.warnings,
      decoderCoverage: result.decoderCoverage,
    },
  };
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const binLength = Math.ceil(binary.byteLength / 4) * 4;
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(json, 20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, binLength, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  output.set(binary, binHeader + 8);
  return output.buffer;
}
