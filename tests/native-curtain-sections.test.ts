import assert from 'node:assert/strict';
import test from 'node:test';
import {architecturalPlanGeometry} from '../lib/reviter/architectural-plan.ts';
import {nativeMeshBarrierCuts} from '../lib/reviter/native-mesh-barrier-cuts.ts';
import type {ConvertResult} from '../lib/reviter/types.ts';
const rectangle = [[2,3],[7,3],[7,3.2],[2,3.2]];
function model(source='native-brep',provenance='native',rings= [rectangle], omit=false) {
 const positions:number[]=[],indices:number[]=[],elementIds:number[]=[];
 for(const ring of rings)for(let i=0;i<ring.length;i++) {
  const a=ring[i]!,b=ring[(i+1)%ring.length]!,v=positions.length/3;
  positions.push(a[0]!,a[1]!,0,b[0]!,b[1]!,0,b[0]!,b[1]!,8,a[0]!,a[1]!,8);
  if(omit&&i===0)continue;
  indices.push(v,v+1,v+2,v,v+2,v+3);elementIds.push(10,10);
 }
 return {origin:{x:0,y:0,z:0},levels:[{levelId:1,elevation:0}],nativeAssociatedLevelRelations:[{elementId:10,levelId:1}],elementBounds:[{elementId:10,categoryId:-2000170,renderGeometryProvenance:provenance,boundsFeet:{min:{x:2,y:3,z:0},max:{x:7,y:3.2,z:8}}}],meshes:[{source,positions,indices,elementIds}]} as unknown as ConvertResult;
}
test('certified placed curtain material separates native regions; triangle ownership and source geometry are retained',()=>{
 const m=model(),original=JSON.stringify(m),plan=architecturalPlanGeometry(m,1);
 assert.equal(plan.walls.length,1);assert.equal(plan.walls[0]!.approximate,false);
 assert.equal(plan.walls[0]!.elementId,10);assert.deepEqual(new Set(plan.walls[0]!.polygon.map(p=>JSON.stringify(p))),new Set(rectangle.map(p=>JSON.stringify(p))));
 assert.equal(JSON.stringify(m),original);
});
test('proxy, unowned and dangling meshes never certify a boundary',()=>{
 for(const m of [model('proxy'),model('native-brep','proxy'),model('native-brep','native',[rectangle],true),{...model(),meshes:model().meshes.map(m=>({...m,elementIds:undefined}))}]) {
  assert.equal(nativeMeshBarrierCuts(m,1,4).length,0);assert.equal(architecturalPlanGeometry(m,1).walls[0]!.approximate,true);
 }
});
test('native holes remain protected when the plan contract cannot represent them',()=>{
 const outer=[[2,3],[7,3],[7,5],[2,5]],inner=[[3,3.5],[6,3.5],[6,4.5],[3,4.5]],m=model('native-brep','native',[outer,inner]);
 assert.equal(nativeMeshBarrierCuts(m,1,4)[0]!.ringsFeet.length,2);
 assert.equal(architecturalPlanGeometry(m,1).walls[0]!.approximate,true);
});
test('JSON indexed arrays are accepted without substituting an element box',()=>{
 const m=model();m.meshes=m.meshes.map(mesh=>({...mesh,positions:{...mesh.positions},indices:{...mesh.indices},elementIds:{...mesh.elementIds}})) as ConvertResult['meshes'];
 assert.equal(architecturalPlanGeometry(m,1).walls[0]!.approximate,false);
});
test('double precision corners require matching closed native evidence; a mismatching box cannot replace the mesh',()=>{
 const matching=model();matching.elementBounds[0]!.orientedBox=rectangle.map(([x,y])=>[x!+.00002,y!,0]) as any;
 assert.deepEqual(architecturalPlanGeometry(matching,1).walls[0]!.polygon,rectangle.map(([x,y])=>[x!+.00002,y!]));
 const bad=model();bad.elementBounds[0]!.orientedBox=rectangle.map(([x,y])=>[x!+1,y!,0]) as any;
 assert.deepEqual(new Set(architecturalPlanGeometry(bad,1).walls[0]!.polygon.map(p=>JSON.stringify(p))),new Set(rectangle.map(p=>JSON.stringify(p))));
 const proxy=model('proxy');proxy.elementBounds[0]!.orientedBox=rectangle.map(([x,y])=>[x,y,0]) as any;
 assert.equal(architecturalPlanGeometry(proxy,1).walls[0]!.approximate,true);
});
