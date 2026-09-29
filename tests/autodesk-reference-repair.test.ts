import assert from 'node:assert/strict';
import test from 'node:test';
import { makeGlb } from '../lib/reviter/export-glb.ts';
import { repairFromAutodesk } from '../lib/reviter/autodesk-reference-repair.ts';
import type { ConvertResult } from '../lib/reviter/types.ts';

function fixture(): ConvertResult {
  return {fileName:'paired.rvt',origin:{x:0,y:0,z:0},warnings:[],stats:{triangleCount:2},elementBounds:[{elementId:7},{elementId:8}],materials:[{name:'white',baseColorLinear:[1,1,1,1],metallic:0,roughness:1,doubleSided:true,source:'display-fallback',assignedElements:2}], meshes:[{name:'mixed',positions:new Float32Array([0,0,0,1,0,0,0,1,0,9,9,9]),indices:new Uint32Array([0,1,2,1,2,3]),colors:new Float32Array(12).fill(1),elementIds:new Uint32Array([7,8]),materialIndex:0,source:'native-brep'}]} as unknown as ConvertResult;
}
function reference() {
  const r=fixture(); r.meshes[0]!.indices=new Uint32Array([0,1,2]);
  const bytes=new Uint8Array(makeGlb(r)),view=new DataView(bytes.buffer),n=view.getUint32(12,true);
  const doc=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+n)));
  doc.nodes[0].extras={autodeskDbId:1};
  const json=new TextEncoder().encode(JSON.stringify(doc)),pad=Math.ceil(json.length/4)*4;
  const out=new Uint8Array(20+pad+bytes.length-(20+n));out.set(bytes.subarray(0,20));out.fill(32,20,20+pad);out.set(json,20);out.set(bytes.subarray(20+n),20+pad);
  const header=new DataView(out.buffer);header.setUint32(8,out.length,true);header.setUint32(12,pad,true);return out;
}
const registration={scale:0.5,sourceCenter:[2,3,4] as [number,number,number],referenceCenter:[1,2,3] as [number,number,number]};
test('registered repair replaces only selected ownership and labels external geometry',()=>{
  const input=fixture();const out=repairFromAutodesk(input,reference(),[null,'guid-00000007'],[7],registration);
  assert.deepEqual([...out.meshes[0]!.elementIds!],[8]);
  const repaired=out.meshes.find(m=>m.source==='reference-autodesk')!;
  assert.deepEqual([...repaired.positions.subarray(0,3)],[0,2,-1]);
  assert.deepEqual([...repaired.elementIds!],[7]);
  assert.ok(Math.abs(repaired.normals![0]!) < 1e-7);
  assert.ok(Math.abs(repaired.normals![1]!) < 1e-7);
  assert.ok(Math.abs(repaired.normals![2]! - 1) < 1e-7);
  assert.equal(out.elementBounds[0]!.renderGeometryProvenance,'reference-assisted');
  assert.equal(out.elementBounds[1],input.elementBounds[1]);
  assert.deepEqual([...input.meshes[0]!.elementIds!],[7,8]);
  assert.deepEqual([...out.referenceAssistedElementIds!],[7]);
});
test('missing identities and invalid registration never silently remove source geometry',()=>{
  assert.throws(()=>repairFromAutodesk(fixture(),reference(),[null,'guid-7'],[8],registration),/absent/);
  assert.throws(()=>repairFromAutodesk(fixture(),reference(),[null,'guid-7'],[7],{...registration,scale:0}),/registration/);
});
test('restoring a missing element adds a labelled manifest record from drawn reference bounds',()=>{
  const input=fixture(); input.elementBounds=input.elementBounds.filter(r=>r.elementId!==7);
  const out=repairFromAutodesk(input,reference(),[null,'guid-00000007'],[7],registration);
  const record=out.elementBounds.find(r=>r.elementId===7)!;
  assert.equal(record.boundsFromReferenceMesh,true);
  assert.equal(record.renderGeometryProvenance,'reference-assisted');
  assert.deepEqual(record.boundsFeet,{min:{x:0,y:2,z:-1},max:{x:2,y:4,z:-1}});
  assert.equal(input.elementBounds.length,1);
});
