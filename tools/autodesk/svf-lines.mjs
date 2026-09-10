// SVF Lines entries store strips separated by an array of index offsets. glTF
// LINES requires independent endpoint pairs, including every edge in each strip.
export function expandPolylineIndices(indices, bounds) {
  if (!bounds.length) {
    if (indices.length % 2) throw new Error('Unbounded SVF line list has an odd index count');
    return indices;
  }
  if (bounds.length < 2 || bounds[0] !== 0 || bounds.at(-1) !== indices.length)
    throw new Error('Malformed SVF polyline boundaries');
  const pairs = [];
  for (let strip = 0; strip < bounds.length - 1; strip++) {
    const start = bounds[strip], end = bounds[strip + 1];
    if (start > end || end > indices.length) throw new Error('Malformed SVF polyline boundaries');
    for (let i = start; i + 1 < end; i++) pairs.push(indices[i], indices[i + 1]);
  }
  return Uint16Array.from(pairs);
}

// forge-convert-utils 4.0.5 ignores the polyline boundaries. Repair its in-memory
// line meshes from the original pack data without changing any captured files.
export async function normalizeSvfPolylines(reader, scene, PackFileReader) {
  const packs = new Map(), seen = new Set();
  const stats = { geometriesChecked: 0, geometriesChanged: 0 };
  for (const meta of scene.svf.geometries) {
    const mesh = scene.svf.meshpacks[meta.packID]?.[meta.entityID];
    const key = `${meta.packID}:${meta.entityID}`;
    if (!mesh?.isLines || seen.has(key)) continue;
    seen.add(key);
    let pack = packs.get(meta.packID);
    if (!pack) {
      pack = new PackFileReader(await reader.getAsset(`${meta.packID}.pf`));
      packs.set(meta.packID, pack);
    }
    const entry = pack.seekEntry(meta.entityID);
    if (entry?._type !== 'Autodesk.CloudPlatform.Lines' || entry.version < 2)
      throw new Error('Unsupported SVF line entry');
    const vertexCount = pack.getUint16(), indexCount = pack.getUint16(), boundsCount = pack.getUint16();
    if (entry.version > 2) pack.getFloat32(); // Width, retained by the existing reader.
    const hasColors = pack.getUint8() !== 0;
    if (indexCount !== mesh.indices.length || vertexCount * 3 !== mesh.vertices.length)
      throw new Error('SVF line header does not match decoded geometry');
    pack.seek(pack.offset + vertexCount * 12 * (hasColors ? 2 : 1) + indexCount * 2);
    const bounds = Array.from({ length: boundsCount }, () => pack.getUint16());
    const indices = expandPolylineIndices(mesh.indices, bounds);
    if (indices.length / 2 !== meta.primCount) throw new Error('SVF polyline count does not match geometry metadata');
    stats.geometriesChecked++;
    if (indices.length !== mesh.indices.length || indices.some((value, i) => value !== mesh.indices[i])) stats.geometriesChanged++;
    mesh.indices = indices;
    mesh.lcount = indices.length / 2;
  }
  return stats;
}
