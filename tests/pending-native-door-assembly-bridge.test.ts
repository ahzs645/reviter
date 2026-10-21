import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { transformSync } from "esbuild";
import { capturePendingNativeDoorAssemblyCandidate, bindPendingNativeDoorAssemblyPortal, pendingNativeDoorAssemblyGeometry } from "../lib/reviter/pending-native-door-assembly-bridge.ts";
import { nativeRouteBlocker, type RoomPortal } from "../lib/reviter/room-directory.ts";
import { createCheckedNativeDoorBridgeProof, type NativeDoorBridgeAuthority } from "../lib/reviter/native-door-bridge-proof.ts";
import { nativeRationalOverlay } from "../lib/reviter/native-rational-overlay.ts";
import type { IndoorDataset, IndoorEdge, IndoorNode } from "../lib/reviter/indoor-contract.ts";
import { physicalPortalBarrierScope } from "../lib/reviter/physical-portal-barrier-scope.ts";

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const exact = (ring: [number, number][]) => nativeRationalOverlay("union", [[ring]]);
function fixture(mutate?: (authority: NativeDoorBridgeAuthority) => void) {
  const sourceModelSha256="a".repeat(64), plane={sourceModelSha256,levelId:20,elevationFeet:10}, aperture=rect(-.2,-1.5,.2,1.5);
  const authority: NativeDoorBridgeAuthority={...plane,
    originalDoor:{...plane,nativeElementId:101,hostNativeElementId:102,footprintFeet:aperture,normalFeet:[1,0],hostRelation:{elementId:101,hostId:102,evidence:"persisted"},hasExplicitOwnershipReview:false},
    originalExactFloorParts:exact(rect(-5,-5,5,5)),originalObstacles:[{kind:"native-door-leaf",nativeElementId:101,hostNativeElementId:102,sourceModelSha256,parts:exact(aperture)}],
    completeOriginalOwners:[102,103].map(id=>({...plane,nativeElementId:id,sourceCategoryId:-2000011,cutElevationFeet:10.1,...(id===103?{sourceNativeHostRelationsVerified:true as const}:{}),originalPhysicalChildIds:id===103?[104]:[]})),
    originalCheckedSourceElementIds:new Set([102,103,104]),physicalScope:{...plane,materialCutElevationFeet:10.1,sourceTreadHeadroomVetoFeet:6,includesAllOriginalWalkingOperands:true,includesPositiveMaterialParts:true,includesLowSlabs:true,includesRestrictedMasks:true,unclassifiedSourceElementIds:[]}};
  mutate?.(authority);
  const request={...plane,nativeDoorElementId:101,nativeHostElementId:102,originalNativeApertureFeet:aperture,fromDepthFeet:.7,toDepthFeet:.7,from:[-.8999999999999999,0] as [number,number],to:[.8999999999999999,0] as [number,number],footprint:exact(rect(-.8999999999999999,-1,.8999999999999999,1)),legacyBlockingNativeElementIds:[103]};
  const sourceCheck=createCheckedNativeDoorBridgeProof(authority);let replayAllowed=true,calls=0;
  const door:NonNullable<IndoorDataset["doors"]>[number]={id:"door:20:101",levelId:20,nativeElementId:101,hostWallNativeElementId:102,pointFeet:[0,0],footprintFeet:aperture,normalFeet:[1,0],roomKeys:["a","b"],state:"connected"};
  const geometry={walls:[{elementId:103,polygon:rect(-1,-2,1,2),approximate:false}],columns:[] as {elementId:number;polygon:[number,number][];approximate:boolean}[]};
  const original={sourceModelSha256,physicalLevelId:20,elevationFeet:10,door,from:request.from,to:request.to,footprintFeet:[[-.8999999999999999,-1],[-.8999999999999999,1],[.8999999999999999,1],[.8999999999999999,-1]] as [[number,number],[number,number],[number,number],[number,number]],legacyBlockingNativeElementIds:[103],geometry,checkOriginalBridge:()=>{calls++;return replayAllowed&&sourceCheck(request);}};
  const portal:RoomPortal={doorId:101,rooms:["a","b"],point:[0,0],from:request.from,to:request.to,halfWidth:.2,halfHeight:1.5,footprint:aperture,normal:[1,0]};
  const node=(id:string,roomKey:string,p:[number,number]):IndoorNode=>({id,roomKey,levelId:20,building:"a",surfaceId:"a20",pointFeet:[...p,10],geographic:[0,0],kind:"portal"});
  const edge:IndoorEdge={id:door.id,from:door.id+":0",to:door.id+":1",kind:"door",nativeElementId:101,roomKeys:["a","b"],lengthMetres:0,pointsFeet:[],enabled:true,accessible:"unknown",evidence:"original"};
  const current={sourceModelSha256,physicalLevelId:20,door,edge,from:node(edge.from,"a",portal.from),to:node(edge.to,"b",portal.to),geometry,openings:[portal]};
  return {original,portal,current,callCount:()=>calls,refuseReplay:()=>{replayAllowed=false;}};
}
const bind=(f:ReturnType<typeof fixture>)=>{const candidate=capturePendingNativeDoorAssemblyCandidate(f.original);assert(candidate);const proof=bindPendingNativeDoorAssemblyPortal(candidate,f.portal);assert(proof);return proof;};

test("the exact selected original two-foot source bridge survives the second legacy gate",()=>{
  const f=fixture(),proof=bind(f);assert.equal(nativeRouteBlocker(f.current.geometry,[f.portal])(f.portal.from,f.portal.to),true);
  const geometry=pendingNativeDoorAssemblyGeometry(proof,f.current);assert(geometry);assert.equal(nativeRouteBlocker(geometry,[f.portal])(f.portal.from,f.portal.to),false);assert.equal(f.callCount(),2);
  assert.equal(f.current.edge.accessible,"unknown");assert.equal(f.current.geometry.walls.length,1);
});
test("a copied or serialized candidate/portal never carries source authority",()=>{
  const f=fixture(),candidate=capturePendingNativeDoorAssemblyCandidate(f.original)!;
  assert.equal(bindPendingNativeDoorAssemblyPortal({...candidate},f.portal),undefined);
  const proof=bind(f);assert.equal(pendingNativeDoorAssemblyGeometry(JSON.parse(JSON.stringify(proof)),f.current),undefined);
});
test("only the actually selected original candidate can bind its portal",()=>{
  const f=fixture(),candidate=capturePendingNativeDoorAssemblyCandidate(f.original)!;
  assert.equal(bindPendingNativeDoorAssemblyPortal(candidate,{...f.portal,from:[-.9,0]}),undefined);
  assert.equal(bindPendingNativeDoorAssemblyPortal(candidate,{...f.portal,doorId:999}),undefined);
});
test("the current exact source/plane/door/owner/endpoints/aperture must remain unchanged",()=>{
  const mutations=[
    (f:ReturnType<typeof fixture>)=>{f.current.sourceModelSha256="b".repeat(64);},
    (f:ReturnType<typeof fixture>)=>{f.current.physicalLevelId=21;},
    (f:ReturnType<typeof fixture>)=>{f.current.door.hostWallNativeElementId=999;},
    (f:ReturnType<typeof fixture>)=>{f.current.door.footprintFeet![0]![0]+=1e-12;},
    (f:ReturnType<typeof fixture>)=>{f.current.from.pointFeet[0]+=1e-12;},
    (f:ReturnType<typeof fixture>)=>{f.current.from.pointFeet[2]+=1e-12;},
    (f:ReturnType<typeof fixture>)=>{f.current.edge.roomKeys=["foreign","b"];},
    (f:ReturnType<typeof fixture>)=>{f.current.to.roomKey="foreign";},
    (f:ReturnType<typeof fixture>)=>{f.current.edge.nativeElementId=999;},
    (f:ReturnType<typeof fixture>)=>{f.current.edge.pointsFeet=[[0,100,10]];},
  ];for(const mutate of mutations){const f=fixture(),proof=bind(f);mutate(f);assert.equal(pendingNativeDoorAssemblyGeometry(proof,f.current),undefined);}
});
test("the actual source query must pass again at the pending gate",()=>{const f=fixture(),proof=bind(f);f.refuseReplay();assert.equal(pendingNativeDoorAssemblyGeometry(proof,f.current),undefined);assert.equal(f.callCount(),2);});
test("changed or added legacy records with the same owner cannot inherit the source proof",()=>{
  for(const mode of["moved","added"]){const f=fixture(),proof=bind(f);if(mode==="moved")f.current.geometry.walls[0]!.polygon[0]![0]+=1e-12;else f.current.geometry.walls.push({...f.current.geometry.walls[0]!,polygon:rect(-.1,-2,.1,2)});assert.equal(pendingNativeDoorAssemblyGeometry(proof,f.current),undefined);}
});
test("every remaining foreign wall and column still blocks under the unchanged aperture rules",()=>{
  for(const kind of["walls","columns"] as const){const f=fixture(),proof=bind(f);f.current.geometry[kind].push({elementId:999,polygon:rect(-.8,-2,-.7,2),approximate:false});assert.equal(pendingNativeDoorAssemblyGeometry(proof,f.current),undefined);}
});
test("unknown source children, foreign coincident material, raised panels and exact floor holes cannot issue a candidate",()=>{
  const mutations=[
    (a:NativeDoorBridgeAuthority)=>{a.originalCheckedSourceElementIds=new Set([102,103]);},
    (a:NativeDoorBridgeAuthority)=>{a.originalObstacles=[...a.originalObstacles,{kind:"physical-material",nativeElementId:999,sourceModelSha256:a.sourceModelSha256,parts:exact(a.originalDoor.footprintFeet)}];},
    (a:NativeDoorBridgeAuthority)=>{a.originalObstacles=[...a.originalObstacles,{kind:"raised-panel",nativeElementId:999,sourceModelSha256:a.sourceModelSha256,parts:exact(rect(-.1,.8,.1,.9))}];},
    (a:NativeDoorBridgeAuthority)=>{a.originalExactFloorParts=nativeRationalOverlay("union",[[rect(-5,-5,5,5),rect(-.1,.8,.1,.9)]]);},
  ];for(const mutate of mutations){const f=fixture(mutate);assert.equal(capturePendingNativeDoorAssemblyCandidate(f.original),undefined);}
});

test("a foreign side intrusion blocks the original full-width tracks even while its centre remains clear",()=>{
  const f=fixture(),proof=bind(f);f.current.geometry.columns.push({elementId:999,polygon:rect(-.8,.9,-.7,1.1),approximate:false});
  assert.equal(nativeRouteBlocker({...f.current.geometry,walls:[]},[f.portal])(f.portal.from,f.portal.to),false);
  assert.equal(pendingNativeDoorAssemblyGeometry(proof,f.current),undefined);
});

test("the actual pending-portal compiler block refuses a failed captured proof instead of its clear legacy centreline",()=>{
  // Execute the original compiler seam, not a test-side copy of its branches.
  // This avoids adding a mutation callback or another authority to production.
  const source=fs.readFileSync(new URL("../lib/reviter/indoor-pipeline.ts",import.meta.url),"utf8"),file=ts.createSourceFile("indoor-pipeline.ts",source,ts.ScriptTarget.Latest,true);
  const prepare=file.statements.find((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text==="prepareIndoorDataset")!;
  // Compilation now lives inside the session-cleanup try/finally scope.
  const compilation=prepare.body!.statements.find(ts.isTryStatement);
  assert(compilation?.finallyBlock,"extract the real guarded compiler body");
  const statements=compilation.tryBlock.statements,start=statements.findIndex(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text==="portalFloorVoids"));
  assert(start>=0);const loop=statements[start+1]!;assert(ts.isForOfStatement(loop)&&loop.expression.getText(file)==="pending");
  const code=transformSync(source.slice(statements[start]!.getStart(file),loop.getEnd()),{loader:"ts",format:"esm"}).code;
  const execute=new Function("scope",`const {dataset,nodes,pending,issue,sourceRooms,createNativePortalFloorVoidQuery,nativeRouteBlocker,physicalPortalBarrierScope,pendingPhysicalLevels,geometries,openings,pendingAssemblyBridges,pendingNativeDoorAssemblyGeometry,modelSha256,fit,DMath,connectedTerminals}=scope;\n${code}`);
  for(const mode of["positive","foreign-side","intermediate-detour"]){
    const f=fixture();f.current.geometry.walls[0]!.polygon=rect(-.8,.8,-.7,1.1);const proof=bind(f);
    if(mode==="foreign-side")f.current.geometry.columns.push({elementId:999,polygon:rect(-.4,.9,-.3,1.1),approximate:false});
    if(mode==="intermediate-detour")f.current.edge.pointsFeet=[[0,100,10]];
    assert.equal(nativeRouteBlocker(f.current.geometry,[f.portal])(f.portal.from,f.portal.to),false,"legacy centreline alone cannot catch this case");
    const dataset={doors:[f.current.door],edges:[] as IndoorEdge[]},issues:string[]=[];
    execute({dataset,nodes:new Map([f.current.from,f.current.to].map(n=>[n.id,n])),pending:[f.current.edge],issue:(code:string)=>issues.push(code),sourceRooms:[{key:"a"},{key:"b"}],
      // Floor refusal is covered independently; this seam isolates the later
      // barrier decision after an already successful original full-floor proof.
      createNativePortalFloorVoidQuery:()=>()=>[],nativeRouteBlocker,physicalPortalBarrierScope,pendingPhysicalLevels:new Map([[f.current.edge.id,20]]),geometries:new Map([[20,f.current.geometry]]),openings:new Map([[20,[f.portal]]]),pendingAssemblyBridges:new Map([[f.current.edge.id,proof]]),pendingNativeDoorAssemblyGeometry,modelSha256:f.current.sourceModelSha256,fit:{scaleMetresPerFoot:.3048},DMath:Math,connectedTerminals:new Set()});
    assert.equal(dataset.edges.length,mode==="positive"?1:0,mode);assert.deepEqual(issues,mode==="positive"?[]:["connection-native-assembly-review"],mode);
  }
});
