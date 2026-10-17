import test from "node:test";
import assert from "node:assert/strict";
import { proposeNativeDoorTerminalArrival, type NativeDoorTerminalArrivalChecks, type NativeDoorTerminalArrivalSource } from "../lib/reviter/native-door-terminal-arrival.ts";
import type { IndoorDataset } from "../lib/reviter/indoor-contract.ts";
import { nativeCirculationGeometryKey } from "../lib/reviter/native-circulation-geometry.ts";
import { encodeNativeExactTopology } from "../lib/reviter/native-exact-planar-topology.ts";
import { nativeRationalOverlay, NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION } from "../lib/reviter/native-rational-overlay.ts";
import { createWorkerRouteCalculator } from "../../openindoormaps/app/indoor-project/route-calculation.ts";
import { resolveRouteArrival } from "../../openindoormaps/app/indoor-project/route-arrival.ts";
import type { IndoorDataset as ViewerData } from "../../openindoormaps/app/indoor-project/contract.ts";

const rect = (a:number,b:number,c:number,d:number):[number,number][] => [[a,b],[c,b],[c,d],[a,d]];
function fixture() {
  const sha="a".repeat(64), roomsSha="b".repeat(64), own=rect(0,0,10,10), hall=rect(10,0,20,10),
    dwg={sha256:"c".repeat(64),sectionId:"fixture",entityHandle:"1",rawText:"T1"},
    record=(key:string,rings:[number,number][][],arrivalNodeId?:string)=>({key,number:key==="target"?"T1":"H1",name:key,
      building:"B",levelId:1,surfaceId:"B:1:0",elevationFeet:0,elevationEvidence:"fixture source floor",
      circulation:true,stair:false,walkable:true,access:"public",ringsFeet:rings,arrivalNodeId,properties:{},confidence:1}),
    node=(id:string,key:string,p:[number,number,number],kind:string)=>({id,roomKey:key,levelId:1,building:"B",surfaceId:"B:1:0",pointFeet:p,kind,geographic:[0,0]});
  const target=record("target",[own]), corridor=record("hall",[hall],"arrival:hall");target.properties={dwg,spaceUse:{kind:"hallway",evidence:"user-reported"}};
  const data={format:"reviter-indoor",version:1,generator:"reviter/indoor-pipeline-1",source:{modelSha256:sha,roomsSha256:roomsSha,modelFileName:"fixture.rvt"},
    records:[target,corridor],nodes:[node("arrival:target","target",[-2,5,0],"arrival"),node("own-portal","target",[9,5,0],"portal"),
      node("other-portal","hall",[11,5,0],"portal"),node("own-junction","target",[5,5,0],"junction"),node("arrival:hall","hall",[15,5,0],"arrival")],
    edges:[{id:"door",kind:"door",from:"own-portal",to:"other-portal",roomKeys:["target","hall"],nativeElementId:2,
      pointsFeet:[[9,5,0],[11,5,0]],lengthMetres:2*.3048,enabled:true,accessible:"unknown",evidence:"fixture measured native door"},
      {id:"own-walk",kind:"walk",nativeCellId:"cell",from:"own-portal",to:"own-junction",roomKeys:["target"],
        pointsFeet:[[9,5,0],[5,5,0]],lengthMetres:4*.3048,enabled:true,accessible:"unknown",evidence:"fixture existing native lateral approach"},
      {id:"hall-walk",kind:"walk",from:"other-portal",to:"arrival:hall",roomKeys:["hall"],pointsFeet:[[11,5,0],[15,5,0]],
        lengthMetres:4*.3048,enabled:true,accessible:"unknown",evidence:"fixture hallway approach"}],
    doors:[{id:"door",levelId:1,nativeElementId:2,hostWallNativeElementId:50,pointFeet:[10,5],footprintFeet:rect(9.5,4,10.5,6),normalFeet:[1,0],roomKeys:["target","hall"],state:"connected"}],
    walkingSupport:{version:1,sourceModelSha256:sha,floors:[{nativeElementId:1,elevationFeet:0,ringsFeet:[rect(0,0,20,10)]}]},
    nativeLevels:[{id:1,name:"Main",elevationFeet:0}],floors:[{id:"1",name:"Main",levelIds:[1],elevationFeet:0}],walls:[],issues:[],report:{},
    alignment:{originFeet:[0,0,0],originGeographic:[-122,53],projectionLatitude:53,rotationRadians:0,horizontalMetresPerFoot:.3048,verticalMetresPerFoot:.3048,rmsMetres:0}} as unknown as IndoorDataset;
  const parts=nativeRationalOverlay("union",[[rect(0,0,9.5,10)]]),
    cell={id:"cell",exactFaceId:"face",levelIds:[1],elevationFeet:0,roomKeys:["target"],nativeFloorIds:[1],ringsFeet:[rect(0,0,9.5,10)],sourceCoverage:1};
  data.circulationGeometry={version:1,sourceModelSha256:sha,sourceGeometryKey:"",preparedRoomKeys:["target","hall"],cells:[cell]};
  function rebind() {
    data.circulationGeometry!.sourceGeometryKey=nativeCirculationGeometryKey(data);
    data.circulationGeometry!.exactTopology=encodeNativeExactTopology({sourceModelSha256:sha,
      sourceGeometryKey:data.circulationGeometry!.sourceGeometryKey,kernelVersion:NATIVE_RATIONAL_OVERLAY_KERNEL_VERSION},[{id:"face",parts}]);
  }rebind();
  const source:NativeDoorTerminalArrivalSource={sourceModelSha256:sha,sourceRoomsSha256:roomsSha,
    annotation:{key:"target",number:"T1",name:"target",levelId:1,polygonFeet:own,labelPointFeet:[-2,5],dwg,
      spaceUse:{kind:"hallway",evidence:"user-reported"},confidence:1}},
    checks:NativeDoorTerminalArrivalChecks={physicalApproachParts:()=>parts,originalEdge:()=>true};
  return {data,source,checks,cell,parts,rebind};
}

test("a source label outside its own polygon proposes only the existing inside native door approach without editing source",()=>{
  const {data,source,checks}=fixture(),before=structuredClone(data),proof=proposeNativeDoorTerminalArrival(data,source,checks);
  assert(proof);assert.equal(proof.proposedArrivalNodeId,"own-portal");assert.deepEqual(proof.proposedArrivalPointFeet,[9,5,0]);
  assert.deepEqual(proof.originalArrivalPointFeet,[-2,5,0]);assert.deepEqual(proof.originalLabelPointFeet,[-2,5]);
  assert.equal(proof.arrivalSemantics,"inside-at-native-door-approach");assert.equal(proof.walkingStripWidthFeet,2);
  assert.deepEqual(proof.roomKeys,["hall","target"]);assert.deepEqual(data,before);
});

test("a source route point, existing arrival, valid interior label, stale source annotation or changed original seed prevents reassignment",()=>{
  for(const mutate of[(f:ReturnType<typeof fixture>)=>{f.source.annotation.routePointFeet=[3,3]},
    (f:ReturnType<typeof fixture>)=>{f.data.records[0]!.arrivalNodeId="own-junction"},
    (f:ReturnType<typeof fixture>)=>{f.source.annotation.labelPointFeet=[3,3];f.data.nodes[0]!.pointFeet=[3,3,0]},
    (f:ReturnType<typeof fixture>)=>{f.source.sourceRoomsSha256="d".repeat(64)},
    (f:ReturnType<typeof fixture>)=>{f.source.annotation.polygonFeet=rect(0,0,8,10)},
    (f:ReturnType<typeof fixture>)=>{f.data.nodes[0]!.pointFeet[0]+=.001}]){
    const f=fixture();mutate(f);f.rebind();assert.equal(proposeNativeDoorTerminalArrival(f.data,f.source,f.checks),undefined);
  }
});

test("two actual own measured entries cannot be reduced to the closer or first physically supported door",()=>{
  const f=fixture(),second=structuredClone(f.data.doors![0]!);second.id="second-door";second.nativeElementId=3;f.data.doors!.push(second);f.rebind();
  assert.equal(proposeNativeDoorTerminalArrival(f.data,f.source,f.checks),undefined);
});

test("missing physical proof, real cell holes, narrower strips and unrelated named floors remain refusals",()=>{
  const absent=fixture();absent.checks.physicalApproachParts=()=>undefined;assert.equal(proposeNativeDoorTerminalArrival(absent.data,absent.source,absent.checks),undefined);
  const blocked=fixture();blocked.checks.originalEdge=()=>false;assert.equal(proposeNativeDoorTerminalArrival(blocked.data,blocked.source,blocked.checks),undefined);
  for(const parts of[nativeRationalOverlay("union",[[rect(0,0,9.5,10),rect(6,4.9,7,5.1)]]),
    nativeRationalOverlay("union",[[rect(0,4.5,9.5,5.5)]]),nativeRationalOverlay("union",[[rect(30,30,40,40)]])]){
    const f=fixture();f.checks.physicalApproachParts=()=>parts;assert.equal(proposeNativeDoorTerminalArrival(f.data,f.source,f.checks),undefined);
  }
  const floor=fixture();floor.data.walkingSupport!.floors.push({nativeElementId:9,elevationFeet:0,ringsFeet:[rect(30,30,40,40)]});floor.cell.nativeFloorIds=[9];floor.rebind();
  assert.equal(proposeNativeDoorTerminalArrival(floor.data,floor.source,floor.checks),undefined);
});

test("the existing lateral branch must retain its owner, fixed door endpoints, exact floor and original own centreline",()=>{
  for(const mutate of[(f:ReturnType<typeof fixture>)=>{f.data.nodes[1]!.roomKey="hall"},
    (f:ReturnType<typeof fixture>)=>{f.data.nodes[1]!.pointFeet[0]+=.001},
    (f:ReturnType<typeof fixture>)=>{f.data.nodes[1]!.pointFeet[2]=.001},
    (f:ReturnType<typeof fixture>)=>{f.cell.elevationFeet=.001},
    (f:ReturnType<typeof fixture>)=>{f.cell.roomKeys=["hall"]},
    (f:ReturnType<typeof fixture>)=>{f.data.edges[1]!.pointsFeet.splice(1,0,[12,7,0])},
    (f:ReturnType<typeof fixture>)=>{f.data.doors![0]!.state="unmatched"},
    (f:ReturnType<typeof fixture>)=>{f.data.edges[0]!.enabled=false},
    (f:ReturnType<typeof fixture>)=>{f.data.edges[1]!.enabled=false}]){
    const f=fixture();mutate(f);f.rebind();assert.equal(proposeNativeDoorTerminalArrival(f.data,f.source,f.checks),undefined);
  }
});

test("all existing cell, door and branch owner permissions remain required",()=>{
  for(const key of["target","hall"]){const f=fixture();f.data.records.find(r=>r.key===key)!.access="staff";f.rebind();
    assert.equal(proposeNativeDoorTerminalArrival(f.data,f.source,f.checks),undefined);}
  const f=fixture(),landing=structuredClone(f.data.records[0]!);landing.key="landing";landing.access="staff";landing.properties={generatedLanding:true};
  f.data.records.push(landing);f.cell.roomKeys.push("landing");f.data.edges[1]!.roomKeys.push("landing");f.rebind();
  assert.equal(proposeNativeDoorTerminalArrival(f.data,f.source,f.checks),undefined);
});

/** Ordinary small calculator contract only. It is not a UNBC physical replay. */
function adoptedCalculatorFixture() {
  const f=fixture(),proof=proposeNativeDoorTerminalArrival(f.data,f.source,f.checks)!;assert(proof);
  const data=structuredClone(f.data) as unknown as ViewerData;
  data.records[0]!.arrivalNodeId=proof.proposedArrivalNodeId;
  // Isolate the source-record→existing-portal policy/arrival-mode contract;
  // original native physical geometry is separately required above and in QA.
  delete data.circulationGeometry;
  for(const edge of data.edges)delete edge.nativeCellId;
  return {data,proof};
}

test("the actual calculator arrives inside at the existing portal and derives a distinct actual doorway threshold",()=>{
  const {data,proof}=adoptedCalculatorFixture(),before=structuredClone(data),calculate=createWorkerRouteCalculator(data);
  for(const [start,end]of[["target","hall"],["hall","target"]]){
    const result=calculate(start!,end!,"public");assert(result.route);assert(result.route.nodeIds.includes("own-portal"));
    assert(!result.route.nodeIds.includes("arrival:target"));assert(result.route.unknownAccessibilityEdges>0);
  }
  const inside=calculate("hall","target","public").route!;
  assert.deepEqual(inside.paths.at(-1)!.pointsFeet.at(-1),proof.proposedArrivalPointFeet);
  const doorway=resolveRouteArrival(data,inside,"target","doorway");assert(doorway.route);
  assert.equal(doorway.route.arrival?.mode,"doorway");assert.deepEqual(doorway.route.arrival?.pointFeet,[10,5,0]);
  assert.notDeepEqual(doorway.route.arrival?.pointFeet,proof.proposedArrivalPointFeet);
  const hallway=resolveRouteArrival(data,inside,"target","hallway");assert(hallway.route);assert.equal(hallway.route.arrival?.mode,"hallway");
  assert.equal(calculate("hall","target","accessible").route,null);assert.deepEqual(data,before);
});

test("arrival and departure policy still refuses source-room, opposite-room and foreign landing staff permissions",()=>{
  for(const key of["target","hall","landing"]){
    const {data}=adoptedCalculatorFixture();
    if(key==="landing"){const landing=structuredClone(data.records[0]!);landing.key="landing";landing.arrivalNodeId=undefined;
      landing.properties={generatedLanding:true};landing.access="staff";data.records.push(landing);data.edges[0]!.roomKeys.push("landing");}
    else data.records.find(r=>r.key===key)!.access="staff";
    const calculate=createWorkerRouteCalculator(data);assert.equal(calculate("target","hall","public").route,null,key);
    assert.equal(calculate("hall","target","public").route,null,key);
  }
});
