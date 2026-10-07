import assert from 'node:assert/strict';
import test from 'node:test';
import {architecturalPlanGeometry} from '../lib/reviter/architectural-plan.ts';
import type {ConvertResult} from '../lib/reviter/types.ts';
const round=Array.from({length:20},(_,i)=>[4+Math.cos(i*Math.PI/10),6+Math.sin(i*Math.PI/10)]);
function model(source='native-brep',omit=false,rings=[round]) {
 const positions:number[]=[],indices:number[]=[],elementIds:number[]=[];
 for(const ring of rings)for(let i=0;i<ring.length;i++){const a=ring[i]!,b=ring[(i+1)%ring.length]!,v=positions.length/3;positions.push(a[0]!,a[1]!,0,b[0]!,b[1]!,0,b[0]!,b[1]!,8,a[0]!,a[1]!,8);if(omit&&i===0)continue;indices.push(v,v+1,v+2,v,v+2,v+3);elementIds.push(10,10);}
 return {origin:{x:0,y:0,z:0},levels:[{levelId:1,elevation:0}],nativeAssociatedLevelRelations:[{elementId:10,levelId:1}],elementBounds:[{elementId:10,categoryId:-2000100,renderGeometryProvenance:'native',boundsFeet:{min:{x:3,y:5,z:0},max:{x:5,y:7,z:8}}},{elementId:20,categoryId:-2000023,boundsFeet:{min:{x:8,y:5,z:0},max:{x:9,y:6,z:8}}}],meshes:[{source,positions,indices,elementIds}]}as unknown as ConvertResult;
}
test('complete native round column retains exact curved material instead of a selected bounds box; door geometry and source unchanged',()=>{const m=model(),before=JSON.stringify(m),p=architecturalPlanGeometry(m,1);assert.equal(p.columns.length,1);assert.equal(p.columns[0]!.approximate,false);assert.equal(p.columns[0]!.polygon.length,round.length);assert.deepEqual(new Set(p.columns[0]!.polygon.map(p=>p.map(x=>Math.round(x*1e6)).join(','))),new Set(round.map(p=>p.map(x=>Math.round(x*1e6)).join(','))));assert.equal(JSON.stringify(m),before);assert.deepEqual(p.doors,architecturalPlanGeometry(model('proxy'),1).doors);});
test('proxy, incomplete and unowned column meshes retain their approximate fallback',()=>{for(const m of [model('proxy'),model('native-brep',true),{...model(),meshes:model().meshes.map(m=>({...m,elementIds:undefined}))}])assert.equal(architecturalPlanGeometry(m,1).columns[0]!.approximate,true);});
test('column native holes cannot be discarded to claim an exact solid barrier',()=>{const inner=round.map(([x,y])=>[4+(x!-4)*.4,6+(y!-6)*.4]);assert.equal(architecturalPlanGeometry(model('native-brep',false,[round,inner]),1).columns[0]!.approximate,true);});
