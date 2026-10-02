import assert from 'node:assert/strict';
import test from 'node:test';
import {recoverNativeDoorOwnership} from '../lib/reviter/native-door-ownership.ts';
import {directoryDoorReviews} from '../lib/reviter/directory-navigation.ts';
import {nativeRouteBlocker,type DirectoryRoom,type RoomPoint} from '../lib/reviter/room-directory.ts';
import type {ArchitecturalPlanGeometry} from '../lib/reviter/architectural-plan.ts';
const box=(x:number,y:number,w:number,h:number):RoomPoint[]=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const room=(key:string,p:RoomPoint[]):DirectoryRoom=>({key,levelId:1,name:'Office',polygonFeet:p,labelPointFeet:[p[0]![0]+1,p[0]![1]+1],confidence:1});
const rooms=[room('a',box(-5,-5,10,3.8)),room('b',box(-5,1.2,10,3.8))];
const door={id:1,point:[0,0]as RoomPoint,halfWidth:1.6,halfHeight:.2,footprint:box(-1.6,-.2,3.2,.4),normal:[0,1]as RoomPoint};
const geometry={cutElevation:0,walls:[{elementId:2,approximate:false,polygon:box(-5,-.19,10,.38)}],columns:[],doors:[],floors:[[box(-6,-6,12,12)]]}as ArchitecturalPlanGeometry;
const reviews=()=>directoryDoorReviews(rooms,[door]);
test('recover recessed native doorway sides with full supported width, including rotated model coordinates',()=>{
 assert.equal(reviews()[0]!.portal,undefined);
 for(const angle of [0,.42]){const rotate=(p:RoomPoint):RoomPoint=>[p[0]*Math.cos(angle)-p[1]*Math.sin(angle),p[0]*Math.sin(angle)+p[1]*Math.cos(angle)];
 const rs=rooms.map(r=>({...r,polygonFeet:r.polygonFeet.map(rotate),labelPointFeet:rotate(r.labelPointFeet)}));
 const d={...door,point:rotate(door.point),normal:rotate(door.normal),footprint:door.footprint.map(rotate)};
 const g={...geometry,walls:geometry.walls.map(w=>({...w,polygon:w.polygon.map(rotate)})),floors:geometry.floors.map(f=>f.map(l=>l.map(rotate)))};
 const recovered=recoverNativeDoorOwnership(rs,directoryDoorReviews(rs,[d]),g);assert.equal(recovered.length,1);assert.deepEqual(recovered[0]!.portal.rooms,['a','b']);assert.equal(recovered[0]!.proof.widthFeet,2);
 const block=nativeRouteBlocker(g,[recovered[0]!.portal]);assert.equal(block(recovered[0]!.portal.from,recovered[0]!.portal.to),false);
 }
});
test('retain doors when floor coverage, native columns, joints, third ownership or apertures are unsupported',()=>{
 assert.equal(recoverNativeDoorOwnership(rooms,reviews(),{...geometry,floors:[[box(-6,-6,12,6)]]}).length,0);
 assert.equal(recoverNativeDoorOwnership(rooms,reviews(),{...geometry,columns:[{elementId:3,approximate:false,polygon:box(.3,.3,.3,.3)}]}).length,0);
 assert.equal(recoverNativeDoorOwnership(rooms,reviews(),{...geometry,walls:[...geometry.walls,{elementId:4,approximate:true,polygon:box(-1,.4,2,.1)}]}).length,0);
 assert.equal(recoverNativeDoorOwnership([...rooms,room('third',box(.3,.3,.3,.3))],reviews(),geometry).length,0);
 assert.equal(recoverNativeDoorOwnership(rooms,directoryDoorReviews(rooms,[{...door,normal:undefined}]),geometry).length,0);
 assert.equal(recoverNativeDoorOwnership(rooms,directoryDoorReviews(rooms,[{...door,footprint:undefined}]),geometry).length,0);
});
test('reject split and overlapping jamb ownership and protect room holes',()=>{
 const split=[rooms[0]!,room('b-left',box(-5,1.2,5,3.8)),room('b-right',box(0,1.2,5,3.8))];
 assert.equal(recoverNativeDoorOwnership(split,directoryDoorReviews(split,[door]),geometry).length,0);
 const overlap=[...rooms,{...rooms[1]!,key:'duplicate'}];assert.equal(recoverNativeDoorOwnership(overlap,directoryDoorReviews(overlap,[door]),geometry).length,0);
 const holes=[{...rooms[0]!,floorOpeningsFeet:[box(-.5,-1,1,1)]},rooms[1]!];assert.equal(recoverNativeDoorOwnership(holes,directoryDoorReviews(holes,[door]),geometry).length,0);
});

test('protected nonwalkable regions and explicit doorway reviews are never bypassed',()=>{
 const obstruction={...room('void',box(.3,.3,.3,.3)),walkability:'void' as const};
 assert.equal(recoverNativeDoorOwnership([...rooms,obstruction],reviews(),geometry).length,0);
 const explicit=directoryDoorReviews(rooms,[door],[{doorId:1,levelId:1,rooms:['a','missing']}]);
 assert.equal(explicit[0]!.hasExplicitReview,true);assert.equal(recoverNativeDoorOwnership(rooms,explicit,geometry).length,0);
 const rejectedSemantic=directoryDoorReviews(rooms,[door],[],[{doorId:1,levelId:1,rooms:['a','missing']}]);
 assert.equal(rejectedSemantic[0]!.hasExplicitReview,true);
 assert.equal(recoverNativeDoorOwnership(rooms,rejectedSemantic,geometry).length,0);
});

test('exact rotated host/aperture boundary contacts tolerate floating roundoff without widening nearby walls',()=>{
 const footprint:RoomPoint[]=[[-295.8029897842492,-40.139052913317045],[-290.4303905709868,-43.496225501779946],[-290.10006032097243,-42.96758659669564],[-295.47265953423477,-39.61041400823274]];
 const host:RoomPoint[]=[[-290.8630190559431,-43.22588922076754],[-301.1589573002394,-36.79227296274968],[-300.828627050225,-36.2636340576654],[-290.5326888059287,-42.69725031568326]];
 const normal:RoomPoint=[.5299192642335558,.8480480961562068],centre:RoomPoint=footprint.reduce((s,p)=>[s[0]+p[0]/4,s[1]+p[1]/4]as RoomPoint,[0,0]as RoomPoint);
 const at=(n:number):RoomPoint=>[centre[0]+normal[0]*n,centre[1]+normal[1]*n];
 const portal={doorId:1779325,rooms:['a','b']as[string,string],point:centre,from:at(-1),to:at(1),halfWidth:3,halfHeight:3,footprint,normal};
 const blocked=nativeRouteBlocker({walls:[{polygon:host}],columns:[]},[portal]);
 assert.equal(blocked(portal.from,portal.to),false);
 // Actual blockage only 1e-6 ft beyond the opening remains a barrier.
 const shifted=host.map(p=>[p[0]+normal[0]*1e-6,p[1]+normal[1]*1e-6]as RoomPoint);
 assert.equal(nativeRouteBlocker({walls:[{polygon:shifted}],columns:[]},[portal])(portal.from,portal.to),true);
 assert.equal(nativeRouteBlocker({walls:[{polygon:host}],columns:[]},[])(portal.from,portal.to),true);
 // Door boundary inclusion never authorizes even a microscopic column.
 assert.equal(nativeRouteBlocker({walls:[{polygon:host}],columns:[{polygon:box(centre[0]-.00001,centre[1]-.00001,.00002,.00002)}]},[portal])(portal.from,portal.to),true);
});

test('independent approach depths recover an asymmetric recess without increasing search distance',()=>{
 const asymmetric=[room('shallow-hall',box(-5,-.7,10,.45)),room('recessed-office',box(-5,1.2,10,3.8))];
 const recovered=recoverNativeDoorOwnership(asymmetric,directoryDoorReviews(asymmetric,[door]),geometry);
 assert.equal(recovered.length,1);assert.deepEqual(recovered[0]!.portal.rooms,['shallow-hall','recessed-office']);
 assert.ok(recovered[0]!.portal.from[1]>=-.7&&recovered[0]!.portal.from[1]<=-.25);
 assert.ok(recovered[0]!.portal.to[1]>=1.2);
 const closed={...geometry,walls:[...geometry.walls,{elementId:9,approximate:false,polygon:box(-1,.5,2,.1)}]};
 assert.equal(recoverNativeDoorOwnership(asymmetric,directoryDoorReviews(asymmetric,[door]),closed).length,0);
 const unsupported=[asymmetric[0]!,{...asymmetric[1]!,polygonFeet:box(-5,1.8,10,3)}];
 assert.equal(recoverNativeDoorOwnership(unsupported,directoryDoorReviews(unsupported,[door]),geometry).length,0);
});
