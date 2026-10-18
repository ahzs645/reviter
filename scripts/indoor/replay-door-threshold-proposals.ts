/** Replay proposed source-envelope profiles only; never actual route approval. */
import { readFileSync,writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { proposeNativeDoorThresholdProfile } from "../../lib/reviter/native-door-threshold-proposal.ts";
import { Rational } from "../../lib/reviter/native-rational-overlay.ts";
type Point3=[number,number,number];
type Row={nativeDoorElementId:number;originalDoor:{state:string};floor:string;
  sideProposal:{status:string};fullWidthTipChecks?:{fullTwoFootTipInsideOriginalIdentity:boolean}[];
  floorSupported?:boolean;thirdRoomKeys?:string[];sameRegisteredSection?:boolean;
  proposedPointsFeet?:[Point3,Point3];proposedOwnerNumbers?:string[];
  elevationFeet:number;members:{originalOrientedBox:Point3[];topElevationFeet:number}[];
  thresholdProfileProposal?:{fullTwoFootEnvelopeSpanProposed:boolean;exactProfileFeet:unknown;
    proposedWheelchairEligible:boolean;routingActivationAllowed:boolean}};
const [file,output]=process.argv.slice(2);
if(!file||!output)throw Error("Usage: replay-door-threshold-proposals.ts SURVEY.json NEW-OUTPUT.json");
const raw=readFileSync(file),data=JSON.parse(raw.toString()) as {format:string;sourceModelSha256:string;authorityGranted:boolean;results:Row[]};
if(data.format!=="native-door-threshold-survey-v1"||data.authorityGranted!==false)
  throw Error("An explicitly non-authoritative complete source survey is required");
function encode(value:unknown):unknown{
  if(value instanceof Rational)return {numerator:value.n.toString(),denominator:value.d.toString()};
  if(Array.isArray(value))return value.map(encode);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
  return value;
}
const selected=data.results.filter(r=>r.originalDoor.state!=="connected"&&r.sideProposal.status==="proposed"&&
  r.floorSupported===true&&r.thirdRoomKeys?.length===0&&r.sameRegisteredSection===true&&
  r.fullWidthTipChecks?.length===2&&r.fullWidthTipChecks.every(t=>t.fullTwoFootTipInsideOriginalIdentity)&&
  r.members.length===1&&r.thresholdProfileProposal?.fullTwoFootEnvelopeSpanProposed===true);
if(!selected.length)throw Error("No complete owner/envelope proposals to replay");
const cases=selected.map(r=>{
  const member=r.members[0]!,points=r.proposedPointsFeet!;
  const input={originalOrientedBox:member.originalOrientedBox,baseElevationFeet:r.elevationFeet,
    topElevationFeet:member.topElevationFeet,fromFeet:points[0],toFeet:points[1]};
  const before=JSON.stringify(input),forward=proposeNativeDoorThresholdProfile(input),
    reverse=proposeNativeDoorThresholdProfile({...input,fromFeet:input.toFeet,toFeet:input.fromFeet});
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(encode(forward.exactProfileFeet),r.thresholdProfileProposal!.exactProfileFeet);
  assert.deepEqual(encode(reverse.exactProfileFeet),encode([...forward.exactProfileFeet].reverse()));
  for(const p of [forward,reverse]){
    assert.equal(p.fullTwoFootEnvelopeSpanProposed,true);assert.equal(p.routingActivationAllowed,false);
    assert.equal(p.proposedWheelchairEligible,false);assert.equal(p.ordinaryFlatDoorApproval,false);
  }
  return {nativeDoorElementId:r.nativeDoorElementId,floor:r.floor,owners:r.proposedOwnerNumbers,
    exactForwardReverseEnvelopeProfilesMatch:true,sourceUnchanged:true,
    actualRouteCalculated:false,routingActivationAllowed:false};
});
const receipt={format:"native-door-threshold-proposal-replay-v1",sourceModelSha256:data.sourceModelSha256,
  surveySha256:createHash("sha256").update(raw).digest("hex"),
  scope:"Envelope proposal reproduction and exact reversal, not original body, clearance, access or actual routes",
  caseCount:cases.length,proposedDirectionalProfiles:cases.length*2,cases,authorityGranted:false};
writeFileSync(output,JSON.stringify(receipt,null,2),{flag:"wx"});
console.log(JSON.stringify({caseCount:cases.length,proposedDirectionalProfiles:cases.length*2,authorityGranted:false}));
