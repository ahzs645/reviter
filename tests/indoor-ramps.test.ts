import {certifyNativeRampCrossfall} from '../lib/reviter/native-ramp-crossfall.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRampTriangles,prepareReviewedIndoorRamps,validateRampRecipe,type IndoorRampRecipes} from '../lib/reviter/indoor-ramps.ts';
import type {ConvertResult} from '../lib/reviter/types.ts';
import type {IndoorDataset} from '../lib/reviter/indoor-contract.ts';
const rect=(x0:number,y0:number,x1:number,y1:number):[number,number][]=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const triangles:[number,number,number][][]=[[[0,0,0],[6,0,3],[6,4,3]],[[0,0,0],[6,4,3],[0,4,0]]];
const model={origin:{x:0,y:0,z:0},levels:[{levelId:1,elevation:0},{levelId:2,elevation:3}],nativeAssociatedLevelRelations:[],elementBounds:[
 {elementId:300,categoryId:-2000180,boundsFeet:{min:{x:0,y:0,z:0},max:{x:6,y:4,z:3}}},
 ...[[1,-10,0,0],[2,6,16,3]].map(([id,x0,x1,z])=>({elementId:id,categoryId:-2000032,boundsFeet:{min:{x:x0,y:0,z:z!-.5},max:{x:x1,y:4,z}},loops:[rect(x0!,0,x1!,4).map(p=>[...p,z])]})),
 ],meshes:[{source:'native-brep',positions:triangles.flat(2),indices:[0,1,2,3,4,5],elementIds:[300,300]}]} as unknown as ConvertResult;
const source='a'.repeat(64);
const dataset=()=>({source:{modelSha256:source},nodes:[],edges:[],records:[],issues:[],nativeLevels:[{id:1,name:'Lower',elevationFeet:0},{id:2,name:'Upper',elevationFeet:3}]} as unknown as IndoorDataset);
const metadata:IndoorRampRecipes={version:1,sourceModelSha256:source,ramps:[{id:'ramp:300',nativeRampId:300,floorElementIds:[1,2],evidence:'reviewed native ramp',accessible:'yes',pointsFeet:[[-.1,2,0],[0,2,0],[6,2,3],[6.1,2,3]],trianglesFeet:triangles,notes:'Existing specific accessibility review'}]};
test('native owner-tagged ramp recipe recompiles separate slopes and reviewed accessibility',()=>{
 const d=dataset();assert.deepEqual(nativeRampTriangles(model,300),triangles);assert.equal(validateRampRecipe(model,d,metadata.ramps[0]!),undefined);
 prepareReviewedIndoorRamps(model,d,metadata,()=>[0,0]);assert.equal(d.edges.length,1);assert.equal(d.edges[0]!.kind,'ramp');assert.equal(d.edges[0]!.accessible,'yes');assert.equal(d.records.length,2);assert.equal(d.rampDisplay!.ramps[0]!.trianglesFeet.length,2);
 assert.deepEqual(d.edges[0]!.pointsFeet,metadata.ramps[0]!.pointsFeet);
});
test('wrong source, invented faces, missing native geometry and an unsupported shortcut reject ramps',()=>{
 const wrong=dataset();prepareReviewedIndoorRamps(model,wrong,{...metadata,sourceModelSha256:'b'.repeat(64)},()=>[0,0]);assert.equal(wrong.edges.length,0);assert.match(wrong.issues[0]!.message,/source identity/);
 assert.match(validateRampRecipe({...model,meshes:[]},dataset(),metadata.ramps[0]!)!,/certified/);
 const invented=structuredClone(metadata.ramps[0]!);invented.trianglesFeet[0]![0]![2]=2;assert.match(validateRampRecipe(model,dataset(),invented)!,/do not match/);
 const shortcut={...metadata.ramps[0]!,pointsFeet:[[-.1,2,0],[6.1,2,3]] as [number,number,number][]};assert.match(validateRampRecipe(model,dataset(),shortcut)!,/continuous/);
 const step={elementId:400,boundsFeet:{min:{x:1,y:1,z:0},max:{x:2,y:3,z:6}},stairTreads:[rect(1,1,2,3).map(p=>[...p,4])]};assert.match(validateRampRecipe({...model,elementBounds:[...model.elementBounds,step] as ConvertResult['elementBounds']},dataset(),metadata.ramps[0]!)!,/stair treads/);
});

test('geometry-bound reviewed ramp approaches survive regeneration while wrong-source reviews cannot apply',()=>{
 const d=dataset();const lower={key:'hall',number:'',name:'Corridor',building:'01',levelId:1,elevationFeet:0,elevationEvidence:'Nativefloor',surfaceId:'01:1:0',circulation:true,stair:false,access:'unknown' as const,walkable:true,confidence:1,ringsFeet:[rect(-10,0,0,4)],properties:{}},upper={...lower,key:'upperhall',levelId:2,elevationFeet:3,surfaceId:'01:2:3',ringsFeet:[rect(6,0,16,4)]};d.records.push(lower,upper);
 d.nodes.push({id:'arrival:hall',roomKey:'hall',levelId:1,building:'01',surfaceId:lower.surfaceId,kind:'arrival',pointFeet:[-5,2,0],geographic:[0,0]},{id:'arrival:upperhall',roomKey:'upperhall',levelId:2,building:'01',surfaceId:upper.surfaceId,kind:'arrival',pointFeet:[12,2,3],geographic:[0,0]});
 const reviews={edges:{'walk:ramp:300:lower':{accessible:'yes' as const,notes:'Existing user reviewed approach',geometryKey:JSON.stringify([source,'arrival:hall','ramp:300:lower',['hall','landing:ramp:300:lower'],[[-5,2,0],[-.1,2,0]]])},'walk:ramp:300:upper':{accessible:'yes' as const,notes:'Existing user reviewed upper approach',geometryKey:JSON.stringify([source,'ramp:300:upper','arrival:upperhall',['landing:ramp:300:upper','upperhall'],[[6.1,2,3],[12,2,3]]])}}};
 const restored=prepareReviewedIndoorRamps(model,d,metadata,()=>[0,0],reviews);assert.equal(d.edges.length,3);assert.equal(restored.size,2);assert.ok(d.edges.every(e=>e.accessible==='yes'));assert.ok(d.edges.filter(e=>e.kind!=='ramp').every(e=>e.kind==='opening'));
 const bad=dataset();bad.records.push(lower,upper);bad.nodes.push(...d.nodes.filter(n=>n.id.startsWith('arrival:')));const stale=structuredClone(reviews);stale.edges['walk:ramp:300:lower'].geometryKey=stale.edges['walk:ramp:300:lower'].geometryKey.replace(source,'b'.repeat(64));const rejected=prepareReviewedIndoorRamps(model,bad,metadata,()=>[0,0],stale);assert.equal(rejected.has('walk:ramp:300:lower'),false);assert.equal(bad.edges.some(e=>e.id==='walk:ramp:300:lower'),false);assert.ok(bad.issues.some(i=>i.message.includes('stale')));
});

test('curved width certificates are recomputed from original faces and cannot grant unsupported or tampered support',()=>{const recipe=structuredClone(metadata.ramps[0]!);recipe.surfaceWidthCertificate=certifyNativeRampCrossfall(triangles,model.elementBounds.filter(r=>r.categoryId===-2000032),recipe.pointsFeet)!;assert.ok(recipe.surfaceWidthCertificate);assert.equal(validateRampRecipe(model,dataset(),recipe),undefined);recipe.surfaceWidthCertificate.maximumCrossfallRatio=.9;assert.match(validateRampRecipe(model,dataset(),recipe)!,/certificate does not match/);});

test('final certificates use exact exported original floor profiles and reject missing source inventory',async()=>{
 const {certifyExportedNativeRampCrossfall}=await import('../lib/reviter/indoor-ramps.ts');
 const d=dataset();d.walkingSupport={version:1,sourceModelSha256:source,floors:model.elementBounds.filter(f=>f.categoryId===-2000032).map(f=>({nativeElementId:f.elementId,elevationFeet:f.boundsFeet.max.z,ringsFeet:f.loops!.map(r=>r.map(p=>[p[0],p[1]]))}))};
 const actual=certifyExportedNativeRampCrossfall(d,triangles,[1,2],metadata.ramps[0]!.pointsFeet);
 const serialized=JSON.parse(JSON.stringify(d));
 assert.deepEqual(actual,certifyExportedNativeRampCrossfall(serialized,JSON.parse(JSON.stringify(triangles)),[1,2],JSON.parse(JSON.stringify(metadata.ramps[0]!.pointsFeet))));
 assert.equal(certifyExportedNativeRampCrossfall(d,triangles,[1,99],metadata.ramps[0]!.pointsFeet),undefined);
 d.walkingSupport.sourceModelSha256='b'.repeat(64);assert.equal(certifyExportedNativeRampCrossfall(d,triangles,[1,2],metadata.ramps[0]!.pointsFeet),undefined);
});
