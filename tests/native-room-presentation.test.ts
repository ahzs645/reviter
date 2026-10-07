import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { recoverNativeRoomInteriors, recoverNativeWallJunctionRepairs, recoverRegisteredWallJunctionRepairs } from "../lib/reviter/native-room-presentation.ts";
import type { IndoorDataset, IndoorRecord } from "../lib/reviter/indoor-contract.ts";
import { containsRoomPoint, roomArea } from "../lib/reviter/room-directory.ts";
type Point = [number, number];
const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const room = (key = "room", levelId = 1): IndoorRecord => ({ key, number: key, name: "Office", building: "A", levelId, elevationFeet: 0, elevationEvidence: "native", surfaceId: key, circulation: false, stair: false, access: "public", walkable: true, confidence: .7, ringsFeet: [rect(.4,.4,9.6,9.6)], properties: {} });
const walls = (levelId = 1): IndoorDataset["walls"] => [rect(-1,-1,11,0),rect(-1,10,11,11),rect(-1,0,0,10),rect(10,0,11,10)].map((ring,i) => ({ kind: "wall", levelId, nativeElementId: i + 1, ringsFeet: [ring] }));
const seeds = (key = "room"): Map<string,Point> => new Map([[key,[5,5]]]);

test("native wall faces recover exact corners and leave sources unchanged", () => {
  const records = [room()], native = walls(); const before = JSON.stringify([records,native]);
  const result = recoverNativeRoomInteriors(records,native,[],seeds());
  assert.equal(result.rooms.length,1); assert.equal(result.diagnostics.length,0);
  assert.equal(roomArea(result.rooms[0]!.ringsFeet[0]!),100);
  assert.deepEqual(new Set(result.rooms[0]!.ringsFeet[0]!.map(p => p.join(","))),new Set(["0,0","10,0","10,10","0,10"]));
  assert.deepEqual(result.rooms[0]!.boundaryElementIds,[1,2,3,4]);
  assert.equal(JSON.stringify([records,native]),before);
});

test("incomplete walls and another native floor cannot enclose a room", () => {
  const incomplete = walls().filter(w => w.nativeElementId !== 2);
  const result = recoverNativeRoomInteriors([room()],[...incomplete,...walls(2)],[],seeds());
  assert.equal(result.rooms.length,0); assert.equal(result.diagnostics[0]!.code,"unclosed-native-cell");
});

test("only a supported native doorway closes its jambs; a floating door does not", () => {
  const native = walls().filter(w => w.nativeElementId !== 4);
  native.push({ kind:"wall",levelId:1,nativeElementId:5,ringsFeet:[rect(10,0,11,4)] },{ kind:"wall",levelId:1,nativeElementId:6,ringsFeet:[rect(10,6,11,10)] });
  const door: NonNullable<IndoorDataset["doors"]>[number] = {id:"door",levelId:1,nativeElementId:20,pointFeet:[10.5,5],footprintFeet:rect(10,4,11,6),roomKeys:["room"],state:"connected"};
  const recovered = recoverNativeRoomInteriors([room()],native,[door],seeds());
  assert.equal(recovered.rooms.length,1);
  assert.ok(recovered.rooms[0]!.boundaryElementIds.includes(door.nativeElementId));
  assert.equal(recoverNativeRoomInteriors([room()],native,[{...door,footprintFeet:rect(9,4,9.5,6)}],seeds()).rooms.length,0);
  assert.equal(recoverNativeRoomInteriors([room()],native,[{...door,levelId:2}],seeds()).rooms.length,0);
});

test("small supported wall junctions close; large gaps remain unresolved", () => {
  const native = walls(); native[2]!.ringsFeet = [rect(-1,.012,0,9.988)];
  assert.equal(recoverNativeRoomInteriors([room()],native,[],seeds()).rooms.length,1);
  native[2]!.ringsFeet = [rect(-1,.1,0,9.9)];
  assert.equal(recoverNativeRoomInteriors([room()],native,[],seeds()).rooms.length,0);
});

test("supported 19 mm end-cap seams close while free walls and doorway gaps remain unchanged", () => {
  const native = walls();
  native[2]!.ringsFeet = [rect(-1,.0633,0,9.9367)];
  const before = JSON.stringify(native);
  assert.equal(recoverNativeRoomInteriors([room()],native,[],seeds()).rooms.length,1);
  const repairs=recoverNativeWallJunctionRepairs(native,[]);
  assert.ok(repairs.length>0);
  assert.ok(repairs.every(r=>r.levelId===1&&r.repairKind==="end-cap"&&r.gapFeet<=r.toleranceFeet));
  assert.ok(repairs.some(r=>r.nativeWallElementId===3&&Math.abs(r.gapFeet-.0633)<1e-6));
  assert.equal(JSON.stringify(native),before);
  native[2]!.ringsFeet = [rect(-1,.09,0,9.91)];
  assert.equal(recoverNativeRoomInteriors([room()],native,[],seeds()).rooms.length,0);
  // A native door footprint protects this gap even though its height is small;
  // its unsupported ends cannot masquerade as a jamb-supported threshold.
  native[2]!.ringsFeet = [rect(-1,.0633,0,9.9367)];
  const door: NonNullable<IndoorDataset["doors"]>[number] = {id:"recess",levelId:1,nativeElementId:20,
    pointFeet:[-.5,.03],footprintFeet:rect(-.8,0,-.2,.0633),roomKeys:["room"],state:"unmatched"};
  assert.equal(recoverNativeRoomInteriors([room()],native,[door],seeds()).rooms.length,0);
});

test("native columns support short wall end caps without becoming invented room partitions", () => {
  const native = walls().filter(w => w.nativeElementId!==3);
  native.push({kind:"wall",levelId:1,nativeElementId:5,ringsFeet:[rect(-1,0,0,4.9367)]},
    {kind:"column",levelId:1,nativeElementId:90,ringsFeet:[rect(-1,5,0,6)]},
    {kind:"wall",levelId:1,nativeElementId:6,ringsFeet:[rect(-1,6.0633,0,10)]});
  const result = recoverNativeRoomInteriors([room()],native,[],seeds());
  assert.equal(result.rooms.length,1);
  assert.ok(result.rooms[0]!.boundaryElementIds.includes(90));
  assert.ok(recoverNativeWallJunctionRepairs(native,[]).some(r=>r.supportingElementId===90&&r.supportingElementKind==="column"));
  native.find(w=>w.nativeElementId===90)!.ringsFeet=[rect(-3,5,-2,6)];
  assert.equal(recoverNativeRoomInteriors([room()],native,[],seeds()).rooms.length,0);
});

test("UNBC Studio 05-122 recovers its native corners without absorbing Bear Display or changing source geometry", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/unbc-studio-boundary-regression.json",import.meta.url),"utf8")) as {
    roomKey:string;records:IndoorRecord[];walls:IndoorDataset["walls"];doors:NonNullable<IndoorDataset["doors"]>;
    labels:{key:string;pointFeet:Point}[];
  };
  const before=JSON.stringify(fixture);
  const labels=new Map(fixture.labels.map(label=>[label.key,label.pointFeet]));
  const result=recoverNativeRoomInteriors(fixture.records,fixture.walls,fixture.doors,labels);
  const studio=result.rooms.find(r=>r.roomKey===fixture.roomKey);
  assert.ok(studio,"the complete native enclosure must not keep the coarse raster fallback");
  assert.ok(studio.sourceCoverage>.99 && studio.cellCoverage>.97);
  assert.ok(studio.ringsFeet[0]!.some(p=>Math.hypot(p[0]-145.5471,p[1]-310.1786)<.0002));
  assert.ok(studio.boundaryElementIds.includes(807017)&&studio.boundaryElementIds.includes(807029));
  const bear=fixture.records.find(r=>r.number==="05-133")!;
  assert.ok(!containsRoomPoint(labels.get(bear.key)!,studio.ringsFeet[0]!));
  assert.equal(JSON.stringify(fixture),before);
  const repairs=recoverNativeWallJunctionRepairs(fixture.walls,fixture.doors);
  assert.ok(repairs.some(r=>r.nativeWallElementId===807017&&r.supportingElementId===807029&&r.repairKind==="end-cap"&&Math.abs(r.gapFeet-.0632596)<.000001));
  assert.ok(repairs.some(r=>r.nativeWallElementId===866754&&r.supportingElementId===807021&&r.repairKind==="corner"&&r.gapFeet<.04));
});

test("a coarse contour cannot crop away a native closure and full native-level context still checks every other label",()=>{
  const r=room();r.ringsFeet=[rect(.4,.4,109.6,99.6)];
  const native=[rect(-1,-1,161,0),rect(-1,100,161,101),rect(-1,0,0,100),rect(160,0,161,100)]
    .map((ring,i)=>({kind:"wall" as const,levelId:1,nativeElementId:i+1,ringsFeet:[ring]}));
  const before=JSON.stringify([r,native]);
  const result=recoverNativeRoomInteriors([r],native,[],seeds());
  assert.equal(result.rooms.length,1);
  assert.equal(roomArea(result.rooms[0]!.ringsFeet[0]!),16000);
  assert.equal(JSON.stringify([r,native]),before);
  const other={...room("adjacent"),ringsFeet:[rect(149,1,151,9)]};
  const rejected=recoverNativeRoomInteriors([r,other],native,[],new Map([[r.key,[5,5]],[other.key,[150,5]]]));
  assert.ok(!rejected.rooms.some(room=>room.roomKey===r.key),"the wider query cannot absorb a second room label outside the coarse contour");
});

test("full-level native barrier union preserves rotated door closures and column holes without accepting floating thresholds",()=>{
  const angle=Math.PI/90;
  const rotate=([x,y]:Point):Point=>[523456.789+x*Math.cos(angle)-y*Math.sin(angle),941000.123+x*Math.sin(angle)+y*Math.cos(angle)];
  const r=room();r.ringsFeet=[rect(.4,.4,109.6,99.6).map(rotate)];
  const native=[rect(-1,-1,40,0),rect(44,-1,161,0),rect(-1,100,161,101),rect(-1,0,0,100),rect(160,0,161,100)]
    .map((ring,i)=>({kind:"wall" as const,levelId:1,nativeElementId:i+1,ringsFeet:[ring.map(rotate)]}));
  const barriers:IndoorDataset["walls"]=[...native,{kind:"column",levelId:1,nativeElementId:90,ringsFeet:[rect(20,20,21,21).map(rotate)]}];
  const door:NonNullable<IndoorDataset["doors"]>[number]={id:"door",nativeElementId:20,levelId:1,pointFeet:rotate([42,-.5]),
    footprintFeet:rect(40,-1,44,0).map(rotate),roomKeys:[r.key],state:"connected"};
  const labels=new Map([[r.key,rotate([5,5])]]);
  const result=recoverNativeRoomInteriors([r],barriers,[door],labels);
  assert.equal(result.rooms.length,1);
  assert.match(result.rooms[0]!.boundaryEvidence!,/exhaustive native-level/);
  assert.deepEqual(recoverNativeRoomInteriors([r],barriers,[door],labels),result,"full-level contexts are reentrant and never rewrite input geometry");
  assert.equal(result.rooms[0]!.ringsFeet.length,2);
  assert.ok(result.rooms[0]!.ringsFeet.slice(1).some(hole=>containsRoomPoint(rotate([20.5,20.5]),hole)));
  assert.ok(result.rooms[0]!.boundaryElementIds.includes(20)&&result.rooms[0]!.boundaryElementIds.includes(90));
  const floating={...door,footprintFeet:rect(40,1,44,1.2).map(rotate)};
  assert.equal(recoverNativeRoomInteriors([r],barriers,[floating],labels).rooms.length,0);
});

test("native structural columns and original room openings remain holes", () => {
  const r = room(); r.ringsFeet.push(rect(2,2,3,3));
  const native = walls(); native.push({kind:"column",levelId:1,nativeElementId:90,ringsFeet:[rect(7,7,8,8)]});
  const result = recoverNativeRoomInteriors([r],native,[],seeds());
  assert.equal(result.rooms.length,1); const rings = result.rooms[0]!.ringsFeet;
  assert.equal(rings.length,3);
  assert.ok(rings.slice(1).some(h => containsRoomPoint([2.5,2.5],h)));
  assert.ok(rings.slice(1).some(h => containsRoomPoint([7.5,7.5],h)));
});

test("shared private labels and claimed circulation prevent accidental room merging", () => {
  const a = room(), b = {...room("second"),ringsFeet:[rect(6,1,9,9)]};
  const labels = new Map<string,Point>([[a.key,[3,5]],[b.key,[7,5]]]);
  assert.equal(recoverNativeRoomInteriors([a,b],walls(),[],labels).rooms.length,0);
  const hall = {...b,circulation:true,ringsFeet:[rect(8,0,10,10)]};
  const result = recoverNativeRoomInteriors([a,hall],walls(),[],new Map([[a.key,[3,5]]]));
  assert.equal(result.rooms.length,0); assert.equal(result.diagnostics[0]!.code,"circulation-or-void-overlap");
});

test("rotated wall corners remain on their vector faces and do not become grid chamfers", () => {
  const rotate = ([x,y]:Point): Point => [500+x*.8-y*.6,1000+x*.6+y*.8];
  const r = room(); r.ringsFeet = r.ringsFeet.map(ring => ring.map(rotate));
  const native = walls().map(w => ({...w,ringsFeet:w.ringsFeet.map(ring => ring.map(rotate))}));
  const result = recoverNativeRoomInteriors([r],native,[],new Map([[r.key,rotate([5,5])]]));
  assert.equal(result.rooms.length,1); assert.ok(Math.abs(roomArea(result.rooms[0]!.ringsFeet[0]!) - 100) < 1e-7);
  for (const p of result.rooms[0]!.ringsFeet[0]!) assert.ok(rect(0,0,10,10).map(rotate).some(q => Math.hypot(p[0]-q[0],p[1]-q[1]) < .0002));
});

test("overlapping fractional native faces are fully noded without leaving numerical corner seams", () => {
  const angle = Math.PI / 7;
  const rotate = ([x,y]:Point): Point => [123.456789 + x*Math.cos(angle)-y*Math.sin(angle),789.123456 + x*Math.sin(angle)+y*Math.cos(angle)];
  const r = room(); r.ringsFeet = r.ringsFeet.map(ring => ring.map(rotate));
  const native = walls().map(w => ({...w,ringsFeet:w.ringsFeet.map(ring => ring.map(rotate))}));
  native.push({...native[0]!,nativeElementId:88,ringsFeet:native[0]!.ringsFeet.map(ring=>ring.map(([x,y])=>[x+.000003,y-.000003] as Point))});
  const result = recoverNativeRoomInteriors([r],native,[],new Map([[r.key,rotate([5,5])]]));
  assert.equal(result.rooms.length,1); assert.ok(Math.abs(roomArea(result.rooms[0]!.ringsFeet[0]!) - 100) < .002);
});

test("an open-to-below region is not absorbed into a room block", () => {
  const r = room();
  const opening = {...room("void"),walkable:false,ringsFeet:[rect(8,0,10,10)],properties:{notes:"Open to below"}};
  const result = recoverNativeRoomInteriors([r,opening],walls(),[],seeds());
  assert.equal(result.rooms.length,0); assert.equal(result.diagnostics[0]!.code,"circulation-or-void-overlap");
});

test('a deeply inset source contour identifies its sole closed native enclosure without painting the full cell',()=>{
 const r=room();r.ringsFeet=[rect(3,3,7,7)];
 const before=JSON.stringify(r);
 const result=recoverNativeRoomInteriors([r],walls(),[],seeds());
 assert.equal(result.rooms.length,1);assert.equal(roomArea(result.rooms[0]!.ringsFeet[0]!),100);
 assert.equal(result.rooms[0]!.sourceCoverage,1);assert.equal(result.rooms[0]!.cellCoverage,.16);
 assert.match(result.rooms[0]!.boundaryEvidence!,/sole native-cell label/);
 assert.equal(JSON.stringify(r),before);
 // Missing partitions/claims are not resolved by merely growing to the outer shell.
 const other={...room('unlabelled'),ringsFeet:[rect(8,1,9,2)]};
 assert.equal(recoverNativeRoomInteriors([r,other],walls(),[],seeds()).rooms.length,0);
 const circulation={...other,circulation:true};
 assert.equal(recoverNativeRoomInteriors([r,circulation],walls(),[],seeds()).rooms.length,0);
 const voidArea={...other,walkable:false,properties:{notes:'Open to below'}};
 assert.equal(recoverNativeRoomInteriors([r,voidArea],walls(),[],seeds()).rooms.length,0);
 assert.equal(recoverNativeRoomInteriors([r],walls().slice(1),[],seeds()).rooms.length,0);
});

test('source-backed joint repair needs both registered faces, facing native caps and no aperture evidence',()=>{
 const ws:IndoorDataset['walls']=[{kind:'wall',levelId:1,nativeElementId:1,ringsFeet:[rect(0,0,4,1)]},{kind:'wall',levelId:1,nativeElementId:2,ringsFeet:[rect(4.2,0,9,1)]}];
 const source={format:'reviter-boundary-reference' as const,version:1 as const,coordinateSystem:'revit-model-feet' as const,sourceSha256:'b'.repeat(64),sections:[{sectionId:'sheet',levelId:1,registrationErrorFeet:.01,wallSegments:[[[0,0],[9,0]],[[0,1],[9,1]]]as [Point,Point][],doorSegments:[]as [Point,Point][]}]};
 const before=JSON.stringify([ws,source]);const repaired=recoverRegisteredWallJunctionRepairs(ws,[],source);
 assert.equal(repaired.length,1);assert.equal(repaired[0]!.evidence,'registered-two-face-wall-continuation');assert.equal(repaired[0]!.sourceSectionId,'sheet');assert.deepEqual(repaired[0]!.sourceWallSegmentIndices,[0,1]);
 assert.ok(Math.abs(repaired[0]!.gapFeet-.2)<1e-8);assert.equal(JSON.stringify([ws,source]),before);
 assert.equal(recoverNativeWallJunctionRepairs(ws,[]).length,0,'source continuation never raises native-only tolerance');
 assert.equal(recoverRegisteredWallJunctionRepairs(ws,[],{...source,sections:[{...source.sections[0]!,wallSegments:source.sections[0]!.wallSegments.slice(0,1)}]}).length,0);
 assert.equal(recoverRegisteredWallJunctionRepairs(ws,[],{...source,sections:[{...source.sections[0]!,registrationErrorFeet:.051}]}).length,0);
 assert.equal(recoverRegisteredWallJunctionRepairs(ws,[],{...source,sections:[{...source.sections[0]!,levelId:2}]}).length,0);
 assert.equal(recoverRegisteredWallJunctionRepairs(ws,[],{...source,sections:[{...source.sections[0]!,doorSegments:[[[4.1,0],[4.1,1]]]}]}).length,0);
 const door:NonNullable<IndoorDataset['doors']>[number]={id:'door',levelId:1,nativeElementId:9,pointFeet:[4.1,.5],roomKeys:[],state:'unmatched',footprintFeet:rect(4,0,4.2,1)};
 assert.equal(recoverRegisteredWallJunctionRepairs(ws,[door],source).length,0);
 assert.equal(recoverRegisteredWallJunctionRepairs([ws[0]!,{...ws[1]!,ringsFeet:[rect(4.6,0,9,1)]}],[],source).length,0);
 assert.equal(recoverRegisteredWallJunctionRepairs([ws[0]!,{...ws[1]!,ringsFeet:[rect(4.2,0,9,1.1)]}],[],source).length,0);
});

test("large-origin full-level T contacts retain separate enclosures without inventing a wall correction",()=>{
 const angle=.5585993153435624;
 const rotate=([x,y]:Point):Point=>[523456.789+x*Math.cos(angle)-y*Math.sin(angle),941000.123+x*Math.sin(angle)+y*Math.cos(angle)];
 const left=room("left"),right=room("right");left.ringsFeet=[rect(3,3,8,8).map(rotate)];right.ringsFeet=[rect(151,3,156,8).map(rotate)];
 const native:IndoorDataset["walls"]=[rect(-1,-1,161,0),rect(-1,100,161,101),rect(-1,0,0,100),rect(160,0,161,100),rect(80,0,80.4,100)].map((ring,i)=>({kind:"wall",levelId:1,nativeElementId:i+1,ringsFeet:[ring.map(rotate)]}));
 const labels=new Map([[left.key,rotate([5,5])],[right.key,rotate([154,5])]]);
 const unpatched=recoverNativeRoomInteriors([left,right],native,[],labels);
 assert.equal(unpatched.rooms.length,2,"already-touching native faces remain separate after precision reduction");
 const otherLevelPatch={kind:"wall" as const,levelId:2,nativeElementId:90,reviewPatchId:"reviewed-other-level",ringsFeet:[rect(1000,1000,1001,1001)]};
 assert.deepEqual(recoverNativeRoomInteriors([left,right],[...native,otherLevelPatch],[],labels),unpatched,"a correction on another floor cannot alter this floor's recovery");
 const patched=native.map((w,i)=>i===4?{...w,reviewPatchId:"reviewed-junction"}:w);
 const adopted=recoverNativeRoomInteriors([left,right],patched,[],labels);
 assert.equal(adopted.rooms.length,2);assert.ok(adopted.rooms.every(r=>r.ringsFeet[0].length>=4));
 assert.ok(!adopted.rooms[0].ringsFeet[0].some(p=>containsRoomPoint(p,adopted.rooms[1].ringsFeet[0]))||adopted.rooms[0].ringsFeet[0].every(p=>!containsRoomPoint(p,adopted.rooms[1].ringsFeet[0])));
});
