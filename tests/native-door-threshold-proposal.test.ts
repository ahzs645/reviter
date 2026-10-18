import assert from "node:assert/strict";
import test from "node:test";
import { proposeNativeDoorThresholdProfile } from "../lib/reviter/native-door-threshold-proposal.ts";
const box=(halfWidth=2)=>[0,50/304.8].flatMap(z=>[
  [-.25,-halfWidth,z],[-.25,halfWidth,z],[.25,halfWidth,z],[.25,-halfWidth,z],
] as [number,number,number][]);
const input=()=>({originalOrientedBox:box(),baseElevationFeet:0,topElevationFeet:50/304.8,
  fromFeet:[-3,0,0] as const,toFeet:[5,0,0] as const});
test("50 mm proposal keeps both vertical steps and original geometry; grants no flat or wheelchair route",()=>{
  const source=input(),before=JSON.stringify(source),p=proposeNativeDoorThresholdProfile(source);
  assert.equal(JSON.stringify(source),before);assert.equal(p.fullTwoFootEnvelopeSpanProposed,true);
  assert.deepEqual(p.displayProfileFeet,[[-3,0,0],[-.25,0,0],[-.25,0,50/304.8],[.25,0,50/304.8],[.25,0,0],[5,0,0]]);
  assert.equal(p.routingActivationAllowed,false);assert.equal(p.proposedWheelchairEligible,false);
  assert.equal(p.ordinaryFlatDoorApproval,false);assert.equal(p.sourceBoundIsNotQualifiedBody,true);
});
test("reverse approach reverses the proposed step sequence",()=>{
  const source=input(),p=proposeNativeDoorThresholdProfile(source),q=proposeNativeDoorThresholdProfile({...source,fromFeet:source.toFeet,toFeet:source.fromFeet});
  assert.deepEqual(q.displayProfileFeet,[...p.displayProfileFeet].reverse());
});
test("finite source span cannot grow to fit a two-foot proposal",()=>{
  const p=proposeNativeDoorThresholdProfile({...input(),originalOrientedBox:box(1-2**-40)});
  assert.equal(p.fullTwoFootEnvelopeSpanProposed,false);assert.equal(p.routingActivationAllowed,false);
});
test("unsupported heights, missing corners and non-crossing approaches are refused",()=>{
  const source=input();
  assert.throws(()=>proposeNativeDoorThresholdProfile({...source,fromFeet:[-3,0,.1]}));
  assert.throws(()=>proposeNativeDoorThresholdProfile({...source,originalOrientedBox:source.originalOrientedBox.slice(1)}));
  assert.throws(()=>proposeNativeDoorThresholdProfile({...source,fromFeet:[2,0,0]}));
  const altered=structuredClone(source);altered.originalOrientedBox[4]![0]+=.01;
  assert.throws(()=>proposeNativeDoorThresholdProfile(altered));
});
