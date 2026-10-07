import assert from 'node:assert/strict';
import test from 'node:test';
import { directoryDoors, directoryDoorReviews, directoryStairs, findBuildingRoute, reviewedDoorPortal } from '../lib/reviter/directory-navigation.ts';
import { auditDirectoryFloor } from '../lib/reviter/directory-audit.ts';
import { findDirectoryRoute, parseRoomDirectory, roomPortals, type DirectoryRoom, type RoomPoint } from '../lib/reviter/room-directory.ts';
import type { ConvertResult } from '../lib/reviter/types.ts';
import {withReviewedDoorApertures,reviewedDoorHostEvidence,type ReviewedDoorApertures} from '../lib/reviter/reviewed-door-apertures.ts';
import {architecturalPlanGeometry} from '../lib/reviter/architectural-plan.ts';
const box=(x:number,y:number,w:number,h:number):RoomPoint[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const room=(key:string,name:string,polygonFeet:RoomPoint[],levelId=1):DirectoryRoom=>({key,number:`B-${key}`,name,levelId,polygonFeet,labelPointFeet:[(polygonFeet[0]![0]+polygonFeet[2]![0])/2,(polygonFeet[0]![1]+polygonFeet[2]![1])/2],confidence:1});
const a=room('a','Office',box(-6,0,5,5)),hall=room('hall','Corridor',box(0,0,4,5)),stair=room('S101','Stair',box(5,0,5,5));
const upper=[{...a,key:'b',number:'B-b',levelId:2},{...hall,key:'hall2',levelId:2},{...stair,key:'S201',number:'B-S201',levelId:2}];
const doors=[{id:1,point:[-.5,2.5] as RoomPoint,halfWidth:.6,halfHeight:1.2},{id:2,point:[4.5,2.5] as RoomPoint,halfWidth:.6,halfHeight:1.2}];
const rooms=[a,hall,stair,...upper];
const model={levels:[{levelId:1,elevation:0},{levelId:2,elevation:10}],elementBounds:[{elementId:101,boundsFeet:{min:{x:5.5,y:1,z:0},max:{x:9,y:4,z:9.5}},stairTreads:[[[5.5,1,1],[6,1,1],[6,4,1],[5.5,4,1]],[[8.5,1,9.5],[9,1,9.5],[9,4,9.5],[8.5,4,9.5]]]}],nativeStairAssemblies:[{stairElementId:100,runAndLandingIds:[101],stringerIds:[],railingIds:[],supportIds:[],spiralRunIds:[],shape:'undetermined',evidence:'runs'}]} as unknown as ConvertResult;

test('routes reach an inner room through real room-to-room doors; walls without doors remain closed',()=>{
 const suite=[room('inner','Office',box(-12,0,5,5)),a,hall];
 const innerDoor={id:3,point:[-6.5,2.5] as RoomPoint,halfWidth:.6,halfHeight:1.2};
 const portals=roomPortals(suite,[doors[0]!,innerDoor]);
 assert.equal(portals.length,2);assert.deepEqual(findDirectoryRoute(suite,portals,'inner','hall')?.roomKeys,['inner','a','hall']);
 assert.equal(findDirectoryRoute(suite,roomPortals(suite,[doors[0]!]),'inner','hall'),null);
});
test('native assembly and floor heights establish stair transitions; names and overlapping bounds cannot',()=>{
 const links=directoryStairs(model,rooms);assert.equal(links.length,1);assert.deepEqual(links[0]!.rooms,['S101','S201']);
 assert.equal(directoryStairs({...model,nativeStairAssemblies:[]},rooms).length,0);
 assert.equal(directoryStairs(model,[...rooms,{...upper[2]!,key:'duplicate-stair'}]).length,0);
 assert.equal(directoryStairs({...model,levels:[model.levels[0]!,{...model.levels[1]!,elevation:20}]},rooms).length,0);
});
test('building route follows floor legs and a native staircase; stairs-disabled and missing-door routes fail',()=>{
 const portals=new Map([[1,roomPortals(rooms.filter(r=>r.levelId===1),doors)],[2,roomPortals(upper,doors)]]);
 const stairs=directoryStairs(model,rooms),route=findBuildingRoute(rooms,portals,stairs,'a','b');
 assert.ok(route);assert.equal(route.transitions.length,1);assert.deepEqual(route.legs.map(l=>l.levelId),[1,2]);assert.ok(route.legs.every(l=>l.route.points.length>1));
 assert.deepEqual(route.steps.map(s=>s.kind),['floor','stairs','floor']);
 const transition=route.steps[1]!;assert.equal(transition.kind,'stairs');if(transition.kind==='stairs')assert.deepEqual([transition.fromKey,transition.toKey],['S101','S201']);
 assert.equal(findBuildingRoute(rooms,portals,stairs,'a','b',false),null);
 assert.equal(findBuildingRoute(rooms,new Map([[1,portals.get(1)!],[2,[]]]),stairs,'a','b'),null);
});

test('a precise door opening spans its persisted host wall, without widening along the wall or using unrelated walls',()=>{
 const boundsFeet={min:{x:-2,y:-2,z:0},max:{x:8,y:2,z:10}};
 const door={elementId:1,categoryId:-2000023,boundsFeet,orientedBox:[[1,-.1,0],[5,-.1,0],[5,.1,0],[1,.1,0]]};
 const host={elementId:2,categoryId:-2000011,boundsFeet,solid:{start:{x:-2,y:0},end:{x:8,y:0},thickness:3,baseElevation:0,topElevation:10}};
 const source={levels:[{levelId:1,elevation:0}],elementBounds:[door,host],nativeAssociatedLevelRelations:[{elementId:1,levelId:1}],nativeHostRelations:[{elementId:1,hostId:2}]} as unknown as ConvertResult;
 const opening=directoryDoors(source,1)[0]!;
 assert.deepEqual(opening.point,[3,0]);assert.equal(opening.halfWidth,2);assert.equal(opening.halfHeight,1.5);
 const noHost=directoryDoors({...source,nativeHostRelations:[]},1)[0]!;
 assert.equal(noHost.halfHeight,.1);
 const regions=[room('left','Atrium',box(0,-5,6,3.5)),room('right','Vestibule',box(0,1.5,6,3.5))];
 const reviews=directoryDoorReviews(regions,[opening]);assert.equal(reviews[0]!.state,'connected');
 assert.ok(findDirectoryRoute(regions,reviews.flatMap(r=>r.portal?[r.portal]:[]),'left','right'));
 assert.equal(directoryDoorReviews(regions,[noHost])[0]!.state,'unmatched');
});
test('reviewed apertures bypass host re-expansion and sibling doors retain original cyclic or closed host evidence',()=>{
 const sha='a'.repeat(64);
 const corners=(x0:number,y0:number,x1:number,y1:number,z0:number,z1:number)=>[...box(x0,y0,x1-x0,y1-y0).map(p=>[...p,z0]),...box(x0,y0,x1-x0,y1-y0).map(p=>[...p,z1])];
 const record=(elementId:number,categoryId:number,c:number[][])=>({elementId,categoryId,orientedBox:c,boundsFeet:{min:{x:Math.min(...c.map(p=>p[0]!)),y:Math.min(...c.map(p=>p[1]!)),z:Math.min(...c.map(p=>p[2]!))},max:{x:Math.max(...c.map(p=>p[0]!)),y:Math.max(...c.map(p=>p[1]!)),z:Math.max(...c.map(p=>p[2]!))}}});
 const host={...record(10,-2000011,corners(-2,0,2,3,0,10)),solid:{start:{x:-2,y:1.5},end:{x:2,y:1.5},thickness:3,baseElevation:0,topElevation:10}};
 const frames=[corners(-2,.5,2,2.5,7,7.2),corners(-2,.5,2,2.5,-.2,0),corners(-2,.3,2,.5,-.2,7.2),corners(-2,2.5,2,2.7,-.2,7.2)].map((c,i)=>({...record(i+3,-2000171,c),renderGeometryProvenance:'native'}));
 const source={levels:[{levelId:1,elevation:0}],elementBounds:[host,record(2,-2000023,corners(-.1,.5,.1,2.5,0,7)),record(20,-2000023,corners(-1.75,.1,1.75,.2,0,7)),...frames],nativeAssociatedLevelRelations:[2,20].map(elementId=>({elementId,levelId:1})),nativeHostRelations:[2,20,...frames.map(f=>f.elementId)].map(elementId=>({elementId,hostId:10,evidence:'persisted'}))} as unknown as ConvertResult;
 const before=JSON.stringify(source),original=directoryDoors(source,1).find(d=>d.id===20)!;
 assert.deepEqual(original.point,[0,1.5]);
 const g=architecturalPlanGeometry(source,1),nativeFace=g.walls.find(w=>w.elementId===10)!.polygon;
 for(const closed of [false,true])for(let offset=0;offset<4;offset++){
  const face=[...nativeFace.slice(offset),...nativeFace.slice(0,offset)];if(closed)face.push(face[0]!);
  const geometry={...g,walls:g.walls.map(w=>w.elementId===10?{...w,polygon:face}:w),floors:[[box(-5,-5,10,11)]]};
  const value:ReviewedDoorApertures={version:1,sourceModelSha256:sha,patches:[{id:'measured-aperture',levelId:1,nativeDoorId:2,apertureFeet:box(-2,.5,4,2),normalFeet:[1,0],wallEvidence:[{nativeElementId:10,partsFeet:[face]}],frameEvidence:frames.map(f=>({nativeElementId:f.elementId,orientedBox:f.orientedBox})),notes:'Measured native frame aperture; keep other original hosted doors independent.'}]};
  const prepared=withReviewedDoorApertures(source,value,sha,()=>geometry),doors=directoryDoors(prepared,1);
  assert.deepEqual(doors.find(d=>d.id===20),original);
  const own=doors.find(d=>d.id===2)!;
  assert.deepEqual(own.footprint,value.patches[0]!.apertureFeet);
  assert.deepEqual(own.normal,value.patches[0]!.normalFeet);
  assert.deepEqual(own.point,[0,1.5]);assert.equal(own.halfHeight,1);
  assert.deepEqual(reviewedDoorHostEvidence(prepared,1,10)?.[0]?.polygon,face);
  assert.equal(reviewedDoorHostEvidence(source,1,10),undefined);
  assert.equal(reviewedDoorHostEvidence(prepared,2,10),undefined);
  assert.equal(JSON.stringify(source),before);
 }
});
test('review resolves a three-region door only for boundaries at that opening and survives export/import',()=>{
 const floor=[a,hall,{...a,key:'duplicate',name:'Office'}];
 assert.equal(directoryDoorReviews(floor,[doors[0]!])[0]!.state,'ambiguous');
 const link={doorId:1,levelId:1,rooms:['a','hall'] as [string,string]};
 assert.ok(reviewedDoorPortal(floor,doors[0]!,link));
 assert.equal(reviewedDoorPortal([...floor,room('remote','Office',box(50,50,5,5))],doors[0]!,{...link,rooms:['a','remote']}),null);
 const data={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'test.rvt'},annotations:floor,navigation:{version:1,doorLinks:[link]}};
 assert.deepEqual(parseRoomDirectory(JSON.stringify(data)).navigation,data.navigation);
 assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,navigation:{version:1,doorLinks:[{...link,rooms:['a','a']}]}})));
});
test('live checks expose outside anchors, overlaps, missing doors and unresolved staircases',()=>{
 const floor=[a,hall,stair,{...room('bad','Office',box(-6,0,5,5)),labelPointFeet:[99,99] as RoomPoint}];
 const reviews=directoryDoorReviews(floor,doors),audit=auditDirectoryFloor(floor,reviews.flatMap(r=>r.portal?[r.portal]:[]),reviews,[]);
 assert.ok(audit.issues.some(i=>i.kind==='anchor'&&i.roomKey==='bad'));
 assert.ok(audit.issues.some(i=>i.kind==='overlap'));
 assert.ok(audit.issues.some(i=>i.kind==='access'&&i.roomKey==='bad'));
 assert.ok(audit.issues.some(i=>i.kind==='stair'&&i.roomKey==='S101'));
 assert.equal(audit.destinations,3);
});

test('precise opening sides resolve a nearby corner without accepting overlapping ownership',()=>{
 const corner=room('corner','Storage',box(-1.2,3.7,1.5,.3));
 const door={...doors[0]!,footprint:box(-1.1,1.3,1.2,2.4),normal:[1,0] as RoomPoint};
 assert.equal(roomPortals([a,hall,corner],[door]).length,1);
 assert.equal(roomPortals([a,hall,corner],[{...door,normal:undefined}]).length,0);
 assert.equal(roomPortals([a,hall,{...a,key:'same-side-overlap'}],[door]).length,0);
});

test('reviewed stair links are explicit, stack in plan, and retain their evidence on reload',()=>{
 const review={rooms:['S101','S201'] as [string,string]};
 const linked=directoryStairs({...model,nativeStairAssemblies:[]},rooms,[review]);
 assert.equal(linked.length,1);assert.equal(linked[0]!.evidence,'reviewed');
 const shifted=rooms.map(r=>r.key==='S201'?{...r,polygonFeet:box(50,50,5,5)}:r);
 assert.equal(directoryStairs({...model,nativeStairAssemblies:[]},shifted,[review]).length,0);
 const data={format:'reviter-room-annotations',version:1,coordinateSystem:'revit-model-feet',model:{fileName:'test.rvt'},annotations:rooms,navigation:{version:1,doorLinks:[],stairLinks:[review]}};
 assert.deepEqual(parseRoomDirectory(JSON.stringify(data)).navigation,data.navigation);
 assert.throws(()=>parseRoomDirectory(JSON.stringify({...data,navigation:{...data.navigation,stairLinks:[{rooms:['a','b']}]}})));
});
