import type { IndoorDataset } from './indoor-contract.ts';
/** Reviewed floor-selection behaviour only. Physical doors and routing stay intact. */
export type SelectionDoorThresholds = {version:1;sourceModelSha256:string;doors:{levelId:number;nativeElementId:number;pointFeet:[number,number];normalFeet:[number,number];footprintFeet:[number,number][];roomKeys:string[];notes:string}[]};
export function validateSelectionDoorThresholds(value:unknown,modelSha?:string):asserts value is SelectionDoorThresholds|undefined {
 if(value===undefined)return;const v=value as SelectionDoorThresholds;
 const point=(p:unknown):p is [number,number]=>Array.isArray(p)&&p.length===2&&p.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<1e7);
 if(!v||v.version!==1||!(/^[a-f0-9]{64}$/).test(v.sourceModelSha256)||(modelSha!==undefined&&v.sourceModelSha256!==modelSha)||!Array.isArray(v.doors)||v.doors.length>10000||v.doors.some(d=>!d||!Number.isSafeInteger(d.levelId)||!Number.isSafeInteger(d.nativeElementId)||d.nativeElementId<=0||!point(d.pointFeet)||!point(d.normalFeet)||Math.hypot(...d.normalFeet)<1e-9||!Array.isArray(d.footprintFeet)||d.footprintFeet.length<3||d.footprintFeet.length>100||!d.footprintFeet.every(point)||!Array.isArray(d.roomKeys)||d.roomKeys.length!==2||new Set(d.roomKeys).size!==2||d.roomKeys.some(k=>typeof k!=='string'||!k)||typeof d.notes!=='string'||!d.notes.trim()||d.notes.length>10000)||new Set(v.doors.map(d=>`${d.levelId}:${d.nativeElementId}`)).size!==v.doors.length)throw new Error('Invalid reviewed selection threshold or source identity.');
}
export function selectionDoorIds(data:IndoorDataset,levelId:number):number[]{
 validateSelectionDoorThresholds(data.selectionDoorThresholds,data.source.modelSha256);
 return (data.selectionDoorThresholds?.doors??[]).filter(d=>d.levelId===levelId).map(saved=>{
  const d=data.doors?.find(d=>d.levelId===levelId&&d.nativeElementId===saved.nativeElementId);
  if(!d||d.state!=='connected'||JSON.stringify([d.pointFeet,d.normalFeet,d.footprintFeet,d.roomKeys])!==JSON.stringify([saved.pointFeet,saved.normalFeet,saved.footprintFeet,saved.roomKeys])||!data.edges.some(e=>e.id===d.id&&e.enabled&&e.kind==='door'&&e.nativeElementId===d.nativeElementId&&e.roomKeys.length===2&&e.roomKeys.every(k=>d.roomKeys.includes(k))))throw new Error('Reviewed selection threshold has stale geometry or no supported door route. Recheck before applying.');
  return saved.nativeElementId;
 });
}
export function validateSelectionDoorBinding(rooms:{selectionDoorThresholds?:SelectionDoorThresholds},data:IndoorDataset){
 if(JSON.stringify(rooms.selectionDoorThresholds)!==JSON.stringify(data.selectionDoorThresholds))throw new Error('Source and prepared selection thresholds differ. Regenerate the reviewed master.');
 for(const level of new Set(data.selectionDoorThresholds?.doors.map(d=>d.levelId)??[])){if(!data.nativeLevels.some(l=>l.id===level))throw new Error('Reviewed threshold belongs to a missing level.');selectionDoorIds(data,level);}
}
