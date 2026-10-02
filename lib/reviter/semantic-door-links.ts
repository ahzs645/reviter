import type {ConvertResult} from './types.ts';
import type {RoomDirectoryData} from './room-directory.ts';
import {directoryDoors, reviewedDoorPortal, type ReviewedDoorLink} from './directory-navigation.ts';
/** Phase-specific Revit FromRoom/ToRoom evidence cannot replace threshold geometry. */
export type SemanticDoorInput = {
  doorId:number; nativeDoorUniqueId:string; phaseUniqueId:string; levelId:number;
  fromRoomKey:string; toRoomKey:string;
  fromNativeRoomUniqueId:string; toNativeRoomUniqueId:string;
};
export type SemanticDoorEvidence = {
  sourceModelSha256:string; exporter:string; nativeDoorUniqueId:string; phaseUniqueId:string;
  fromNativeRoomUniqueId:string; toNativeRoomUniqueId:string;
};
type Diagnostic={doorId:number;levelId:number;code:string;message:string};
function validEvidence(e:SemanticDoorEvidence|undefined,sha:string):e is SemanticDoorEvidence {
  return !!e && e.sourceModelSha256===sha && e.fromNativeRoomUniqueId!==e.toNativeRoomUniqueId && [e.exporter,e.nativeDoorUniqueId,e.phaseUniqueId,e.fromNativeRoomUniqueId,e.toNativeRoomUniqueId].every(s=>typeof s==='string'&&!!s.trim());
}
export function supportedSemanticDoorLinks(model:ConvertResult,data:RoomDirectoryData,sha:string,links:readonly ReviewedDoorLink[]) {
  const accepted:ReviewedDoorLink[]=[], diagnostics:Diagnostic[]=[];
  const identity=new Map(model.nativeIdentity?.identities.map(i=>[i.elementId,i.uniqueId]));
  const nativeDoors=new Map<number,ReturnType<typeof directoryDoors>>();
  for(const link of links){
    const evidence=link.semanticEvidence;
    if(!evidence){accepted.push(link);continue;}
    const fail=(code:string,message:string)=>diagnostics.push({doorId:link.doorId,levelId:link.levelId,code:`semantic-door-${code}`,message});
    if(!validEvidence(evidence,sha)){fail('stale-evidence','Re-export phase-specific door relationships for the exact model bytes.');continue;}
    if(link.rooms.some((key,i)=>{
      const p=data.annotations.find(r=>r.key===key)?.semanticInteriorProvenance as {nativeRoomUniqueId?:string;phaseUniqueId?:string}|undefined;
      return p && (p.nativeRoomUniqueId!==(i?evidence.toNativeRoomUniqueId:evidence.fromNativeRoomUniqueId)||p.phaseUniqueId!==evidence.phaseUniqueId);
    })){fail('phase','Saved room semantics no longer agree with the door phase or FromRoom/ToRoom identities.');continue;}
    if(identity.get(link.doorId)!==evidence.nativeDoorUniqueId){fail('identity','Native door ElementId and UniqueId must resolve to the same source element.');continue;}
    if(!model.nativeAssociatedLevelRelations?.some(r=>r.elementId===link.doorId&&r.levelId===link.levelId)){fail('threshold','Door has no persisted native association to the mapped floor.');continue;}
    let doors=nativeDoors.get(link.levelId);if(!doors){doors=directoryDoors(model,link.levelId);nativeDoors.set(link.levelId,doors);}
    const door=doors.find(d=>d.id===link.doorId);
    if(!door?.footprint || !door.normal){fail('threshold','A precise native opening and native level association are required.');continue;}
    const portal=reviewedDoorPortal(data.annotations.filter(r=>r.levelId===link.levelId),door,link);
    const side=(p:[number,number])=>(p[0]-door.point[0])*door.normal![0]+(p[1]-door.point[1])*door.normal![1];
    if(!portal || side(portal.from)*side(portal.to)>.0025){fail('geometry','Both semantic room boundaries must reach the actual native threshold; fix source boundaries before reconnecting.');continue;}
    accepted.push(link);
  }
  return {links:accepted,diagnostics};
}
/** Import only explicit room-key mappings in the same model/phase export. Exterior
 * null FromRoom/ToRoom entries remain audit findings, never imaginary rooms. */
export function applySemanticDoorLinks(model:ConvertResult,data:RoomDirectoryData,sha:string,raw:unknown) {
  const input=raw as {sourceModelSha256?:string;exporter?:string;rooms?:{roomKey:string;nativeRoomUniqueId:string;phaseUniqueId:string;levelId:number}[];doors?:SemanticDoorInput[]};
  if(!input || input.sourceModelSha256!==sha || typeof input.exporter!=='string'||!input.exporter.trim())throw Error('Semantic door export requires the exact source model and exporter identity.');
  if(input.doors===undefined)return {data,accepted:0,diagnostics:[] as Diagnostic[]};
  if(!Array.isArray(input.doors)||input.doors.length>20000||!Array.isArray(input.rooms))throw Error('Semantic doors require a finite explicit room mapping.');
  const pending:ReviewedDoorLink[]=[],diagnostics:Diagnostic[]=[];
  const duplicate=new Set(input.doors.filter((d,i,all)=>all.some((o,j)=>j!==i&&o?.doorId===d?.doorId)).map(d=>d?.doorId));
  for(const d of input.doors){
    const fail=(message:string)=>diagnostics.push({doorId:d?.doorId??-1,levelId:d?.levelId??-1,code:'semantic-door-room-mapping',message});
    if(!d||!Number.isSafeInteger(d.doorId)||!Number.isSafeInteger(d.levelId)||duplicate.has(d.doorId)||d.fromRoomKey===d.toRoomKey){fail('Door identity must be unique and connect two explicit room mappings.');continue;}
    const mapped=[['fromRoomKey','fromNativeRoomUniqueId'],['toRoomKey','toNativeRoomUniqueId']] as const;
    if(mapped.some(([key,id])=>{
      const rows=input.rooms!.filter(r=>r?.roomKey===d[key]&&r.nativeRoomUniqueId===d[id]&&r.phaseUniqueId===d.phaseUniqueId&&r.levelId===d.levelId);
      return rows.length!==1||input.rooms!.filter(r=>r?.nativeRoomUniqueId===d[id]).length!==1||!data.annotations.some(r=>r.key===d[key]&&r.levelId===d.levelId&&r.status!=='deleted');
    })){fail('FromRoom/ToRoom UniqueIds, phase and mapped floor must agree with the explicit room export.');continue;}
    pending.push({doorId:d.doorId,levelId:d.levelId,rooms:[d.fromRoomKey,d.toRoomKey],semanticEvidence:{sourceModelSha256:sha,exporter:input.exporter,nativeDoorUniqueId:d.nativeDoorUniqueId,phaseUniqueId:d.phaseUniqueId,fromNativeRoomUniqueId:d.fromNativeRoomUniqueId,toNativeRoomUniqueId:d.toNativeRoomUniqueId}});
  }
  const supported=supportedSemanticDoorLinks(model,data,sha,pending);diagnostics.push(...supported.diagnostics);
  const nav=data.navigation??{version:1 as const,doorLinks:[]};
  const acceptedKeys=new Set(supported.links.map(l=>`${l.levelId}:${l.doorId}`));
  return {data:{...data,navigation:{...nav,doorLinks:[...nav.doorLinks.filter(l=>!acceptedKeys.has(`${l.levelId}:${l.doorId}`)),...supported.links]}},accepted:supported.links.length,diagnostics};
}
