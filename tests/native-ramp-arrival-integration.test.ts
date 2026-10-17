import test from "node:test";
import assert from "node:assert/strict";
import { applyNativeRampTerminalArrival } from "../lib/reviter/native-ramp-arrival-integration.ts";
import { fixture } from "./fixtures/native-ramp-arrival-qualification.ts";
import { createWorkerRouteCalculator } from "../../openindoormaps/app/indoor-project/route-calculation.ts";
import type { IndoorDataset } from "../../openindoormaps/app/indoor-project/contract.ts";

test("the unwired integration changes only a derived arrival pointer after fresh qualification", () => {
  const { d, recipes } = fixture(), expected = structuredClone(d);
  expected.records[0]!.arrivalNodeId = "ramp:10:lower";
  const result = applyNativeRampTerminalArrival(d, recipes, "target", () => true);
  assert.ok(result);assert.deepEqual(d, expected);
  assert.deepEqual(d.nodes[0]!.pointFeet, [5,0,0], "original flat seed is retained for provenance");
  assert.equal(d.edges[0]!.accessible, "unknown");
  assert.equal(applyNativeRampTerminalArrival(d, recipes, "target", () => true), undefined,
    "an existing arrival cannot be silently reassigned again");
  const refused = fixture(), original = structuredClone(refused.d);
  assert.equal(applyNativeRampTerminalArrival(refused.d, refused.recipes, "target", () => false), undefined);
  assert.deepEqual(refused.d, original);
});

/** This small ordinary routing fixture isolates the arrival-pointer ownership
 * contract. Actual UNBC original ramp/door/physical cells are checked separately;
 * this fixture is not evidence for their native geometry. */
function calculatorFixture() {
  const sha = "a".repeat(64), ring: [number,number][] = [[0,0],[10,0],[10,10],[0,10]],
    room = (key:string, arrivalNodeId:string, access="unknown") => ({key,number:key,name:key,building:"B",levelId:1,
      elevationFeet:0,elevationEvidence:"fixture",surfaceId:"B:1:0",circulation:true,stair:false,walkable:true,access,
      arrivalNodeId,ringsFeet:[ring],properties:{},confidence:1}),
    node = (id:string,roomKey:string,kind:string,p:[number,number,number]) => ({id,roomKey,kind,pointFeet:p,
      levelId:1,building:"B",surfaceId:"B:1:0",geographic:[0,0]});
  const target=room("target","ramp-lower"),landing=room("landing","ramp-lower"),hall=room("hall","hall-arrival","public");
  landing.properties={generatedLanding:true};
  return {format:"reviter-indoor",version:1,generator:"reviter/indoor-pipeline-1",source:{modelSha256:sha,roomsSha256:"b".repeat(64),modelFileName:"fixture.rvt"},
    records:[target,landing,hall],nodes:[node("arrival:target","target","arrival",[5,5,0]),node("ramp-lower","landing","connector",[2,5,0]),node("hall-arrival","hall","arrival",[8,5,0])],
    edges:[{id:"approach",kind:"walk",from:"ramp-lower",to:"hall-arrival",roomKeys:["target","landing","hall"],
      pointsFeet:[[2,5,0],[8,5,0]],lengthMetres:6*.3048,enabled:true,accessible:"unknown",evidence:"fixture original walk"}],
    nativeLevels:[{id:1,name:"Main",elevationFeet:0}],floors:[{id:"1",name:"Main",levelIds:[1],elevationFeet:0}],
    walls:[],doors:[],issues:[],report:{},walkingSupport:{version:1,sourceModelSha256:sha,floors:[{nativeElementId:1,elevationFeet:0,ringsFeet:[ring]}]},
    alignment:{originFeet:[0,0,0],originGeographic:[-122,53],projectionLatitude:53,rotationRadians:0,horizontalMetresPerFoot:.3048,verticalMetresPerFoot:.3048,rmsMetres:0}} as unknown as IndoorDataset;
}

test("the actual worker calculator permits arriving and departing through an existing landing-owned alias without moving the original seed", () => {
  const d=calculatorFixture(), original=structuredClone(d),calculate=createWorkerRouteCalculator(d);
  for(const [start,end]of[["target","hall"],["hall","target"]]){
    const result=calculate(start!,end!,"public");assert.ok(result.route);
    assert.equal(result.route.nodeIds[start==="target"?0:result.route.nodeIds.length-1],"ramp-lower");
    assert.ok(result.route.unknownAccessAreas.includes("target"));
    assert.equal(result.route.unknownAccessibilityEdges,1);
  }
  assert.equal(calculate("target","hall","accessible").route,null,"aliasing a node never upgrades an unknown walking edge");
  assert.deepEqual(d,original);
});

test("the actual worker calculator retains destination and landing-owner staff restrictions", () => {
  for(const key of["target","landing"]){
    const d=calculatorFixture();d.records.find(r=>r.key===key)!.access="staff";
    const calculate=createWorkerRouteCalculator(d);
    assert.equal(calculate("target","hall","public").route,null);
    assert.equal(calculate("hall","target","public").route,null);
  }
});
