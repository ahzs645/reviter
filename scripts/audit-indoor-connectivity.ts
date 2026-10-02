/** Produce an actionable native-door/lift review inventory without changing routes.
 * node --experimental-strip-types scripts/audit-indoor-connectivity.ts --input prepared.reviter.zip --out audit.json
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {readProjectPackage} from '../lib/reviter/project-package.ts';
import {convertRvtBytes} from '../lib/reviter/convert.ts';
import {directoryDoors,directoryDoorReviews} from '../lib/reviter/directory-navigation.ts';
import {nearestRoomBoundary,containsDirectoryRoomPoint,isWalkable,roomBuilding} from '../lib/reviter/room-directory.ts';
import {supportedSemanticDoorLinks} from '../lib/reviter/semantic-door-links.ts';
import type {ConvertResult} from '../lib/reviter/types.ts';
const args=process.argv.slice(2),option=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1]};
const input=option('--input'),out=option('--out');if(!input||!out)throw Error('Supply --input project.reviter.zip --out review.json [--native-cache model-bound-cache.json].');
const pkg=await readProjectPackage(new Uint8Array(await readFile(resolve(input))));
let model:ConvertResult;
if(option('--native-cache')){
 const cached=JSON.parse(await readFile(resolve(option('--native-cache')!),'utf8')) as {sourceModelSha256:string;nativeModel:ConvertResult};
 if(cached.sourceModelSha256!==pkg.manifest.model.sha256||cached.nativeModel?.fileName!==pkg.model.name)throw Error('Native audit cache must be bound to these exact model bytes.');
 model=cached.nativeModel;
}else{
 const result=convertRvtBytes(new Uint8Array(await pkg.model.arrayBuffer()),pkg.model.name,{});if(!result.ok)throw Error(result.error);model=result;
}
const rooms=pkg.rooms.annotations.filter(r=>r.status!=='deleted'),details:unknown[]=[];
const links=supportedSemanticDoorLinks(model,pkg.rooms,pkg.manifest.model.sha256,pkg.rooms.navigation?.doorLinks??[]).links;
const identity=new Map(model.nativeIdentity?.identities.map(i=>[i.elementId,i.uniqueId]));
for(const levelId of [...new Set(rooms.map(r=>r.levelId))]){
 const onfloor=rooms.filter(r=>r.levelId===levelId);
 for(const review of directoryDoorReviews(onfloor,directoryDoors(model,levelId),links)){
  if(review.portal)continue;
  const d=review.door;
  const nearest=onfloor.filter(isWalkable).map(r=>{
   const q=[r.polygonFeet,...r.holesFeet??[]].map(p=>nearestRoomBoundary(d.point,p)).sort((a,b)=>a.distance-b.distance)[0]!;
   return {roomKey:r.key,name:r.name,number:r.number,building:roomBuilding(r),distanceFeet:q.distance,pointFeet:q.point,containsDoor:containsDirectoryRoomPoint(d.point,r),thresholdSide:d.normal?(q.point[0]-d.point[0])*d.normal[0]+(q.point[1]-d.point[1])*d.normal[1]:null};
  }).sort((a,b)=>a.distanceFeet-b.distanceFeet).slice(0,5);
  const precise=!!(d.footprint&&d.normal),candidateCount=review.candidates.length;
  details.push({levelId,nativeDoorId:d.id,nativeDoorUniqueId:identity.get(d.id)??null,nativeHostId:model.nativeHostRelations?.find(r=>r.elementId===d.id)?.hostId??null,pointFeet:d.point,preciseThreshold:precise,footprintFeet:d.footprint,normal:d.normal,candidateRoomKeys:review.candidates,nearest,
   correction:!precise?'Recover native threshold geometry and verify door host.':candidateCount<2?'Export phase-specific FromRoom/ToRoom and Finish boundaries; inspect missing room/door-side annotation coverage.':candidateCount>2?'Export phase-specific FromRoom/ToRoom; resolve overlapping or adjacent room ownership at this threshold.':'Inspect threshold side ownership and envelope; two nearby corners do not establish a doorway.'});
 }
}
const namedNative=model.elementBounds.filter(e=>/elevator|escalator|\blift\b/i.test([e.familyName,e.typeName,e.categoryName,JSON.stringify(e.parameters??[])].join(' '))).map(e=>({nativeElementId:e.elementId,nativeUniqueId:identity.get(e.elementId)??null,category:e.categoryName,family:e.familyName,type:e.typeName,associatedLevels:model.nativeAssociatedLevelRelations?.filter(r=>r.elementId===e.elementId).map(r=>r.levelId),boundsFeet:e.boundsFeet}));
const namedAreas=rooms.filter(r=>/elevator|escalator|\blift\b/i.test([r.name,r.number,r.walkabilityNotes].join(' '))).map(r=>({roomKey:r.key,levelId:r.levelId,name:r.name,number:r.number,building:roomBuilding(r)}));
const typed=details as {candidateRoomKeys:string[];preciseThreshold:boolean;nativeHostId:number|null}[];
const report={version:1,sourceModelSha256:pkg.manifest.model.sha256,sourceRoomsSha256:pkg.manifest.floors.sha256,summary:{unmatchedDoors:details.length,candidateCounts:Object.fromEntries([0,1,2,3,4].map(n=>[n,typed.filter(d=>d.candidateRoomKeys.length===n).length])),preciseThresholds:typed.filter(d=>d.preciseThreshold).length,nativeHosts:typed.filter(d=>d.nativeHostId!==null).length,namedNativeLiftElements:namedNative.length,namedLiftAreas:namedAreas.length},doors:details,lifts:{decodedNativeCandidates:namedNative,annotationCandidates:namedAreas,correction:'Annotation names and machine/control rooms do not establish a lift. Export native assembly identity, served floors, and per-floor entrance door IDs/anchors. Accessibility remains unknown until verified.'}};
await mkdir(dirname(resolve(out)),{recursive:true});await writeFile(resolve(out),JSON.stringify(report,null,2));console.log(JSON.stringify(report.summary,null,2));
