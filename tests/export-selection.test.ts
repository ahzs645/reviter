import assert from 'node:assert/strict';
import test from 'node:test';
import { selectExportElements } from '../lib/reviter/export-selection.ts';
import { vertexNormals } from '../lib/reviter/export-glb.ts';
import { parseExtractArguments } from '../scripts/extract-geometry.ts';
import type { ConvertResult } from '../lib/reviter/types.ts';

test('element filtering compacts distant unused vertices while preserving original normals and ownership',()=>{
  const mesh={name:'mixed',materialIndex:0,positions:new Float32Array([0,0,0,1,0,0,0,1,0,100,0,100]),indices:new Uint32Array([0,1,2,0,2,3]),elementIds:new Uint32Array([7,8]),colors:new Float32Array(12).fill(1)};
  const r={meshes:[mesh],elementBounds:[{elementId:7},{elementId:8}],stats:{triangleCount:2},warnings:[],referenceAssistedElementIds:new Uint32Array([8])} as unknown as ConvertResult;
  const out=selectExportElements(r,new Set([7]));
  assert.deepEqual(out.bbox,{min:{x:0,y:0,z:0},max:{x:1,y:1,z:0}});
  assert.deepEqual(out.meshes[0]!.indices,new Uint32Array([0,1,2]));
  assert.deepEqual(out.meshes[0]!.normals,vertexNormals(mesh.positions,mesh.indices).slice(0,9));
  assert.deepEqual([...out.meshes[0]!.elementIds!],[7]);
  assert.equal(out.stats.triangleCount,1);assert.equal(out.elementBounds.length,1);
  assert.equal(out.referenceAssistedElementIds!.length,0);
  assert.equal(mesh.positions.length,12);
  assert.throws(()=>selectExportElements(r,new Set([99])),/no drawn triangles/);
  assert.throws(()=>selectExportElements({...r,meshes:[{...mesh,elementIds:undefined}]},new Set([7])),/ownership/);
});

test('category export selection is explicit and rejects malformed category IDs',()=>{
  assert.deepEqual(parseExtractArguments(['model.rvt','--out','model.pascal.json.gz','--exclude-categories','-2001340,-2003400']).excludeCategories,[-2001340,-2003400]);
  for(const value of ['','x','2000011','-1.5'])assert.throws(()=>parseExtractArguments(['m.rvt','--out','m.glb','--exclude-categories',value]),/category IDs/);
});
