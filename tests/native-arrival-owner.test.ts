import test from 'node:test';import assert from 'node:assert/strict';
import {createNativeArrivalOwnerQuery} from '../lib/reviter/native-arrival-owner.ts';
import {prepareNativeCirculationGeometry,attachNativeCirculationCellRoutes,replayNativePhysicalCellRoutes} from '../lib/reviter/native-circulation-geometry.ts';
import {nativeIndoorEnvelopeHash} from '../lib/reviter/native-indoor-envelopes.ts';
import type {IndoorDataset} from '../lib/reviter/indoor-contract.ts';
import type {ConvertResult} from '../lib/reviter/types.ts';
const rect=(a:number,b:number,c:number,d:number):[number,number][]=>[[a,b],[c,b],[c,d],[a,d]];
async function fixture(hole=false,angled=false){
 const model='a'.repeat(64),outer=rect(0,0,10,10),holes=hole?[rect(2.9,2.9,3.1,3.1)]:[],floor=[outer,...holes];
 const envelope={version:1 as const,sourceModelSha256:model,levels:[{levelId:1,elevationFeet:0,partsFeet:[floor],sourceElementIds:[1],cutElevationsFeet:[4,8],evidenceSha256:'b'.repeat(64)}]};
 const owner={key:'landing',number:'S1',name:'Stair',levelId:1,building:'B',surfaceId:'B:1:0',elevationFeet:0,elevationEvidence:'native floor',circulation:true,stair:true,walkable:true,access:'unknown',confidence:1,ringsFeet:[rect(1,1,30,4)],properties:{}};
 const hall={...owner,key:'hall',name:'Corridor',stair:false,access:'public',ringsFeet:[outer]};
 const nodes=[{id:'arrival:landing',roomKey:'landing',kind:'arrival',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[3,3,0],geographic:[0,0]},{id:'own-portal',roomKey:'landing',kind:'portal',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[7,3,0],geographic:[0,0]},{id:'other-portal',roomKey:'hall',kind:'portal',levelId:1,building:'B',surfaceId:'B:1:0',pointFeet:[9,3,0],geographic:[0,0]}];
 const d={source:{modelSha256:model},alignment:{horizontalMetresPerFoot:.3048},issues:[],report:{},nativeLevels:[{id:1,elevationFeet:0,name:'Main'}],records:[owner,hall],nodes,edges:[{id:'door',from:'own-portal',to:'other-portal',kind:'door',roomKeys:['landing','hall'],nativeElementId:2,pointsFeet:[[7,3,0],[9,3,0]],enabled:true,accessible:'unknown',evidence:'native door',lengthMetres:.6096}],doors:[{id:'door',levelId:1,nativeElementId:2,hostWallNativeElementId:50,pointFeet:[8,3],footprintFeet:rect(7.5,2,8.5,4),normalFeet:[1,0],roomKeys:['landing','hall'],state:'connected'}],walls:[],walkingSupport:{version:1,sourceModelSha256:model,floors:[{nativeElementId:1,elevationFeet:0,ringsFeet:floor}]},nativeIndoorEnvelopes:{...envelope,geometrySha256:await nativeIndoorEnvelopeHash(envelope)}} as unknown as IndoorDataset;
 if(angled){
  d.records[0]!.ringsFeet=[[[1,1],[200,1],[200,2],[8.25,2],[4.25,6],[1,6]]];
  d.nodes[2]!.pointFeet=[8.414213562373096,4.414213562373095,0];
  d.edges[0]!.pointsFeet=[d.nodes[1]!.pointFeet,d.nodes[2]!.pointFeet];
  d.doors![0]!.pointFeet=[7.707106781186548,3.7071067811865475];
  d.doors![0]!.normalFeet=[Math.SQRT1_2,Math.SQRT1_2];
  d.doors![0]!.footprintFeet=rect(7.6,3.6,8.6,4.6);
 }
 const m={elementBounds:[{elementId:1,categoryId:-2000032,boundsFeet:{min:{x:0,y:0,z:-1},max:{x:10,y:10,z:0}},loops:floor.map(r=>r.map(p=>[...p,0]))}],levels:[{levelId:1,elevation:0}],nativeAssociatedLevelRelations:[]} as unknown as ConvertResult;
 d.circulationGeometry=prepareNativeCirculationGeometry(m,d).geometry;
 const cell=d.circulationGeometry.cells.find(c=>c.roomKeys.includes('hall'))!;
 assert.ok(cell&&!cell.roomKeys.includes('landing'));
 return{d,cell,m};
}
test('minority landing retains its exact original arrival and actual own portal plus all foreign permissions',async()=>{
 const {d,cell}=await fixture(),before=JSON.stringify(d),proof=createNativeArrivalOwnerQuery(d)('arrival:landing',cell.id);
 assert.ok(proof);assert.deepEqual(proof.arrivalPointFeet,[3,3,0]);assert.deepEqual(proof.portalPointFeet,[7,3,0]);
 assert.equal(proof.nativeDoorElementId,2);assert.deepEqual(proof.roomKeys,['hall','landing']);assert.equal(proof.walkingStripWidthFeet,2);
 assert.equal(JSON.stringify(d),before,'a checked proposal edits no arrival, door, flight or access');
});
test('a borrowed foreign portal, absent or disabled physical door, or stale native model never proves an arrival',async()=>{
 for(const mutate of[(d:IndoorDataset)=>{d.nodes[1]!.roomKey='hall'},(d:IndoorDataset)=>{d.edges[0]!.enabled=false},(d:IndoorDataset)=>{d.doors![0]!.state='unmatched'},(d:IndoorDataset)=>{d.doors![0]!.nativeElementId=999},(d:IndoorDataset)=>{d.walkingSupport!.sourceModelSha256='c'.repeat(64)}]){
  const {d,cell}=await fixture();mutate(d);assert.equal(createNativeArrivalOwnerQuery(d)('arrival:landing',cell.id),undefined);
 }
});
test('a genuine original hole, changed height and endpoint movement remain refusals',async()=>{
 const holed=await fixture(true);assert.equal(createNativeArrivalOwnerQuery(holed.d)('arrival:landing',holed.cell.id),undefined);
 const {d,cell}=await fixture(),query=createNativeArrivalOwnerQuery(d);d.nodes[0]!.pointFeet[0]+=.001;
 assert.equal(query('arrival:landing',cell.id),undefined,'an original point is not replaced with a nearby one');
 const raised=await fixture();raised.d.nodes[0]!.pointFeet[2]=.01;
 assert.equal(createNativeArrivalOwnerQuery(raised.d)('arrival:landing',raised.cell.id),undefined,'even a tolerated source height difference cannot supply a coplanar arrival');
});
test('foreign staff restrictions and a narrower source identity cannot be dropped',async()=>{
 const restricted=await fixture();restricted.d.records[1]!.access='staff';assert.equal(createNativeArrivalOwnerQuery(restricted.d)('arrival:landing',restricted.cell.id),undefined);
 const original=await fixture();original.d.records[0]!.properties.originalSourceRingsFeet=[rect(2,2,4,4)];
 assert.equal(createNativeArrivalOwnerQuery(original.d)('arrival:landing',original.cell.id),undefined,'full approach must stay inside original source identity as well as prepared physical geometry');
});


test('a cell cannot borrow unrelated original named floor IDs or a changed opposite doorway terminal',async()=>{
 const {d,m}=await fixture();d.walkingSupport!.floors.push({nativeElementId:9,elevationFeet:0,ringsFeet:[rect(20,20,30,30)]});
 d.circulationGeometry=prepareNativeCirculationGeometry(m,d).geometry;
 const cell=d.circulationGeometry.cells.find(c=>c.roomKeys.includes('hall'))!;cell.nativeFloorIds=[9];
 assert.equal(createNativeArrivalOwnerQuery(d)('arrival:landing',cell.id),undefined);
 const other=await fixture(),query=createNativeArrivalOwnerQuery(other.d);other.d.nodes[2]!.pointFeet[0]+=.1;
 assert.equal(query('arrival:landing',other.cell.id),undefined);
});

test('an oblique jamb uses its measured original door normal while preserving both fixed terminals and full width',async()=>{
 const {d,cell}=await fixture(false,true),before=JSON.stringify(d);
 const proof=createNativeArrivalOwnerQuery(d)('arrival:landing',cell.id);
 assert.ok(proof);assert.equal(proof.pointsFeet.length,3,'a direct centreline would cut the original diagonal side');
 assert.deepEqual(proof.pointsFeet[0],d.nodes[0]!.pointFeet);assert.deepEqual(proof.pointsFeet.at(-1),d.nodes[1]!.pointFeet);
 assert.equal(JSON.stringify(d),before);
 const narrowed=await fixture(false,true);narrowed.d.records[0]!.properties.originalSourceRingsFeet=[rect(2,2,4,4)];
 assert.equal(createNativeArrivalOwnerQuery(narrowed.d)('arrival:landing',narrowed.cell.id),undefined,'the normal proposal never authorizes an original-room gap');
});

test('the actual cell constructor attaches only the proved own-door branch and the independent final physical replay keeps it',async()=>{
 const {d,cell}=await fixture(false,true),source=JSON.stringify([d.nodes,d.records,d.doors,d.circulationGeometry]);
 attachNativeCirculationCellRoutes(d);
 const approaches=d.edges.filter(e=>e.nativeCellId===cell.id&&(e.from==='arrival:landing'||e.to==='arrival:landing'));
 assert.equal(approaches.length,1);assert.equal(approaches[0]!.to,'own-portal');
 assert.equal(approaches[0]!.pointsFeet.length,3);assert.deepEqual(approaches[0]!.roomKeys,['hall','landing']);
 assert.equal(approaches[0]!.accessible,'unknown');assert.equal(approaches[0]!.kind,'walk');
 assert.equal(JSON.stringify([d.nodes,d.records,d.doors,d.circulationGeometry]),source);
 const replay=replayNativePhysicalCellRoutes(d);assert.equal(replay.disabled.length,0);assert.equal(approaches[0]!.enabled,true);
 const hole=await fixture(true);attachNativeCirculationCellRoutes(hole.d);
 assert.equal(hole.d.edges.some(e=>e.enabled&&e.kind==='walk'&&(e.from==='arrival:landing'||e.to==='arrival:landing')),false);
});
