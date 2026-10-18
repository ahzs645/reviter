/** Complete selected-floor source inventory and local connection proposals.
 * It never edits source boundaries/materials or creates enabled route links.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deserialize } from "node:v8";
import { extname } from "node:path";
import type { IndoorDataset } from "../../lib/reviter/indoor-contract.ts";
import type { ConvertResult } from "../../lib/reviter/types.ts";
import type { RoomDirectoryData } from "../../lib/reviter/room-directory.ts";
import { nativeDoorSillCandidates } from "../../lib/reviter/native-door-sill-candidates.ts";
import { proposeNativeDoorSides } from "../../lib/reviter/native-door-side-proposals.ts";
import { nativeRoomIdentityRings } from "../../lib/reviter/native-floor-opening-ownership.ts";
import { nativeRationalOverlay, rational, Rational } from "../../lib/reviter/native-rational-overlay.ts";
import { proposeNativeDoorThresholdProfile } from "../../lib/reviter/native-door-threshold-proposal.ts";
import { nativeRationalAreaCompare, nativeRationalFootprintSupported } from "../../lib/reviter/native-exact-planar-topology.ts";
import { nativeRationalIntersectionOperand } from "../../lib/reviter/native-rational-intersection-broadphase.ts";
import { projectStatedTwoFootWalkingVolume } from "../../lib/reviter/native-stepped-stair-v2-walking-volume.ts";
import { createNativeRoutingMaterialQuery } from "../../lib/reviter/native-routing-material.ts";
import { initializeNativeExactGeosOverlay } from "../../lib/reviter/native-exact-geos-overlay.ts";

const [cacheFile, datasetFile, sourceStateFile, output] = process.argv.slice(2);
if (!cacheFile || !datasetFile || !sourceStateFile || !output)
  throw Error("Usage: audit-native-door-thresholds.ts NATIVE-MODEL.bin COMPLETE-DATASET.json-or-bin CHECKED-SOURCE-STATE.bin NEW-OUTPUT.json");
const sha = (v:string|Uint8Array) => createHash("sha256").update(v).digest("hex");
const rawModel=readFileSync(cacheFile), rawData=readFileSync(datasetFile), rawState=readFileSync(sourceStateFile);
const model=deserialize(rawModel) as ConvertResult;
const data=(extname(datasetFile)===".bin"?deserialize(rawData):JSON.parse(rawData.toString())) as IndoorDataset;
const state=deserialize(rawState) as {modelSha:string;rooms:RoomDirectoryData};
if(state.modelSha!==data.source.modelSha256)throw Error("Source state and dataset belong to different original models");
if(model.nativeMaterialSource?.sourceModelSha256!==data.source.modelSha256)
  throw Error("Native cache must retain the same original-model binding as the complete dataset");
const floors=data.floors.map(f=>({...f,sourceName:f.name,name:f.name.replace(/^Campus /,"")}))
  .filter(f=>["Floor 1","Floor 2","Floor 3","Floor 4"].includes(f.name));
if(floors.length!==4 || new Set(floors.map(f=>f.name)).size!==4)
  throw Error("All four defined campus floors are required for this survey");
const levels=floors.flatMap(f=>f.levelIds), started=performance.now();
await initializeNativeExactGeosOverlay();
const candidates=nativeDoorSillCandidates(model,data,levels);
const records=new Map(data.records.map(r=>[r.key,r]));
const identities=data.records.filter(r=>levels.includes(r.levelId)).map(r=>({key:r.key,levelId:r.levelId,ringsFeet:nativeRoomIdentityRings(data,r)}));
const materialQuery=createNativeRoutingMaterialQuery(data);
const inspect=(candidate: (typeof candidates)[number])=>{
  const door=candidate.originalDoor, proposal=proposeNativeDoorSides(identities,door);
  const basic={...candidate,floor:floors.find(f=>f.levelIds.includes(candidate.levelId))!.name,
    existingOwnerNumbers:door.roomKeys.map(k=>records.get(k)?.number),sideProposal:proposal};
  if(proposal.status!=="proposed")return {...basic,routingActivationAllowed:false};
  const z=candidate.elevationFeet;
  const a:[number,number,number]=[...proposal.from.pointFeet,z],b:[number,number,number]=[...proposal.to.pointFeet,z];
  const strip=nativeRationalOverlay("union",[[projectStatedTwoFootWalkingVolume(a,b,rational(z),rational(z),6).unclippedStatedStripFeet]]);
  const tips=[proposal.from,proposal.to].map(side=>{
    const other=side===proposal.from?b:a, dx=side.pointFeet[0]-other[0],dy=side.pointFeet[1]-other[1],length=Math.hypot(dx,dy);
    const tip:[number,number,number]=[side.pointFeet[0]+dx/length*.025,side.pointFeet[1]+dy/length*.025,z];
    const start:[number,number,number]=[...side.pointFeet,z];
    const footprint=nativeRationalOverlay("union",[[projectStatedTwoFootWalkingVolume(start,tip,rational(z),rational(z),6).unclippedStatedStripFeet]]);
    return {roomKey:side.roomKey,fullTwoFootTipInsideOriginalIdentity:nativeRationalFootprintSupported(footprint,nativeRationalOverlay("union",[identities.find(r=>r.key===side.roomKey)!.ringsFeet]))};
  });
  const thirdRoomKeys=identities.filter(r=>r.levelId===door.levelId&&![proposal.from.roomKey,proposal.to.roomKey].includes(r.key)).filter(r=>{
    const operand=nativeRationalIntersectionOperand(strip,[r.ringsFeet]);
    return operand.length&&nativeRationalAreaCompare(nativeRationalOverlay("intersection",strip,operand),[])>0;
  }).map(r=>r.key);
  const floorParts=data.walkingSupport?.floors.filter(f=>f.elevationFeet===z).flatMap(f=>f.partsFeet??[f.ringsFeet])??[];
  const floorSupported=data.walkingSupport?.sourceModelSha256===data.source.modelSha256&&nativeRationalFootprintSupported(strip,nativeRationalOverlay("union",nativeRationalIntersectionOperand(strip,floorParts)));
  const outsideOriginalDoorVetoIds:number[]=[];
  const parts=materialQuery(z), materialVetoes=parts.parts.flatMap(part=>{
    const operand=nativeRationalIntersectionOperand(strip,[part.rings]);
    if(!operand.length)return [];
    const overlap=nativeRationalOverlay("intersection",strip,operand);
    if(nativeRationalAreaCompare(overlap,[])<=0)return [];
    if(nativeRationalAreaCompare(nativeRationalOverlay("difference",overlap,[[door.footprintFeet!]]),[])>0)outsideOriginalDoorVetoIds.push(part.nativeElementId);
    return [part.nativeElementId];
  });
  const reference=state.rooms.boundaryReference, owners=[proposal.from.roomKey,proposal.to.roomKey].map(k=>records.get(k)!);
  const sections=owners.map(r=>{const dwg=r.properties.dwg as {sha256?:string;sectionId?:string}|undefined;return dwg&&dwg.sha256===reference?.sourceSha256?reference?.sections.find(s=>s.levelId===r.levelId&&s.sectionId===dwg.sectionId&&s.registrationErrorFeet<=.05):undefined;});
  let thresholdProfileProposal:ReturnType<typeof proposeNativeDoorThresholdProfile>|undefined,profileProposalError:string|undefined;
  if(candidate.members.length===1){
    const member=candidate.members[0]!;
    try{thresholdProfileProposal=proposeNativeDoorThresholdProfile({originalOrientedBox:member.originalOrientedBox,
      baseElevationFeet:z,topElevationFeet:member.topElevationFeet,fromFeet:a,toFeet:b});}
    catch(error){profileProposalError=String(error);}
  }else profileProposalError="Multiple members require individual original-body/clearance review";
  return {...basic, proposedOwnerNumbers:owners.map(r=>r.number),proposedPointsFeet:[a,b],
    fullWidthTipChecks:tips,thirdRoomKeys,floorSupported,flatMaterialVetoIds:[...new Set(materialVetoes)],
    outsideOriginalDoorVetoIds:[...new Set(outsideOriginalDoorVetoIds)],
    existingPairMatchesProposal:door.roomKeys.length===2&&owners.every(r=>door.roomKeys.includes(r.key)),
    sameRegisteredSection:!!sections[0]&&sections[0]===sections[1],
    proposedOwnerAccess:owners.map(r=>({key:r.key,walkable:r.walkable,access:r.access,circulation:r.circulation})),
    thresholdProfileProposal,profileProposalError,
    nextRequirement:"Explicit source-supported threshold traversal and complete approach/body/clearance/access checks; no flat or step-free bypass",
    routingActivationAllowed:false};
};
const results=candidates.map(candidate=>{
  try{return inspect(candidate);}
  catch(error){return {...candidate,inspectionError:String(error),routingActivationAllowed:false};}
});
const report={format:"native-door-threshold-survey-v1",sourceModelSha256:data.source.modelSha256,
  modelCacheSha256:sha(rawModel),datasetSha256:sha(rawData),sourceStateSha256:sha(rawState),datasetEncoding:extname(datasetFile)===".bin"?"V8 diagnostic snapshot":"JSON",
  scope:"Complete four-floor sill-pattern inventory and original-room ray/strip proposals, not full routes or 3D stepping qualification",
  implementationSources:Object.fromEntries(["./audit-native-door-thresholds.ts",
    "../../lib/reviter/native-door-side-proposals.ts","../../lib/reviter/native-door-sill-candidates.ts",
    "../../lib/reviter/native-door-threshold-proposal.ts"].map(path=>[path,sha(readFileSync(new URL(path,import.meta.url)))])),
  definedFloors:floors.map(f=>({floor:f.name,sourceName:f.sourceName,levelIds:f.levelIds})),
  sourceUnchanged:sha(readFileSync(cacheFile))===sha(rawModel)&&sha(readFileSync(datasetFile))===sha(rawData)&&sha(readFileSync(sourceStateFile))===sha(rawState),
  originalDoorCount:(data.doors??[]).filter(d=>levels.includes(d.levelId)).length,
  doorStates:floors.map(f=>({floor:f.name,...(data.doors??[]).filter(d=>f.levelIds.includes(d.levelId)).reduce((o,d)=>(o[d.state]=(o[d.state]??0)+1,o),{} as Record<string,number>)})),
  candidateCount:results.length,unpairedCandidates:results.filter(r=>r.originalDoor.state!=="connected").length,
  elapsedSeconds:(performance.now()-started)/1000,results,authorityGranted:false,published:false};
if(!report.sourceUnchanged)throw Error("Source bytes changed during survey");
// Explicit exact-coordinate carrier. Never allow Rational.toJSON or IEEE
// conversion to discard the original fractions used in proposal intersections.
function encode(value:unknown):unknown{
  if(value instanceof Rational)return {numerator:value.n.toString(),denominator:value.d.toString()};
  if(Array.isArray(value))return value.map(encode);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]));
  return value;
}
writeFileSync(output,JSON.stringify(encode(report),null,2),{flag:"wx"});
console.log(JSON.stringify({candidateCount:report.candidateCount,unpairedCandidates:report.unpairedCandidates,sourceUnchanged:report.sourceUnchanged,elapsedSeconds:report.elapsedSeconds}));
