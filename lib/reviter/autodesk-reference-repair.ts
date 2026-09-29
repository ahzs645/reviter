/** Explicit, element-scoped repair from a registered Autodesk GLB. RVT decoding stays independent. */
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import type { ConvertResult, ElementBoundsRecord, MeshData } from './types.ts';
import { meshBoundsByElement } from './mesh-element-bounds.ts';

export type ReferenceRegistration = {
  scale: number;
  sourceCenter: [number, number, number];
  referenceCenter: [number, number, number];
};

export function repairFromAutodesk(
  result: ConvertResult,
  bytes: Uint8Array,
  externalIds: readonly unknown[],
  elementIds: readonly number[],
  registration: ReferenceRegistration,
): ConvertResult {
  const ids = new Set(elementIds);
  if (!ids.size || [...ids].some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error('Explicit positive element IDs required');
  if (!(registration.scale > 0) || !Number.isFinite(registration.scale) ||
    [registration.sourceCenter, registration.referenceCenter].some(v => v.length !== 3 || !v.every(Number.isFinite))) throw Error('Invalid reference registration');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) throw Error('Invalid GLB');
  const jsonLength = view.getUint32(12, true);
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binaryStart = 28 + jsonLength;
  if (view.getUint32(24 + jsonLength, true) !== 0x004e4942) throw Error('Embedded GLB buffer required');
  const read = (id: number, components: number) => {
    const a = doc.accessors[id], b = doc.bufferViews[a?.bufferView];
    if (!a || !b || a.sparse || a.normalized || (b.buffer ?? 0) !== 0 || a.type !== (components === 3 ? 'VEC3' : 'SCALAR')) throw Error('Unsupported reference accessor');
    const size = ({5126:4,5125:4,5123:2,5121:1} as Record<number,number>)[a.componentType];
    if (!size) throw Error('Unsupported reference component type');
    const start = binaryStart + (b.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = b.byteStride ?? size * components;
    const values: number[] = [];
    for (let i = 0; i < a.count; i++) for (let j = 0; j < components; j++) {
      const at = start + i * stride + j * size;
      if (at + size > binaryStart + (b.byteOffset ?? 0) + b.byteLength) throw Error('Accessor exceeds buffer view');
      const value = a.componentType === 5126 ? view.getFloat32(at,true) : a.componentType === 5125 ? view.getUint32(at,true) : a.componentType === 5123 ? view.getUint16(at,true) : view.getUint8(at);
      if (!Number.isFinite(value)) throw Error('Nonfinite reference geometry');
      values.push(value);
    }
    return values;
  };
  const materialOffset = result.materials.length;
  const referenceMaterials = [...(doc.materials ?? [])];
  const defaultMaterial = referenceMaterials.length;
  referenceMaterials.push({name:'glTF default'});
  const materials = [...result.materials, ...referenceMaterials.map((m: any, i: number) => ({
    name: `Autodesk reference ${m.name ?? i}`,
    baseColorLinear: m.pbrMetallicRoughness?.baseColorFactor ?? [1,1,1,1],
    metallic: m.pbrMetallicRoughness?.metallicFactor ?? 1,
    roughness: m.pbrMetallicRoughness?.roughnessFactor ?? 1,
    doubleSided: m.doubleSided === true,
    source: 'display-fallback' as const,
    assignedElements: 0,
  }))];
  const repaired: MeshData[] = [];
  const found = new Set<number>();
  const active = new Set<number>();
  function visit(index: number, parent: Matrix4) {
    if (active.has(index)) throw Error('Cyclic reference scene');
    active.add(index);
    const node = doc.nodes[index];
    if (!node) throw Error('Missing reference node');
    const local = new Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else {
      local.makeRotationFromQuaternion(new Quaternion(...(node.rotation ?? [0,0,0,1]) as [number,number,number,number]));
      local.scale(new Vector3(...(node.scale ?? [1,1,1]) as [number,number,number]));
      local.setPosition(...(node.translation ?? [0,0,0]) as [number,number,number]);
    }
    const world = parent.clone().multiply(local);
    const external = externalIds[node.extras?.autodeskDbId];
    const suffix = typeof external === 'string' ? external.split('-').at(-1)! : '';
    const id = /^[\da-f]+$/i.test(suffix) ? Number.parseInt(suffix,16) : 0;
    if (node.mesh != null && ids.has(id)) {
      if (node.extensions?.EXT_mesh_gpu_instancing) throw Error('Instanced reference requires explicit expansion');
      for (const primitive of doc.meshes[node.mesh].primitives) {
        if ((primitive.mode ?? 4) !== 4) continue;
        const raw = read(primitive.attributes.POSITION,3);
        const indices = primitive.indices == null ? raw.map((_: number,i: number)=>i).slice(0,raw.length/3) : read(primitive.indices,1);
        if (indices.length % 3 || indices.some((i: number)=>!Number.isInteger(i) || i<0 || i>=raw.length/3)) throw Error('Invalid reference indices');
        const positions = new Float32Array(raw.length);
        const rawNormals = primitive.attributes.NORMAL == null ? null : read(primitive.attributes.NORMAL,3);
        if (rawNormals && rawNormals.length !== raw.length) throw Error('Reference normal count differs from positions');
        const normals = rawNormals ? new Float32Array(raw.length) : undefined;
        const normalMatrix = new Matrix3().getNormalMatrix(world);
        for (let i = 0; i < raw.length; i += 3) {
          const p = new Vector3(raw[i],raw[i+1],raw[i+2]).applyMatrix4(world);
          p.sub(new Vector3(...registration.referenceCenter)).divideScalar(registration.scale).add(new Vector3(...registration.sourceCenter));
          if (![p.x,p.y,p.z].every(Number.isFinite)) throw Error('Nonfinite transformed reference');
          positions.set([p.x,-p.z,p.y],i);
          if (normals && rawNormals) {
            const n = new Vector3(rawNormals[i],rawNormals[i+1],rawNormals[i+2]).applyMatrix3(normalMatrix).normalize();
            normals.set([n.x,-n.z,n.y],i);
          }
        }
        if (world.determinant() < 0) for (let i=0;i<indices.length;i+=3) [indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
        if (!indices.length) continue;
        const referenceMaterial = primitive.material ?? defaultMaterial;
        if (!Number.isInteger(referenceMaterial) || referenceMaterial < 0 || referenceMaterial >= referenceMaterials.length) throw Error('Invalid reference material');
        repaired.push({ name:`Autodesk repair ${id}`, positions, normals, indices:Uint32Array.from(indices), colors:new Float32Array(positions.length).fill(1), elementIds:new Uint32Array(indices.length/3).fill(id), materialIndex:materialOffset+referenceMaterial, source:'reference-autodesk' });
        found.add(id);
      }
    }
    for (const child of node.children ?? []) visit(child,world);
    active.delete(index);
  }
  for (const root of doc.scenes[doc.scene ?? 0].nodes) visit(root,new Matrix4());
  const absent = [...ids].filter(id=>!found.has(id));
  if (absent.length) throw Error(`Requested elements absent from reference: ${absent.join(',')}`);
  const retained = result.meshes.flatMap(mesh => {
    if (!mesh.elementIds) return [mesh];
    if (mesh.elementIds.length * 3 !== mesh.indices.length) throw Error('Invalid source ownership');
    const indices: number[] = [], owners: number[] = [];
    for (let t=0;t<mesh.elementIds.length;t++) if (!ids.has(mesh.elementIds[t]!)) {
      indices.push(mesh.indices[t*3]!,mesh.indices[t*3+1]!,mesh.indices[t*3+2]!); owners.push(mesh.elementIds[t]!);
    }
    return indices.length ? [{...mesh,indices:Uint32Array.from(indices),elementIds:Uint32Array.from(owners)}] : [];
  });
  const meshes = [...retained,...repaired];
  const known = new Set(result.elementBounds.map(record => record.elementId));
  const restoredRecords: ElementBoundsRecord[] = [];
  for (const [id, b] of meshBoundsByElement(repaired, result.origin)) {
    if (known.has(id)) continue;
    // Restoring an absent roof must restore its manifest identity as well.
    // These bounds came from the reference, not from an RVT envelope.
    restoredRecords.push({elementId:id,stream:'Autodesk reference',chunkIndex:0,rawOffset:0,recordOffset:0,
      boundsFeet:{min:{x:b[0],y:b[1],z:b[2]},max:{x:b[3],y:b[4],z:b[5]}},
      boundsFromReferenceMesh:true,renderGeometryProvenance:'reference-assisted'});
  }
  return { ...result, materials, meshes,
    elementBounds: [...result.elementBounds.map(record=> ids.has(record.elementId) ? {...record,renderGeometryProvenance:'reference-assisted' as const} : record), ...restoredRecords],
    referenceAssistedElementIds: Uint32Array.from(new Set([...(result.referenceAssistedElementIds ?? []),...ids])),
    stats: {...result.stats,triangleCount:meshes.reduce((n,m)=>n+m.indices.length/3,0)},
    warnings: [...result.warnings,`${ids.size} elements replaced from the registered Autodesk reference; geometry is reference-assisted, not native RVT recovery.`],
  };
}
