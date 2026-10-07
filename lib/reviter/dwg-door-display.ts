export type CadDoorDisplayPoint=[number,number];
export type CadDoorDisplayFloor={primitives:{sourceHandle?:string;type?:string;pointsMetres:CadDoorDisplayPoint[]}[];doors:{arcHandles?:string[];leafHandles?:string[];leafSegmentsMetres?:CadDoorDisplayPoint[][]}[]};
/** Strip recognized swing/leaf strokes from derived display only, never source data. */
export function cadDoorDisplayStrokes(floor:CadDoorDisplayFloor,architectural:boolean):CadDoorDisplayPoint[][]{
 if(architectural)return floor.primitives.map(p=>p.pointsMetres);
 const arcs=new Set(floor.doors.flatMap(d=>d.arcHandles??[])),leaves=new Set(floor.doors.flatMap(d=>d.leafHandles??[]));
 const key=(ps:CadDoorDisplayPoint[])=>ps.map(p=>p.map(v=>v.toFixed(6)).join(',')).sort().join('|');
 const leafSegments=new Set(floor.doors.flatMap(d=>(d.leafSegmentsMetres??[]).map(key)));
 return floor.primitives.flatMap(p=>{
  if(p.sourceHandle&&arcs.has(p.sourceHandle))return [];
  if(p.type==='LINE'&&p.sourceHandle&&leaves.has(p.sourceHandle))return [];
  const result:CadDoorDisplayPoint[][]=[];let run:CadDoorDisplayPoint[]=[];
  for(let i=1;i<p.pointsMetres.length;i++){
   const a=p.pointsMetres[i-1]!,b=p.pointsMetres[i]!;
   if(leafSegments.has(key([a,b]))){if(run.length>1)result.push(run);run=[];}else{if(!run.length)run.push(a);run.push(b);}
  }
  if(run.length>1)result.push(run);return result;
 });
}
