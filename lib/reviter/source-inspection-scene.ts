import type { ConvertResult, MeshData } from "./types.ts";

/** Restore only exact serialized render values. This creates a display copy;
 * the original model, physical bodies and source arrays are never edited. */
function buffer<T extends Float32Array | Uint32Array>(
  value: unknown, create: (values: number[]) => T, label: string,
): T {
  if (!value || typeof value !== "object") throw Error(`Missing ${label}`);
  const keys = Object.keys(value);
  const values = keys.map((key, i) => {
    if (key !== String(i)) throw Error(`Noncontiguous ${label}`);
    const number = (value as Record<string, unknown>)[key];
    if (typeof number !== "number" || !Number.isFinite(number)) throw Error(`Invalid ${label}`);
    return number;
  });
  const result = create(values);
  if (!values.every((number, i) => Object.is(number, result[i])))
    throw Error(`Lossy ${label} restoration`);
  return result;
}

export function sourceInspectionScene(model: ConvertResult) {
  if (!model || !Array.isArray(model.meshes) || !Array.isArray(model.materials) ||
      !model.materials.length || !model.origin ||
      ![model.origin.x, model.origin.y, model.origin.z].every(Number.isFinite))
    throw Error("A complete recovered model with original materials/origin is required");
  let vertices = 0, triangles = 0, nonemptyMeshes = 0;
  const meshes = model.meshes.map((mesh): MeshData => {
    const positions = buffer(mesh.positions, values => Float32Array.from(values), `${mesh.name} positions`);
    const indices = buffer(mesh.indices, values => Uint32Array.from(values), `${mesh.name} indices`);
    if (positions.length % 3 || indices.length % 3 ||
        indices.some(index => index >= positions.length / 3) ||
        (!positions.length && indices.length) || (positions.length && !indices.length))
      throw Error(`Invalid triangle topology in ${mesh.name}`);
    if (positions.length) {
      vertices += positions.length / 3;
      triangles += indices.length / 3;
      nonemptyMeshes++;
    }
    return { ...mesh, positions, indices };
  });
  if (!nonemptyMeshes || !vertices || !triangles)
    throw Error("Refuse empty/incomplete scene export");
  return { model: { ...model, meshes }, vertices, triangles, nonemptyMeshes,
    losslessMeshArrayRepackingVerified: true as const };
}
