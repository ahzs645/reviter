import { vertexNormals } from './export-glb.ts';
import type { ConvertResult, MeshData } from './types.ts';

/** Explicit export population. Compact vertices too: unused distant points
 * must not enlarge the GLB accessor bounds or the viewer's initial frame. */
export function selectExportElements(result: ConvertResult, keep: ReadonlySet<number>): ConvertResult {
  const min = {x:Infinity,y:Infinity,z:Infinity}, max = {x:-Infinity,y:-Infinity,z:-Infinity};
  const meshes: MeshData[] = result.meshes.flatMap(mesh => {
    if (!mesh.elementIds || mesh.elementIds.length * 3 !== mesh.indices.length)
      throw Error('Element-filtered exports require complete triangle ownership');
    const originalNormals = mesh.normals ?? vertexNormals(mesh.positions, mesh.indices);
    const map = new Map<number, number>();
    const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [], ids: number[] = [];
    for (let t=0;t<mesh.elementIds.length;t++) {
      const id=mesh.elementIds[t]!; if (!keep.has(id)) continue;
      ids.push(id);
      for(let c=0;c<3;c++) {
        const source=mesh.indices[t*3+c]!;
        if (source*3+2>=mesh.positions.length) throw Error('Invalid triangle index');
        let target=map.get(source);
        if(target==null) {
          target=positions.length/3;map.set(source,target);
          for(let a=0;a<3;a++) {
            const value=mesh.positions[source*3+a]!;
            if (!Number.isFinite(value)) throw Error('Nonfinite selected geometry');
            positions.push(value);normals.push(originalNormals[source*3+a]!);colors.push(mesh.colors[source*3+a] ?? 1);
            const axis=(['x','y','z'] as const)[a]!;min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
          }
        }
        indices.push(target);
      }
    }
    return indices.length?[{...mesh,positions:Float32Array.from(positions),normals:Float32Array.from(normals),colors:Float32Array.from(colors),indices:Uint32Array.from(indices),elementIds:Uint32Array.from(ids)}]:[];
  });
  if(!meshes.length) throw Error('Export selection contains no drawn triangles');
  return {...result,meshes,bbox:{min,max},elementBounds:result.elementBounds.filter(r=>keep.has(r.elementId)),
    referenceAssistedElementIds:result.referenceAssistedElementIds?.filter(id=>keep.has(id)),
    stats:{...result.stats,triangleCount:meshes.reduce((n,m)=>n+m.indices.length/3,0)},
    warnings:[...result.warnings,'Export restricted to explicitly selected elements; other recovered geometry is excluded.']};
}
